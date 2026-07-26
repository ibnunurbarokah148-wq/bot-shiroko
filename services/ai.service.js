// ==========================================
// AI SERVICE — BACKWARD COMPATIBILITY FACADE
// ==========================================
// File ini dulunya monolitik 843 baris. Sekarang menjadi thin facade
// yang re-export dari modul baru di services/ai/*.
// Semua consumer lama tetap jalan tanpa perubahan apapun.
// ==========================================

const AIProvider = require('./ai/AIProvider');
const gemini = require('./ai/providers/gemini');
const ollama = require('./ai/providers/ollama');
const openrouter = require('./ai/providers/openrouter');
const cloudflare = require('./ai/providers/cloudflare');
const arisu = require('./ai/providers/arisu');
const memory = require('./ai/memory');
const { cleanThinkingLogs } = require('./ai/utils');

// ==========================================
// RE-EXPORT FUNGSI LAMA
// ==========================================

// Gemini
const getGeminiComponents = gemini.getGeminiComponents;
const getShirokoModel = gemini.getShirokoModel;
const getAkademikModel = gemini.getAkademikModel;

// HuggingFace (tetap di sini karena tidak masuk AIProvider pattern)
const { InferenceClient } = require('@huggingface/inference');
const HF_API_KEYS = process.env.HUGGINGFACE_API_KEY ? process.env.HUGGINGFACE_API_KEY.split(',').map(key => key.trim()) : [];
if (HF_API_KEYS.length === 0) {
    console.warn('HUGGINGFACE_API_KEY tidak ditemukan pada .env, fitur gambar mungkin tidak jalan.');
}
function getHfClient() {
    const randomKey = HF_API_KEYS[Math.floor(Math.random() * HF_API_KEYS.length)];
    return new InferenceClient(randomKey);
}

// Wrapper fungsi lama → AIProvider.generate()
async function tanyaOllama(senderId, pesanUser, isOwner, gambarBase64 = null) {
    return ollama.generate({
        prompt: pesanUser,
        senderId,
        isOwner,
        imageBuffer: gambarBase64 ? Buffer.from(gambarBase64, 'base64') : null
    });
}

async function tanyaArisu(senderId, pesanUser, isOwner, modelEndpoint) {
    return arisu.generate({
        prompt: pesanUser,
        senderId,
        isOwner,
        model: modelEndpoint
    });
}

async function tanyaOpenRouter(senderId, promptInput, isOwner, modelName, customSystemPrompt = null) {
    return openrouter.generate({
        prompt: promptInput,
        senderId,
        isOwner,
        model: modelName,
        systemPrompt: customSystemPrompt
    });
}

async function tanyaCloudflare(senderId, promptInput, isOwner, modelName, customSystemPrompt = null) {
    return cloudflare.generate({
        prompt: promptInput,
        senderId,
        isOwner,
        model: modelName,
        systemPrompt: customSystemPrompt
    });
}

// Image & TTS
const generateCloudflareImage = cloudflare.generateImage;

async function textToSpeechCloudflare(textInput, modelName) {
    // Delegasi ke Arisu jika model arisu
    if (modelName === 'arisu-basic' || modelName === 'arisu-voicevox') {
        return arisu.textToSpeech(textInput, modelName);
    }
    return cloudflare.textToSpeech(textInput, modelName);
}

// Model fetching
const fetchOpenRouterModels = openrouter.fetchModels;
const fetchCloudflareModels = cloudflare.fetchModels;
const fetchCloudflareImageModels = cloudflare.fetchImageModels;
const fetchCloudflareTTSModels = cloudflare.fetchTTSModels;
const fetchArisuTTSModels = arisu.fetchTTSModels;

// Memory — proxy ke ChatMemory baru (backward compat untuk commands/ai.js !lupa)
// Akses langsung via property proxy
const memoriProxy = {
    get: (target, prop) => {
        // Support delete memoriOllama[senderId] dan memoriOllama[senderId] checks
        if (typeof prop === 'string') {
            const data = memory.get(prop, target.__provider);
            if (data) return data;
        }
        return undefined;
    },
    deleteProperty: (target, prop) => {
        memory.clear(prop, target.__provider);
        return true;
    },
    has: (target, prop) => {
        return !!memory.get(prop, target.__provider);
    }
};

const memoriOllama = new Proxy({ __provider: 'ollama' }, memoriProxy);
const memoriArisu = new Proxy({ __provider: 'arisu' }, memoriProxy);
const memoriOpenRouter = new Proxy({ __provider: 'openrouter' }, memoriProxy);
const memoriCloudflare = new Proxy({ __provider: 'cloudflare' }, memoriProxy);

module.exports = {
    // Gemini
    getGeminiComponents,
    getHfClient,
    getShirokoModel,
    getAkademikModel,

    // Provider functions (lama)
    tanyaOllama,
    tanyaArisu,
    tanyaOpenRouter,
    tanyaCloudflare,

    // Image & TTS
    generateCloudflareImage,
    textToSpeechCloudflare,

    // Model fetching
    fetchOpenRouterModels,
    fetchCloudflareModels,
    fetchCloudflareImageModels,
    fetchCloudflareTTSModels,
    fetchArisuTTSModels,

    // Memory (proxy ke ChatMemory baru)
    memoriOllama,
    memoriArisu,
    memoriOpenRouter,
    memoriCloudflare,

    // API Keys
    GEMINI_API_KEYS: gemini.GEMINI_API_KEYS,
    HF_API_KEYS,
    OPENROUTER_API_KEYS: openrouter.OPENROUTER_API_KEYS,

    // NEW: AIProvider unified interface
    AIProvider
};
