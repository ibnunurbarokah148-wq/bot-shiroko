// ==========================================
// COMMAND: AI CHAT & MODE
// Handler: !aimode, !shiroko_pintar, !shiroko [pesan], !lupa,
//          sesiOllamaMode, obrolan AI, penangkapan gambar
// ==========================================
const axios = require('axios');
const state = require('../config/state');
const { cekDanPotongLimit, kembalikanLimit } = require('../config/db');
const AIProvider = require('../services/ai/AIProvider');
const { getGeminiComponents } = require('../services/ai/providers/gemini');

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

        AIProvider.clearMemory(senderId);
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
                const models = await AIProvider.fetchModels('openrouter');

                if (!models || models.length === 0) { await reply('Nn... Tidak ada model OpenRouter yang tersedia.'); return true; }

                state.sesiOpenRouterMode[senderId] = { list: models };

                let teksList = `🌐 *DAFTAR MODEL OPENROUTER LIVE*\n\nNn... Sensei, pilih otak OpenRouter yang mau dipakai dengan membalas angkanya:\n\n`;
                models.forEach((m, i) => { teksList += `*${i + 1}.* ${m.name}\n`; });
                teksList += `\n_Ketik *batal* untuk membatalkan._`;

                await reply(teksList);
            } catch (err) {
                console.error('Error scan OpenRouter:', err.message);
                await reply(`Nn... Gagal men-scan OpenRouter: ${err.message}`);
            }
        } else if (args === 'cloudflare' || args === 'cf') {
            try {
                await reply('Nn... Men-scan daftar model AI resmi dari Cloudflare...');
                const models = await AIProvider.fetchModels('cloudflare');

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
            'gemini': 2, 'ollama': 0, 'openrouter': 2, 'cloudflare': 2
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
            const { provider, model } = AIProvider.resolveMode(userMode, senderId);

            const pesanInstruksi = `[TOLONG JAWAB PERTANYAAN INI SEBAGAI ASISTEN AKADEMIK YANG CERDAS DAN FORMAL]: ${pertanyaan}`;

            if (provider === 'gemini') {
                // Gemini mode khusus: one-shot (tanpa chat session)
                await reply('Nn... Mengakses database cloud Gemini...');
                const bensinGemini = getGeminiComponents();
                const modelPintarDinamis = bensinGemini.genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
                const result = await modelPintarDinamis.generateContent(`Jawablah informatif & akurat:\n\nPertanyaan: ${pertanyaan}`);
                await reply(`🧠 *SHIROKO PINTAR (GEMINI)*\n\n${result.response.text().trim()}`);
            } else {
                await reply(`Nn... Membuka jalur perpustakaan ${provider.toUpperCase()} (${model})...`);
                const jawaban = await AIProvider.generate({
                    provider, model, prompt: pesanInstruksi, senderId, isOwner
                });
                await reply(`🧠 *SHIROKO PINTAR (${model.toUpperCase()})*\n\n${jawaban}`);
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
    // MESIN OBROLAN AI — UNIFIED via AIProvider
    // ==========================================
    if (pemicuObrolan && (pesanUser || chatImageBuffer)) {
        const defaultMode = isOwner ? 'gemini' : 'arisu-gemini';
        const userMode = state.userAIMode[senderId] || defaultMode;
        const cost = getAiCost(userMode);
        if (!cekDanPotongLimit(senderId, cost)) { await reply(`Nn... Token habis. Butuh ${cost} limit.`); return true; }

        try {
            await sock.sendPresenceUpdate('composing', from);
            const { provider, model } = AIProvider.resolveMode(userMode, senderId);

            const jawaban = await AIProvider.generate({
                provider,
                model,
                prompt: pesanUser,
                senderId,
                isOwner,
                imageBuffer: chatImageBuffer
            });

            await reply(jawaban);
            return true;
        } catch (error) {
            kembalikanLimit(senderId, cost);
            await reply('Nn... Memori Shiroko eror, ketik !lupa.');
        }
        return true;
    }

    // ==========================================
    // LUPA (RESET MEMORI) — UNIFIED
    // ==========================================
    if (textLower === '!lupa') {
        const berhasilLupa = AIProvider.clearMemory(senderId);

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
