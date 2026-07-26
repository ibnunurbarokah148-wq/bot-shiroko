// ==========================================
// PROVIDER: CLOUDFLARE — Workers AI
// ==========================================
const axios = require('axios');
const state = require('../../../config/state');
const memory = require('../memory');
const { cleanThinkingLogs, extractCloudflareText, detectMimeType } = require('../utils');
const { getShirokoShortPrompt } = require('../prompts');

const PROVIDER_NAME = 'cloudflare';

/**
 * Mendapatkan pasangan accountId:token secara acak.
 * @returns {{ accountId: string, token: string }}
 */
function getCloudflarePair() {
    const rawAccountIds = process.env.CLOUDFLARE_ACCOUNT_ID ? process.env.CLOUDFLARE_ACCOUNT_ID.split(',').map(s => s.trim()) : [];
    const rawTokens = process.env.CLOUDFLARE_API_TOKEN ? process.env.CLOUDFLARE_API_TOKEN.split(',').map(s => s.trim()) : [];

    const validPairs = [];
    rawTokens.forEach((tokenStr, idx) => {
        if (!tokenStr || tokenStr.includes('masukkan')) return;
        if (tokenStr.includes(':')) {
            const [acc, tok] = tokenStr.split(':');
            if (acc && tok) validPairs.push({ accountId: acc.trim(), token: tok.trim() });
        } else if (rawAccountIds.length > 0) {
            const acc = rawAccountIds[idx] || rawAccountIds[0];
            if (acc && !acc.includes('masukkan')) {
                validPairs.push({ accountId: acc, token: tokenStr });
            }
        }
    });

    if (validPairs.length === 0) {
        throw new Error('Konfigurasi CLOUDFLARE_ACCOUNT_ID atau CLOUDFLARE_API_TOKEN belum di-set di .env.');
    }

    return validPairs[Math.floor(Math.random() * validPairs.length)];
}

/**
 * Generate chat via Cloudflare Workers AI.
 * 3 fallback levels: system role → merged → prompt string.
 * @param {object} options
 * @param {string} options.prompt
 * @param {string} options.senderId
 * @param {boolean} options.isOwner
 * @param {string} [options.model='@cf/meta/llama-3-8b-instruct']
 * @param {string|null} [options.systemPrompt]
 * @returns {Promise<string>}
 */
