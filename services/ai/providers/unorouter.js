// ==========================================
// PROVIDER: UNOROUTER — OpenAI-compatible gateway
// ==========================================
const axios = require('axios');
const state = require('../../../config/state');
const memory = require('../memory');
const { cleanThinkingLogs, extractOpenRouterText } = require('../utils');
const { prepareAudioForChatApi, validateTranscript } = require('../media.service');
const { getShirokoSystemPrompt } = require('../prompts');
const { getCoreNumber } = require('../../../utils/helpers');

const BASE_URL = String(process.env.UNOROUTER_BASE_URL || 'https://api.unorouter.com/v1').replace(/\/$/, '');
const PROVIDER_NAME = 'unorouter';
const API_KEYS = String(process.env.UNOROUTER_API_KEY || '').split(',').map(key => key.trim()).filter(Boolean);
const MODEL_CACHE_TTL = 5 * 60 * 1000;
let modelCache = { expiresAt: 0, models: [] };

function getRandomKey() {
    if (!API_KEYS.length) throw new Error('UNOROUTER_API_KEY belum dikonfigurasi di .env.');
    return API_KEYS[Math.floor(Math.random() * API_KEYS.length)];
}

function modelId(model) { return String(model?.id || model?.name || ''); }

// Model-model ini bukan text generation biasa dan tidak cocok ditampilkan di room chat.
function isTextGenerationModel(model) {
    const id = modelId(model).toLowerCase();
    const type = String(model?.type || model?.task || model?.modality || '').toLowerCase();
    if (!id || /embedding|rerank|moderation|whisper|tts|speech|audio|image|vision|flux|sdxl|stable-diffusion|robotics|ocr|search/.test(`${id} ${type}`)) return false;
    if (model?.architecture?.input_modalities && !model.architecture.input_modalities.some(value => /text/i.test(value))) return false;
    return true;
}

function isPremiumModel(model) {
    const id = modelId(model).toLowerCase();
    return !id.includes(':free') && isTextGenerationModel(model);
}

function getModelCost(model, { isOwner = false } = {}) {
    if (isOwner) return 0;
    const id = modelId(model).toLowerCase();
    if (/flash-lite|mini|nano|haiku|glm-4\.6|deepseek-v3(\.2)?$/.test(id)) return 25;
    if (/flash|qwen3\.7|sonnet|gpt-5\.5|gpt-5\.6|deepseek-v4/.test(id)) return 50;
    if (/pro|opus|grok-4\.6|gpt-6|qwen3\.8-max/.test(id)) return 125;
    return 75;
}

function resolveModel({ model, senderId, isOwner } = {}) {
    const core = senderId && getCoreNumber(senderId);
    return model || state.userUnoRouterModel?.[senderId] || (core && state.userUnoRouterModel?.[core]) ||
        (isOwner && state.ownerUnoRouterModel) || process.env.UNOROUTER_DEFAULT_MODEL || 'gemini-3.5-flash';
}

async function fetchLiveModels() {
    if (modelCache.expiresAt > Date.now()) return modelCache.models;
    const response = await axios.get(`${BASE_URL}/models`, { headers: { Authorization: `Bearer ${getRandomKey()}` }, timeout: 20000 });
    const data = Array.isArray(response.data?.data) ? response.data.data : [];
    modelCache = { expiresAt: Date.now() + MODEL_CACHE_TTL, models: data.filter(isTextGenerationModel).map(model => ({
        id: modelId(model), name: model.name || modelId(model), provider: PROVIDER_NAME,
        accessTier: isPremiumModel(model) ? 'premium' : 'free', billingType: isPremiumModel(model) ? 'premium' : 'free',
        pricing: model.pricing || {}, capabilities: model.capabilities || {}, architecture: model.architecture || {}
    })).filter(model => model.id) };
    return modelCache.models;
}

async function fetchModels({ premiumOnly = false, all = true } = {}) {
    const models = await fetchLiveModels();
    return models.filter(model => all || !premiumOnly || isPremiumModel(model));
}

