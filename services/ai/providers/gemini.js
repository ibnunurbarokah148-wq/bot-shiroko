// ==========================================
// PROVIDER: GEMINI — Google Generative AI
// ==========================================
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GoogleAIFileManager } = require('@google/generative-ai/server');
const state = require('../../../config/state');
const memory = require('../memory');
const { getShirokoSystemPrompt, getShirokoGenerationConfig } = require('../prompts');

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

/**
 * Generate chat via Gemini Cloud (managed chat session).
 * @param {object} options
 * @param {string} options.prompt
 * @param {string} options.senderId
 * @param {boolean} options.isOwner
 * @param {string} [options.model='gemini-2.5-flash-lite']
 * @param {string|null} [options.systemPrompt]
 * @param {Buffer|null} [options.imageBuffer]
 * @returns {Promise<string>}
 */
async function generate({ prompt, senderId, isOwner, model = 'gemini-2.5-flash-lite', systemPrompt = null, imageBuffer = null }) {
    const { genAI } = getGeminiComponents();

    const instruction = systemPrompt || getShirokoSystemPrompt(isOwner);

    // Gunakan chat session dari state (Gemini SDK mengelola histori sendiri)
    if (!state.sesiObrolan[senderId]) {
        const geminiModel = genAI.getGenerativeModel({
            model,
            generationConfig: getShirokoGenerationConfig(),
            systemInstruction: instruction
        });
        state.sesiObrolan[senderId] = geminiModel.startChat({ history: [] });
    }

    let messageParts;
    if (imageBuffer) {
        messageParts = [
            prompt,
            { inlineData: { data: imageBuffer.toString('base64'), mimeType: 'image/jpeg' } }
        ];
    } else {
        messageParts = prompt;
    }

    const result = await state.sesiObrolan[senderId].sendMessage(messageParts);
    return result.response.text();
}

module.exports = {
    generate,
    getGeminiComponents,
    getShirokoModel,
    getAkademikModel,
    GEMINI_API_KEYS
};
