// ==========================================
// PROVIDER: COPILOTKU — Multi-Model AI Gateway
// Base URL: https://anthropic.platfrom-claude.com/v1
// Compatible with OpenAI Chat Completions & Anthropic Messages format
// ==========================================
const axios = require('axios');
const state = require('../../../config/state');
const BASE_URL = 'https://anthropic.platfrom-claude.com/v1';
const COPILOTKU_CATALOG = require('../../../copilotku-models.json');
const COPILOTKU_MODEL_IDS = new Set(COPILOTKU_CATALOG.map(model => model.id));
const memory = require('../memory');
const { cleanThinkingLogs, extractOpenRouterText, detectMimeType } = require('../utils');
const { prepareAudioForChatApi, validateTranscript } = require('../media.service');
const { getShirokoSystemPrompt } = require('../prompts');
const { getCoreNumber } = require('../../../utils/helpers');

const PROVIDER_NAME = 'copilotku';

// Model premium yang boleh dipakai VIP Premium Shiroko.
// Model lain tetap hanya tersedia untuk Owner karena saldo wallet Copilotku terpisah.
const COPILOTKU_PREMIUM_MODELS = Object.freeze({
    'fable-5': { limitCost: 25 },
    'fable-5.1': { limitCost: 25 },
    'opus[1m]': { limitCost: 125 },
    'Opus-4.8': { limitCost: 200 },
    'Opus-4.7': { limitCost: 200 },
    'Haiku-4.5': { limitCost: 25 },
    'Sonnet-5': { limitCost: 125 },
    'GLM-5.3': { limitCost: 25 },
    'GPT-6 Astra': { limitCost: 200 },
    'GPT-5.6 Sol': { limitCost: 125 },
    'GPT-5.6 Terra': { limitCost: 125 },
    'GPT-5.6 Luna': { limitCost: 125 },
    'GPT-5.5': { limitCost: 125 },
    'GPT-5.4': { limitCost: 100 },
    'GPT-5.4 mini': { limitCost: 50 },
    'GPT-5.3-Codex': { limitCost: 125 },
    'GPT-5 mini': { limitCost: 50 },
    'Gemini 3.6 Flash': { limitCost: 25 },
    'Gemini 3.7 Flash': { limitCost: 25 },
    'Gemini 3.8 Flash': { limitCost: 25 },
    'GLM-5.3-Flash': { limitCost: 25 },
    'Gemini 3.5 Flash': { limitCost: 25 },
    'Gemini 3.1 Pro': { limitCost: 50 },
    'Grok 4.5': { limitCost: 125 },
    'Grok 4.6': { limitCost: 200 },
    'Raptor mini': { limitCost: 50 },
    'Kimi K2.7 Code': { limitCost: 125 },
    'Kimi K3': { limitCost: 125 }
});

function isCopilotkuModelFree(model) {
    return model?.billingType === 'free' || model?.accessTier === 'free';
}

function isCopilotkuCatalogModel(modelId) {
    return COPILOTKU_MODEL_IDS.has(modelId);
}

function isCopilotkuModelAllowed(modelId, { isOwner = false, isPremium = false } = {}) {
    if (isOwner) return COPILOTKU_MODEL_IDS.has(modelId);
    if (isPremium && COPILOTKU_MODEL_IDS.has(modelId) && Object.prototype.hasOwnProperty.call(COPILOTKU_PREMIUM_MODELS, modelId)) return true;
    return false;
}

function getCopilotkuModelCost(modelId, { isOwner = false, isPremium = false, model = null } = {}) {
    if (isOwner) return 0;
    if (isPremium && COPILOTKU_MODEL_IDS.has(modelId) && COPILOTKU_PREMIUM_MODELS[modelId]) return COPILOTKU_PREMIUM_MODELS[modelId].limitCost;
    if (isCopilotkuModelFree(model) || !model) return 1;
    return null;
}

function formatCopilotkuPricing(pricing = {}) {
    const input = Number(pricing.input || 0);
    const output = Number(pricing.output || 0);
    if (input === 0 && output === 0) return 'FREE';
    return `input $${input}/1M • output $${output}/1M`;
}

// Multi-key rotation support
const COPILOTKU_API_KEYS = (process.env.COPILOTKU_API_KEY || '')
    .split(',')
    .map(k => k.trim())
    .filter(Boolean);

function getRandomKey() {
    if (COPILOTKU_API_KEYS.length === 0) {
        throw new Error('COPILOTKU_API_KEY tidak ditemukan pada file .env! Harap tambahkan COPILOTKU_API_KEY di .env.');
    }
    return COPILOTKU_API_KEYS[Math.floor(Math.random() * COPILOTKU_API_KEYS.length)];
}

