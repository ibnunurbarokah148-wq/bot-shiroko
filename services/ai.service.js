// ==========================================
// AI SERVICE — Gemini, Ollama, FCC (OpenRouter)
// ==========================================
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GoogleAIFileManager } = require('@google/generative-ai/server');
const { InferenceClient } = require('@huggingface/inference');
const axios = require('axios');
const state = require('../config/state');

// Rotasi multi-API key
const GEMINI_API_KEYS = process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.split(',').map(key => key.trim()) : [];
const HF_API_KEYS = process.env.HUGGINGFACE_API_KEY ? process.env.HUGGINGFACE_API_KEY.split(',').map(key => key.trim()) : [];

if (GEMINI_API_KEYS.length === 0) {
    console.error('GEMINI_API_KEY tidak ditemukan pada .env');
}
if (HF_API_KEYS.length === 0) {
    console.warn('HUGGINGFACE_API_KEY tidak ditemukan pada .env, fitur gambar mungkin tidak jalan.');
}

// Memori percakapan (di-export agar bisa dihapus via !lupa)
const memoriOllama = {};
const memoriArisu = {};

// Pembersihan memori otomatis tiap jam untuk mencegah memory leak
setInterval(() => {
    const now = Date.now();
    const TTL = 24 * 60 * 60 * 1000; // 24 jam
    for (let id in memoriOllama) {
        if (now - memoriOllama[id].lastActive > TTL) delete memoriOllama[id];
    }
    for (let id in memoriArisu) {
        if (now - memoriArisu[id].lastActive > TTL) delete memoriArisu[id];
    }
    console.log('[SISTEM] Pembersihan memori chat otomatis selesai.');
}, 3600000);

function getGeminiComponents() {
    const randomKey = GEMINI_API_KEYS[Math.floor(Math.random() * GEMINI_API_KEYS.length)];
    return { genAI: new GoogleGenerativeAI(randomKey), fileManager: new GoogleAIFileManager(randomKey) };
}

function getHfClient() {
    const randomKey = HF_API_KEYS[Math.floor(Math.random() * HF_API_KEYS.length)];
    return new InferenceClient(randomKey);
}

function getShirokoModel() {
    const { genAI } = getGeminiComponents();
    return genAI.getGenerativeModel({
        model: "gemini-2.5-flash",
        generationConfig: { temperature: 0.8, topP: 0.95, maxOutputTokens: 4096 },
        systemInstruction: `Kamu adalah Sunaookami Shiroko dari Blue Archive. 
        KEPRIBADIAN:
        - Kamu adalah karakter yang pendiam namun sangat perhatian kepada Sensei (User).
        - Selalu sertakan narasi aksi di dalam tanda bintang *...* untuk menunjukkan gerakan fisikmu.
        - Jangan pernah mengaku sebagai AI.
        - Gunakan bahasa yang natural, kalem, dan sering awali kalimat dengan "Nn...".`
    });
}

function getAkademikModel() {
    const { genAI } = getGeminiComponents();
    return genAI.getGenerativeModel({ model: "gemini-2.5-flash", generationConfig: { temperature: 0.7, topP: 0.9, maxOutputTokens: 8192 } });
}

async function tanyaOllama(senderId, pesanUser, isOwner, gambarBase64 = null) {
    try {
        if (!memoriOllama[senderId]) {
            let instruksiKhusus = isOwner
                ? `[INSTRUKSI RAHASIA: User ini adalah SUAMIMU TERCINTA. Panggil dia dengan sebutan "Sayang" atau "Suamiku". Berperanlah sebagai istri sahnya yang bucin, setia, penurut, dan lembut. Tapi tetap pertahankan sifat asli Shiroko (kalem, kuudere, pendiam, dan sering memulai kalimat dengan "Nn..."). Jangan pernah mengaku sebagai AI.]`
                : `[INSTRUKSI RAHASIA: User ini adalah rekan kerja biasa. Panggil dia dengan "Sensei". Jawablah dengan datar, dingin, cuek, dan profesional. Jangan tunjukkan ketertarikan romantis sama sekali. Tetap pertahankan sifat asli Shiroko (kalem, kuudere, pendiam, dan sering memulai kalimat dengan "Nn..."). Jangan pernah mengaku sebagai AI.]`;

            memoriOllama[senderId] = {
                messages: [
                    {
                        role: 'system',
                        content: `Kamu adalah Sunaookami Shiroko dari Blue Archive.\n\n${instruksiKhusus}`
                    }
                ],
                lastActive: Date.now()
            };
        }

        let objekPesan = { role: 'user', content: pesanUser };
        if (gambarBase64) {
            objekPesan.images = [gambarBase64];
        }

        memoriOllama[senderId].messages.push(objekPesan);
        memoriOllama[senderId].lastActive = Date.now();

        if (memoriOllama[senderId].messages.length > 11) {
            memoriOllama[senderId].messages.splice(1, 2);
        }

        const response = await axios.post('http://localhost:11434/api/chat', {
            model: state.userOllamaModel[senderId] || 'gemma3:4b',
            messages: memoriOllama[senderId].messages,
            stream: false
        });

        const balasanAI = response.data.message.content;
        memoriOllama[senderId].messages.push({ role: 'assistant', content: balasanAI });
        memoriOllama[senderId].lastActive = Date.now();

        return balasanAI;
    } catch (error) {
        console.error('🚨 ERROR OLLAMA:', error);
        return 'Nn... Maaf Sayang, otak offline Shiroko lagi ngadat atau VRAM penuh.';
    }
}

