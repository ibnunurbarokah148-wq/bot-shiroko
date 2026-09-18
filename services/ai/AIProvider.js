// ==========================================
// AI PROVIDER — Router Utama
// Unified interface: AIProvider.generate({ provider, model, prompt, ... })
// ==========================================
const geminiProvider = require('./providers/gemini');
const ollamaProvider = require('./providers/ollama');
const openrouterProvider = require('./providers/openrouter');
const cloudflareProvider = require('./providers/cloudflare');
const arisuProvider = require('./providers/arisu');
const unorouterProvider = require('./providers/unorouter');
const fishProvider = require('./providers/fish');
const memory = require('./memory');
const state = require('../../config/state');

const { getCoreNumber } = require('../../utils/helpers');
const { ID_OWNER } = require('../../config/constants');

// Mode default bot: DeepSeek V4 Pro melalui ArisuSoft (tingkatan Standard).
const DEFAULT_AI_MODE = 'ds4';

/**
 * Ambil mode AI aktif milik user, dengan fallback ke mode default bot.
 * @param {string} senderId
 * @returns {string}
 */
function getUserMode(senderId) {
    const core = getCoreNumber(senderId);
    return state.userAIMode[senderId] ||
        (core && state.userAIMode[core]) ||
        DEFAULT_AI_MODE;
}

/**
 * Mapping dari !aimode shortcut ke { provider, model }.
 * @param {string} mode - Mode AI dari !aimode (misal 'ds3', 'cloudflare')
 * @param {string} senderId - Untuk ambil model pilihan user
 * @returns {{ provider: string, model: string }}
 */
function getModelCost(provider, model, context = {}) {
    if (provider === 'ollama') return 0;
    if (provider === 'openrouter' || provider === 'cloudflare') return 1;
    if (provider === 'unorouter') return unorouterProvider.getModelCost(model, context);
    if (provider === 'arisu') {
        const arisuModel = arisuProvider.fetchModels().find(item => item.id === model);
        return arisuModel?.limitCost || (model === 'deepseek-v4' ? 4 : 2);
    }
    return 2;
}

const PREMIUM_DENIED_REASON = 'Tingkatan Premium hanya tersedia untuk VIP Premium. Gunakan tingkatan Standard atau Open Source.';
const UNOROUTER_UNKNOWN_MODEL_REASON = 'Model UnoRouter ini tidak tersedia pada katalog premium.';

function isOwnerId(senderId) {
    if (!senderId) return false;
    const core = getCoreNumber(senderId);
    return ID_OWNER.some(ownerId => ownerId === senderId || ownerId === core);
}

function hasActivePremium(senderId, alternateId = null) {
    const { dbPremium } = require('../../config/db');
    const keys = new Set();
    for (const value of [senderId, alternateId]) {
        if (!value) continue;
        const raw = String(value);
        const core = getCoreNumber(raw);
        keys.add(raw);
        if (core) keys.add(core);
        const digits = raw.split('@')[0].split(':')[0].replace(/\D/g, '');
        if (digits) {
            keys.add(digits);
            keys.add(`${digits}@s.whatsapp.net`);
        }
    }
    for (const key of keys) {
        const entry = dbPremium[key];
        if (entry && (entry === true || entry > Date.now())) return true;
    }
    return false;
}

/**
 * Penjaga tunggal akses UnoRouter.
 * UnoRouter premium hanya boleh dipakai Owner atau VIP Premium, dan model wajib
 * berasal dari katalog yang ditampilkan lewat menu !aimode.
 * @param {string} model
 * @param {object} context
 * @returns {{ allowed: boolean, reason?: string }}
 */
function ensureUnoRouterAccess(model, context = {}) {
    const senderId = context.senderId || null;
    const isOwner = context.isOwner === true || isOwnerId(senderId);
    if (isOwner) {
        return { allowed: true };
    }

    const isPremium = context.isPremium === true || hasActivePremium(senderId, context.alternateId);
    if (!isPremium) return { allowed: false, reason: PREMIUM_DENIED_REASON };
    if (!unorouterProvider.isPremiumModel({ id: model })) return { allowed: false, reason: UNOROUTER_UNKNOWN_MODEL_REASON };
    return { allowed: true };
}

function ensureUnoRouterProviderAccess(context = {}) {
    const senderId = context.senderId || null;
    if (context.isOwner === true || isOwnerId(senderId)) return { allowed: true };
    if (context.isPremium === true || hasActivePremium(senderId, context.alternateId)) return { allowed: true };
    return { allowed: false, reason: PREMIUM_DENIED_REASON };
}

function assertUnoRouterAccess(model, context = {}) {
    const verdict = ensureUnoRouterAccess(model, context);
    if (!verdict.allowed) throw new Error(verdict.reason);
}

function validateModelAccess(provider, model, context = {}) {
    const accessContext = {
        ...context,
        isOwner: context.isOwner === true || isOwnerId(context.senderId),
        isPremium: context.isPremium === true || hasActivePremium(context.senderId, context.alternateId)
    };
    if (provider !== 'unorouter') return { allowed: true, cost: getModelCost(provider, model, accessContext) };
    const verdict = ensureUnoRouterAccess(model, accessContext);
    if (!verdict.allowed) return { allowed: false, cost: null, reason: verdict.reason };
    return { allowed: true, cost: getModelCost(provider, model, accessContext) };
}

