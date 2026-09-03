// ==========================================
// COMMAND: AI CHAT & MODE
// Handler: !aimode, !shiroko_pintar, !shiroko [pesan], !lupa,
//          sesiOllamaMode, obrolan AI, penangkapan gambar
// ==========================================
const axios = require('axios');
const state = require('../config/state');
const { cekDanPotongLimit, kembalikanLimit, dbAIRole, dbPremium } = require('../config/db');
const AIProvider = require('../services/ai/AIProvider');
const { getGeminiComponents } = require('../services/ai/providers/gemini');
const { ROLE_PROMPTS, getRolePrompt, getShirokoSystemPrompt } = require('../services/ai/prompts');
const { getCoreNumber } = require('../utils/helpers');
const db = require('../config/database');
const companionService = require('../services/ai/companion.service');
const appearanceState = require('../services/ai/appearance.state');
const { extractDocumentText, splitDocumentText } = require('../services/ai/media.service');
const moodState = require('../services/ai/mood.state');
const waifuService = require('../services/waifu.service');
const { WAIFU_CHARACTERS } = require('../config/waifu.characters');
const {
    isXKiroModelFree,
    isXKiroModelAllowed,
    getXKiroModelCost,
    formatXKiroPricing
} = require('../services/ai/providers/xkiro');

function hasActivePremium(senderId) {
    const entry = dbPremium[senderId];
    return !!entry && (entry === true || entry > Date.now());
}

function formatXKiroModelLine(model, { isOwner, isPremium }) {
    const limitCost = getXKiroModelCost(model.id, { isOwner, isPremium, model });
    if (isXKiroModelFree(model)) {
        return `*${model.name}*\n   └ FREE • 1 limit/request`;
    }
    if (isOwner) {
        const tier = (model.accessTier || model.billingType || 'paid').toUpperCase();
        return `*${model.name}*\n   └ ${tier}/WALLET • ${formatXKiroPricing(model.pricing)} • limit bot unlimited`;
    }
    return `*${model.name}*\n   └ PREMIUM/WALLET • ${limitCost} limit/request`;
}