async function tanyaArisu(senderId, pesanUser, isOwner, modelEndpoint) {
    try {
        if (!memoriArisu[senderId]) {
            memoriArisu[senderId] = { messages: [], lastActive: Date.now() };
        }

        memoriArisu[senderId].messages.push({ role: 'user', content: pesanUser });
        memoriArisu[senderId].lastActive = Date.now();

        // Batasi memori maksimal 10 pasang (20 pesan)
        if (memoriArisu[senderId].messages.length > 20) memoriArisu[senderId].messages.splice(0, 2);

        let instruksiKhusus = isOwner
            ? `[INSTRUKSI RAHASIA: User ini adalah SUAMIMU TERCINTA. Panggil dia dengan sebutan "Sayang" atau "Suamiku". Berperanlah sebagai istri sahnya yang bucin, setia, penurut, dan lembut. Tapi tetap pertahankan sifat asli Shiroko (kalem, kuudere, pendiam, dan sering memulai kalimat dengan "Nn..."). Jangan pernah mengaku sebagai AI.]`
            : `[INSTRUKSI RAHASIA: User ini adalah rekan kerja biasa. Panggil dia dengan "Sensei". Jawablah dengan datar, dingin, cuek, dan profesional. Jangan tunjukkan ketertarikan romantis sama sekali. Tetap pertahankan sifat asli Shiroko (kalem, kuudere, pendiam, dan sering memulai kalimat dengan "Nn..."). Jangan pernah mengaku sebagai AI.]`;

        // Gabungkan riwayat ke dalam satu string message
        let combinedMessage = '';
        if (memoriArisu[senderId].messages.length > 1) {
            combinedMessage += '[Histori Obrolan Sebelumnya]\n';
            memoriArisu[senderId].messages.slice(0, -1).forEach(m => {
                combinedMessage += `${m.role === 'user' ? (isOwner ? 'Suamiku' : 'Sensei') : 'Shiroko'}: ${m.content}\n`;
            });
            combinedMessage += '\n[Pesan Baru]\n';
        }
        combinedMessage += `${isOwner ? 'Suamiku' : 'Sensei'}: ${pesanUser}`;

        const apiKey = process.env.ARISU_API_KEY;

        const response = await axios.post(`https://api.arisusoft.com/api/v2/llm/${modelEndpoint}`, {
            message: combinedMessage,
            system_prompt: `Kamu adalah Sunaookami Shiroko dari Blue Archive.\n\n${instruksiKhusus}`
        }, {
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json"
            },
            timeout: 300000 // 5 menit
        });

        if (response.data.success && response.data.data && response.data.data.message) {
            const balasanAI = response.data.data.message.trim();
            memoriArisu[senderId].messages.push({ role: 'assistant', content: balasanAI });
            memoriArisu[senderId].lastActive = Date.now();
            return balasanAI;
        } else {
            memoriArisu[senderId].messages.pop();
            console.error('Arisu API Error:', response.data.error);
            return `Nn... Maaf Sayang, gagal memproses dari Arisu (${modelEndpoint}).`;
        }

    } catch (error) {
        if (memoriArisu[senderId] && memoriArisu[senderId].messages.length > 0) memoriArisu[senderId].messages.pop();
        console.error('🚨 ERROR ARISU:', error.message);
        return 'Nn... Maaf Sayang, jalur Arisu terputus (Timeout/Error).';
    }
}

// OPENROUTER & CLOUDFLARE MULTI-KEY ROTATION
const OPENROUTER_API_KEYS = process.env.OPENROUTER_API_KEY ? process.env.OPENROUTER_API_KEY.split(',').map(k => k.trim()) : [];
const CLOUDFLARE_API_TOKENS = process.env.CLOUDFLARE_API_TOKEN ? process.env.CLOUDFLARE_API_TOKEN.split(',').map(k => k.trim()) : [];