async function generate({ prompt, senderId, isOwner, model, systemPrompt = null }) {
    const { accountId, token } = getCloudflarePair();
    const modelName = model || state.userCloudflareModel[senderId] || '@cf/meta/llama-3-8b-instruct';
    const instruction = systemPrompt || getShirokoShortPrompt(isOwner);

    // Inisialisasi memory jika belum ada
    if (!memory.get(senderId, PROVIDER_NAME)) {
        memory.init(senderId, PROVIDER_NAME);
    }

    // Push user message
    memory.push(senderId, PROVIDER_NAME, 'user', prompt);

    const systemMessage = { role: 'system', content: instruction };
    const userMessages = memory.getMessages(senderId, PROVIDER_NAME);
    const payloadMessages = [systemMessage, ...userMessages];
    const cleanModel = modelName.startsWith('@cf/') ? modelName : `@cf/${modelName}`;
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${cleanModel}`;
    const headers = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    };

    let resData = null;

    // Attempt 1: Standard messages array dengan system role
    try {
        const response = await axios.post(url, {
            messages: payloadMessages,
            max_tokens: 2048
        }, { headers, timeout: 60000 });
        if (response.data?.success && response.data?.result) {
            resData = response.data.result;
        }
    } catch (e1) {
        // Attempt 2: Fallback gabungkan system prompt ke pesan user pertama
        try {
            const mergedMessages = userMessages.map((m, idx) => {
                if (idx === 0) {
                    return { role: 'user', content: `${instruction}\n\n${m.content}` };
                }
                return m;
            });
            const response = await axios.post(url, {
                messages: mergedMessages,
                max_tokens: 2048
            }, { headers, timeout: 60000 });
            if (response.data?.success && response.data?.result) {
                resData = response.data.result;
            }
        } catch (e2) {
            // Attempt 3: Fallback string prompt (untuk model completion lama)
            try {
                let promptStr = `${instruction}\n\n`;
                userMessages.forEach(m => {
                    promptStr += `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}\n`;
                });
                const response = await axios.post(url, {
                    prompt: promptStr
                }, { headers, timeout: 60000 });
                if (response.data?.success && response.data?.result) {
                    resData = response.data.result;
                }
            } catch (e3) {
                memory.popLast(senderId, PROVIDER_NAME);
                const errMsg = e3.response?.data?.errors?.[0]?.message || e3.message;
                throw new Error(`Cloudflare Error (${cleanModel}): ${errMsg}`);
            }
        }
    }

    if (resData) {
        const extracted = extractCloudflareText(resData);
        if (extracted) {
            const cleanedAns = cleanThinkingLogs(extracted);
            memory.push(senderId, PROVIDER_NAME, 'assistant', cleanedAns);
            return cleanedAns;
        }
    }

    memory.popLast(senderId, PROVIDER_NAME);
    throw new Error(`Respons Cloudflare AI (${cleanModel}) gagal atau kosong`);
}

/**
 * Generate gambar via Cloudflare text-to-image.
 * @param {string} promptInput
 * @param {string} [modelName='@cf/stabilityai/stable-diffusion-xl-base-1.0']
 * @returns {Promise<{buffer: Buffer, mime: string}>}
 */
async function generateImage(promptInput, modelName = '@cf/stabilityai/stable-diffusion-xl-base-1.0') {
    const cleanModel = modelName.startsWith('@cf/') ? modelName : `@cf/${modelName}`;
    const { accountId, token } = getCloudflarePair();
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${cleanModel}`;

    let rawBuffer = null;

    try {
        const response = await axios.post(url, { prompt: promptInput }, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            responseType: 'arraybuffer',
            timeout: 60000
        });
        if (response.data && response.data.length > 0) {
            rawBuffer = Buffer.from(response.data);
        }
    } catch (err) {
        // Fallback pair ke-2 jika tersedia
        try {
            const pair2 = getCloudflarePair();
            const url2 = `https://api.cloudflare.com/client/v4/accounts/${pair2.accountId}/ai/run/${cleanModel}`;
            const response2 = await axios.post(url2, { prompt: promptInput }, {
                headers: {
                    'Authorization': `Bearer ${pair2.token}`,
                    'Content-Type': 'application/json'
                },
                responseType: 'arraybuffer',
                timeout: 60000
            });
            if (response2.data && response2.data.length > 0) {
                rawBuffer = Buffer.from(response2.data);
            }
        } catch (err2) {
            const errMsg = err2.response?.data ? err2.response.data.toString() : err2.message;
            throw new Error(`Cloudflare Image Error (${cleanModel}): ${errMsg}`);
        }
    }

    if (!rawBuffer || rawBuffer.length === 0) {
        throw new Error('Cloudflare mengembalikan data gambar kosong');
    }

    // Cek jika Cloudflare mengembalikan respons JSON
    const firstStr = rawBuffer.toString('utf8', 0, 100).trim();
    if (firstStr.startsWith('{')) {
        try {
            const parsed = JSON.parse(rawBuffer.toString('utf8'));
            if (parsed.result?.image) {
                return { buffer: Buffer.from(parsed.result.image, 'base64'), mime: 'image/png' };
            }
            if (parsed.result?.response) {
                return { buffer: Buffer.from(parsed.result.response, 'base64'), mime: 'image/png' };
            }
            if (parsed.errors && parsed.errors.length > 0) {
                throw new Error(parsed.errors[0].message);
            }
        } catch (e) {
            throw new Error(`Cloudflare API Error: ${e.message}`);
        }
    }

    return { buffer: rawBuffer, mime: detectMimeType(rawBuffer, 'image') };
}

/**
 * Text-to-Speech via Cloudflare Workers AI.
 * @param {string} textInput
 * @param {string} [modelName='@cf/myshell-ai/melotts']
 * @returns {Promise<{buffer: Buffer, mime: string}>}
 */
