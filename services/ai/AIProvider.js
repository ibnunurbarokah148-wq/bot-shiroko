// ==========================================
// AI PROVIDER — Router Utama
// Unified interface: AIProvider.generate({ provider, model, prompt, ... })
// ==========================================
const geminiProvider = require('./providers/gemini');
const ollamaProvider = require('./providers/ollama');
const openrouterProvider = require('./providers/openrouter');
const cloudflareProvider = require('./providers/cloudflare');
const arisuProvider = require('./providers/arisu');
const xkiroProvider = require('./providers/xkiro');
const memory = require('./memory');
const state = require('../../config/state');

const { getCoreNumber } = require('../../utils/helpers');

/**
 * Mapping dari !aimode shortcut ke { provider, model }.
 * @param {string} mode - Mode AI dari !aimode (misal 'ds3', 'cloudflare')
 * @param {string} senderId - Untuk ambil model pilihan user
 * @returns {{ provider: string, model: string }}
 */
function resolveMode(mode, senderId) {
    const core = getCoreNumber(senderId);
    const modeMap = {
        'gemini':       { provider: 'gemini',      model: 'gemini-2.5-flash-lite' },
        'ollama':       { provider: 'ollama',      model: state.userOllamaModel[senderId] || (core && state.userOllamaModel[core]) || 'gemma3:4b' },
        'openrouter':   { provider: 'openrouter',  model: state.userOpenRouterModel[senderId] || (core && state.userOpenRouterModel[core]) || 'deepseek/deepseek-r1:free' },
        'or':           { provider: 'openrouter',  model: state.userOpenRouterModel[senderId] || (core && state.userOpenRouterModel[core]) || 'deepseek/deepseek-r1:free' },
        'cloudflare':   { provider: 'cloudflare',  model: state.userCloudflareModel[senderId] || (core && state.userCloudflareModel[core]) || '@cf/meta/llama-3-8b-instruct' },
        'cf':           { provider: 'cloudflare',  model: state.userCloudflareModel[senderId] || (core && state.userCloudflareModel[core]) || '@cf/meta/llama-3-8b-instruct' },
        'xkiro':        { provider: 'xkiro',       model: state.userXKiroModel[senderId] || (core && state.userXKiroModel[core]) || state.ownerXKiroModel || 'openai/gpt-4o' },
        'xk':           { provider: 'xkiro',       model: state.userXKiroModel[senderId] || (core && state.userXKiroModel[core]) || state.ownerXKiroModel || 'openai/gpt-4o' },
        'ds3':          { provider: 'arisu',       model: 'deepseek-v3' },
        'ds4':          { provider: 'arisu',       model: 'deepseek-v4' },
        'glm':          { provider: 'arisu',       model: 'glm' },
        'qwen':         { provider: 'arisu',       model: 'qwen' },
        'arisu-gemini': { provider: 'arisu',       model: 'gemini' },
        'gpt':          { provider: 'arisu',       model: 'gpt' },
        'grok':         { provider: 'arisu',       model: 'grok' }
    };

    return modeMap[mode] || { provider: 'gemini', model: 'gemini-2.5-flash-lite' };
}

/**
 * Generate teks AI via provider yang sesuai.
 * @param {object} options
 * @param {string} options.provider - 'gemini' | 'ollama' | 'openrouter' | 'cloudflare' | 'arisu' | 'xkiro'
 * @param {string} [options.model] - Model spesifik
 * @param {string} options.prompt - Pesan user
 * @param {string} options.senderId - ID pengirim
 * @param {boolean} options.isOwner - Apakah owner
 * @param {string|null} [options.systemPrompt] - Custom system prompt (null = Shiroko default)
 * @param {Buffer|null} [options.imageBuffer] - Buffer gambar untuk vision (Gemini & Ollama only)
 * @returns {Promise<string>}
 */
async function generate(options) {
    const { provider } = options;

    switch (provider) {
        case 'gemini':
            return geminiProvider.generate(options);
        case 'ollama':
            return ollamaProvider.generate(options);
        case 'openrouter':
            return openrouterProvider.generate(options);
        case 'cloudflare':
            return cloudflareProvider.generate(options);
        case 'arisu':
            return arisuProvider.generate(options);
        case 'xkiro':
            return xkiroProvider.generate(options);
        default:
            throw new Error(`Provider tidak dikenali: ${provider}`);
    }
}