function resolveCopilotkuModel({ model, senderId, isOwner } = {}) {
    const core = senderId && getCoreNumber(senderId);
    return model ||
        (senderId && state.userCopilotkuModel[senderId]) ||
        (core && state.userCopilotkuModel[core]) ||
        (isOwner && state.ownerCopilotkuModel) ||
        'GPT-5.6 Luna';
}

/**
 * Generate chat / vision via Copilotku Gateway.
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
    const modelName = resolveCopilotkuModel({ model, senderId });

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

    const systemMessage = { role: 'developer', content: instruction };
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
        const response = await axios.post(`${BASE_URL}/chat/completions`, {
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
        throw new Error(`Copilotku Error (${modelName}): ${errMsg}`);
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
    throw new Error(`Respons Copilotku (${modelName}) tidak valid atau kosong`);
}

async function generateWithTools({ prompt, senderId, isOwner, model, systemPrompt = null, tools = [], executeTool, maxToolRounds = 3, imageBuffer = null, imageMimeType = null }) {
    if (!Array.isArray(tools) || tools.length === 0) throw new Error('Tool Copilotku belum dikonfigurasi.');
    if (typeof executeTool !== 'function') throw new TypeError('Executor tool Copilotku wajib berupa function.');

    const apiKey = getRandomKey();
    const modelName = resolveCopilotkuModel({ model, senderId });
    const instruction = systemPrompt || getShirokoSystemPrompt(isOwner);
    if (!memory.get(senderId, PROVIDER_NAME)) memory.init(senderId, PROVIDER_NAME);

    const historyMessages = memory.getMessages(senderId, PROVIDER_NAME);
    const userContent = imageBuffer ? [
        { type: 'text', text: prompt || 'Nn... Tolong analisis gambar ini.' },
        { type: 'image_url', image_url: { url: `data:${imageMimeType || detectMimeType(imageBuffer, 'image')};base64,${imageBuffer.toString('base64')}` } }
    ] : (prompt || '');
    const messages = [
        { role: 'developer', content: instruction },
        ...historyMessages,
        { role: 'user', content: userContent }
    ];

    for (let round = 0; round <= maxToolRounds; round++) {
        let response;
        try {
            response = await axios.post(`${BASE_URL}/chat/completions`, {
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
            throw new Error(`Copilotku Tool Error (${modelName}): ${error.response?.data?.error?.message || error.message}`);
        }

        const message = response.data?.choices?.[0]?.message;
        const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
        if (!toolCalls.length) {
            const text = cleanThinkingLogs(extractOpenRouterText(response.data));
            if (!text) throw new Error(`Respons Copilotku (${modelName}) kosong setelah tool execution`);
            memory.push(senderId, PROVIDER_NAME, 'user', prompt || '');
            memory.push(senderId, PROVIDER_NAME, 'assistant', text);
            return text;
        }

        if (round === maxToolRounds) throw new Error('Copilotku melewati batas maksimal tool call.');
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

const COPILOTKU_TTS_FORMATS = new Set(['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm']);
const COPILOTKU_TTS_MIME = Object.freeze({
    mp3: 'audio/mpeg',
    opus: 'audio/ogg',
    aac: 'audio/aac',
    flac: 'audio/flac',
    wav: 'audio/wav',
    pcm: 'audio/pcm'
});

async function textToSpeech(textInput, voice = process.env.COPILOTKU_TTS_VOICE || 'mexican-female', options = {}) {
    const input = String(textInput || '').trim();
    if (!input) throw new Error('Teks TTS Copilotku tidak boleh kosong.');

    const responseFormat = String(options.responseFormat || process.env.COPILOTKU_TTS_FORMAT || 'mp3').toLowerCase();
    if (!COPILOTKU_TTS_FORMATS.has(responseFormat)) {
        throw new Error(`Format TTS Copilotku tidak didukung: ${responseFormat}`);
    }

    const payload = {
        model: options.model || process.env.COPILOTKU_TTS_MODEL || 'copilotku-voice',
        input,
        voice,
        response_format: responseFormat,
        speed: Number(options.speed ?? process.env.COPILOTKU_TTS_SPEED ?? 1)
    };
    if (!Number.isFinite(payload.speed) || payload.speed < 0.25 || payload.speed > 4) {
        throw new Error('Kecepatan TTS Copilotku harus antara 0.25 sampai 4.0.');
    }
    if (options.pitch !== undefined) payload.pitch = Number(options.pitch);
    if (options.volume !== undefined) payload.volume = Number(options.volume);
    if (options.emotion) payload.emotion = String(options.emotion);

    try {
        const response = await axios.post(`${BASE_URL}/audio/speech`, payload, {
            headers: {
                Authorization: `Bearer ${getRandomKey()}`,
                'Content-Type': 'application/json',
                Accept: COPILOTKU_TTS_MIME[responseFormat]
            },
            responseType: 'arraybuffer',
            timeout: 95000,
            maxContentLength: Infinity,
            maxBodyLength: Infinity
        });
        const buffer = Buffer.from(response.data);
        if (!buffer.length) throw new Error('Copilotku mengembalikan audio kosong.');
        return { buffer, mime: COPILOTKU_TTS_MIME[responseFormat], format: responseFormat, voice: payload.voice };
    } catch (error) {
        let detail = error.message;
        if (error.response?.data) {
            try {
                const parsed = JSON.parse(Buffer.from(error.response.data).toString('utf8'));
                detail = parsed?.error?.message || parsed?.message || detail;
            } catch {}
        }
        throw new Error(`Copilotku TTS Error: ${detail}`);
    }
}

function getConfiguredTTSVoices() {
    const configured = String(process.env.COPILOTKU_TTS_VOICES || process.env.COPILOTKU_TTS_VOICE || 'mexican-female')
        .split(',')
        .map(id => id.trim())
        .filter(Boolean);
    return [...new Set(configured)].map(id => ({ id, name: id.replace(/[-_]+/g, ' '), desc: 'Copilotku Voice' }));
}

async function fetchTTSVoices(filters = {}) {
    const params = {};
    for (const key of ['locale', 'languageKey', 'gender', 'isVip', 'q', 'offset', 'limit']) {
        if (filters[key] !== undefined && filters[key] !== null && filters[key] !== '') params[key] = filters[key];
    }
    const response = await axios.get(`${BASE_URL}/audio/voices`, { params, timeout: 15000 });
    const voices = response.data?.voices;
    if (!Array.isArray(voices)) throw new Error('Daftar voice Copilotku tidak valid.');
    return voices.map(voice => ({
        id: voice.id,
        name: voice.name || voice.id,
        locale: voice.locale || null,
        languageKey: voice.languageKey || null,
        gender: voice.gender || null,
        isVip: voice.isVip === true,
        desc: [voice.locale, voice.gender, voice.isVip ? 'VIP' : 'Standard'].filter(Boolean).join(' • ') || 'Copilotku Voice'
    }));
}

async function transcribe({ audioBuffer, mimeType = 'audio/ogg', model, senderId }) {
    const apiKey = getRandomKey();
    const modelName = resolveCopilotkuModel({ model, senderId });
    const { buffer: preparedAudio, format, converted } = prepareAudioForChatApi(audioBuffer, mimeType);

    console.log(`[AUDIO] provider=copilotku model=${modelName} mime=${mimeType} format=${format} converted=${converted} bytes=${preparedAudio.length}`);
    const response = await axios.post(`${BASE_URL}/chat/completions`, {
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
        console.error('[AUDIO] Respons mentah Copilotku:', JSON.stringify(response.data).slice(0, 500));
    }
    const transcript = validateTranscript(cleanThinkingLogs(text), 'Copilotku', modelName);
    console.log(`[AUDIO] Copilotku menjawab: ${transcript.slice(0, 200)}`);
    return transcript;
}

/**
 * Scan daftar model live dari Copilotku API.
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
async function fetchModels() {
    try {
        const apiKey = getRandomKey();
        const res = await axios.get(`${BASE_URL}/models`, {
            headers: { 'Authorization': `Bearer ${apiKey}` },
            timeout: 15000
        });

        let allModels = res.data.data || res.data.models || [];
        if (!Array.isArray(allModels)) return getFallbackModels();
        allModels = allModels.filter(model => COPILOTKU_MODEL_IDS.has(model.id || model.name));

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
                limitCost: isFree ? 1 : (COPILOTKU_PREMIUM_MODELS[modelId]?.limitCost || null)
            };
        });

        return (mapped.length > 0 ? mapped : getFallbackModels())
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    } catch (e) {
        console.warn(`[COPILOTKU] Gagal fetch live models, menggunakan catalog fallback: ${e.message}`);
        return getFallbackModels();
    }
}

function getFallbackModels() {
    return COPILOTKU_CATALOG.map(model => ({
        id: model.id,
        name: model.name || model.id,
        accessTier: 'premium',
        billingType: 'premium',
        limitCost: COPILOTKU_PREMIUM_MODELS[model.id]?.limitCost || 1,
        capabilities: {}
    })).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

module.exports = {
    generate,
    generateWithTools,
    transcribe,
    textToSpeech,
    getConfiguredTTSVoices,
    fetchTTSVoices,
    fetchModels,
    resolveCopilotkuModel,
    COPILOTKU_PREMIUM_MODELS,
    isCopilotkuCatalogModel,
    isCopilotkuModelFree,
    isCopilotkuModelAllowed,
    getCopilotkuModelCost,
    formatCopilotkuPricing,
    COPILOTKU_API_KEYS
};