async function generate({ prompt, senderId, isOwner, model, systemPrompt = null, imageBuffer = null, useMemory = true }) {
    const modelName = resolveModel({ model, senderId, isOwner });
    const keepMemory = useMemory !== false;
    if (keepMemory && !memory.get(senderId, PROVIDER_NAME)) memory.init(senderId, PROVIDER_NAME);
    if (keepMemory) memory.push(senderId, PROVIDER_NAME, 'user', prompt || '[Gambar]');
    const userContent = imageBuffer ? [{ type: 'text', text: prompt || 'Analisis gambar ini.' }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBuffer.toString('base64')}` } }] : (prompt || '');
    const messages = [{ role: 'system', content: systemPrompt || getShirokoSystemPrompt(isOwner) }, ...(keepMemory ? memory.getMessages(senderId, PROVIDER_NAME) : [{ role: 'user', content: userContent }])];
    try {
        const response = await axios.post(`${BASE_URL}/chat/completions`, { model: modelName, max_tokens: Number(process.env.UNOROUTER_MAX_TOKENS || 4096), messages }, {
            headers: { Authorization: `Bearer ${getRandomKey()}`, 'Content-Type': 'application/json' }, timeout: Number(process.env.UNOROUTER_TIMEOUT || 120000)
        });
        const text = cleanThinkingLogs(extractOpenRouterText(response.data));
        if (!text) throw new Error('Respons UnoRouter kosong.');
        if (keepMemory) memory.push(senderId, PROVIDER_NAME, 'assistant', text);
        return text;
    } catch (error) {
        if (keepMemory) memory.popLast(senderId, PROVIDER_NAME);
        throw new Error(`UnoRouter Error (${modelName}): ${error.response?.data?.error?.message || error.response?.data?.message || error.message}`);
    }
}

async function generateWithTools({ prompt, senderId, isOwner, model, systemPrompt, tools, executeTool, maxToolRounds = 3, imageBuffer = null, imageMimeType = 'image/jpeg' }) {
    if (!Array.isArray(tools) || typeof executeTool !== 'function') throw new Error('Tool UnoRouter belum dikonfigurasi dengan benar.');
    const modelName = resolveModel({ model, senderId, isOwner });
    const userContent = imageBuffer ? [{ type: 'text', text: prompt || 'Analisis gambar.' }, { type: 'image_url', image_url: { url: `data:${imageMimeType};base64,${imageBuffer.toString('base64')}` } }] : (prompt || '');
    const messages = [{ role: 'system', content: systemPrompt || getShirokoSystemPrompt(isOwner) }, { role: 'user', content: userContent }];
    for (let round = 0; round <= maxToolRounds; round++) {
        const response = await axios.post(`${BASE_URL}/chat/completions`, { model: modelName, max_tokens: Number(process.env.UNOROUTER_MAX_TOKENS || 4096), messages, tools, tool_choice: 'auto' }, { headers: { Authorization: `Bearer ${getRandomKey()}`, 'Content-Type': 'application/json' }, timeout: Number(process.env.UNOROUTER_TIMEOUT || 120000) });
        const message = response.data?.choices?.[0]?.message;
        const calls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
        if (!calls.length) return cleanThinkingLogs(extractOpenRouterText(response.data));
        if (round === maxToolRounds) throw new Error('UnoRouter melewati batas tool call.');
        messages.push({ role: 'assistant', content: message.content ?? null, tool_calls: calls });
        for (const call of calls) {
            let args = {};
            try { args = JSON.parse(call.function?.arguments || '{}'); } catch (_) { args = { _parseError: 'invalid JSON' }; }
            let result;
            try { result = await executeTool(call.function?.name, args, { senderId, isOwner, model: modelName }); } catch (error) { result = { ok: false, error: error.message }; }
            messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result || { ok: true }) });
        }
    }
    throw new Error('UnoRouter tool execution gagal.');
}

async function transcribe({ audioBuffer, mimeType = 'audio/ogg', model, senderId, isOwner }) {
    const { buffer, format } = prepareAudioForChatApi(audioBuffer, mimeType);
    const modelName = model || process.env.CALL_STT_MODEL || resolveModel({ senderId, isOwner });
    const response = await axios.post(`${BASE_URL}/chat/completions`, { model: modelName, messages: [{ role: 'user', content: [{ type: 'text', text: 'Transkripsikan audio ini secara akurat. Keluarkan hanya transkripnya.' }, { type: 'input_audio', input_audio: { data: buffer.toString('base64'), format } }] }] }, { headers: { Authorization: `Bearer ${getRandomKey()}`, 'Content-Type': 'application/json' }, timeout: Number(process.env.UNOROUTER_TIMEOUT || 120000), maxContentLength: Infinity, maxBodyLength: Infinity });
    return validateTranscript(cleanThinkingLogs(extractOpenRouterText(response.data)), 'UnoRouter', modelName);
}

module.exports = { generate, generateWithTools, transcribe, fetchModels, fetchLiveModels, resolveModel, getModelCost, isTextGenerationModel, isPremiumModel, BASE_URL };
