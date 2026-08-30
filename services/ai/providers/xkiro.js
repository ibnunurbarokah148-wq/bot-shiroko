// ==========================================
// PROVIDER: XKIRO — Multi-Model AI Gateway
// Base URL: https://api.xkiro.com/v1
// Compatible with OpenAI Chat Completions & Anthropic Messages format
// ==========================================
const axios = require('axios');
const state = require('../../../config/state');
const memory = require('../memory');
const { cleanThinkingLogs, extractOpenRouterText, detectMimeType } = require('../utils');
const { prepareAudioForChatApi, validateTranscript } = require('../media.service');
const { getShirokoSystemPrompt } = require('../prompts');
const { getCoreNumber } = require('../../../utils/helpers');

const PROVIDER_NAME = 'xkiro';

// Model premium yang boleh dipakai VIP Premium Shiroko.
// Model lain tetap hanya tersedia untuk Owner karena saldo wallet Xkiro terpisah.
const XKIRO_PREMIUM_MODELS = Object.freeze({
    'openai/gpt-5.6-luna': { limitCost: 25 },
    'z-ai/glm-5.3-flash': { limitCost: 25 },
    'moonshotai/kimi-k2.6': { limitCost: 125 },
    'x-ai/grok-4.6': { limitCost: 200 }
});

function isXKiroModelFree(model) {
    return model?.billingType === 'free' || model?.accessTier === 'free';
}

function isXKiroModelAllowed(modelId, { isOwner = false, isPremium = false } = {}) {
    if (isOwner) return true;
    if (isPremium && Object.prototype.hasOwnProperty.call(XKIRO_PREMIUM_MODELS, modelId)) return true;
    return false;
}

function getXKiroModelCost(modelId, { isOwner = false, isPremium = false, model = null } = {}) {
    if (isOwner) return 0;
    if (isPremium && XKIRO_PREMIUM_MODELS[modelId]) return XKIRO_PREMIUM_MODELS[modelId].limitCost;
    if (isXKiroModelFree(model) || !model) return 1;
    return null;
}

function formatXKiroPricing(pricing = {}) {
    const input = Number(pricing.input || 0);
    const output = Number(pricing.output || 0);
    if (input === 0 && output === 0) return 'FREE';
    return `input $${input}/1M • output $${output}/1M`;
}

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

function resolveXKiroModel({ model, senderId } = {}) {
    const core = senderId && getCoreNumber(senderId);
    const selectedModel =
        model ||
        (senderId && state.userXKiroModel[senderId]) ||
        (core && state.userXKiroModel[core]) ||
        state.ownerXKiroModel ||
        'google/gemini-2.5-flash';

    // Pilihan GPT-4o lama tidak konsisten menerima input_audio di gateway xKiro.
    return selectedModel.includes('gpt-4o')
        ? 'google/gemini-2.5-flash'
        : selectedModel;
}

/**
 * Generate chat / vision via xKiro Gateway.
 * @param {object} options
 * @param {string} options.prompt
 * @param {string} options.senderId
 * @param {boolean} options.isOwner
 * @param {string} [options.model]
 * @param {string|null} [options.systemPrompt]
 * @param {Buffer|null} [options.imageBuffer]
 * @returns {Promise<string>}
 */
