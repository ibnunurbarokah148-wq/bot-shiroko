// ==========================================
// PROVIDER: GEMINI — Google Generative AI
// ==========================================
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GoogleAIFileManager } = require('@google/generative-ai/server');
const state = require('../../../config/state');
const memory = require('../memory');
const { getShirokoSystemPrompt, getShirokoGenerationConfig } = require('../prompts');
const { temporaryAudioFile, cleanupTemp, normalizeAudioMime, validateTranscript } = require('../media.service');
const { sanitizeInternalDisclosure } = require('../utils');

// Rotasi multi-API key
const GEMINI_API_KEYS = process.env.GEMINI_API_KEY
    ? process.env.GEMINI_API_KEY.split(',').map(key => key.trim())
    : [];

if (GEMINI_API_KEYS.length === 0) {
    console.error('GEMINI_API_KEY tidak ditemukan pada .env');
}

/**
 * Mendapatkan instance GenAI + FileManager dengan key acak.
 * @returns {{ genAI: GoogleGenerativeAI, fileManager: GoogleAIFileManager }}
 */
function getGeminiComponents() {
    const randomKey = GEMINI_API_KEYS[Math.floor(Math.random() * GEMINI_API_KEYS.length)];
    return { genAI: new GoogleGenerativeAI(randomKey), fileManager: new GoogleAIFileManager(randomKey) };
}

/**
 * Mendapatkan model Shiroko roleplay.
 * @returns {GenerativeModel}
 */
    function getShirokoModel() {
        const { genAI } = getGeminiComponents();
        return genAI.getGenerativeModel({
            model: "gemini-2.5-flash-lite",
            generationConfig: getShirokoGenerationConfig(),
            systemInstruction: getShirokoSystemPrompt(true) // Default owner mode for Shiroko model
        });
    }

    /**
     * Mendapatkan model Akademik.
     * @returns {GenerativeModel}
     */
    function getAkademikModel() {
        const { genAI } = getGeminiComponents();
        return genAI.getGenerativeModel({
            model: "gemini-2.5-flash-lite",
        generationConfig: { temperature: 0.7, topP: 0.9, maxOutputTokens: 8192 }
    });
}

const PROVIDER_NAME = 'gemini';

/**
 * Generate chat via Gemini Cloud (Unified ChatMemory).
 * @param {object} options
 * @param {string} options.prompt
 * @param {string} options.senderId
 * @param {boolean} options.isOwner
 * @param {string} [options.model='gemini-2.5-flash-lite']
 * @param {string|null} [options.systemPrompt]
 * @param {Buffer|null} [options.imageBuffer]
 * @returns {Promise<string>}
 */
async function generate({ prompt, senderId, isOwner, model = 'gemini-2.5-flash-lite', systemPrompt = null, imageBuffer = null, useMemory = true }) {
    const { genAI } = getGeminiComponents();
    const instruction = systemPrompt || getShirokoSystemPrompt(isOwner);
    const shouldKeepMemory = useMemory !== false;

    let contents;
    if (shouldKeepMemory) {
        // Inisialisasi memory jika belum ada
        if (!memory.get(senderId, PROVIDER_NAME)) {
            memory.init(senderId, PROVIDER_NAME);
        }

        // Push pesan user ke ChatMemory
        memory.push(senderId, PROVIDER_NAME, 'user', prompt);

        const historyMessages = memory.getMessages(senderId, PROVIDER_NAME);

        // Format histori pesan untuk Gemini API (role: 'user' | 'model')
        contents = historyMessages.map(m => {
            const role = (m.role === 'assistant' || m.role === 'model') ? 'model' : 'user';
            const parts = [{ text: m.content || '' }];
            return { role, parts };
        });

        // Lampirkan imageBuffer jika ada pada pesan user terakhir
        if (imageBuffer && contents.length > 0) {
            const lastMsg = contents[contents.length - 1];
            lastMsg.parts.push({
                inlineData: {
                    data: imageBuffer.toString('base64'),
                    mimeType: 'image/jpeg'
                }
            });
        }
    } else {
        // Single turn tanpa memory
        contents = [{
            role: 'user',
            parts: [{ text: prompt || '' }]
        }];
        if (imageBuffer) {
            contents[0].parts.push({
                inlineData: {
                    data: imageBuffer.toString('base64'),
                    mimeType: 'image/jpeg'
                }
            });
        }
    }

    const geminiModel = genAI.getGenerativeModel({
        model,
        generationConfig: getShirokoGenerationConfig(),
        systemInstruction: instruction
    });

    try {
        const result = await geminiModel.generateContent({ contents });
        const textResult = sanitizeInternalDisclosure(result.response.text());

        if (shouldKeepMemory) {
            // Simpan respon assistant ke ChatMemory
            memory.push(senderId, PROVIDER_NAME, 'assistant', textResult);
        }
        return textResult;
    } catch (err) {
        if (shouldKeepMemory) {
            memory.popLast(senderId, PROVIDER_NAME);
        }
        throw err;
    }
}

async function transcribe({ audioBuffer, mimeType = 'audio/ogg' }) {
    if (!audioBuffer) throw new Error('Data audio kosong.');
    const { fileManager, genAI } = getGeminiComponents();
    const normalizedAudio = normalizeAudioMime(mimeType);
    const temp = temporaryAudioFile(audioBuffer, normalizedAudio.mime);
    let uploaded;
    try {
        uploaded = await fileManager.uploadFile(temp.filePath, { mimeType: normalizedAudio.mime, displayName: 'WhatsApp Audio' });
        if (!uploaded?.file?.uri) throw new Error('Gemini tidak mengembalikan URI file audio.');
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
        const result = await model.generateContent([
            'Transkripsikan audio berikut secara akurat. Keluarkan hanya transkripnya, tanpa komentar atau rangkuman.',
            { fileData: { fileUri: uploaded.file.uri, mimeType: uploaded.file.mimeType || mimeType } }
        ]);
        return validateTranscript(result.response.text(), 'Gemini', 'gemini-2.5-flash-lite');
    } finally {
        if (uploaded?.file?.name) await fileManager.deleteFile(uploaded.file.name).catch(() => {});
        cleanupTemp(temp.dir);
    }
}

module.exports = {
    generate,
    getGeminiComponents,
    getShirokoModel,
    getAkademikModel,
    transcribe,
    GEMINI_API_KEYS
};
