// ==========================================
// PROVIDER: ARISU — ArisuSoft API
// Mendukung: deepseek-v3, deepseek-v4, glm, qwen, gemini, gpt, grok
// ==========================================
const axios = require('axios');
const memory = require('../memory');
const { cleanThinkingLogs, detectMimeType } = require('../utils');
const { getShirokoArisuPrompt } = require('../prompts');

const PROVIDER_NAME = 'arisu';

/**
 * Generate chat via ArisuSoft API.
 * @param {object} options
 * @param {string} options.prompt
 * @param {string} options.senderId
 * @param {boolean} options.isOwner
 * @param {string} options.model - Endpoint model: 'deepseek-v3', 'deepseek-v4', 'glm', 'qwen', 'gemini', 'gpt', 'grok'
 * @param {string|null} [options.systemPrompt]
 * @returns {Promise<string>}
 */
async function generate({ prompt, senderId, isOwner, model, systemPrompt = null, useMemory = true }) {
    const apiKey = process.env.ARISU_API_KEY;
    if (!apiKey) throw new Error('ARISU_API_KEY tidak ditemukan pada .env');

    const modelEndpoint = model || 'deepseek-v3';
    const instruction = systemPrompt || getShirokoArisuPrompt(isOwner);
    const shouldKeepMemory = useMemory !== false;

    let combinedMessage = '';
    if (shouldKeepMemory) {
        // Inisialisasi memory jika belum ada
        if (!memory.get(senderId, PROVIDER_NAME)) {
            memory.init(senderId, PROVIDER_NAME);
        }

        // Push user message
        memory.push(senderId, PROVIDER_NAME, 'user', prompt);

        const messages = memory.getMessages(senderId, PROVIDER_NAME);

        // Build combined message dengan histori (format Arisu yang unik)
        if (messages.length > 1) {
            combinedMessage += '[Histori Obrolan Sebelumnya]\n';
            messages.slice(0, -1).forEach(m => {
                combinedMessage += `${m.role === 'user' ? (isOwner ? 'Suamiku' : 'Sensei') : 'Shiroko'}: ${m.content}\n`;
            });
            combinedMessage += '\n[Pesan Baru]\n';
        }
    }
    combinedMessage += `${isOwner ? 'Suamiku' : 'Sensei'}: ${prompt}`;

    try {
        const response = await axios.post(`https://api.arisusoft.com/api/v2/llm/${modelEndpoint}`, {
            message: combinedMessage,
            system_prompt: instruction
        }, {
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json"
            },
            timeout: 300000
        });

        if (response.data.success && response.data.data && response.data.data.message) {
            const balasanAI = cleanThinkingLogs(response.data.data.message);
            if (shouldKeepMemory) {
                memory.push(senderId, PROVIDER_NAME, 'assistant', balasanAI);
            }
            return balasanAI;
        } else {
            if (shouldKeepMemory) memory.popLast(senderId, PROVIDER_NAME);
            console.error('Arisu API Error:', response.data.error);
            return `Nn... Maaf Sayang, gagal memproses dari Arisu (${modelEndpoint}).`;
        }
    } catch (error) {
        if (shouldKeepMemory) memory.popLast(senderId, PROVIDER_NAME);
        console.error('🚨 ERROR ARISU:', error.message);
        return 'Nn... Maaf Sayang, jalur Arisu terputus (Timeout/Error).';
    }
}

/**
 * Text-to-Speech via ArisuSoft API.
 * @param {string} textInput
 * @param {string} [modelType='arisu-basic'] - 'arisu-basic' atau 'arisu-voicevox'/'voicevox'
 * @returns {Promise<{buffer: Buffer, mime: string}>}
 */
async function textToSpeech(textInput, modelType = 'arisu-basic') {
    const apiKey = process.env.ARISU_API_KEY;
    if (!apiKey) throw new Error("ARISU_API_KEY tidak terpasang di file .env");

    let url = '';
    if (modelType === 'voicevox' || modelType === 'arisu-voicevox') {
        url = `https://api.arisusoft.com/api/v2/tools/voicevox?text=${encodeURIComponent(textInput)}&speaker=3&style=jp`;
    } else {
        url = `https://api.arisusoft.com/api/v2/tools/tts?text=${encodeURIComponent(textInput)}&voice=id`;
    }

    const response = await axios.get(url, {
        headers: { "Authorization": `Bearer ${apiKey}` },
        timeout: 30000
    });

    if (response.data && response.data.success && response.data.data?.url) {
        const audioRes = await axios.get(response.data.data.url, { responseType: 'arraybuffer', timeout: 30000 });
        const rawBuffer = Buffer.from(audioRes.data);
        return { buffer: rawBuffer, mime: detectMimeType(rawBuffer, 'audio') };
    }

    throw new Error(`ArisuSoft TTS (${modelType}) Error: ${JSON.stringify(response.data?.error || response.data)}`);
}

/**
 * Mendapatkan daftar model TTS Arisu.
 * @returns {Array<{id: string, name: string, desc: string}>}
 */
function fetchTTSModels() {
    return [
        {
            id: 'arisu-basic',
            name: 'Arisu Basic TTS (Bahasa Indonesia)',
            desc: 'Suara Bahasa Indonesia Natural & Jernih (ArisuSoft API)'
        },
        {
            id: 'arisu-voicevox',
            name: 'Arisu Voicevox (Anime Voice JP)',
            desc: 'Suara Anime Jepang Voicevox (Auto Translate Indo -> JP)'
        }
    ];
}

module.exports = {
    generate,
    textToSpeech,
    fetchTTSModels
};