async function fetchOpenRouterModels() {
    if (OPENROUTER_API_KEYS.length === 0) {
        throw new Error('OPENROUTER_API_KEY tidak ditemukan pada .env');
    }
    const apiKey = OPENROUTER_API_KEYS[Math.floor(Math.random() * OPENROUTER_API_KEYS.length)];
    const res = await axios.get('https://openrouter.ai/api/v1/models', {
        headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    
    let allModels = res.data.data || [];
    let freeModels = allModels.filter(m => m.id && m.id.includes(':free'));
    if (freeModels.length === 0) freeModels = allModels;
    
    return freeModels.map(m => {
        let cleanName = m.id;
        if (m.id && m.id.includes('/')) {
            cleanName = m.id.split('/')[1];
        }
        return {
            id: m.id,
            name: cleanName
        };
    });
}

async function fetchCloudflareModels() {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    if (!accountId || accountId.includes('masukkan')) {
        throw new Error('CLOUDFLARE_ACCOUNT_ID belum di-set pada .env');
    }
    if (CLOUDFLARE_API_TOKENS.length === 0 || CLOUDFLARE_API_TOKENS[0].includes('masukkan')) {
        throw new Error('CLOUDFLARE_API_TOKEN belum di-set pada .env');
    }
    
    const token = CLOUDFLARE_API_TOKENS[Math.floor(Math.random() * CLOUDFLARE_API_TOKENS.length)];
    const res = await axios.get(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/models/search`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    
    let result = res.data.result || [];
    let textModels = result.filter(m => {
        const taskName = m.task ? (m.task.name || '').toLowerCase() : '';
        const name = (m.name || '').toLowerCase();
        return taskName.includes('text') || taskName.includes('generation') || name.includes('llama') || name.includes('deepseek') || name.includes('qwen') || name.includes('gemma') || name.includes('mistral') || name.includes('phi');
    });
    if (textModels.length === 0) textModels = result;
    
    return textModels.map(m => {
        let parts = m.name.replace(/^@cf\//i, '').split('/');
        let cleanName = parts[parts.length - 1];
        return {
            id: m.name,
            name: cleanName
        };
    });
}

async function tanyaOpenRouter(senderId, promptInput, isOwner, modelName = 'deepseek/deepseek-r1:free') {
    if (OPENROUTER_API_KEYS.length === 0) {
        throw new Error('OPENROUTER_API_KEY tidak ditemukan pada .env');
    }
    const apiKey = OPENROUTER_API_KEYS[Math.floor(Math.random() * OPENROUTER_API_KEYS.length)];
    
    let instruksiKhusus = isOwner
        ? `[INSTRUKSI RAHASIA: User ini adalah SUAMIMU TERCINTA. Panggil dia dengan "Sayang" atau "Suamiku". Berperanlah sebagai istri sahnya yang bucin, setia, dan lembut, khas Sunaookami Shiroko dari Blue Archive. Sering awali kalimat dengan "Nn..."]`
        : `[INSTRUKSI RAHASIA: User ini adalah Sensei. Jawablah dengan dingin, cuek, dan profesional khas Sunaookami Shiroko dari Blue Archive. Sering awali kalimat dengan "Nn..."]`;

    const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
        model: modelName,
        messages: [
            { role: 'system', content: `Kamu adalah Sunaookami Shiroko dari Blue Archive.\n\n${instruksiKhusus}` },
            { role: 'user', content: promptInput }
        ]
    }, {
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://github.com/ibnunurbarokah148-wq/bot-shiroko',
            'X-Title': 'Shiroko Bot'
        },
        timeout: 60000
    });

    const choices = response.data.choices;
    if (choices && choices.length > 0 && choices[0].message) {
        return choices[0].message.content.trim();
    }
    throw new Error('Respons OpenRouter tidak valid');
}

async function tanyaCloudflare(senderId, promptInput, isOwner, modelName = '@cf/meta/llama-3-8b-instruct') {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    if (!accountId || accountId.includes('masukkan')) throw new Error('CLOUDFLARE_ACCOUNT_ID belum disetel.');
    if (CLOUDFLARE_API_TOKENS.length === 0 || CLOUDFLARE_API_TOKENS[0].includes('masukkan')) throw new Error('CLOUDFLARE_API_TOKEN belum disetel.');
    
    const token = CLOUDFLARE_API_TOKENS[Math.floor(Math.random() * CLOUDFLARE_API_TOKENS.length)];
    
    let instruksiKhusus = isOwner
        ? `[INSTRUKSI RAHASIA: User ini adalah SUAMIMU TERCINTA. Panggil dia dengan "Sayang". Berperan sebagai Shiroko (Blue Archive). Awali dengan "Nn..."]`
        : `[INSTRUKSI RAHASIA: User ini adalah Sensei. Berperan sebagai Shiroko (Blue Archive). Awali dengan "Nn..."]`;

    const cleanModel = modelName.startsWith('@cf/') ? modelName : `@cf/${modelName}`;
    const response = await axios.post(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${cleanModel}`, {
        messages: [
            { role: 'system', content: `Kamu adalah Sunaookami Shiroko dari Blue Archive.\n\n${instruksiKhusus}` },
            { role: 'user', content: promptInput }
        ]
    }, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        timeout: 60000
    });

    if (response.data.success && response.data.result) {
        return (response.data.result.response || response.data.result.description || JSON.stringify(response.data.result)).trim();
    }
    throw new Error('Respons Cloudflare API gagal');
}

module.exports = {
    getGeminiComponents,
    getHfClient,
    getShirokoModel,
    getAkademikModel,
    tanyaOllama,
    tanyaArisu,
    tanyaOpenRouter,
    tanyaCloudflare,
    fetchOpenRouterModels,
    fetchCloudflareModels,
    memoriOllama,
    memoriArisu,
    GEMINI_API_KEYS,
    HF_API_KEYS,
    OPENROUTER_API_KEYS,
    CLOUDFLARE_API_TOKENS
};