async function generate({ prompt, senderId, isOwner, model, systemPrompt = null, imageBuffer = null, useMemory = true }) {
    const apiKey = getRandomKey();
    const modelName = resolveXKiroModel({ model, senderId });

    const instruction = systemPrompt || getShirokoSystemPrompt(isOwner);

    const shouldKeepMemory = useMemory !== false;

    // Inisialisasi memory jika belum ada
    if (shouldKeepMemory && !memory.get(senderId, PROVIDER_NAME)) {
        memory.init(senderId, PROVIDER_NAME);
    }

    // Format payload pesan user (teks biasa atau vision payload)
    let userContent = prompt || 'Nn... Tolong analisis gambar ini.';
    if (imageBuffer) {
        const mime = detectMimeType(imageBuffer, 'image');
        const b64 = imageBuffer.toString('base64');
        userContent = [
            { type: 'text', text: prompt || 'Nn... Tolong analisis dan jelaskan gambar ini dengan detail.' },
            { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } }
        ];
    }

    // Push pesan user ke ChatMemory (simpan ringkasan pesan)
    if (shouldKeepMemory) memory.push(senderId, PROVIDER_NAME, 'user', prompt || '[Gambar]');

    const systemMessage = { role: 'system', content: instruction };
    const historyMessages = shouldKeepMemory ? memory.getMessages(senderId, PROVIDER_NAME) : [{ role: 'user', content: prompt || '[Gambar]' }];

    // Susun payload messages sesuai format OpenAI Chat Completions
    const payloadMessages = [systemMessage];

    for (let i = 0; i < historyMessages.length; i++) {
        const m = historyMessages[i];
        const isLastUser = (i === historyMessages.length - 1) && (m.role === 'user');

        if (isLastUser && imageBuffer) {
            payloadMessages.push({ role: 'user', content: userContent });
        } else {
            payloadMessages.push({ role: m.role, content: m.content });
        }
    }

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
        if (shouldKeepMemory) memory.popLast(senderId, PROVIDER_NAME);
        const errMsg = e.response?.data?.error?.message || e.response?.data?.message || e.message;
        throw new Error(`xKiro Error (${modelName}): ${errMsg}`);
    }

    if (rawData) {
        const extracted = extractOpenRouterText(rawData);
        if (extracted) {
            const cleanedAns = cleanThinkingLogs(extracted);
            if (shouldKeepMemory) memory.push(senderId, PROVIDER_NAME, 'assistant', cleanedAns);
            return cleanedAns;
        }
    }

    if (shouldKeepMemory) memory.popLast(senderId, PROVIDER_NAME);
    throw new Error(`Respons xKiro (${modelName}) tidak valid atau kosong`);
}

async function generateWithTools({ prompt, senderId, isOwner, model, systemPrompt = null, tools = [], executeTool, maxToolRounds = 3 }) {
    if (!Array.isArray(tools) || tools.length === 0) throw new Error('Tool xKiro belum dikonfigurasi.');
    if (typeof executeTool !== 'function') throw new TypeError('Executor tool xKiro wajib berupa function.');

    const apiKey = getRandomKey();
    const modelName = resolveXKiroModel({ model, senderId });
    const instruction = systemPrompt || getShirokoSystemPrompt(isOwner);
    if (!memory.get(senderId, PROVIDER_NAME)) memory.init(senderId, PROVIDER_NAME);

    const historyMessages = memory.getMessages(senderId, PROVIDER_NAME);
    const messages = [
        { role: 'system', content: instruction },
        ...historyMessages,
        { role: 'user', content: prompt || '' }
    ];

    for (let round = 0; round <= maxToolRounds; round++) {
        let response;
        try {
            response = await axios.post('https://api.xkiro.com/v1/chat/completions', {
                model: modelName,
                max_tokens: 4096,
                messages,
                tools,
                tool_choice: 'auto'
            }, {
                headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                timeout: 120000
            });
        } catch (error) {
            throw new Error(`xKiro Tool Error (${modelName}): ${error.response?.data?.error?.message || error.message}`);
        }

        const message = response.data?.choices?.[0]?.message;
        const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
        if (!toolCalls.length) {
            const text = cleanThinkingLogs(extractOpenRouterText(response.data));
            if (!text) throw new Error(`Respons xKiro (${modelName}) kosong setelah tool execution`);
            memory.push(senderId, PROVIDER_NAME, 'user', prompt || '');
            memory.push(senderId, PROVIDER_NAME, 'assistant', text);
            return text;
        }

        if (round === maxToolRounds) throw new Error('xKiro melewati batas maksimal tool call.');
        messages.push({ role: 'assistant', content: message.content ?? null, tool_calls: toolCalls });

        for (const call of toolCalls) {
            const name = call.function?.name;
            let args;
            try {
                args = JSON.parse(call.function?.arguments || '{}');
            } catch (error) {
                args = { _parseError: error.message };
            }
            let result;
            try {
                result = await executeTool(name, args, { senderId, isOwner, model: modelName });
            } catch (error) {
                result = { ok: false, error: error.message };
            }
            messages.push({
                role: 'tool',
                tool_call_id: call.id,
                content: JSON.stringify(result ?? { ok: true })
            });
        }
    }
}

