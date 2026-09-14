const axios = require('axios');
const state = require('../../../config/state');
const memory = require('../memory');
const { cleanThinkingLogs, extractOpenRouterText, detectMimeType } = require('../utils');
const { prepareAudioForChatApi, validateTranscript } = require('../media.service');
const { getShirokoSystemPrompt } = require('../prompts');
const { getCoreNumber } = require('../../../utils/helpers');

const BASE_URL = 'https://my.vpsmurah.co.id/api/v1';
const PROVIDER_NAME = 'vpsmurah';
const VPSMURAH_MODELS = Object.freeze({
    'deepseek-v32': { name: 'DeepSeek V3.2', limitCost: 25 },
    'deepseek-v3': { name: 'DeepSeek V4 Pro', limitCost: 200 },
    luna: { name: 'GPT-5.6 Luna', limitCost: 125 },
    'qwen3-max': { name: 'Qwen3 Max', limitCost: 50 }
});
const VPSMURAH_API_KEYS = (process.env.VPSMURAH_API_KEY || '')
    .split(',')
    .map(key => key.trim())
    .filter(Boolean);

function getRandomKey() {
    if (VPSMURAH_API_KEYS.length === 0) throw new Error('VPSMURAH_API_KEY tidak ditemukan pada file .env.');
    return VPSMURAH_API_KEYS[Math.floor(Math.random() * VPSMURAH_API_KEYS.length)];
}

function getVpsMurahModelCost(modelId, { isOwner = false, isPremium = false } = {}) {
    if (isOwner) return 0;
    if (isPremium && VPSMURAH_MODELS[modelId]) return VPSMURAH_MODELS[modelId].limitCost;
    return null;
}

function isVpsMurahModelAllowed(modelId) {
    return Object.prototype.hasOwnProperty.call(VPSMURAH_MODELS, modelId);
}

function resolveVpsMurahModel({ model, senderId, isOwner } = {}) {
    const core = senderId && getCoreNumber(senderId);
    return model ||
        (senderId && state.userVpsMurahModel[senderId]) ||
        (core && state.userVpsMurahModel[core]) ||
        (isOwner && state.ownerVpsMurahModel) ||
        'luna';
}

async function generate({ prompt, senderId, isOwner, model, systemPrompt = null, imageBuffer = null, useMemory = true }) {
    const apiKey = getRandomKey();
    const modelName = resolveVpsMurahModel({ model, senderId, isOwner });
    const shouldKeepMemory = useMemory !== false;
    const instruction = systemPrompt || getShirokoSystemPrompt(isOwner);

    if (shouldKeepMemory && !memory.get(senderId, PROVIDER_NAME)) memory.init(senderId, PROVIDER_NAME);
    if (shouldKeepMemory) memory.push(senderId, PROVIDER_NAME, 'user', prompt || '[Gambar]');

    let userContent = prompt || 'Nn... Tolong analisis gambar ini.';
    if (imageBuffer) {
        const mime = detectMimeType(imageBuffer, 'image');
        userContent = [
            { type: 'text', text: prompt || 'Nn... Tolong analisis dan jelaskan gambar ini dengan detail.' },
            { type: 'image_url', image_url: { url: `data:${mime};base64,${imageBuffer.toString('base64')}` } }
        ];
    }

    const historyMessages = shouldKeepMemory ? memory.getMessages(senderId, PROVIDER_NAME) : [{ role: 'user', content: userContent }];
    if (shouldKeepMemory && imageBuffer && historyMessages.length > 0) {
        historyMessages[historyMessages.length - 1] = { role: 'user', content: userContent };
    }
    const messages = [{ role: 'system', content: instruction }, ...historyMessages];

    try {
        const response = await axios.post(`${BASE_URL}/chat/completions`, {
            model: modelName,
            max_tokens: 4096,
            messages
        }, {
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            timeout: 120000
        });
        const text = cleanThinkingLogs(extractOpenRouterText(response.data));
        if (!text) throw new Error('Respons VPSMurah kosong atau tidak valid.');
        if (shouldKeepMemory) memory.push(senderId, PROVIDER_NAME, 'assistant', text);
        return text;
    } catch (error) {
        if (shouldKeepMemory) memory.popLast(senderId, PROVIDER_NAME);
        throw new Error(`VPSMurah Error (${modelName}): ${error.response?.data?.error?.message || error.response?.data?.message || error.message}`);
    }
}

async function transcribe({ audioBuffer, mimeType = 'audio/ogg', model, senderId, isOwner }) {
    const apiKey = getRandomKey();
    const modelName = resolveVpsMurahModel({ model, senderId, isOwner });
    const { buffer: preparedAudio, format } = prepareAudioForChatApi(audioBuffer, mimeType);
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
    return validateTranscript(cleanThinkingLogs(text), 'VPSMurah', modelName);
}

async function fetchLiveModels() {
    const response = await axios.get(`${BASE_URL}/models`, {
        headers: { Authorization: `Bearer ${getRandomKey()}` },
        timeout: 15000
    });
    const models = Array.isArray(response.data?.data) ? response.data.data : response.data?.models;
    if (!Array.isArray(models)) throw new Error('Format daftar model VPSMurah tidak valid.');
    return models
        .map(model => {
            const id = model.id || model.name;
            if (!id) return null;
            const known = VPSMURAH_MODELS[id];
            return {
                id,
                name: known?.name || model.display_name || model.name || id,
                accessTier: known ? 'premium' : (model.access_tier || 'unknown'),
                billingType: known ? 'premium' : (model.billingType || model.access_tier || 'unknown'),
                limitCost: known?.limitCost || null,
                capabilities: model.capabilities || {}
            };
        })
        .filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

async function fetchModels({ all = false } = {}) {
    const live = await fetchLiveModels();
    if (all) return live;
    return live.filter(model => isVpsMurahModelAllowed(model.id));
}

module.exports = {
    generate,
    transcribe,
    fetchModels,
    fetchLiveModels,
    resolveVpsMurahModel,
    getVpsMurahModelCost,
    isVpsMurahModelAllowed,
    VPSMURAH_MODELS,
    VPSMURAH_API_KEYS
};
