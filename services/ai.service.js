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

module.exports = {
    getGeminiComponents,
    getHfClient,
    getShirokoModel,
    getAkademikModel,
    tanyaOllama,
    tanyaArisu,
    memoriOllama,
    memoriArisu,
    GEMINI_API_KEYS,
    HF_API_KEYS
};