async function transcribe({ audioBuffer, mimeType = 'audio/ogg', model, senderId }) {
    const apiKey = getRandomKey();
    const modelName = resolveXKiroModel({ model, senderId });
    const { buffer: preparedAudio, format, converted } = prepareAudioForChatApi(audioBuffer, mimeType);

    console.log(`[AUDIO] provider=xkiro model=${modelName} mime=${mimeType} format=${format} converted=${converted} bytes=${preparedAudio.length}`);
    const response = await axios.post('https://api.xkiro.com/v1/chat/completions', {
        model: modelName,
        messages: [{ role: 'user', content: [
            { type: 'text', text: 'Transkripsikan audio ini secara akurat. Keluarkan hanya transkripnya.' },
            { type: 'input_audio', input_audio: { data: preparedAudio.toString('base64'), format } }
        ] }]
    }, {
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        timeout: 120000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity
    });
    const text = extractOpenRouterText(response.data);
    if (!text) {
        console.error('[AUDIO] Respons mentah xKiro:', JSON.stringify(response.data).slice(0, 500));
    }
    const transcript = validateTranscript(cleanThinkingLogs(text), 'xKiro', modelName);
    console.log(`[AUDIO] xKiro menjawab: ${transcript.slice(0, 200)}`);
    return transcript;
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
            const cleanName = m.display_name || modelId;
            const accessTier = m.access_tier || 'unknown';
            const pricing = m.pricing || {};
            const inputPrice = Number(pricing.input || 0);
            const outputPrice = Number(pricing.output || 0);
            const isFree = accessTier === 'free' && inputPrice === 0 && outputPrice === 0;
            return {
                id: modelId,
                name: cleanName,
                accessTier,
                pricing,
                capabilities: m.capabilities || {},
                billingType: isFree ? 'free' : accessTier,
                limitCost: isFree ? 1 : null
            };
        });

        return (mapped.length > 0 ? mapped : getFallbackModels())
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    } catch (e) {
        console.warn(`[XKIRO] Gagal fetch live models, menggunakan catalog fallback: ${e.message}`);
        return getFallbackModels();
    }
}

function getFallbackModels() {
    return [
        { id: 'deepseek/deepseek-v4-flash', name: 'DeepSeek V4 Flash', accessTier: 'free', billingType: 'free', limitCost: 1, capabilities: { tools: true } },
        { id: 'deepseek/deepseek-v3.2', name: 'DeepSeek V3.2', accessTier: 'free', billingType: 'free', limitCost: 1, capabilities: { tools: true } },
        { id: 'qwen/qwen3.5-flash', name: 'Qwen 3.5 Flash', accessTier: 'free', billingType: 'free', limitCost: 1, capabilities: { tools: true } },
        { id: 'mistralai/devstral-medium', name: 'Devstral 2', accessTier: 'free', billingType: 'free', limitCost: 1, capabilities: { tools: true } }
    ].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

module.exports = {
    generate,
    generateWithTools,
    transcribe,
    fetchModels,
    resolveXKiroModel,
    XKIRO_PREMIUM_MODELS,
    isXKiroModelFree,
    isXKiroModelAllowed,
    getXKiroModelCost,
    formatXKiroPricing,
    XKIRO_API_KEYS
};
