// ==========================================
// PROVIDER: OPENROUTER — Multi-Model API
// ==========================================
const axios = require('axios');
const state = require('../../../config/state');
const memory = require('../memory');
const { cleanThinkingLogs, extractOpenRouterText } = require('../utils');
const { getShirokoSystemPrompt } = require('../prompts');

const PROVIDER_NAME = 'openrouter';

// Multi-key rotation
const OPENROUTER_API_KEYS = process.env.OPENROUTER_API_KEY
    ? process.env.OPENROUTER_API_KEY.split(',').map(k => k.trim())
    : [];

function getRandomKey() {
    if (OPENROUTER_API_KEYS.length === 0) throw new Error('OPENROUTER_API_KEY tidak ditemukan pada .env');
    return OPENROUTER_API_KEYS[Math.floor(Math.random() * OPENROUTER_API_KEYS.length)];
}

/**
 * Generate chat via OpenRouter.
 * @param {object} options
 * @param {string} options.prompt
 * @param {string} options.senderId
 * @param {boolean} options.isOwner
 * @param {string} [options.model='deepseek/deepseek-r1:free']
 * @param {string|null} [options.systemPrompt]
 * @returns {Promise<string>}
 */
async function generate({ prompt, senderId, isOwner, model, systemPrompt = null }) {
    const apiKey = getRandomKey();
    const modelName = model || state.userOpenRouterModel[senderId] || 'deepseek/deepseek-r1:free';
    const instruction = systemPrompt || getShirokoSystemPrompt(isOwner);

    // Inisialisasi memory jika belum ada
    if (!memory.get(senderId, PROVIDER_NAME)) {
        memory.init(senderId, PROVIDER_NAME);
    }

    // Push user message
    memory.push(senderId, PROVIDER_NAME, 'user', prompt);

    const systemMessage = { role: 'system', content: instruction };
    const payloadMessages = [systemMessage, ...memory.getMessages(senderId, PROVIDER_NAME)];

    let rawData = null;

    // Attempt 1: Standar request
    try {
        const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
            model: modelName,
            include_reasoning: false,
            max_tokens: 4096,
            messages: payloadMessages
        }, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://github.com/ibnunurbarokah148-wq/bot-shiroko',
                'X-Title': 'Shiroko Bot'
            },
            timeout: 60000
        });
        rawData = response.data;
    } catch (e1) {
        // Attempt 2: Fallback tanpa parameter non-standar
        try {
            const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
                model: modelName,
                messages: payloadMessages
            }, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'https://github.com/ibnunurbarokah148-wq/bot-shiroko',
                    'X-Title': 'Shiroko Bot'
                },
                timeout: 60000
            });
            rawData = response.data;
        } catch (e2) {
            memory.popLast(senderId, PROVIDER_NAME);
            const errMsg = e2.response?.data?.error?.message || e2.message;
            throw new Error(`OpenRouter Error (${modelName}): ${errMsg}`);
        }
    }

    if (rawData) {
        const extracted = extractOpenRouterText(rawData);
        if (extracted) {
            const cleanedAns = cleanThinkingLogs(extracted);
            memory.push(senderId, PROVIDER_NAME, 'assistant', cleanedAns);
            return cleanedAns;
        }
    }

    memory.popLast(senderId, PROVIDER_NAME);
    throw new Error(`Respons OpenRouter (${modelName}) tidak valid atau kosong`);
}

async function transcribe({ audioBuffer, mimeType = 'audio/ogg', model }) {
    const apiKey = getRandomKey();
    const modelName = model || 'google/gemini-2.5-flash';
    const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
        model: modelName,
        messages: [{ role: 'user', content: [
            { type: 'text', text: 'Transkripsikan audio ini secara akurat. Keluarkan hanya transkripnya.' },
            { type: 'input_audio', input_audio: { data: audioBuffer.toString('base64'), format: mimeType.split('/')[1] || 'ogg' } }
        ] }]
    }, { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 120000 });
    const text = extractOpenRouterText(response.data);
    if (!text) throw new Error(`Model OpenRouter ${modelName} tidak mengembalikan transkrip.`);
    return cleanThinkingLogs(text);
}

/**
 * Scan daftar model live dari OpenRouter API.
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
async function fetchModels() {
    const apiKey = getRandomKey();
    const res = await axios.get('https://openrouter.ai/api/v1/models', {
        headers: { 'Authorization': `Bearer ${apiKey}` }
    });

    let allModels = res.data.data || [];
    let freeModels = allModels.filter(m => m.id && m.id.includes(':free'));
    if (freeModels.length === 0) freeModels = allModels;

    return freeModels.map(m => {
        let cleanName = m.id;
        if (m.id && m.id.includes('/')) {
            cleanName = m.id.split('/')[1];
        }
        return { id: m.id, name: cleanName };
    });
}

module.exports = {
    generate,
    transcribe,
    fetchModels,
    OPENROUTER_API_KEYS
};
