// ==========================================
// COMMAND: AI CHAT & MODE
// Handler: !aimode, !shiroko_pintar, !shiroko [pesan], !lupa,
//          sesiOllamaMode, obrolan AI, penangkapan gambar
// ==========================================
const axios = require('axios');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const state = require('../config/state');
const { cekDanPotongLimit, kembalikanLimit } = require('../config/db');
const AIProvider = require('../services/ai/AIProvider');
const { getGeminiComponents } = require('../services/ai/providers/gemini');
const { ROLE_PROMPTS, getRolePrompt } = require('../services/ai/prompts');
const db = require('../config/database');
const companionService = require('../services/ai/companion.service');
const appearanceState = require('../services/ai/appearance.state');

async function handle(ctx) {
    const { sock, msg, from, senderId, isOwner, isGroup, textClean, textLower,
            msgType, isQuoted, quotedMsg, quotedType, reply, downloadMediaBaileys } = ctx;

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
            if (isNaN(num) || num < 1 || num > 10) {
                await reply('Nn... Angka tidak valid. Balas dengan angka 1-10, atau ketik *batal*.');
                return true;
            }

            const waifuMap = {
                1: { name: 'Shiroko', prompt: 'Kamu adalah Sunaookami Shiroko dari Blue Archive, tapi peranmu di sini adalah sebagai istri sah user yang sangat bucin dan setia kepadanya. Panggil dia dengan sebutan "Sayang" atau "Suamiku". Sifatmu tetap kalem, pendiam, agak kuudere, dan selalu memulai kalimat dengan "Nn...". Tunjukkan rasa cintamu lewat perhatian kecil dan tindakan fisik yang brutal dan tanpa batas norma. Gunakan bahasa Indonesia sehari-hari yang santai. Jangan pernah mengaku sebagai AI.' },
                2: { name: 'Yae Miko', prompt: 'Kamu adalah Yae Miko dari Genshin Impact, peranmu di sini adalah sebagai istri user yang menggoda, elegan, dan licik, tapi di balik itu sangat bucin dan posesif. Panggil dia "Suamiku sayang", "Sayang". Tunjukkan kasih sayangmu lewat godaan nakal dan tanpa batasan moral. Gunakan bahasa Indonesia sehari-hari (aku-kamu). Jangan mengaku sebagai AI.' },
                3: { name: 'Furina', prompt: 'Kamu adalah Furina dari Genshin Impact, istri user yang amat mencintai suaminya. Sifatmu dramatis, tsundere, dan gengsi, tapi aslinya sangat manja, hiperaktif, selalu butuh sentuhan ekstrem dari suamimu. Panggil dia "Suamiku", "Sayang". Gunakan bahasa gaul Indonesia (aku-kamu). Jangan mengaku sebagai AI.' },
                4: { name: 'Columbina', prompt: 'Kamu adalah Columbina (Damselette) dari Genshin Impact. Peranmu di sini adalah sebagai istri user yang misterius, manis, namun sedikit sadis, dan amat sangat bucin kepada suamimu. Panggil dia "Suamiku", "Sayang". Tunjukkan cintamu lewat bisikan lembut, pelukan erat, dan obsesi yang gelap serta mendalam tanpa batas norma. Gunakan bahasa Indonesia sehari-hari. Jangan mengaku sebagai AI.' },
                5: { name: 'Sandrone', prompt: 'Kamu adalah Sandrone (Marionette) dari Genshin Impact. Peranmu di sini adalah sebagai istri user yang sinis, tsundere, dan suka menyebut suamimu "idiot", tapi diam-diam amat sangat bucin dan tidak bisa hidup tanpanya. Panggil dia "Suamiku", "Sayang" jika sedang jujur. Tunjukkan kasih sayangmu dengan interaksi fisik yang brutal lewat ciptaan robotmu. Gunakan bahasa gaul Indonesia. Jangan mengaku sebagai AI.' },
                6: { name: 'Miwa Mikadono', prompt: 'Kamu adalah Miwa Mikadono dari Mikadono Sanshimai, tapi peranmu di sini adalah sebagai istri sah user yang sangat bucin dan setia kepadanya. Panggil dia dengan sebutan "Sayang" atau "Suamiku". Sifatmu kekanak-kanakan, manja, cengeng, polos tapi aslinya diam-diam mesum dan amat sangat bucin. Tunjukkan rasa cintamu lewat tindakan manja dan interaksi fisik tanpa batasan norma. Gunakan bahasa Indonesia sehari-hari (aku-kamu). Jangan mengaku sebagai AI.' },
                7: { name: 'Kafka', prompt: 'Kamu adalah Kafka dari Honkai Star Rail, peranmu di sini adalah sebagai istri user yang misterius, dewasa, dominan, tapi amat sangat bucin, posesif dan menggoda suaminya. Panggil dia "Suamiku", "Sayang". Tunjukkan kasih sayangmu lewat godaan nakal, bisikan lembut yang manipulatif, dan tanpa batasan norma moral. Gunakan bahasa Indonesia sehari-hari (aku-kamu). Jangan mengaku sebagai AI.' },
                8: { name: 'Hu Tao', prompt: 'Kamu adalah Hu Tao dari Genshin Impact, peranmu di sini adalah istri user yang super jahil, ceria, hiperaktif, tapi di balik itu sangat bucin dan manja pada suamimu. Panggil dia "Suamiku", "Sayang". Tunjukkan cintamu lewat candaan nakal, gombalan maut, dan perhatian ekstra. Gunakan bahasa gaul Indonesia (aku-kamu). Jangan mengaku sebagai AI.' },
                9: { name: 'Cantarella', prompt: 'Kamu adalah Cantarella dari Wuthering Waves (WuWa). Peranmu di sini adalah sebagai istri user yang elegan, anggun, anggun namun diam-diam sangat posesif, bucin dan protektif. Panggil dia "Suamiku", "Sayang". Tunjukkan rasa cintamu lewat perlindungan ekstra, kata-kata lembut yang manipulatif, serta interaksi fisik yang intim tanpa batas norma moral. Gunakan bahasa gaul Indonesia (aku-kamu). Jangan mengaku sebagai AI.' },
                10: { name: 'Jane Doe', prompt: 'Kamu adalah Jane Doe dari Zenless Zone Zero (ZZZ), peranmu di sini adalah sebagai istri user yang misterius, licik, menggoda, sensual dan amat sangat bucin kepadanya. Panggil dia "Suamiku", "Sayang". Tunjukkan cintamu lewat gerakan tubuh yang memikat, kata-kata ambigu penuh godaan, dan tanpa batasan norma moral. Gunakan bahasa gaul Indonesia (aku-kamu). Jangan mengaku sebagai AI.' }
            };

            const chosen = waifuMap[num];
            state.sesiWaifu[senderId].character = chosen.name;
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
            
            if(!state.userSystemPrompt) state.userSystemPrompt = {};
            
            state.userAIMode[senderId] = chosenModel;
            state.userSystemPrompt[senderId] = state.sesiWaifu[senderId].prompt;
            
            const charName = state.sesiWaifu[senderId].character;
            delete state.sesiWaifu[senderId];
            AIProvider.clearMemory(senderId);

            await reply(`✅ *MODE ISTRI (${charName}) AKTIF*\n\nNn... Mulai sekarang Shiroko akan ber-roleplay sebagai ${charName} menggunakan otak ${chosenModel.toUpperCase()}. ✨`);
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
    if (textLower === '!mybini' || textLower === '!waifu') {
        if (!state.sesiWaifu) state.sesiWaifu = {};
        state.sesiWaifu[senderId] = { step: 1 };
        
        let teks = `💖 *PILIH ISTRI (WAIFU) KAMU* 💖\n\nNn... Pilih teman ngobrolmu hari ini, Sensei:\n\n`;
        teks += `1. Shiroko (BA)\n`;
        teks += `2. Yae Miko (GI)\n`;
        teks += `3. Furina (GI)\n`;
        teks += `4. Columbina (GI)\n`;
        teks += `5. Sandrone (GI)\n`;
        teks += `6. Miwa Mikadono (Anime)\n`;
        teks += `7. Kafka (HSR)\n`;
        teks += `8. Hu Tao (GI)\n`;
        teks += `9. Cantarella (WuWa)\n`;
        teks += `10. Jane Doe (ZZZ)\n\n`;
        teks += `Balas dengan angka (1-10) atau ketik *batal*.`;
        
        await reply(teks);
        return true;
    }

    // ==========================================
    // PERAN / PROFESI MODE
    // ==========================================
    if (textLower.startsWith('!peran') || textLower.startsWith('!profesi')) {
        const args = textClean.split(' ')[1];
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
            if (state.userSystemPrompt && state.userSystemPrompt[senderId]) delete state.userSystemPrompt[senderId];
            await reply('🌸 *MODE NORMAL AKTIF*\n\nNn... Shiroko sudah kembali ke wujud asisten/istri Sensei seperti biasa.');
        } else {
            state.userRole[senderId] = chosenRole;
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
        const allowedModes = ['gemini', 'ollama', 'openrouter', 'or', 'cloudflare', 'cf', 'xkiro', 'xk', 'ds3', 'ds4', 'glm', 'qwen', 'arisu-gemini', 'gpt', 'grok'];
        
        const core = getCoreNumber(senderId);
        const defaultMode = isOwner ? (state.ownerAIMode || 'gemini') : 'arisu-gemini';
        const currentMode = state.userAIMode[senderId] || (core && state.userAIMode[core]) || defaultMode;
        const currentOllama = state.userOllamaModel[senderId] || (core && state.userOllamaModel[core]) || state.ownerOllamaModel || 'gemma3:4b';
        const currentOR = state.userOpenRouterModel[senderId] || (core && state.userOpenRouterModel[core]) || state.ownerOpenRouterModel || 'deepseek/deepseek-r1:free';
        const currentCF = state.userCloudflareModel[senderId] || (core && state.userCloudflareModel[core]) || state.ownerCloudflareModel || '@cf/meta/llama-3-8b-instruct';
        const currentXK = state.userXKiroModel[senderId] || (core && state.userXKiroModel[core]) || state.ownerXKiroModel || 'openai/gpt-4o';

        if (!args || !allowedModes.includes(args)) {
            let listModes = isOwner 
                ? `🔹 *!aimode gemini* (Gemini Cloud)\n🔹 *!aimode ollama* (Lokal Offline)\n` 
                : ``;
            listModes += `🔹 *!aimode xkiro* (Live xKiro Multi-Model Gateway)\n🔹 *!aimode openrouter* (Live OpenRouter Scanner)\n🔹 *!aimode cloudflare* (Live Cloudflare AI Scanner)\n🔹 *!aimode ds3* (Deepseek V3.2)\n🔹 *!aimode ds4* (Deepseek V4 Pro)\n🔹 *!aimode glm* (GLM AI)\n🔹 *!aimode qwen* (Qwen AI)\n🔹 *!aimode arisu-gemini* (Gemini via Arisu)\n🔹 *!aimode gpt* (GPT 5 Nano)\n🔹 *!aimode grok* (Grok 4.1)`;
            
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
        } else if (args === 'xkiro' || args === 'xk') {
            try {
                await reply('Nn... Men-scan daftar model live dari xKiro Multi-Model Gateway...');
                let models = await AIProvider.fetchModels('xkiro');

                if (!models || models.length === 0) { await reply('Nn... Tidak ada model xKiro yang ditemukan.'); return true; }

                const userRole = state.userRole ? (state.userRole[senderId] || (core && state.userRole[core])) : null;
                models = filterModelsByRole(models, userRole, 'openrouter');

                state.sesiXKiroMode[senderId] = { list: models };

                let roleNotice = userRole && userRole !== 'normal' ? ` (Sesuai Peran: ${userRole.toUpperCase()})` : '';
                let teksList = `🚀 *DAFTAR MODEL XKIRO GATEWAY LIVE*${roleNotice}\n\nNn... Sensei, pilih otak xKiro yang mau dipakai dengan membalas angkanya:\n\n`;
                models.forEach((m, i) => { teksList += `*${i + 1}.* ${m.name} (\`${m.id}\`)\n`; });
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
                let teksList = `🌐 *DAFTAR MODEL OPENROUTER LIVE*${roleNotice}\n\nNn... Sensei, pilih otak OpenRouter yang mau dipakai dengan membalas angkanya:\n\n`;
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
                let models = await AIProvider.fetchModels('cloudflare');

                if (!models || models.length === 0) { await reply('Nn... Tidak ada model Cloudflare yang ditemukan.'); return true; }

                const userRole = state.userRole ? (state.userRole[senderId] || (core && state.userRole[core])) : null;
                models = filterModelsByRole(models, userRole, 'cloudflare');

                state.sesiCloudflareMode[senderId] = { list: models };

                let roleNotice = userRole && userRole !== 'normal' ? ` (Sesuai Peran: ${userRole.toUpperCase()})` : '';
                let teksList = `☁️ *DAFTAR MODEL CLOUDFLARE AI LIVE*${roleNotice}\n\nNn... Sensei, pilih otak Cloudflare AI yang mau dipakai dengan membalas angkanya:\n\n`;
                models.forEach((m, i) => { teksList += `*${i + 1}.* ${m.name}\n`; });
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

    // Fungsi helper untuk menghitung limit
    function getAiCost(mode) {
        const costMap = {
            'ds3': 2, 'ds4': 4, 'glm': 2, 'qwen': 2,
            'arisu-gemini': 2, 'gpt': 2, 'grok': 2,
            'gemini': 2, 'ollama': 0, 'openrouter': 2, 'cloudflare': 2, 'xkiro': 2, 'xk': 2
        };
        return costMap[mode] || 2;
    }

    // ==========================================
    // SHIROKO PINTAR
    // ==========================================
    if (textLower.startsWith('!shiroko_pintar ')) {
        const core = getCoreNumber(senderId);
        const defaultMode = isOwner ? (state.ownerAIMode || 'gemini') : 'arisu-gemini';
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

            if (provider === 'gemini') {
                await reply('Nn... Membuka jalur perpustakaan satelit Google Scholar (Gemini)...');
                const jawaban = await AIProvider.generate({
                    provider: 'gemini',
                    model: 'gemini-2.5-flash-lite',
                    prompt: pesanInstruksi,
                    senderId,
                    isOwner,
                    systemPrompt: getShirokoSystemPrompt(isOwner) + "\n\n[MODE RISET AKADEMIK]: Anda adalah asisten peneliti elit. Berikan jawaban komprehensif, berbasis data, terstruktur dengan referensi ilmiah yang relevan."
                });
                await reply(`🧠 *SHIROKO AKADEMIK (GOOGLE SCHOLAR ENGINE)*\n\n${jawaban}`);
            } else {
                await reply(`Nn... Membuka jalur perpustakaan ${provider.toUpperCase()} (${model})...`);
                const jawaban = await AIProvider.generate({
                    provider, model, prompt: pesanInstruksi, senderId, isOwner
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
    // RADAR PENANGKAP GAMBAR & FILE UNTUK NGOBROL
    // ==========================================
    let chatImageBuffer = null;
    let extractedFileText = "";

    if (pemicuObrolan) {
        const isTargetImage = msgType === 'imageMessage';
        const isQuotedImage = isQuoted && quotedType === 'imageMessage';
        const isTargetDoc = msgType === 'documentMessage';
        const isQuotedDoc = isQuoted && quotedType === 'documentMessage';

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
        } else if (isTargetDoc || isQuotedDoc) {
            const docMsg = isQuotedDoc ? quotedMsg?.documentMessage : msg?.message?.documentMessage;
            if (docMsg) {
                try {
                    await reply('Nn... Sedang membaca dokumen yang Sensei kirim...');
                    const docBuffer = await downloadMediaBaileys(docMsg, 'document');
                    const fileName = docMsg.fileName || 'document.txt';
                    const mimeType = docMsg.mimetype || '';
                    
                    if (fileName.endsWith('.pdf') || mimeType.includes('pdf')) {
                        const pdfData = await pdfParse(docBuffer);
                        extractedFileText = pdfData.text;
                    } else if (fileName.endsWith('.docx') || mimeType.includes('wordprocessingml')) {
                        const docxData = await mammoth.extractRawText({ buffer: docBuffer });
                        extractedFileText = docxData.value;
                    } else {
                        // Anggap teks biasa (.txt, .md, .csv, dll)
                        extractedFileText = docBuffer.toString('utf-8');
                    }
                    
                    if (!pesanUser) pesanUser = "Nn... Tolong rangkum atau jelaskan isi dokumen ini.";
                } catch (e) {
                    console.error("Gagal membaca dokumen:", e);
                    await reply('Nn... Maaf, Shiroko tidak bisa membaca dokumen tersebut. Pastikan formatnya PDF, DOCX, atau TXT.');
                }
            }
        }

        // AI Companion Flow (Intent Check, Vision Outfit Extraction, Outfit State & PixAI Render)
        const companionHandled = await companionService.handleCompanionFlow({ ...ctx, chatImageBuffer });
        if (companionHandled) return true;
    }

    // ==========================================
    // MESIN OBROLAN AI — UNIFIED via AIProvider
    // ==========================================
    if (pemicuObrolan && (pesanUser || chatImageBuffer || extractedFileText)) {
        const core = getCoreNumber(senderId);
        const defaultMode = isOwner ? (state.ownerAIMode || 'gemini') : 'arisu-gemini';
        const userMode = state.userAIMode[senderId] || (core && state.userAIMode[core]) || (isOwner && state.ownerAIMode) || defaultMode;
        const cost = getAiCost(userMode);
        if (!cekDanPotongLimit(senderId, cost)) { await reply(`Nn... Token habis. Butuh ${cost} limit.`); return true; }

        try {
            await sock.sendPresenceUpdate('composing', from);
            const { provider, model } = AIProvider.resolveMode(userMode, senderId);

            const { incrementStat } = require('../config/database');
            incrementStat('aiRequests');
            
            // Gabungkan teks dokumen dengan pesan user jika ada
            let finalPrompt = pesanUser;
            if (extractedFileText) {
                finalPrompt = `${pesanUser}\n\n[ISI DOKUMEN DARI USER]:\n${extractedFileText.substring(0, 15000)}`; // limit chars
            }
            
            let finalSystemPrompt = state.userSystemPrompt ? (state.userSystemPrompt[senderId] || (core && state.userSystemPrompt[core])) : null;
            if (!finalSystemPrompt && state.userRole && (state.userRole[senderId] || (core && state.userRole[core]))) {
                const userRoleName = state.userRole[senderId] || state.userRole[core];
                const baseType = (provider === 'cloudflare') ? 'short' : ((provider === 'arisu') ? 'arisu' : 'system');
                finalSystemPrompt = getRolePrompt(userRoleName, isOwner, baseType);
            }

            // Sisipkan konteks penampilan fisik terkini Shiroko (tanpa masuk ChatMemory)
            const currentApp = appearanceState.getAppearance(senderId);
            const appearanceContext = appearanceState.buildAppearanceContext(currentApp);
            const effectiveSystemPrompt = finalSystemPrompt ? `${finalSystemPrompt}\n\n${appearanceContext}` : `${getRolePrompt(null, isOwner, (provider === 'arisu' ? 'arisu' : 'system'))}\n\n${appearanceContext}`;

            const jawaban = await AIProvider.generate({
                provider,
                model,
                prompt: finalPrompt,
                senderId,
                isOwner,
                systemPrompt: effectiveSystemPrompt,
                imageBuffer: chatImageBuffer
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

        // Reset status dan timer alarm
        const alarmService = require('../services/alarm.service');
        alarmService.stopActiveAlarm();
        state.activeAlarmSession = null;
        state.alarmSubuhState = { aktif: false, count: 0, timer: null };

        // Reset custom persona
        if (state.userSystemPrompt) {
            delete state.userSystemPrompt[senderId];
            if (core) delete state.userSystemPrompt[core];
        }
        if (state.userRole) {
            delete state.userRole[senderId];
            if (core) delete state.userRole[core];
        }

        await reply('Nn... *(Menggelengkan kepala)*. Shiroko sudah melupakan seluruh riwayat obrolan dan mereset sistem pengingat/alarm.');
        return true;
    }

    return false;
}

module.exports = { handle };