async function textToSpeech(textInput, modelName = '@cf/myshell-ai/melotts') {
    const cleanModel = modelName.startsWith('@cf/') ? modelName : `@cf/${modelName}`;
    const { accountId, token } = getCloudflarePair();
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${cleanModel}`;

    const payload = cleanModel.includes('melotts') ? { prompt: textInput } : { text: textInput };

    let rawBuffer = null;

    try {
        const response = await axios.post(url, payload, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            responseType: 'arraybuffer',
            timeout: 60000
        });
        if (response.data && response.data.length > 0) {
            rawBuffer = Buffer.from(response.data);
        }
    } catch (err) {
        try {
            const pair2 = getCloudflarePair();
            const url2 = `https://api.cloudflare.com/client/v4/accounts/${pair2.accountId}/ai/run/${cleanModel}`;
            const response2 = await axios.post(url2, payload, {
                headers: {
                    'Authorization': `Bearer ${pair2.token}`,
                    'Content-Type': 'application/json'
                },
                responseType: 'arraybuffer',
                timeout: 60000
            });
            if (response2.data && response2.data.length > 0) {
                rawBuffer = Buffer.from(response2.data);
            }
        } catch (err2) {
            const errMsg = err2.response?.data ? Buffer.from(err2.response.data).toString('utf8') : err2.message;
            throw new Error(`Cloudflare TTS Error (${cleanModel}): ${errMsg}`);
        }
        if (!rawBuffer) {
            const errMsg = err.response?.data ? Buffer.from(err.response.data).toString('utf8') : err.message;
            throw new Error(`Cloudflare TTS Error (${cleanModel}): ${errMsg}`);
        }
    }

    if (!rawBuffer || rawBuffer.length === 0) {
        throw new Error('Cloudflare mengembalikan data audio kosong');
    }

    // Cek jika Cloudflare mengembalikan respons JSON (misal MeloTTS)
    const firstStr = rawBuffer.toString('utf8', 0, 100).trim();
    if (firstStr.startsWith('{')) {
        try {
            const parsed = JSON.parse(rawBuffer.toString('utf8'));
            if (parsed.result?.audio) {
                rawBuffer = Buffer.from(parsed.result.audio, 'base64');
            } else if (parsed.result?.response) {
                rawBuffer = Buffer.from(parsed.result.response, 'base64');
            } else if (parsed.errors && parsed.errors.length > 0) {
                throw new Error(parsed.errors[0].message);
            }
        } catch (e) {
            throw new Error(`Cloudflare TTS JSON Parsing Error: ${e.message}`);
        }
    }

    return { buffer: rawBuffer, mime: detectMimeType(rawBuffer, 'audio') };
}

/**
 * Scan daftar model Text Generation dari Cloudflare.
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
async function fetchModels() {
    const { accountId, token } = getCloudflarePair();
    const res = await axios.get(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/models/search?task=Text%20Generation`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });

    let result = res.data.result || [];

    let textModels = result.filter(m => {
        if (!m) return false;
        const taskName = m.task ? (typeof m.task === 'object' ? (m.task.name || '') : m.task).toLowerCase() : '';
        return taskName.includes('text generation') || taskName.includes('text-generation');
    });

    // Fallback jika API tidak mengirimkan struktur task.name
    if (textModels.length === 0) {
        textModels = result.filter(m => {
            const name = (m.name || '').toLowerCase();
            return name.includes('llama') || name.includes('deepseek') || name.includes('qwen') || name.includes('gemma') || name.includes('mistral') || name.includes('phi') || name.includes('hermes');
        });
    }

    return textModels.map(m => {
        let parts = m.name.replace(/^@cf\//i, '').split('/');
        let cleanName = parts[parts.length - 1];
        return { id: m.name, name: cleanName };
    });
}

/**
 * Scan daftar model Text-to-Image dari Cloudflare.
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
async function fetchImageModels() {
    const { accountId, token } = getCloudflarePair();
    let result = [];
    try {
        const response = await axios.get(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/models/search`, {
            headers: { 'Authorization': `Bearer ${token}` },
            timeout: 15000
        });
        result = response.data.result || [];
    } catch (err) {
        console.error("Gagal mengambil daftar model gambar dari Cloudflare API:", err.message);
        return [
            { id: '@cf/stabilityai/stable-diffusion-xl-base-1.0', name: 'stable-diffusion-xl-base-1.0' },
            { id: '@cf/bytedance/stable-diffusion-xl-lightning', name: 'stable-diffusion-xl-lightning' },
            { id: '@cf/lykon/dreamshaper-8-lcm', name: 'dreamshaper-8-lcm' },
            { id: '@cf/black-forest-labs/flux-1-schnell', name: 'flux-1-schnell' },
            { id: '@cf/leonardo/phoenix-1.0', name: 'phoenix-1.0' },
            { id: '@cf/leonardo/lucid-origin', name: 'lucid-origin' }
        ];
    }

    const textToImageModels = result.filter(m => {
        if (!m) return false;
        const taskName = m.task ? (typeof m.task === 'object' ? (m.task.name || '') : m.task).toLowerCase() : '';
        const name = (m.name || '').toLowerCase();

        if (name.includes('inpainting') || name.includes('img2img') || name.includes('flux-2') || name.includes('edit')) return false;
        if (taskName.includes('image-to-text') || taskName.includes('classification') || taskName.includes('speech') || taskName.includes('audio')) return false;

        return taskName.includes('text-to-image') || taskName.includes('image-generation') ||
               name.includes('stable-diffusion') || name.includes('flux') ||
               name.includes('dreamshaper') || name.includes('phoenix') || name.includes('lucid');
    });

    return textToImageModels.map(m => {
        let parts = m.name.replace(/^@cf\//i, '').split('/');
        let cleanName = parts[parts.length - 1];
        return { id: m.name, name: cleanName };
    });
}

/**
 * Scan daftar model TTS dari Cloudflare.
 * @returns {Promise<Array<{id: string, name: string, desc: string}>>}
 */