async function transcribe(options) {
    const { provider } = options;
    if (provider === 'arisu') {
        throw new Error('Mode ArisuSoft belum mendukung pemrosesan audio atau ZIP.');
    }
    const providerModule = {
        gemini: geminiProvider,
        openrouter: openrouterProvider,
        cloudflare: cloudflareProvider,
        xkiro: xkiroProvider
    }[provider];
    if (!providerModule?.transcribe) {
        throw new Error(`Provider ${provider} belum mendukung transkripsi audio.`);
    }
    return providerModule.transcribe(options);
}

/**
 * Menghapus SEMUA memori chat user (untuk !lupa).
 * Juga hapus sesi Gemini dari state.
 * @param {string} senderId
 * @returns {boolean} true jika ada yang dihapus
 */
function clearMemory(senderId) {
    let cleared = memory.clearAll(senderId);
    const core = getCoreNumber(senderId);

    return cleared;
}

/**
 * Scan daftar model dari provider tertentu.
 * @param {string} provider - 'openrouter' | 'cloudflare' | 'xkiro'
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
async function fetchModels(provider) {
    switch (provider) {
        case 'openrouter':
            return openrouterProvider.fetchModels();
        case 'cloudflare':
            return cloudflareProvider.fetchModels();
        case 'xkiro':
            return xkiroProvider.fetchModels();
        default:
            throw new Error(`fetchModels tidak tersedia untuk provider: ${provider}`);
    }
}

/**
 * Generate gambar.
 * @param {string} provider - Saat ini hanya 'cloudflare'
 * @param {string} prompt
 * @param {string} [model]
 * @returns {Promise<{buffer: Buffer, mime: string}>}
 */
async function generateImage(provider, prompt, model) {
    switch (provider) {
        case 'cloudflare':
            return cloudflareProvider.generateImage(prompt, model);
        default:
            throw new Error(`generateImage tidak tersedia untuk provider: ${provider}`);
    }
}

/**
 * Text-to-Speech.
 * @param {string} provider - 'cloudflare' atau 'arisu'
 * @param {string} text
 * @param {string} [model]
 * @returns {Promise<{buffer: Buffer, mime: string}>}
 */
async function textToSpeech(provider, text, model) {
    switch (provider) {
        case 'cloudflare':
            return cloudflareProvider.textToSpeech(text, model);
        case 'arisu':
            return arisuProvider.textToSpeech(text, model);
        default:
            throw new Error(`textToSpeech tidak tersedia untuk provider: ${provider}`);
    }
}

/**
 * Scan daftar model gambar.
 * @param {string} provider - Saat ini hanya 'cloudflare'
 * @returns {Promise<Array>}
 */
async function fetchImageModels(provider) {
    switch (provider) {
        case 'cloudflare':
            return cloudflareProvider.fetchImageModels();
        default:
            throw new Error(`fetchImageModels tidak tersedia untuk provider: ${provider}`);
    }
}

/**
 * Scan daftar model TTS.
 * @param {string} provider - 'cloudflare' atau 'arisu'
 * @returns {Promise<Array>|Array}
 */
async function fetchTTSModels(provider) {
    switch (provider) {
        case 'cloudflare':
            return cloudflareProvider.fetchTTSModels();
        case 'arisu':
            return arisuProvider.fetchTTSModels();
        default:
            throw new Error(`fetchTTSModels tidak tersedia untuk provider: ${provider}`);
    }
}

module.exports = {
    generate,
    transcribe,
    resolveMode,
    clearMemory,
    fetchModels,
    generateImage,
    textToSpeech,
    fetchImageModels,
    fetchTTSModels,

    // Re-export untuk akses langsung ke provider jika dibutuhkan
    providers: {
        gemini: geminiProvider,
        ollama: ollamaProvider,
        openrouter: openrouterProvider,
        cloudflare: cloudflareProvider,
        arisu: arisuProvider
    },

    // Re-export memory manager
    memory
};
