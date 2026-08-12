// ==========================================
// PROVIDER: XKIRO — Multi-Model AI Gateway
// Base URL: https://api.xkiro.com/v1
// Compatible with OpenAI Chat Completions & Anthropic Messages format
// ==========================================
const axios = require('axios');
const state = require('../../../config/state');
const memory = require('../memory');
const { cleanThinkingLogs, extractOpenRouterText } = require('../utils');
const { getShirokoSystemPrompt } = require('../prompts');

const PROVIDER_NAME = 'xkiro';

// Multi-key rotation support
const XKIRO_API_KEYS = (process.env.XKIRO_API_KEY || process.env.XKIRO_KEY || '')
    .split(',')
    .map(k => k.trim())
    .filter(Boolean);

function getRandomKey() {
    if (XKIRO_API_KEYS.length === 0) {
        throw new Error('XKIRO_API_KEY tidak ditemukan pada file .env! Harap tambahkan XKIRO_API_KEY di .env.');
    }
    return XKIRO_API_KEYS[Math.floor(Math.random() * XKIRO_API_KEYS.length)];
}

/**
 * Generate chat via xKiro Gateway.
 * @param {object} options
 * @param {string} options.prompt
 * @param {string} options.senderId
 * @param {boolean} options.isOwner
 * @param {string} [options.model]
 * @param {string|null} [options.systemPrompt]
 * @returns {Promise<string>}
 */
async function generate({ prompt, senderId, isOwner, model, systemPrompt = null }) {
    const apiKey = getRandomKey();
    const modelName = model || state.userXKiroModel[senderId] || state.ownerXKiroModel || 'openai/gpt-4o';
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

    try {
        const response = await axios.post('https://api.xkiro.com/v1/chat/completions', {
            model: modelName,
            max_tokens: 4096,
            messages: payloadMessages
        }, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 60000
        });
        rawData = response.data;
    } catch (e) {
        memory.popLast(senderId, PROVIDER_NAME);
        const errMsg = e.response?.data?.error?.message || e.response?.data?.message || e.message;
        throw new Error(`xKiro Error (${modelName}): ${errMsg}`);
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
    throw new Error(`Respons xKiro (${modelName}) tidak valid atau kosong`);
}

/**
 * Scan daftar model live dari xKiro API.
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
async function fetchModels() {
    const apiKey = getRandomKey();
    try {
        const res = await axios.get('https://api.xkiro.com/v1/models', {
            headers: { 'Authorization': `Bearer ${apiKey}` },
            timeout: 15000
        });

        let allModels = res.data.data || res.data.models || [];
        if (!Array.isArray(allModels)) return getFallbackModels();

        const mapped = allModels.map(m => {
            const modelId = m.id || m.name || String(m);
            let cleanName = modelId;
            if (modelId.includes('/')) {
                cleanName = modelId.split('/')[1];
            }
            return { id: modelId, name: cleanName };
        });

        return mapped.length > 0 ? mapped : getFallbackModels();
    } catch (e) {
        console.warn(`[XKIRO] Gagal fetch live models, menggunakan catalog fallback: ${e.message}`);
        return getFallbackModels();
    }
}

function getFallbackModels() {
    return [
        { id: 'openai/gpt-4o', name: 'gpt-4o' },
        { id: 'openai/gpt-4o-mini', name: 'gpt-4o-mini' },
        { id: 'anthropic/claude-3-5-sonnet', name: 'claude-3-5-sonnet' },
        { id: 'deepseek/deepseek-r1', name: 'deepseek-r1' },
        { id: 'deepseek/deepseek-v3', name: 'deepseek-v3' },
        { id: 'google/gemini-2.5-flash', name: 'gemini-2.5-flash' },
        { id: 'z-ai/glm-4', name: 'glm-4' },
        { id: 'minimax/minimax-01', name: 'minimax-01' }
    ];
}

module.exports = {
    generate,
    fetchModels,
    XKIRO_API_KEYS
};