function resolveMode(mode, senderId) {
    const core = getCoreNumber(senderId);
    const isOwner = ID_OWNER.some(ownerId => ownerId === senderId || ownerId === core);
    const unorouterModel = state.userUnoRouterModel[senderId] || (core && state.userUnoRouterModel[core]) || (isOwner && state.ownerUnoRouterModel) || process.env.UNOROUTER_DEFAULT_MODEL || 'gemini-3.5-flash';
    const modeMap = {
        'gemini':       { provider: 'gemini',      model: 'gemini-2.5-flash-lite' },
        'ollama':       { provider: 'ollama',      model: state.userOllamaModel[senderId] || (core && state.userOllamaModel[core]) || 'gemma3:4b' },
        'openrouter':   { provider: 'openrouter',  model: state.userOpenRouterModel[senderId] || (core && state.userOpenRouterModel[core]) || 'deepseek/deepseek-r1:free' },
        'or':           { provider: 'openrouter',  model: state.userOpenRouterModel[senderId] || (core && state.userOpenRouterModel[core]) || 'deepseek/deepseek-r1:free' },
        'cloudflare':   { provider: 'cloudflare',  model: state.userCloudflareModel[senderId] || (core && state.userCloudflareModel[core]) || '@cf/meta/llama-3-8b-instruct' },
        'cf':           { provider: 'cloudflare',  model: state.userCloudflareModel[senderId] || (core && state.userCloudflareModel[core]) || '@cf/meta/llama-3-8b-instruct' },
        'unorouter':    { provider: 'unorouter', model: unorouterModel },
        'arisu':        { provider: 'arisu', model: state.userArisuModel[senderId] || (core && state.userArisuModel[core]) || state.ownerArisuModel || 'deepseek-v3' },
        'ds3':          { provider: 'arisu', model: 'deepseek-v3' },
        'ds4':          { provider: 'arisu', model: 'deepseek-v4' },
        'glm':          { provider: 'arisu', model: 'glm' },
        'qwen':         { provider: 'arisu', model: 'qwen' },
        'arisu-gemini': { provider: 'arisu',       model: 'gemini' },
        'gpt':          { provider: 'arisu',       model: 'gpt' },
        'grok':         { provider: 'arisu',       model: 'grok' }
    };

    return modeMap[mode] || modeMap[DEFAULT_AI_MODE];
}

/**
 * Generate teks AI via provider yang sesuai.
 * @param {object} options
 * @param {string} options.provider - 'gemini' | 'ollama' | 'openrouter' | 'cloudflare' | 'arisu' | 'unorouter'
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
    const syncShared = options.isOwner === true && options.useMemory !== false && options.syncSharedMemory !== false && provider !== 'gemini';
    if (syncShared) memory.syncProviderFromShared(options.senderId, provider);

    let result;
    switch (provider) {
        case 'gemini':
            result = await geminiProvider.generate(options); break;
        case 'ollama':
            result = await ollamaProvider.generate(options); break;
        case 'openrouter':
            result = await openrouterProvider.generate(options); break;
        case 'cloudflare':
            result = await cloudflareProvider.generate(options); break;
        case 'arisu':
            result = await arisuProvider.generate(options); break;
        case 'unorouter':
            assertUnoRouterAccess(options.model || resolveMode('unorouter', options.senderId).model, options);
            result = await unorouterProvider.generate(options); break;
        default:
            throw new Error(`Provider tidak dikenali: ${provider}`);
    }
    if (syncShared) {
        memory.pushShared(options.senderId, 'user', options.prompt);
        memory.pushShared(options.senderId, 'assistant', result);
    }
    return result;
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
        unorouter: unorouterProvider
    }[provider];
    if (!providerModule?.transcribe) {
        throw new Error(`Provider ${provider} belum mendukung transkripsi audio.`);
    }
    if (provider === 'unorouter') assertUnoRouterAccess(options.model || resolveMode('unorouter', options.senderId).model, options);
    try {
        return await providerModule.transcribe(options);
    } catch (err) {
        throw err;
    }
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

function getMemoryGeneration(senderId) {
    return memory.generation(senderId);
}

function isMemoryGenerationCurrent(senderId, generation) {
    return memory.isCurrent(senderId, generation);
}

/**
 * Scan daftar model dari provider tertentu.
 * @param {string} provider - 'openrouter' | 'cloudflare' | 'unorouter'
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
async function fetchModels(provider) {
    switch (provider) {
        case 'openrouter':
            return openrouterProvider.fetchModels();
        case 'cloudflare':
            return cloudflareProvider.fetchModels();
        case 'unorouter':
            return unorouterProvider.fetchModels();
        case 'arisu':
            return arisuProvider.fetchModels();
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
async function textToSpeech(provider, text, model, options = {}) {
    switch (provider) {
        case 'cloudflare':
            return cloudflareProvider.textToSpeech(text, model);
        case 'arisu':
            return arisuProvider.textToSpeech(text, model);
        case 'fish':
            return fishProvider.textToSpeech(text, model, options);
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
        case 'fish':
            return [{ id: process.env.SHIROKO_VOICE_ID || 'configured-voice', name: 'Fish Audio Voice', desc: 'Reference voice' }];
        default:
            throw new Error(`fetchTTSModels tidak tersedia untuk provider: ${provider}`);
    }
}

module.exports = {
    generate,
    transcribe,
    resolveMode,
    getUserMode,
    DEFAULT_AI_MODE,
    getModelCost,
    validateModelAccess,
    ensureUnoRouterAccess,
    ensureUnoRouterProviderAccess,
    hasActivePremium,
    clearMemory,
    getMemoryGeneration,
    isMemoryGenerationCurrent,
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
        arisu: arisuProvider,
         unorouter: unorouterProvider
    },

    // Re-export memory manager
    memory
};
