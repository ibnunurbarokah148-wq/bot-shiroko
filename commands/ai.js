// ==========================================
// COMMAND: AI CHAT & MODE
// Handler: !aimode, !shiroko_pintar, !shiroko [pesan], !lupa,
//          sesiOllamaMode, obrolan AI, penangkapan gambar
// ==========================================
const axios = require('axios');
const state = require('../config/state');
const { cekDanPotongLimit, kembalikanLimit } = require('../config/db');
const { getGeminiComponents, tanyaOllama, tanyaArisu, tanyaOpenRouter, tanyaCloudflare, fetchOpenRouterModels, fetchCloudflareModels, memoriOllama, memoriArisu } = require('../services/ai.service');

async function handle(ctx) {
    const { sock, msg, from, senderId, isOwner, isGroup, textClean, textLower,
            msgType, isQuoted, quotedMsg, quotedType, reply, downloadMediaBaileys } = ctx;

    // ==========================================
    // HANDLER SESI MILIH MODEL OLLAMA
    // ==========================================
    if (state.sesiOllamaMode[senderId]) {
        const pilihan = textLower;
        if (pilihan === 'batal' || pilihan === 'cancel') {
            delete state.sesiOllamaMode[senderId];
            await reply('Nn... Pemilihan otak Ollama dibatalkan.');
            return true;
        }

        const num = parseInt(pilihan) - 1;
        const listModels = state.sesiOllamaMode[senderId].list;

        if (isNaN(num) || num < 0 || num >= listModels.length) {
            await reply('Nn... Angka tidak valid, Sensei. Balas dengan angka yang ada di daftar, atau ketik *batal*.');
            return true;
        }

        const chosenModel = listModels[num];
        state.ownerOllamaModel = chosenModel;
        state.ownerAIMode = 'ollama';

        if (memoriOllama[senderId]) delete memoriOllama[senderId];
        delete state.sesiOllamaMode[senderId];

        await reply(`✅ *MODE OLLAMA AKTIF*\n\nNn... Berhasil mengganti otak. Shiroko sekarang menggunakan sistem lokal: *${chosenModel}*. ✨`);
        return true;
    }

    // ==========================================
    // HANDLER SESI MILIH MODEL OPENROUTER
    // ==========================================
    if (state.sesiOpenRouterMode[senderId]) {
        const pilihan = textLower;
        if (pilihan === 'batal' || pilihan === 'cancel') {
            delete state.sesiOpenRouterMode[senderId];
            await reply('Nn... Pemilihan otak OpenRouter dibatalkan.');
            return true;
        }

        const num = parseInt(pilihan) - 1;
        const listModels = state.sesiOpenRouterMode[senderId].list;

        if (isNaN(num) || num < 0 || num >= listModels.length) {
            await reply('Nn... Angka tidak valid, Sensei. Balas dengan angka yang ada di daftar, atau ketik *batal*.');
            return true;
        }

        const chosenModel = listModels[num];
        state.userOpenRouterModel[senderId] = chosenModel.id;
        state.userAIMode[senderId] = 'openrouter';

        delete state.sesiOpenRouterMode[senderId];

        await reply(`✅ *MODE OPENROUTER AKTIF*\n\nNn... Otak OpenRouter berhasil dikunci ke model:\n*${chosenModel.name}* (\`${chosenModel.id}\`). ✨`);
        return true;
    }

    // ==========================================
    // HANDLER SESI MILIH MODEL CLOUDFLARE
    // ==========================================
    if (state.sesiCloudflareMode[senderId]) {
        const pilihan = textLower;
        if (pilihan === 'batal' || pilihan === 'cancel') {
            delete state.sesiCloudflareMode[senderId];
            await reply('Nn... Pemilihan otak Cloudflare dibatalkan.');
            return true;
        }

        const num = parseInt(pilihan) - 1;
        const listModels = state.sesiCloudflareMode[senderId].list;

        if (isNaN(num) || num < 0 || num >= listModels.length) {
            await reply('Nn... Angka tidak valid, Sensei. Balas dengan angka yang ada di daftar, atau ketik *batal*.');
            return true;
        }

        const chosenModel = listModels[num];
        state.userCloudflareModel[senderId] = chosenModel.id;
        state.userAIMode[senderId] = 'cloudflare';

        delete state.sesiCloudflareMode[senderId];

        await reply(`✅ *MODE CLOUDFLARE AI AKTIF*\n\nNn... Otak Cloudflare AI berhasil dikunci ke model:\n*${chosenModel.name}*. ✨`);
        return true;
    }

    // ==========================================
    // AI MODE
    // ==========================================
    if (textLower.startsWith('!aimode')) {
        const args = textClean.split(' ')[1];
        const allowedModes = ['gemini', 'ollama', 'openrouter', 'or', 'cloudflare', 'cf', 'ds3', 'ds4', 'glm', 'qwen', 'arisu-gemini', 'gpt', 'grok'];
        
        if (!args || !allowedModes.includes(args)) {
            const defaultMode = isOwner ? 'gemini' : 'arisu-gemini';
            const currentMode = state.userAIMode[senderId] || defaultMode;
            const currentOllama = state.userOllamaModel[senderId] || 'gemma3:4b';
            const currentOR = state.userOpenRouterModel[senderId] || 'deepseek/deepseek-r1:free';
            const currentCF = state.userCloudflareModel[senderId] || '@cf/meta/llama-3-8b-instruct';
            
            let listModes = isOwner 
                ? `🔹 *!aimode gemini* (Gemini Cloud)\n🔹 *!aimode ollama* (Lokal Offline)\n` 
                : ``;
            listModes += `🔹 *!aimode openrouter* (Live OpenRouter Scanner)\n🔹 *!aimode cloudflare* (Live Cloudflare AI Scanner)\n🔹 *!aimode ds3* (Deepseek V3.2)\n🔹 *!aimode ds4* (Deepseek V4 Pro)\n🔹 *!aimode glm* (GLM AI)\n🔹 *!aimode qwen* (Qwen AI)\n🔹 *!aimode arisu-gemini* (Gemini via Arisu)\n🔹 *!aimode gpt* (GPT 5 Nano)\n🔹 *!aimode grok* (Grok 4.1)`;
            
            await reply(`Nn... Format salah, Sensei. Pilih salah satu mode di bawah ini:\n\n${listModes}\n\nMode saat ini: *${currentMode.toUpperCase()}*\nOpenRouter Aktif: *${currentOR}*\nCloudflare Aktif: *${currentCF}*`);
            return true;
        }

        if (args === 'ollama') {
            try {
                await reply('Nn... Mengecek daftar otak buatan di laptop lokal...');
                const resTags = await axios.get('http://localhost:11434/api/tags');
                const models = resTags.data.models;

                if (!models || models.length === 0) { await reply('Nn... Tidak ada model Ollama yang terinstall di laptop Sensei.'); return true; }

                const modelNames = models.map(m => m.name);
                state.sesiOllamaMode[senderId] = { list: modelNames };

                let teksList = `🤖 *DAFTAR MODEL OLLAMA LOKAL*\n\nNn... Sensei, pilih otak mana yang mau dipakai dengan membalas angkanya:\n\n`;
                modelNames.forEach((name, i) => { teksList += `*${i + 1}.* ${name}\n`; });
                teksList += `\n_Ketik *batal* untuk membatalkan._`;

                await reply(teksList);
            } catch (err) {
                console.error('Error cek Ollama:', err.message);
                await reply('Nn... Gagal nyambung ke Ollama. Pastikan aplikasi Ollama di laptop udah nyala.');
            }
        } else if (args === 'openrouter' || args === 'or') {
            try {
                await reply('Nn... Men-scan daftar model live dari OpenRouter API...');
                const models = await fetchOpenRouterModels();

                if (!models || models.length === 0) { await reply('Nn... Tidak ada model OpenRouter yang tersedia.'); return true; }

                state.sesiOpenRouterMode[senderId] = { list: models };

                let teksList = `🌐 *DAFTAR MODEL OPENROUTER LIVE*\n\nNn... Sensei, pilih otak OpenRouter yang mau dipakai dengan membalas angkanya:\n\n`;
                models.forEach((m, i) => { teksList += `*${i + 1}.* ${m.name}\n   \`${m.id}\`\n`; });
                teksList += `\n_Ketik *batal* untuk membatalkan._`;

                await reply(teksList);
            } catch (err) {
                console.error('Error scan OpenRouter:', err.message);
                await reply(`Nn... Gagal men-scan OpenRouter: ${err.message}`);
            }
        } else if (args === 'cloudflare' || args === 'cf') {
            try {
                await reply('Nn... Men-scan daftar model AI resmi dari Cloudflare...');
                const models = await fetchCloudflareModels();

                if (!models || models.length === 0) { await reply('Nn... Tidak ada model Cloudflare yang ditemukan.'); return true; }

                state.sesiCloudflareMode[senderId] = { list: models };

                let teksList = `☁️ *DAFTAR MODEL CLOUDFLARE AI LIVE*\n\nNn... Sensei, pilih otak Cloudflare AI yang mau dipakai dengan membalas angkanya:\n\n`;
                models.forEach((m, i) => { teksList += `*${i + 1}.* ${m.name}\n`; });
                teksList += `\n_Ketik *batal* untuk membatalkan._`;

                await reply(teksList);
            } catch (err) {
                console.error('Error scan Cloudflare:', err.message);
                await reply(`Nn... Gagal men-scan Cloudflare AI: ${err.message}`);
            }
        } else {
            state.userAIMode[senderId] = args;
            await reply(`✅ *MODE OPERASIONAL DIUBAH*\n\nNn... Mulai sekarang, khusus untuk chat dari Sensei, Shiroko akan berpikir menggunakan otak *${args.toUpperCase()}*. ✨`);
        }
        return true;
    }

    // Fungsi helper untuk menghitung limit
    function getAiCost(mode) {
        const costMap = {
            'ds3': 2, 'ds4': 4, 'glm': 2, 'qwen': 2,
            'arisu-gemini': 2, 'gpt': 2, 'grok': 2,
            'gemini': 2, 'ollama': 1, 'openrouter': 2, 'cloudflare': 2
        };
        return costMap[mode] || 2;
    }

    // ==========================================
    // SHIROKO PINTAR
    // ==========================================
    if (textLower.startsWith('!shiroko_pintar ')) {
        const defaultMode = isOwner ? 'gemini' : 'arisu-gemini';
        const userMode = state.userAIMode[senderId] || defaultMode;
        const cost = getAiCost(userMode);
        if (!cekDanPotongLimit(senderId, cost)) { await reply(`Nn... Token tidak cukup. Butuh ${cost} limit.`); return true; }

        try {
            await sock.sendPresenceUpdate('composing', from);
            const pertanyaan = textClean.substring(16).trim();

            if (userMode === 'ollama') {
                await reply('Nn... Membuka database perpustakaan lokal via Ollama...');
                const pesanInstruksi = `[TOLONG JAWAB PERTANYAAN INI SEBAGAI ASISTEN AKADEMIK YANG CERDAS DAN FORMAL]: ${pertanyaan}`;
                const jawaban = await tanyaOllama(senderId, pesanInstruksi, isOwner);
                await reply(`🧠 *SHIROKO PINTAR (OLLAMA)*\n\n${jawaban}`);
                return true;
            } else if (userMode === 'openrouter') {
                const modelPilihan = state.userOpenRouterModel[senderId] || 'deepseek/deepseek-r1:free';
                await reply(`Nn... Menghubungi OpenRouter (${modelPilihan})...`);
                const pesanInstruksi = `[TOLONG JAWAB PERTANYAAN INI SEBAGAI ASISTEN AKADEMIK YANG CERDAS DAN FORMAL]: ${pertanyaan}`;
                const jawaban = await tanyaOpenRouter(senderId, pesanInstruksi, isOwner, modelPilihan);
                await reply(`🧠 *SHIROKO PINTAR (OPENROUTER)*\n\n${jawaban}`);
                return true;
            } else if (userMode === 'cloudflare') {
                const modelPilihan = state.userCloudflareModel[senderId] || '@cf/meta/llama-3-8b-instruct';
                await reply(`Nn... Menghubungi Cloudflare Workers AI (${modelPilihan})...`);
                const pesanInstruksi = `[TOLONG JAWAB PERTANYAAN INI SEBAGAI ASISTEN AKADEMIK YANG CERDAS DAN FORMAL]: ${pertanyaan}`;
                const jawaban = await tanyaCloudflare(senderId, pesanInstruksi, isOwner, modelPilihan);
                await reply(`🧠 *SHIROKO PINTAR (CLOUDFLARE)*\n\n${jawaban}`);
                return true;
            } else if (['ds3', 'ds4', 'glm', 'qwen', 'arisu-gemini', 'gpt', 'grok'].includes(userMode)) {
                let endpoint = userMode === 'ds3' ? 'deepseek-v3' : userMode === 'ds4' ? 'deepseek-v4' : userMode === 'arisu-gemini' ? 'gemini' : userMode;
                await reply(`Nn... Membuka jalur perpustakaan Arisu (${endpoint})...`);
                const pesanInstruksi = `[TOLONG JAWAB PERTANYAAN INI SEBAGAI ASISTEN AKADEMIK YANG CERDAS DAN FORMAL]: ${pertanyaan}`;
                const jawaban = await tanyaArisu(senderId, pesanInstruksi, isOwner, endpoint);
                await reply(`🧠 *SHIROKO PINTAR (${endpoint.toUpperCase()})*\n\n${jawaban}`);
                return true;
            } else {
                await reply('Nn... Mengakses database cloud Gemini...');
                const bensinGemini = getGeminiComponents();
                const modelPintarDinamis = bensinGemini.genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
                const result = await modelPintarDinamis.generateContent(`Jawablah informatif & akurat:\n\nPertanyaan: ${pertanyaan}`);
                await reply(`🧠 *SHIROKO PINTAR (GEMINI)*\n\n${result.response.text().trim()}`);
                return true;
            }

        } catch (error) {
            kembalikanLimit(senderId, cost);
            await reply('Nn... Mesin kecerdasan akademik sedang mengalami gangguan teknis: ' + error.message);
            console.error('🚨 ERROR SHIROKO PINTAR:', error);
        }
        return true;
    }

    // ==========================================
    // DETEKSI TRIGGER OBROLAN
    // ==========================================
    let pemicuObrolan = false, pesanUser = "";
    if (isGroup) {
        if (textLower.startsWith('!shiroko ')) { pemicuObrolan = true; pesanUser = textClean.substring(9).trim(); }
    } else {
        const sedangSesiLain = state.sesiUjian[senderId] || state.sesiTikTok[senderId] ||
            state.sesiKaryaIlmiah[senderId] || state.sesiPixiv[senderId] || state.sesiWaifu[senderId] ||
            state.sesiTopup[senderId] || state.sesiMeme[senderId] || state.sesiOllamaMode[senderId] ||
            state.sesiOpenRouterMode[senderId] || state.sesiCloudflareMode[senderId] ||
            state.sesiCabutRole[senderId] || state.sesiModelGambar[senderId];
        if (!textClean.startsWith('!') && !sedangSesiLain) { pemicuObrolan = true; pesanUser = textClean; }
        else if (textLower.startsWith('!shiroko ')) { pemicuObrolan = true; pesanUser = textClean.substring(9).trim(); }
    }

    // ==========================================
    // RADAR PENANGKAP GAMBAR UNTUK NGOBROL
    // ==========================================
    let chatImageBuffer = null;
    if (pemicuObrolan) {
        const isTargetImage = msgType === 'imageMessage';
        const isQuotedImage = isQuoted && quotedType === 'imageMessage';

        if (isTargetImage || isQuotedImage) {
            const messageToDownload = isQuotedImage ? quotedMsg?.imageMessage : msg?.message?.imageMessage;
            if (messageToDownload) {
                try {
                    chatImageBuffer = await downloadMediaBaileys(messageToDownload, 'image');
                    if (!pesanUser) pesanUser = "Nn... Tolong deskripsikan gambar ini dengan detail.";
                } catch (e) {
                    console.error("Gagal download gambar chat:", e);
                }
            }
        }
    }

    // ==========================================
    // MESIN OBROLAN AI
    // ==========================================
    if (pemicuObrolan && (pesanUser || chatImageBuffer)) {
        const defaultMode = isOwner ? 'gemini' : 'arisu-gemini';
        const userMode = state.userAIMode[senderId] || defaultMode;
        const cost = getAiCost(userMode);
        if (!cekDanPotongLimit(senderId, cost)) { await reply(`Nn... Token habis. Butuh ${cost} limit.`); return true; }

        try {
            await sock.sendPresenceUpdate('composing', from);

            if (userMode === 'ollama') {
                let base64Img = chatImageBuffer ? chatImageBuffer.toString('base64') : null;
                const jawabanOllama = await tanyaOllama(senderId, pesanUser, isOwner, base64Img);
                await reply(jawabanOllama);
                return true;
            } else if (userMode === 'openrouter') {
                const modelPilihan = state.userOpenRouterModel[senderId] || 'deepseek/deepseek-r1:free';
                const jawabanOR = await tanyaOpenRouter(senderId, pesanUser, isOwner, modelPilihan);
                await reply(jawabanOR);
                return true;
            } else if (userMode === 'cloudflare') {
                const modelPilihan = state.userCloudflareModel[senderId] || '@cf/meta/llama-3-8b-instruct';
                const jawabanCF = await tanyaCloudflare(senderId, pesanUser, isOwner, modelPilihan);
                await reply(jawabanCF);
                return true;
            } else if (['ds3', 'ds4', 'glm', 'qwen', 'arisu-gemini', 'gpt', 'grok'].includes(userMode)) {
                let endpoint = userMode === 'ds3' ? 'deepseek-v3' : userMode === 'ds4' ? 'deepseek-v4' : userMode === 'arisu-gemini' ? 'gemini' : userMode;
                const jawabanArisu = await tanyaArisu(senderId, pesanUser, isOwner, endpoint);
                await reply(jawabanArisu);
                return true;
            } else {
                // JALUR GEMINI CLOUD
                const bensinGemini = getGeminiComponents();
                if (!state.sesiObrolan[senderId]) {
                    let instruksiKhusus = isOwner
                        ? `[INSTRUKSI RAHASIA: User ini adalah SUAMIMU TERCINTA. Panggil dia dengan sebutan "Sayang" atau "Suamiku". Berperanlah sebagai istri sahnya yang bucin, setia, penurut, dan lembut. Tapi tetap pertahankan sifat asli Shiroko (kalem, kuudere, pendiam, dan sering memulai kalimat dengan "Nn..."). Jangan pernah mengaku sebagai AI.]`
                        : `[INSTRUKSI RAHASIA: User ini adalah rekan kerja biasa. Panggil dia dengan "Sensei". Jawablah dengan datar, dingin, cuek, dan profesional. Jangan tunjukkan ketertarikan romantis sama sekali. Tetap pertahankan sifat asli Shiroko (kalem, kuudere, pendiam, dan sering memulai kalimat dengan "Nn..."). Jangan pernah mengaku sebagai AI.]`;

                    const modelObrolan = bensinGemini.genAI.getGenerativeModel({
                        model: "gemini-2.5-flash",
                        generationConfig: { temperature: 0.8, topP: 0.95, maxOutputTokens: 4096 },
                        systemInstruction: `Kamu adalah Sunaookami Shiroko dari Blue Archive.\n\n${instruksiKhusus}`
                    });
                    state.sesiObrolan[senderId] = modelObrolan.startChat({ history: [] });
                }

                // FIX BUG #7: Kirim gambar ke Gemini jika ada
                let messageParts;
                if (chatImageBuffer) {
                    messageParts = [
                        pesanUser,
                        { inlineData: { data: chatImageBuffer.toString('base64'), mimeType: 'image/jpeg' } }
                    ];
                } else {
                    messageParts = pesanUser;
                }

                const result = await state.sesiObrolan[senderId].sendMessage(messageParts);
                await reply(result.response.text());
                return true;
            }
        } catch (error) {
            kembalikanLimit(senderId, cost);
            await reply('Nn... Memori Shiroko eror, ketik !lupa.');
        }
        return true;
    }

    // ==========================================
    // LUPA (RESET MEMORI)
    // ==========================================
    if (textLower === '!lupa') {
        let berhasilLupa = false;

        if (state.sesiObrolan[senderId]) {
            delete state.sesiObrolan[senderId];
            berhasilLupa = true;
        }
        if (memoriOllama[senderId]) {
            delete memoriOllama[senderId];
            berhasilLupa = true;
        }
        if (memoriArisu[senderId]) {
            delete memoriArisu[senderId];
            berhasilLupa = true;
        }

        if (berhasilLupa) {
            await reply('Nn... *(Menggelengkan kepala)*. Shiroko sudah menghapus seluruh memori percakapan kita.');
        } else {
            await reply('Nn... Pikiran Shiroko memang masih kosong dari awal.');
        }
        return true;
    }

    return false;
}

module.exports = { handle };
