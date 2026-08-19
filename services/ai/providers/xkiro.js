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
async function generate({ prompt, senderId, isOwner, model, systemPrompt = null, imageBuffer = null }) {
    const apiKey = getRandomKey();
    const modelName = resolveXKiroModel({ model, senderId });

    const instruction = systemPrompt || getShirokoSystemPrompt(isOwner);

    // Inisialisasi memory jika belum ada
    if (!memory.get(senderId, PROVIDER_NAME)) {
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
    memory.push(senderId, PROVIDER_NAME, 'user', prompt || '[Gambar]');

    const systemMessage = { role: 'system', content: instruction };
    const historyMessages = memory.getMessages(senderId, PROVIDER_NAME);

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
            let cleanName = m.display_name || modelId;
            return { id: modelId, name: cleanName };
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
        { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
        { id: 'google/gemini-3-flash', name: 'Gemini 3 Flash' },
        { id: 'openai/gpt-5.4-mini', name: 'GPT-5.4 Mini' },
        { id: 'openai/gpt-5.4', name: 'GPT-5.4' },
        { id: 'anthropic/claude-sonnet-4.6', name: 'Claude Sonnet 4.6' },
        { id: 'deepseek/deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
        { id: 'qwen/qwen3.5-omni-flash', name: 'Qwen 3.5 Omni Flash' },
        { id: 'z-ai/glm-5', name: 'GLM-5' }
    ].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

module.exports = {
    generate,
    transcribe,
    fetchModels,
    resolveXKiroModel,
    XKIRO_API_KEYS
};
