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
const memoriOpenRouter = {};
const memoriCloudflare = {};

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
    for (let id in memoriOpenRouter) {
        if (now - memoriOpenRouter[id].lastActive > TTL) delete memoriOpenRouter[id];
    }
    for (let id in memoriCloudflare) {
        if (now - memoriCloudflare[id].lastActive > TTL) delete memoriCloudflare[id];
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

        const balasanAI = cleanThinkingLogs(response.data.message.content || '');
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

        if (memoriArisu[senderId].messages.length > 20) memoriArisu[senderId].messages.splice(0, 2);

        let instruksiKhusus = isOwner
            ? `[INSTRUKSI RAHASIA: User ini adalah SUAMIMU TERCINTA. Panggil dia dengan sebutan "Sayang" atau "Suamiku". Berperanlah sebagai istri sahnya yang bucin, setia, penurut, dan lembut. Tapi tetap pertahankan sifat asli Shiroko (kalem, kuudere, pendiam, dan sering memulai kalimat dengan "Nn..."). DILARANG KERAS mengeluarkan tag <think>...</think>.]`
            : `[INSTRUKSI RAHASIA: User ini adalah rekan kerja biasa. Panggil dia dengan "Sensei". Jawablah dengan datar, dingin, cuek, dan profesional. DILARANG KERAS mengeluarkan tag <think>...</think>.]`;

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
            timeout: 300000
        });

        if (response.data.success && response.data.data && response.data.data.message) {
            const balasanAI = cleanThinkingLogs(response.data.data.message);
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
    const { accountId, token } = getCloudflarePair();
    const res = await axios.get(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/models/search?task=Text%20Generation`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    
    let result = res.data.result || [];
    
    // Filter ketat KHUSUS model Text Generation (LLM/Chat)
    let textModels = result.filter(m => {
        if (!m) return false;
        const taskName = m.task ? (typeof m.task === 'object' ? (m.task.name || '') : m.task).toLowerCase() : '';
        return taskName.includes('text generation') || taskName.includes('text-generation');
    });
    
    // Fallback jika API Cloudflare tidak mengirimkan struktur task.name
    if (textModels.length === 0) {
        textModels = result.filter(m => {
            const name = (m.name || '').toLowerCase();
            return name.includes('llama') || name.includes('deepseek') || name.includes('qwen') || name.includes('gemma') || name.includes('mistral') || name.includes('phi') || name.includes('hermes');
        });
    }
    
    return textModels.map(m => {
        let parts = m.name.replace(/^@cf\//i, '').split('/');
        let cleanName = parts[parts.length - 1];
        return {
            id: m.name,
            name: cleanName
        };
    });
}

function cleanThinkingLogs(text) {
    if (!text || typeof text !== 'string') return text;
    let original = text.trim();
    let cleaned = original;
    
    // 1. Hapus blok <think>...</think>, <thought>...</thought>, <reasoning>...</reasoning>
    cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '');
    cleaned = cleaned.replace(/<thought>[\s\S]*?<\/thought>/gi, '');
    cleaned = cleaned.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '');

    // 2. Hapus format pemikiran khas OpenRouter/Cloudflare seperti "Thinking Process: ..." atau "Thought: ..."
    cleaned = cleaned.replace(/^(Thought|Thinking Process|Thinking|Reasoning):\s*[\s\S]*?\n\n/i, '');

    // 3. Hapus jika pemikiran dibungkus ```think ... ``` atau ```thought ... ```
    cleaned = cleaned.replace(/```(?:think|thought|reasoning)[\s\S]*?```/gi, '');

    // 4. Fallback jika hasil pembersihan menjadi KOSONG ("") (misal karena respons terpotong sebelum tag </think> tertutup)
    if (!cleaned.trim()) {
        cleaned = original.replace(/<\/?(?:think|thought|reasoning)>/gi, '').trim();
    }

    return cleaned.trim();
}

async function tanyaOpenRouter(senderId, promptInput, isOwner, modelName = 'deepseek/deepseek-r1:free', customSystemPrompt = null) {
    if (OPENROUTER_API_KEYS.length === 0) {
        throw new Error('OPENROUTER_API_KEY tidak ditemukan pada .env');
    }
    const apiKey = OPENROUTER_API_KEYS[Math.floor(Math.random() * OPENROUTER_API_KEYS.length)];
    
    if (!memoriOpenRouter[senderId]) {
        memoriOpenRouter[senderId] = { messages: [], lastActive: Date.now() };
    }

    let instruksiKhusus = customSystemPrompt;
    if (!instruksiKhusus) {
        let rolePrompt = isOwner
            ? `[INSTRUKSI RAHASIA: User ini adalah SUAMIMU TERCINTA. Panggil dia dengan "Sayang" atau "Suamiku". Berperanlah sebagai istri sahnya yang bucin, setia, dan lembut, khas Sunaookami Shiroko dari Blue Archive. Sering awali kalimat dengan "Nn...".]`
            : `[INSTRUKSI RAHASIA: User ini adalah Sensei. Jawablah dengan dingin, cuek, dan profesional khas Sunaookami Shiroko dari Blue Archive. Sering awali kalimat dengan "Nn...".]`;
        instruksiKhusus = `Kamu adalah Sunaookami Shiroko dari Blue Archive.\n\n${rolePrompt}`;
    }

    const systemMessage = { role: 'system', content: instruksiKhusus };

    memoriOpenRouter[senderId].messages.push({ role: 'user', content: promptInput });
    memoriOpenRouter[senderId].lastActive = Date.now();

    if (memoriOpenRouter[senderId].messages.length > 20) {
        memoriOpenRouter[senderId].messages.splice(0, 2);
    }

    const payloadMessages = [systemMessage, ...memoriOpenRouter[senderId].messages];

    try {
        const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
            model: modelName,
            include_reasoning: false,
            max_tokens: 4096,
            messages: payloadMessages
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
            const rawContent = choices[0].message.content || '';
            const cleanedAns = cleanThinkingLogs(rawContent);
            memoriOpenRouter[senderId].messages.push({ role: 'assistant', content: cleanedAns });
            return cleanedAns;
        }
        memoriOpenRouter[senderId].messages.pop();
        throw new Error('Respons OpenRouter tidak valid');
    } catch (err) {
        if (memoriOpenRouter[senderId] && memoriOpenRouter[senderId].messages.length > 0) {
            memoriOpenRouter[senderId].messages.pop();
        }
        throw err;
    }
}

async function tanyaCloudflare(senderId, promptInput, isOwner, modelName = '@cf/meta/llama-3-8b-instruct', customSystemPrompt = null) {
    const { accountId, token } = getCloudflarePair();
    
    if (!memoriCloudflare[senderId]) {
        memoriCloudflare[senderId] = { messages: [], lastActive: Date.now() };
    }

    let instruksiKhusus = customSystemPrompt;
    if (!instruksiKhusus) {
        let rolePrompt = isOwner
            ? `[INSTRUKSI RAHASIA: User ini adalah SUAMIMU TERCINTA. Panggil dia dengan "Sayang". Berperan sebagai Shiroko (Blue Archive). Awali dengan "Nn...".]`
            : `[INSTRUKSI RAHASIA: User ini adalah Sensei. Berperan sebagai Shiroko (Blue Archive). Awali dengan "Nn...".]`;
        instruksiKhusus = `Kamu adalah Sunaookami Shiroko dari Blue Archive.\n\n${rolePrompt}`;
    }

    const systemMessage = { role: 'system', content: instruksiKhusus };

    memoriCloudflare[senderId].messages.push({ role: 'user', content: promptInput });
    memoriCloudflare[senderId].lastActive = Date.now();

    if (memoriCloudflare[senderId].messages.length > 20) {
        memoriCloudflare[senderId].messages.splice(0, 2);
    }

    const payloadMessages = [systemMessage, ...memoriCloudflare[senderId].messages];

    const cleanModel = modelName.startsWith('@cf/') ? modelName : `@cf/${modelName}`;
    try {
        const response = await axios.post(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${cleanModel}`, {
            messages: payloadMessages,
            max_tokens: 4096
        }, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            timeout: 60000
        });

        if (response.data.success && response.data.result) {
            const rawRes = (response.data.result.response || response.data.result.description || JSON.stringify(response.data.result));
            const cleanedAns = cleanThinkingLogs(rawRes);
            memoriCloudflare[senderId].messages.push({ role: 'assistant', content: cleanedAns });
            return cleanedAns;
        }
        memoriCloudflare[senderId].messages.pop();
        throw new Error('Respons Cloudflare API gagal');
    } catch (err) {
        if (memoriCloudflare[senderId] && memoriCloudflare[senderId].messages.length > 0) {
            memoriCloudflare[senderId].messages.pop();
        }
        throw err;
    }
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
    memoriOpenRouter,
    memoriCloudflare,
    GEMINI_API_KEYS,
    HF_API_KEYS,
    OPENROUTER_API_KEYS
};