async function fetchTTSModels() {
    const { accountId, token } = getCloudflarePair();
    let result = [];
    try {
        const response = await axios.get(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/models/search`, {
            headers: { 'Authorization': `Bearer ${token}` },
            timeout: 15000
        });
        result = response.data.result || [];
    } catch (err) {
        console.error("Gagal mengambil daftar model TTS dari Cloudflare API:", err.message);
        return [
            { id: '@cf/myshell-ai/melotts', name: 'MeloTTS', desc: 'Suara Jernih Natural & Ekspresif (WAV)' },
            { id: '@cf/deepgram/aura-1', name: 'Deepgram Aura 1', desc: 'Suara Bahasa Inggris Natural (Cepat)' },
            { id: '@cf/deepgram/aura-2-en', name: 'Deepgram Aura 2 EN', desc: 'Suara Bahasa Inggris Ekspresif HD' },
            { id: '@cf/deepgram/aura-2-es', name: 'Deepgram Aura 2 ES', desc: 'Suara Bahasa Spanyol Natural' }
        ];
    }

    const ttsModels = result.filter(m => {
        if (!m) return false;
        const taskName = m.task ? (typeof m.task === 'object' ? (m.task.name || '') : m.task).toLowerCase() : '';
        const name = (m.name || '').toLowerCase();

        if (name.includes('whisper') || name.includes('nova') || name.includes('asr') || (name.includes('deepgram/flux') && !name.includes('aura'))) return false;

        return taskName.includes('text-to-speech') || name.includes('tts') || name.includes('aura') || name.includes('melotts');
    });

    const descMap = {
        'melotts': 'Suara Jernih Natural & Ekspresif (MyShell AI - High Quality WAV - Support Indo/English)',
        'aura-1': 'Suara Bahasa Inggris Natural & Cepat (Deepgram Realtime Engine)',
        'aura-2-en': 'Suara Bahasa Inggris Ekspresif HD dengan Intonasi Kontekstual',
        'aura-2-es': 'Suara Bahasa Spanyol Natural & Ekspresif'
    };

    return ttsModels.map(m => {
        let parts = m.name.replace(/^@cf\//i, '').split('/');
        let cleanName = parts[parts.length - 1];
        let desc = descMap[cleanName.toLowerCase()] || 'Model AI Text-to-Speech Cloudflare';
        return { id: m.name, name: cleanName, desc };
    });
}

module.exports = {
    generate,
    generateImage,
    textToSpeech,
    fetchModels,
    fetchImageModels,
    fetchTTSModels,
    getCloudflarePair
};