async function handle(ctx) {
    const { sock, msg, normalizedMessage, from, senderId, isOwner, isGroup, textClean, textLower,
            msgType, isQuoted, quotedMsg, quotedType, reply, downloadMediaBaileys } = ctx;

    if (textLower === '!mood') {
        if (!isOwner) {
            await reply('Nn... Status mood hanya bisa dilihat oleh Owner.');
            return true;
        }
        const mood = moodState.getMood();
        const updated = mood.updatedAt ? new Date(mood.updatedAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) : 'Belum ada';
        await reply(`🧠 *STATUS MOOD SHIROKO*\n\n• Mood: *${mood.mood}*\n• Intensitas: *${Math.round(mood.intensity * 100)}%*\n• Confidence: *${Math.round(mood.confidence * 100)}%*\n• Tren: *${mood.trend}*\n• Sinyal terakhir: *${mood.lastSignal}*\n• Diperbarui: ${updated}`);
        return true;
    }

    if (textLower === '!resetmood') {
        if (!isOwner) {
            await reply('Nn... Mood hanya bisa direset oleh Owner.');
            return true;
        }
        moodState.resetMood();
        await reply('Nn... Mood Shiroko sudah dikembalikan ke *neutral*.');
        return true;
    }

    // ==========================================
    // HANDLER SESI MILIH WAIFU (!mybini)
    // ==========================================
    if (state.sesiWaifu && state.sesiWaifu[senderId]) {
        const pilihan = textLower;
        if (pilihan === 'batal' || pilihan === 'cancel') {
            delete state.sesiWaifu[senderId];
            await reply('Nn... Pemilihan istri dibatalkan.');
            return true;
        }

        if (state.sesiWaifu[senderId].step === 1) {
            const num = parseInt(pilihan);
            if (isNaN(num) || num < 1 || num > WAIFU_CHARACTERS.length) {
                await reply(`Nn... Angka tidak valid. Balas dengan angka 1-${WAIFU_CHARACTERS.length}, atau ketik *batal*.`);
                return true;
            }

            const chosen = WAIFU_CHARACTERS[num - 1];
            state.sesiWaifu[senderId].character = chosen.name;
            state.sesiWaifu[senderId].characterId = chosen.id;
            state.sesiWaifu[senderId].prompt = chosen.prompt;
            state.sesiWaifu[senderId].step = 2;

            let teksModel = `Nn... Kamu memilih **${chosen.name}**. Sekarang pilih otak AI yang ingin digunakan:\n\n`;
            teksModel += `1. Gemini (Cloud)\n`;
            teksModel += `2. OpenRouter AI (Cloud)\n`;
            teksModel += `3. Cloudflare Workers AI\n`;
            teksModel += `4. Ollama (Lokal)\n`;
            teksModel += `5. Deepseek V3.2 (Arisu)\n`;
            teksModel += `6. Deepseek V4 Pro (Arisu)\n`;
            teksModel += `7. GLM AI (Arisu)\n`;
            teksModel += `8. Qwen AI (Arisu)\n`;
            teksModel += `9. Gemini (Arisu)\n`;
            teksModel += `10. GPT 5 Nano (Arisu)\n`;
            teksModel += `11. Grok 4.1 (Arisu)\n`;
            teksModel += `12. xKiro Multi-Model Gateway 🚀\n\n`;
            teksModel += `Balas dengan angka (1-12) atau ketik *batal*.`;

            await reply(teksModel);
            return true;
        }

        if (state.sesiWaifu[senderId].step === 2) {
            const num = parseInt(pilihan);
            if (isNaN(num) || num < 1 || num > 12) {
                await reply('Nn... Angka tidak valid. Balas dengan angka 1-12, atau ketik *batal*.');
                return true;
            }

            const modelMap = {
                1: 'gemini', 2: 'openrouter', 3: 'cloudflare', 4: 'ollama',
                5: 'ds3', 6: 'ds4', 7: 'glm', 8: 'qwen', 9: 'arisu-gemini', 10: 'gpt', 11: 'grok', 12: 'xkiro'
            };

            const chosenModel = modelMap[num];
            
            const charName = state.sesiWaifu[senderId].character;
            const characterId = state.sesiWaifu[senderId].characterId;
            const core = getCoreNumber(senderId);
            state.userAIMode[senderId] = chosenModel;
            if (core) state.userAIMode[core] = chosenModel;
            db.setSetting('userAIMode', state.userAIMode);
            waifuService.activate(senderId, characterId);
            delete state.sesiWaifu[senderId];
            AIProvider.clearMemory(senderId);
            if (core) AIProvider.clearMemory(core);

            await reply(`✅ *MODE WAIFU (${charName}) AKTIF*\n\nDi PM, cukup chat biasa. Di grup, gunakan *!chat [pesan]*. Otak AI: *${chosenModel.toUpperCase()}*.`);
            return true;
        }
    }

    // ==========================================
    // HANDLER SESI MILIH MODEL OLLAMA
    // ==========================================
    if (state.sesiOllamaMode && state.sesiOllamaMode[senderId]) {
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
        const core = getCoreNumber(senderId);
        state.userOllamaModel[senderId] = chosenModel;
        if (core) state.userOllamaModel[core] = chosenModel;
        state.userAIMode[senderId] = 'ollama';
        if (core) state.userAIMode[core] = 'ollama';

        if (isOwner) {
            state.ownerOllamaModel = chosenModel;
            state.ownerAIMode = 'ollama';
            db.setSetting('ownerOllamaModel', chosenModel);
            db.setSetting('ownerAIMode', 'ollama');
        }
        db.setSetting('userOllamaModel', state.userOllamaModel);
        db.setSetting('userAIMode', state.userAIMode);

        AIProvider.clearMemory(senderId);
        if (core) AIProvider.clearMemory(core);
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
        const core = getCoreNumber(senderId);
        state.userOpenRouterModel[senderId] = chosenModel.id;
        if (core) state.userOpenRouterModel[core] = chosenModel.id;
        state.userAIMode[senderId] = 'openrouter';
        if (core) state.userAIMode[core] = 'openrouter';

        if (isOwner) {
            state.ownerOpenRouterModel = chosenModel.id;
            state.ownerAIMode = 'openrouter';
            db.setSetting('ownerOpenRouterModel', chosenModel.id);
            db.setSetting('ownerAIMode', 'openrouter');
        }
        db.setSetting('userOpenRouterModel', state.userOpenRouterModel);
        db.setSetting('userAIMode', state.userAIMode);

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
        const core = getCoreNumber(senderId);
        state.userCloudflareModel[senderId] = chosenModel.id;
        if (core) state.userCloudflareModel[core] = chosenModel.id;
        state.userAIMode[senderId] = 'cloudflare';
        if (core) state.userAIMode[core] = 'cloudflare';

        if (isOwner) {
            state.ownerCloudflareModel = chosenModel.id;
            state.ownerAIMode = 'cloudflare';
            db.setSetting('ownerCloudflareModel', chosenModel.id);
            db.setSetting('ownerAIMode', 'cloudflare');
        }
        db.setSetting('userCloudflareModel', state.userCloudflareModel);
        db.setSetting('userAIMode', state.userAIMode);

        delete state.sesiCloudflareMode[senderId];

        await reply(`✅ *MODE CLOUDFLARE AKTIF*\n\nNn... Otak Cloudflare berhasil dikunci ke model:\n*${chosenModel.name}* (\`${chosenModel.id}\`). ✨`);
        return true;
    }

    // ==========================================
    // HANDLER SESI MILIH MODEL ARISU
    // ==========================================
    if (state.sesiArisuMode && state.sesiArisuMode[senderId]) {
        const pilihan = textLower;
        if (pilihan === 'batal' || pilihan === 'cancel') {
            delete state.sesiArisuMode[senderId];
            await reply('Nn... Pemilihan otak ArisuSoft dibatalkan.');
            return true;
        }
        const num = parseInt(pilihan) - 1;
        const listModels = state.sesiArisuMode[senderId].list;
        if (isNaN(num) || num < 0 || num >= listModels.length) {
            await reply('Nn... Angka tidak valid, Sensei. Balas dengan angka yang ada di daftar atau ketik *batal*.');
            return true;
        }
        const chosenModel = listModels[num];
        const core = getCoreNumber(senderId);
        state.userArisuModel[senderId] = chosenModel.id;
        if (core) state.userArisuModel[core] = chosenModel.id;
        state.userAIMode[senderId] = 'arisu';
        if (core) state.userAIMode[core] = 'arisu';
        if (isOwner) {
            state.ownerAIMode = 'arisu';
            db.setSetting('ownerAIMode', 'arisu');
        }
        db.setSetting('userAIMode', state.userAIMode);
        db.setSetting('userArisuModel', state.userArisuModel);
        if (isOwner) db.setSetting('ownerArisuModel', chosenModel.id);
        delete state.sesiArisuMode[senderId];
        AIProvider.clearMemory(senderId);
        await reply(`✅ *MODE ARISUSOFT AKTIF*\\n\\nModel: *${chosenModel.name}*\\nBiaya: *${chosenModel.limitCost} limit/request*. ✨`);
        return true;
    }

    // ==========================================
    // HANDLER SESI MILIH MODEL XKIRO
    // ==========================================
    if (state.sesiXKiroMode && state.sesiXKiroMode[senderId]) {
        const pilihan = textLower;
        if (pilihan === 'batal' || pilihan === 'cancel') {
            delete state.sesiXKiroMode[senderId];
            await reply('Nn... Pemilihan otak xKiro dibatalkan.');
            return true;
        }

        const num = parseInt(pilihan) - 1;
        const listModels = state.sesiXKiroMode[senderId].list;

        if (isNaN(num) || num < 0 || num >= listModels.length) {
            await reply('Nn... Angka tidak valid, Sensei. Balas dengan angka yang ada di daftar, atau ketik *batal*.');
            return true;
        }

        const chosenModel = listModels[num];
        const chosenIsPremium = hasActivePremium(senderId);
        if (!isOwner && !isXKiroModelFree(chosenModel) && !isXKiroModelAllowed(chosenModel.id, { isPremium: chosenIsPremium })) {
            delete state.sesiXKiroMode[senderId];
            await reply('Nn... Model ini tidak termasuk akses akunmu. Gunakan model FREE atau aktifkan VIP Premium.');
            return true;
        }
        const core = getCoreNumber(senderId);
        state.userXKiroModel[senderId] = chosenModel.id;
        if (core) state.userXKiroModel[core] = chosenModel.id;
        state.userAIMode[senderId] = 'xkiro';
        if (core) state.userAIMode[core] = 'xkiro';

        if (isOwner) {
            state.ownerXKiroModel = chosenModel.id;
            state.ownerAIMode = 'xkiro';
            db.setSetting('ownerXKiroModel', chosenModel.id);
            db.setSetting('ownerAIMode', 'xkiro');
        }
        db.setSetting('userXKiroModel', state.userXKiroModel);
        db.setSetting('userAIMode', state.userAIMode);

        delete state.sesiXKiroMode[senderId];

        await reply(`✅ *MODE XKIRO GATEWAY AKTIF*\n\nNn... Otak xKiro berhasil dikunci ke model:\n*${chosenModel.name}* (\`${chosenModel.id}\`). ✨`);
        return true;
    }

    // ==========================================
    // MY BINI / WAIFU MODE
    // ==========================================
    if (textLower === '!mybini' || textLower === '!waifu' || textLower === '!bini' || textLower === '!gantiwaifu') {
        if (!state.sesiWaifu) state.sesiWaifu = {};
        state.sesiWaifu[senderId] = { step: 1 };
        let teks = `💖 *PILIH KARAKTER WAIFU* 💖\n\nNn... Pilih teman ngobrolmu hari ini:\n\n`;
        WAIFU_CHARACTERS.forEach((character, index) => { teks += `${index + 1}. ${character.name} (${character.franchise})\n`; });
        teks += `\nBalas dengan angka (1-${WAIFU_CHARACTERS.length}) atau ketik *batal*.`;
        await reply(teks);
        return true;
    }

    if (textLower === '!waifustatus') {
        const character = waifuService.get(senderId);
        await reply(character ? `Nn... Karakter aktifmu: *${character.name}* (${character.franchise}).\n\nGunakan *!gantiwaifu* untuk mengganti.` : 'Nn... Belum ada karakter waifu aktif. Gunakan *!bini* untuk memilih.');
        return true;
    }

    if (textLower === '!stopwaifu') {
        waifuService.clear(senderId);
        AIProvider.clearMemory(senderId);
        await reply('Nn... Mode waifu dinonaktifkan. Persona default kembali aktif.');
        return true;
    }

    // ==========================================
    // PERAN / PROFESI MODE
    // ==========================================
    if (/^!(?:peran|profesi)(?:\s|$)/i.test(textClean)) {
        const args = textClean.split(/\s+/)[1];
        const roleKeys = Object.keys(ROLE_PROMPTS);
        
        if (!args) {
            let teks = `💼 *PILIH PERAN / PROFESI SHIROKO* 💼\n\nNn... Sensei ingin Shiroko berperan sebagai apa hari ini?\n\n`;
            teks += `1. 💻 Programmer (Senior Software Engineer)\n`;
            teks += `2. 📖 Novelist (Penulis Sastra)\n`;
            teks += `3. 🎓 Akademisi (Tutor/Dosen)\n`;
            teks += `4. 🌐 Penerjemah (Translator Profesional)\n`;
            teks += `5. 🌸 Normal (Kembali jadi Waifu/Asisten)\n\n`;
            teks += `Ketik *!peran [angka]* (contoh: *!peran 1*)`;
            await reply(teks);
            return true;
        }

        const roleMap = { '1': 'programmer', '2': 'novelist', '3': 'akademisi', '4': 'penerjemah', '5': 'normal' };
        const chosenRole = roleMap[args] || (roleKeys.includes(args.toLowerCase()) ? args.toLowerCase() : null);

        if (!chosenRole) {
            await reply('Nn... Pilihan peran tidak valid. Ketik *!peran* untuk melihat daftar.');
            return true;
        }

        if(!state.userRole) state.userRole = {};
        
        if (chosenRole === 'normal') {
            delete state.userRole[senderId];
            delete dbAIRole[senderId];
            if (state.userSystemPrompt && state.userSystemPrompt[senderId]) delete state.userSystemPrompt[senderId];
            await reply('🌸 *MODE NORMAL AKTIF*\n\nNn... Shiroko sudah kembali ke wujud asisten/istri Sensei seperti biasa.');
        } else {
            state.userRole[senderId] = chosenRole;
            dbAIRole[senderId] = chosenRole;
            if (state.userSystemPrompt && state.userSystemPrompt[senderId]) delete state.userSystemPrompt[senderId];
            const roleNama = chosenRole.charAt(0).toUpperCase() + chosenRole.slice(1);
            await reply(`✅ *PERAN ${roleNama.toUpperCase()} AKTIF*\n\nNn... Mulai sekarang Shiroko akan berperilaku sebagai ${roleNama}. ✨`);
        }
        
        AIProvider.clearMemory(senderId);
        return true;
    }

    // ==========================================
    // AI MODE
    // ==========================================
    
    // Helper function untuk filter model berdasarkan peran (Role)
    function filterModelsByRole(models, role, provider) {
        if (!role || role === 'normal') return models; // Tampilkan semua jika normal

        const keywords = {
            'programmer': {
                'cloudflare': ['coder', 'code', 'qwq', 'r1', 'deepseek'],
                'openrouter': ['code', 'coder', 'reasoning']
            },
            'novelist': {
                'cloudflare': ['70b', '120b', 'mistral', 'glm'],
                'openrouter': ['550b', '120b']
            },
            'akademisi': {
                'cloudflare': ['70b', '120b', 'r1', 'qwq'],
                'openrouter': ['550b', '31b', '20b']
            },
            'penerjemah': {
                'cloudflare': ['70b', 'gemma', '26b', '120b'],
                'openrouter': ['31b', 'flash', '26b']
            }
        };

        const currentKeywords = keywords[role]?.[provider] || [];
        const filtered = models.filter(m => {
            const str = (m.name + " " + m.id).toLowerCase();
            return currentKeywords.some(kw => str.includes(kw));
        });

        return filtered.length > 0 ? filtered : models;
    }

    if (textLower.startsWith('!aimode')) {
        const args = textClean.split(' ')[1];
        const allowedModes = ['gemini', 'ollama', 'openrouter', 'or', 'cloudflare', 'cf', 'xkiro', 'xk', 'arisu', 'ds3', 'ds4', 'glm', 'qwen', 'arisu-gemini', 'gpt', 'grok'];
        
        const core = getCoreNumber(senderId);
        const defaultMode = isOwner ? (state.ownerAIMode || 'gemini') : 'xkiro';
        const currentMode = state.userAIMode[senderId] || (core && state.userAIMode[core]) || defaultMode;
        const currentOllama = state.userOllamaModel[senderId] || (core && state.userOllamaModel[core]) || state.ownerOllamaModel || 'gemma3:4b';
        const currentOR = state.userOpenRouterModel[senderId] || (core && state.userOpenRouterModel[core]) || state.ownerOpenRouterModel || 'deepseek/deepseek-r1:free';
        const currentCF = state.userCloudflareModel[senderId] || (core && state.userCloudflareModel[core]) || state.ownerCloudflareModel || '@cf/meta/llama-3-8b-instruct';
        const currentXK = state.userXKiroModel[senderId] || (core && state.userXKiroModel[core]) || (isOwner && state.ownerXKiroModel) || 'deepseek/deepseek-v4-flash';

        if (!args || !allowedModes.includes(args)) {
            let listModes = isOwner 
                ? `🔹 *!aimode gemini* (Gemini Cloud)\n🔹 *!aimode ollama* (Lokal Offline)\n` 
                : ``;
            listModes += `🔹 *!aimode xkiro* (Live xKiro Multi-Model Gateway)\n🔹 *!aimode arisu* (Pilih model ArisuSoft)\n🔹 *!aimode openrouter* (Live OpenRouter Scanner)\n🔹 *!aimode cloudflare* (Live Cloudflare AI Scanner)\n🔹 *!aimode ds3* (Deepseek V3.2)\n🔹 *!aimode ds4* (Deepseek V4 Pro)\n🔹 *!aimode glm* (GLM AI)\n🔹 *!aimode qwen* (Qwen AI)\n🔹 *!aimode arisu-gemini* (Gemini via Arisu)\n🔹 *!aimode gpt* (GPT 5 Nano)\n🔹 *!aimode grok* (Grok 4.1)`;
            
            await reply(`Nn... Format salah, Sensei. Pilih salah satu mode di bawah ini:\n\n${listModes}\n\nMode saat ini: *${currentMode.toUpperCase()}*\nxKiro Aktif: *${currentXK}*\nOpenRouter Aktif: *${currentOR}*\nCloudflare Aktif: *${currentCF}*`);
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

                let roleNotice = '';
                let teksList = `🤖 *DAFTAR MODEL OLLAMA LOKAL*${roleNotice}\n\nNn... Sensei, pilih otak mana yang mau dipakai dengan membalas angkanya:\n\n`;
                modelNames.forEach((name, i) => { teksList += `*${i + 1}.* ${name}\n`; });
                teksList += `\n_Ketik *batal* untuk membatalkan._`;

                await reply(teksList);
            } catch (err) {
                console.error('Error cek Ollama:', err.message);
                await reply('Nn... Gagal nyambung ke Ollama. Pastikan aplikasi Ollama di laptop udah nyala.');
            }
        } else if (args === 'arisu') {
            try {
                const models = await AIProvider.fetchModels('arisu');
                state.sesiArisuMode[senderId] = { list: models };
                let teksList = `🛰️ *DAFTAR MODEL ARISUSOFT*\n\nNn... Pilih model ArisuSoft (biaya per request):\n\n`;
                models.forEach((m, i) => { teksList += `*${i + 1}.* ${m.name} — *${m.limitCost} limit*\n`; });
                teksList += `\n_Ketik *batal* untuk membatalkan._`;
                await reply(teksList);
            } catch (err) {
                console.error('Error daftar Arisu:', err.message);
                await reply(`Nn... Gagal memuat model ArisuSoft: ${err.message}`);
            }
        } else if (args === 'xkiro' || args === 'xk') {
            try {
                await reply('Nn... Men-scan daftar model live dari xKiro Multi-Model Gateway...');
                let models = await AIProvider.fetchModels('xkiro');

                if (!models || models.length === 0) { await reply('Nn... Tidak ada model xKiro yang ditemukan.'); return true; }

                const userRole = state.userRole ? (state.userRole[senderId] || (core && state.userRole[core])) : null;
                const isPremium = hasActivePremium(senderId);
                models = filterModelsByRole(models, userRole, 'xkiro').filter(model => {
                    if (isOwner) return true;
                    if (isXKiroModelFree(model)) return true;
                    return isXKiroModelAllowed(model.id, { isPremium });
                });

                if (models.length === 0) {
                    await reply('Nn... Tidak ada model xKiro yang sesuai dengan akses akun ini.');
                    return true;
                }

                state.sesiXKiroMode[senderId] = { list: models };

                const roleNotice = userRole && userRole !== 'normal' ? ` (Sesuai Peran: ${userRole.toUpperCase()})` : '';
                const audience = isOwner ? 'OWNER' : (isPremium ? 'VIP PREMIUM' : 'FREE');
                let teksList = `🚀 *DAFTAR MODEL XKIRO ${audience}*${roleNotice}\n\nNn... Pilih model dengan membalas angkanya:\n\n`;
                models.forEach((m, i) => { teksList += `*${i + 1}.* ${formatXKiroModelLine(m, { isOwner, isPremium })}\n`; });
                if (!isOwner && isPremium) {
                    teksList += `\n_Catatan: akses VIP tidak mencakup saldo wallet Xkiro. Model PREMIUM/WALLET tetap membutuhkan saldo provider._\n`;
                }
                teksList += `\n_Ketik *batal* untuk membatalkan._`;

                await reply(teksList);
            } catch (err) {
                console.error('Error scan xKiro:', err.message);
                await reply(`Nn... Gagal men-scan xKiro AI: ${err.message}`);
            }
        } else if (args === 'openrouter' || args === 'or') {
            try {
                await reply('Nn... Men-scan daftar model live dari OpenRouter API...');
                let models = await AIProvider.fetchModels('openrouter');

                if (!models || models.length === 0) { await reply('Nn... Tidak ada model OpenRouter yang tersedia.'); return true; }

                const userRole = state.userRole ? (state.userRole[senderId] || (core && state.userRole[core])) : null;
                models = filterModelsByRole(models, userRole, 'openrouter');

                state.sesiOpenRouterMode[senderId] = { list: models };

                let roleNotice = userRole && userRole !== 'normal' ? ` (Sesuai Peran: ${userRole.toUpperCase()})` : '';
                let teksList = `🌐 *DAFTAR MODEL OPENROUTER LIVE*${roleNotice}\n\nNn... Sensei, pilih model FREE OpenRouter (1 limit/request):\n\n`;
                models.forEach((m, i) => { teksList += `*${i + 1}.* ${m.name} — *1 limit*\n`; });
                teksList += `\n_Ketik *batal* untuk membatalkan._`;

                await reply(teksList);
            } catch (err) {
                console.error('Error scan OpenRouter:', err.message);
                await reply(`Nn... Gagal men-scan OpenRouter: ${err.message}`);
            }
        } else if (args === 'cloudflare' || args === 'cf') {
            try {
                await reply('Nn... Men-scan daftar model AI resmi dari Cloudflare...');
                let models = await AIProvider.fetchModels('cloudflare');

                if (!models || models.length === 0) { await reply('Nn... Tidak ada model Cloudflare yang ditemukan.'); return true; }

                const userRole = state.userRole ? (state.userRole[senderId] || (core && state.userRole[core])) : null;
                models = filterModelsByRole(models, userRole, 'cloudflare');

                state.sesiCloudflareMode[senderId] = { list: models };

                let roleNotice = userRole && userRole !== 'normal' ? ` (Sesuai Peran: ${userRole.toUpperCase()})` : '';
                let teksList = `☁️ *DAFTAR MODEL CLOUDFLARE AI LIVE*${roleNotice}\n\nNn... Sensei, pilih model Cloudflare (1 limit/request):\n\n`;
                models.forEach((m, i) => { teksList += `*${i + 1}.* ${m.name} — *1 limit*\n`; });
                teksList += `\n_Ketik *batal* untuk membatalkan._`;

                await reply(teksList);
            } catch (err) {
                console.error('Error scan Cloudflare:', err.message);
                await reply(`Nn... Gagal men-scan Cloudflare AI: ${err.message}`);
            }
        } else {
            const core = getCoreNumber(senderId);
            state.userAIMode[senderId] = args;
            if (core) state.userAIMode[core] = args;
            if (isOwner) {
                state.ownerAIMode = args;
                db.setSetting('ownerAIMode', args);
            }
            db.setSetting('userAIMode', state.userAIMode);
            await reply(`✅ *MODE OPERASIONAL DIUBAH*\n\nNn... Mulai sekarang, khusus untuk chat dari Sensei, Shiroko akan berpikir menggunakan otak *${args.toUpperCase()}*. ✨`);
        }
        return true;
    }

    // ==========================================
    // SHIROKO PINTAR
    // ==========================================
    if (textLower.startsWith('!shiroko_pintar ')) {
        const core = getCoreNumber(senderId);
        const defaultMode = isOwner ? (state.ownerAIMode || 'gemini') : 'xkiro';
        const userMode = state.userAIMode[senderId] || (core && state.userAIMode[core]) || (isOwner && state.ownerAIMode) || defaultMode;
        const cost = 3;
        if (!cekDanPotongLimit(senderId, cost)) { await reply(`Nn... Token habis. Butuh ${cost} limit.`); return true; }

        const pesanInstruksi = textClean.substring(16).trim();
        if (!pesanInstruksi) {
            kembalikanLimit(senderId, cost);
            await reply('Nn... Perintah akademis kosong. Contoh: *!shiroko_pintar tolong carikan referensi jurnal tentang IoT*');
            return true;
        }

        try {
            await sock.sendPresenceUpdate('composing', from);
            const { provider, model } = AIProvider.resolveMode(userMode, senderId);

            if (isOwner) moodState.updateFromResponse(pesanInstruksi);
            const moodContext = isOwner ? moodState.buildMoodContext() : '';
            const academicPrompt = getShirokoSystemPrompt(isOwner) +
                (moodContext ? `\n\n${moodContext}` : '') +
                '\n\n[MODE RISET AKADEMIK]: Anda adalah asisten peneliti elit. Berikan jawaban komprehensif, berbasis data, terstruktur dengan referensi ilmiah yang relevan.';

            if (provider === 'gemini') {
                await reply('Nn... Membuka jalur perpustakaan satelit Google Scholar (Gemini)...');
                const jawaban = await AIProvider.generate({
                    provider: 'gemini',
                    model: 'gemini-2.5-flash-lite',
                    prompt: pesanInstruksi,
                    senderId,
                    isOwner,
                    systemPrompt: academicPrompt
                });
                await reply(`🧠 *SHIROKO AKADEMIK (GOOGLE SCHOLAR ENGINE)*\n\n${jawaban}`);
            } else {
                await reply(`Nn... Membuka jalur perpustakaan ${provider.toUpperCase()} (${model})...`);
                const jawaban = await AIProvider.generate({
                    provider, model, prompt: pesanInstruksi, senderId, isOwner, systemPrompt: academicPrompt
                });
                await reply(`🧠 *SHIROKO PINTAR (${model.toUpperCase()})*\n\n${jawaban}`);
            }

        } catch (error) {
            kembalikanLimit(senderId, cost);
            console.error('🚨 ERROR SHIROKO PINTAR:', error);
            await reply(`Nn... Mesin kecerdasan akademik sedang mengalami gangguan teknis:\n_${error.message}_`);
        }
        return true;
    }

    // ==========================================
    // DETEKSI TRIGGER OBROLAN
    // ==========================================
    let pemicuObrolan = false, pesanUser = "";
    let triggerType = null;
    if (textLower.startsWith('!shiroko ')) {
        pemicuObrolan = true;
        triggerType = 'shiroko';
        pesanUser = textClean.substring(9).trim();
    } else if (isGroup && textLower.startsWith('!chat ')) {
        pemicuObrolan = true;
        triggerType = 'chat';
        pesanUser = textClean.substring(6).trim();
    } else if (!isGroup) {
        const sedangSesiLain = state.sesiUjian[senderId] || state.sesiTikTok[senderId] ||
            state.sesiKaryaIlmiah[senderId] || state.sesiPixiv[senderId] || state.sesiWaifu[senderId] ||
            state.sesiTopup[senderId] || state.sesiMeme[senderId] || state.sesiOllamaMode[senderId] ||
            state.sesiOpenRouterMode[senderId] || state.sesiCloudflareMode[senderId] ||
            state.sesiCabutRole[senderId] || state.sesiModelGambar[senderId];
        if (msgType === 'audioMessage' && normalizedMessage.audioMessage?.ptt === true && !sedangSesiLain) {
            pemicuObrolan = true;
            pesanUser = 'Transkripsikan dan jelaskan isi voice note ini.';
        } else if (!textClean.startsWith('!') && !sedangSesiLain) { pemicuObrolan = true; pesanUser = textClean; }
    }

    // ==========================================
    // RADAR PENANGKAP GAMBAR & FILE UNTUK NGOBROL
    // ==========================================
    let chatImageBuffer = null;
    let chatImageMime = null;
    let chatAudioBuffer = null;
    let chatAudioMime = 'audio/ogg';
    let extractedFileText = "";

    if (pemicuObrolan) {
        if (triggerType === 'chat') {
            const cooldownKey = `${from}:${senderId}`;
            const lastChat = state.groupChatCooldown?.get(cooldownKey) || 0;
            if (Date.now() - lastChat < 5000) {
                await reply('Nn... Tunggu sebentar sebelum mengirim chat waifu berikutnya.');
                return true;
            }
            if (!state.groupChatCooldown) state.groupChatCooldown = new Map();
            state.groupChatCooldown.set(cooldownKey, Date.now());
        }
        const isTargetImage = msgType === 'imageMessage';
        const isQuotedImage = isQuoted && quotedType === 'imageMessage';
        const isTargetAudio = msgType === 'audioMessage';
        const isQuotedAudio = isQuoted && quotedType === 'audioMessage';
        const isTargetDoc = msgType === 'documentMessage' || msgType === 'documentWithCaptionMessage';
        const isQuotedDoc = isQuoted && (quotedType === 'documentMessage' || quotedType === 'documentWithCaptionMessage');

        if (isTargetImage || isQuotedImage) {
            const messageToDownload = isQuotedImage ? quotedMsg?.imageMessage : normalizedMessage?.imageMessage;
            if (messageToDownload) {
                try {
                    chatImageBuffer = await downloadMediaBaileys(messageToDownload, 'image');
                    chatImageMime = messageToDownload.mimetype || 'image/jpeg';
                    if (!pesanUser) pesanUser = "Nn... Tolong deskripsikan gambar ini dengan detail.";
                } catch (e) {
                    console.error("Gagal download gambar chat:", e);
                }
            }
        } else if (isTargetAudio || isQuotedAudio) {
            const audioMsg = isQuotedAudio ? quotedMsg?.audioMessage : normalizedMessage?.audioMessage;
            if (audioMsg) {
                try {
                    chatAudioBuffer = await downloadMediaBaileys(audioMsg, 'audio');
                    chatAudioMime = audioMsg.mimetype || 'audio/ogg';
                    if (!pesanUser) pesanUser = 'Transkripsikan dan jelaskan isi audio ini.';
                } catch (e) {
                    console.error('Gagal download audio chat:', e);
                }
            }
        } else if (isTargetDoc || isQuotedDoc) {
            const docContainer = isQuotedDoc ? quotedMsg : normalizedMessage;
            const docMsg = docContainer?.documentMessage || docContainer?.documentWithCaptionMessage?.message?.documentMessage;
            if (docMsg) {
                try {
                    await reply('Nn... Sedang membaca dokumen yang Sensei kirim...');
                    const docBuffer = await downloadMediaBaileys(docMsg, 'document');
                    const fileName = docMsg.fileName || 'document.txt';
                    const mimeType = docMsg.mimetype || '';
                    extractedFileText = await extractDocumentText(docBuffer, fileName, mimeType);
                    
                    if (!pesanUser) pesanUser = "Nn... Tolong rangkum atau jelaskan isi dokumen ini.";
                } catch (e) {
                    console.error("Gagal membaca dokumen:", e);
                    await reply('Nn... Maaf, Shiroko tidak bisa membaca dokumen tersebut. Pastikan formatnya PDF, DOCX, atau TXT.');
                }
            }
        }

        // Resolve mode sekali agar companion dan chat normal memakai mode yang sama.
        const core = getCoreNumber(senderId);
        const defaultMode = isOwner ? (state.ownerAIMode || 'gemini') : 'xkiro';
        const userMode = state.userAIMode[senderId] || (core && state.userAIMode[core]) || (isOwner && state.ownerAIMode) || defaultMode;
        const resolvedMode = AIProvider.resolveMode(userMode, senderId);

        // Perbarui mood sebelum companion flow agar jalur visual tidak melewati state mood.
        // Normal chat membaca flag ini supaya tidak melakukan update dua kali.
        if (isOwner && pesanUser) {
            moodState.updateFromResponse(pesanUser);
            ctx.moodProcessed = true;
        }

        // Companion legacy hanya untuk Arisu. xKiro memakai native tools
        // setelah biaya dan capability model divalidasi di bawah.
        const companionHandled = await companionService.handleCompanionFlow({
            ...ctx,
            chatImageBuffer,
            chatImageMime,
            userMode,
            ...resolvedMode
        });
        if (companionHandled) return true;
    }

    // ==========================================
    // MESIN OBROLAN AI — UNIFIED via AIProvider
    // ==========================================
    if (pemicuObrolan && (pesanUser || chatImageBuffer || chatAudioBuffer || extractedFileText)) {
        const core = getCoreNumber(senderId);
        const defaultMode = isOwner ? (state.ownerAIMode || 'gemini') : 'xkiro';
        const userMode = state.userAIMode[senderId] || (core && state.userAIMode[core]) || (isOwner && state.ownerAIMode) || defaultMode;
        const { provider: costProvider, model: costModel } = AIProvider.resolveMode(userMode, senderId);
        const isPremium = hasActivePremium(senderId);
        let xkiroMetadata = null;
        if (costProvider === 'xkiro') {
            try {
                xkiroMetadata = (await AIProvider.fetchModels('xkiro')).find(item => item.id === costModel) || null;
            } catch (err) {
                console.warn(`[XKIRO] Gagal memvalidasi katalog model: ${err.message}`);
            }
        }
        const access = AIProvider.validateModelAccess(costProvider, costModel, {
            isOwner,
            isPremium,
            metadata: xkiroMetadata
        });
        if (!access.allowed) {
            await reply(`Nn... ${access.reason}`);
            return true;
        }
        const cost = access.cost;
        if (!Number.isInteger(cost) || cost < 0) {
            await reply('Nn... Biaya model ini tidak dapat ditentukan. Pilih ulang model Xkiro dari *!aimode xkiro*.');
            return true;
        }
        if (!cekDanPotongLimit(senderId, cost)) { await reply(`Nn... Token habis. Butuh ${cost} limit.`); return true; }

        if (costProvider === 'xkiro') {
            const companionIntent = companionService.detectHeuristicIntent(textLower, !!chatImageBuffer);
            const visualIntent = companionIntent && !['NORMAL_CHAT', 'OUTFIT_DISCUSSION', 'VISION_ANALYSIS'].includes(companionIntent.intent);

            if (visualIntent) {
                if (!xkiroMetadata?.capabilities?.tools) {
                    kembalikanLimit(senderId, cost);
                    await reply('Nn... Model xKiro ini belum mendukung native tool calling untuk aksi visual. Pilih model lain yang memiliki capability tools.');
                    return true;
                }
                const activePrompt = triggerType === 'shiroko'
                    ? getShirokoSystemPrompt(isOwner)
                    : (state.userSystemPrompt?.[senderId] || (core && state.userSystemPrompt?.[core])) || getShirokoSystemPrompt(isOwner);
                try {
                    return await companionService.handleXkiroCompanionFlow({
                        ...ctx,
                        userMode,
                        provider: costProvider,
                        model: costModel,
                        companionIntent: companionIntent.intent,
                        companionRenderAllowed: companionIntent.renderRequested,
                        systemPrompt: activePrompt,
                        chatImageBuffer,
                        chatImageMime,
                        moodContext: isOwner ? moodState.buildMoodContext() : ''
                    });
                } catch (error) {
                    kembalikanLimit(senderId, cost);
                    console.error('🚨 xKiro Native Tool Error:', error);
                    await reply(`Nn... Terjadi kesalahan saat menjalankan aksi native xKiro:\n_${error.message}_`);
                    return true;
                }
            }

            // Chat biasa/discussion/vision diteruskan ke jalur normal agar
            // imageBuffer, memory, dan system prompt tetap diproses dengan benar.
        }

        try {
            await sock.sendPresenceUpdate('composing', from);
            const { provider, model } = AIProvider.resolveMode(userMode, senderId);

            // Media processing must remain on the selected provider; Arisu has no media adapter.
            if (provider === 'arisu' && (chatAudioBuffer || extractedFileText.startsWith('[ISI ARSIP ZIP:'))) {
                throw new Error('Mode ArisuSoft belum mendukung pemrosesan audio atau ZIP. Silakan pilih Gemini, OpenRouter, Cloudflare, atau xKiro.');
            }

            // Dokumen panjang diproses bertahap agar seluruh isi tetap terbaca tanpa
            // menjejalkan seluruh dokumen ke satu context window provider.
            let finalPrompt = pesanUser;
            if (extractedFileText) {
                const documentChunks = splitDocumentText(extractedFileText);
                if (documentChunks.length > 1) {
                    await reply(`Nn... Dokumen cukup panjang (${documentChunks.length} bagian). Shiroko akan membaca seluruhnya secara bertahap...`);
                    const chunkResults = [];
                    for (let i = 0; i < documentChunks.length; i++) {
                        const chunkPrompt = `Anda sedang membaca bagian ${i + 1} dari ${documentChunks.length} dokumen pengguna.\n\n[ISI BAGIAN DOKUMEN]:\n${documentChunks[i]}\n\nBuat catatan ringkas dan faktual tentang bagian ini. Pertahankan nama, angka, tanggal, kesimpulan, dan informasi penting. Jangan menjawab pertanyaan akhir dulu.`;
                        const chunkResult = await AIProvider.generate({
                            provider,
                            model,
                            prompt: chunkPrompt,
                            senderId,
                            isOwner,
                            useMemory: false,
                            syncSharedMemory: false,
                            systemPrompt: 'Anda adalah analis dokumen. Keluarkan catatan faktual ringkas dalam bahasa yang sama dengan dokumen.'
                        });
                        chunkResults.push(`BAGIAN ${i + 1}:\n${chunkResult}`);
                    }
                    finalPrompt = `${pesanUser || 'Analisis dokumen ini.'}\n\n[RINGKASAN SELURUH DOKUMEN]:\n${chunkResults.join('\n\n')}`;
                } else {
                    finalPrompt = `${pesanUser}\n\n[ISI DOKUMEN DARI USER]:\n${documentChunks[0]}`;
                }
            }

            let moodInput = pesanUser;
            if (chatAudioBuffer) {
                await reply('Nn... Sedang membaca audio menggunakan provider sesuai aimode Sensei...');
                const transcript = await AIProvider.transcribe({
                    provider,
                    model,
                    audioBuffer: chatAudioBuffer,
                    mimeType: chatAudioMime
                });
                moodInput = `${pesanUser} ${transcript}`.trim();
                finalPrompt = `${pesanUser}\n\n[TRANSKRIP AUDIO USER]:\n${transcript.substring(0, 20000)}`;
            }
            if (isOwner && moodInput && !ctx.moodProcessed) moodState.updateFromResponse(moodInput);

            const { incrementStat } = require('../config/database');
            incrementStat('aiRequests');
            
            let finalSystemPrompt = triggerType === 'shiroko' ? getShirokoSystemPrompt(isOwner) : (state.userSystemPrompt ? (state.userSystemPrompt[senderId] || (core && state.userSystemPrompt[core])) : null);
            if (!finalSystemPrompt && state.userRole && (state.userRole[senderId] || (core && state.userRole[core]))) {
                const userRoleName = state.userRole[senderId] || state.userRole[core];
                const baseType = (provider === 'cloudflare') ? 'short' : ((provider === 'arisu') ? 'arisu' : 'system');
                finalSystemPrompt = getRolePrompt(userRoleName, isOwner, baseType);
            }

            // Sisipkan konteks penampilan fisik terkini Shiroko (tanpa masuk ChatMemory)
            const currentApp = appearanceState.getAppearance(senderId);
            const appearanceContext = appearanceState.buildAppearanceContext(currentApp);
            const moodContext = isOwner ? moodState.buildMoodContext() : '';
            const effectiveSystemPrompt = [
                finalSystemPrompt || getRolePrompt(null, isOwner, (provider === 'arisu' ? 'arisu' : 'system')),
                moodContext,
                appearanceContext
            ].filter(Boolean).join('\n\n');

            const jawaban = await AIProvider.generate({
                provider,
                model,
                prompt: finalPrompt,
                senderId,
                isOwner,
                systemPrompt: effectiveSystemPrompt,
                imageBuffer: chatImageBuffer,
                imageMimeType: chatImageMime,
                useMemory: !extractedFileText
            });

            await reply(jawaban);
            return true;
        } catch (error) {
            kembalikanLimit(senderId, cost);
            console.error('🚨 AI Chat Error:', error);
            await reply(`Nn... Terjadi kesalahan dari server AI:\n_${error.message}_\n\n*(Coba ketik !lupa jika dirasa memori percakapan nyangkut)*`);
        }
        return true;
    }

    // ==========================================
    // LUPA (RESET MEMORI & RESET ALARM) — UNIFIED
    // ==========================================
    if (textLower === '!lupa') {
        const core = getCoreNumber(senderId);
        let berhasilLupa = AIProvider.clearMemory(senderId);
        if (core) {
            const cLupa = AIProvider.clearMemory(core);
            if (cLupa) berhasilLupa = true;
        }
        if (isOwner) {
            const { ID_OWNER } = require('../config/constants');
            const ownerJid = ID_OWNER[0] + '@s.whatsapp.net';
            AIProvider.clearMemory(ownerJid);
            AIProvider.clearMemory(ID_OWNER[0]);
        }

        // Reset alarm global hanya boleh dilakukan oleh owner.
        if (isOwner) {
            const alarmService = require('../services/alarm.service');
            alarmService.stopActiveAlarm();
            state.activeAlarmSession = null;
            state.alarmSubuhState = { aktif: false, count: 0, timer: null };
        }

        // Reset custom persona
        if (state.userSystemPrompt) {
            delete state.userSystemPrompt[senderId];
            if (core) delete state.userSystemPrompt[core];
        }
        waifuService.clear(senderId);
        if (state.userRole) {
            delete state.userRole[senderId];
            if (core) delete state.userRole[core];
        }
        delete dbAIRole[senderId];
        if (core) delete dbAIRole[core];

        if (isOwner) moodState.resetMood();

        await reply('Nn... *(Menggelengkan kepala)*. Shiroko sudah melupakan seluruh riwayat obrolan dan mereset sistem pengingat/alarm.');
        return true;
    }

    return false;
}

module.exports = { handle };
