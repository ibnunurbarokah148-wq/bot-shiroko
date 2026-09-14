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
const modelCatalog = require('../services/ai/model.catalog');

const PESAN_GANGGUAN_AI = 'Nn... Maaf, layanan AI sedang mengalami gangguan. Silakan coba lagi beberapa saat lagi.';
const PESAN_GAGAL_MODEL = 'Nn... Daftar model belum bisa dimuat sekarang. Silakan coba lagi nanti.';

function hasActivePremium(senderId) {
    const entry = dbPremium[senderId];
    return !!entry && (entry === true || entry > Date.now());
}

function isXKiroModelUsable(model, { isOwner, isPremium }) {
    if (isOwner) return true;
    if (!isPremium) return false;
    return isXKiroModelFree(model) || isXKiroModelAllowed(model.id, { isPremium: true });
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
    const { sock, msg, normalizedMessage, from, senderId, callTarget, isOwner, isGroup, textClean, textLower,
            msgType, isQuoted, quotedMsg, quotedType, reply, replyNow, downloadMediaBaileys } = ctx;

    if (textLower === '!callai' || textLower === '!telponai') {
        if (!isOwner || isGroup) {
            await reply('Nn... POC telepon AI sementara hanya tersedia untuk Owner melalui chat pribadi.');
            return true;
        }
        try {
            const callService = require('../services/call.service');
            const target = callTarget;
            if (!target) {
                await reply('Nn... Nomor telepon akun ini belum bisa dipetakan dari LID WhatsApp. Simpan nomor tersebut di kontak utama lalu coba lagi.');
                return true;
            }
            const result = await callService.startCall(target);
            await reply(`Nn... Panggilan AI sedang dimulai. Status: *${result.state || 'ringing'}*.`);
        } catch (error) {
            console.error('[CALL] Gagal memulai panggilan AI:', error);
            await reply('Nn... Layanan panggilan AI sedang tidak tersedia. Silakan coba lagi nanti.');
        }
        return true;
    }

    if (textLower === '!hangup' || textLower === '!tutuptelepon') {
        if (!isOwner) {
            await reply('Nn... Perintah ini hanya tersedia untuk Owner.');
            return true;
        }
        try {
            await require('../services/call.service').hangup();
            await reply('Nn... Panggilan AI sudah diakhiri.');
        } catch (error) {
            console.error('[CALL] Gagal mengakhiri panggilan:', error);
            await reply('Nn... Panggilan belum bisa diakhiri sekarang. Silakan coba lagi nanti.');
        }
        return true;
    }

    if (textLower === '!callstatus') {
        if (!isOwner) {
            await reply('Nn... Status telepon hanya tersedia untuk Owner.');
            return true;
        }
        try {
            const status = await require('../services/call.service').status();
            await reply(`☎️ *STATUS AI CALL*\n\n• Service: *${status.connected ? 'CONNECTED' : 'OFFLINE'}*\n• Login: *${status.loggedIn ? 'READY' : 'BELUM PAIRING'}*\n• Call: *${status.state || 'idle'}*\n• Peer: ${status.peer || '-'}`);
        } catch (error) {
            console.error('[CALL] Status call service gagal diambil:', error);
            await reply('Nn... Call service belum bisa dihubungi. Silakan coba lagi nanti.');
        }
        return true;
    }

    if (textLower.startsWith('!play ')) {
        if (isGroup) {
            await reply('Nn... Music Call hanya tersedia melalui chat pribadi.');
            return true;
        }
        const musicUrl = textClean.substring(6).trim();
        if (!musicUrl) {
            await reply('Nn... Masukkan URL YouTube atau direct audio .mp3, .wav, atau .opus.');
            return true;
        }
        const musicCost = 4;
        if (!isOwner && !cekDanPotongLimit(senderId, musicCost)) {
            await reply(`Nn... Butuh ${musicCost} limit untuk memutar satu lagu.`);
            return true;
        }
        try {
            const callService = require('../services/call.service');
            const result = await callService.startMusicCall(callTarget, musicUrl);
            await reply(`🎵 Nn... Musik diterima (${musicCost} limit). Status: *${result.position === 0 ? 'sedang diputar' : `antrean call #${result.position}`}*.`);
        } catch (error) {
            if (!isOwner) kembalikanLimit(senderId, musicCost);
            console.error('[MUSIC] Gagal memutar musik:', error);
            await reply('Nn... Musik belum bisa diputar sekarang. Silakan coba lagi nanti.');
        }
        return true;
    }

    if (['!pause', '!pausemusic'].includes(textLower)) {
        if (isGroup) { await reply('Nn... Kontrol musik call hanya tersedia melalui chat pribadi.'); return true; }
        try { await require('../services/call.service').pauseMusic(callTarget); await reply('⏸️ Musik call dijeda.'); }
        catch (error) { console.error('[MUSIC] Gagal menjeda musik:', error); await reply('Nn... Musik belum bisa dijeda sekarang.'); }
        return true;
    }

    if (['!resume', '!resumemusic'].includes(textLower)) {
        if (isGroup) { await reply('Nn... Kontrol musik call hanya tersedia melalui chat pribadi.'); return true; }
        try { await require('../services/call.service').resumeMusic(callTarget); await reply('▶️ Musik call dilanjutkan.'); }
        catch (error) { console.error('[MUSIC] Gagal melanjutkan musik:', error); await reply('Nn... Musik belum bisa dilanjutkan sekarang.'); }
        return true;
    }

    if (textLower === '!skip') {
        if (isGroup) { await reply('Nn... Kontrol musik call hanya tersedia melalui chat pribadi.'); return true; }
        try { await require('../services/call.service').skipMusic(callTarget); await reply('⏭️ Musik dilewati.'); }
        catch (error) { console.error('[MUSIC] Gagal melewati musik:', error); await reply('Nn... Musik belum bisa dilewati sekarang.'); }
        return true;
    }

    if (['!stopmusic', '!stop'].includes(textLower)) {
        if (isGroup) { await reply('Nn... Kontrol musik call hanya tersedia melalui chat pribadi.'); return true; }
        try { await require('../services/call.service').stopMusic(callTarget); await reply('⏹️ Musik call dihentikan dan antrean dikosongkan.'); }
        catch (error) { console.error('[MUSIC] Gagal menghentikan musik:', error); await reply('Nn... Musik belum bisa dihentikan sekarang.'); }
        return true;
    }

    if (textLower === '!queue') {
        if (isGroup) { await reply('Nn... Kontrol musik call hanya tersedia melalui chat pribadi.'); return true; }
        try {
            const queue = await require('../services/call.service').musicQueue(callTarget);
            await reply(`🎶 *MUSIC CALL*\n\n• Sedang diputar: *${queue.playing ? 'Ya' : 'Tidak'}*\n• Antrean berikutnya: *${queue.queued || 0}*`);
        } catch (error) { console.error('[MUSIC] Gagal mengambil antrean musik:', error); await reply('Nn... Antrean musik belum bisa dibaca sekarang.'); }
        return true;
    }

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
    if (state.sesiMybini && state.sesiMybini[senderId]) {
        const pilihan = textLower;
        if (pilihan === 'batal' || pilihan === 'cancel') {
            delete state.sesiMybini[senderId];
            await reply('Nn... Pemilihan istri dibatalkan.');
            return true;
        }

        if (state.sesiMybini[senderId].step === 1) {
            const num = parseInt(pilihan);
            if (isNaN(num) || num < 1 || num > WAIFU_CHARACTERS.length) {
                await reply(`Nn... Angka tidak valid. Balas dengan angka 1-${WAIFU_CHARACTERS.length}, atau ketik *batal*.`);
                return true;
            }

            const chosen = WAIFU_CHARACTERS[num - 1];
            const core = getCoreNumber(senderId);
            const chosenModel = AIProvider.getUserMode(senderId);
            const charName = chosen.name;
            const characterId = chosen.id;
            state.userAIMode[senderId] = chosenModel;
            if (core) state.userAIMode[core] = chosenModel;
            db.setSetting('userAIMode', state.userAIMode);
            waifuService.activate(senderId, characterId);
            delete state.sesiMybini[senderId];
            AIProvider.clearMemory(senderId);
            if (core) AIProvider.clearMemory(core);

            await replyNow(`✅ *MODE WAIFU (${charName}) AKTIF*\n\nDi PM, cukup chat biasa. Di grup, gunakan *!chat [pesan]*. Otak AI: *${chosenModel.toUpperCase()}*.`);
            return true;
        }
    }

    // ==========================================
    // HANDLER SESI PEMILIHAN AI MODE (2 TAHAP)
    // ==========================================
    if (state.sesiAIMode && state.sesiAIMode[senderId]) {
        const sesi = state.sesiAIMode[senderId];
        const pilihan = textLower.trim();

        if (pilihan === 'batal' || pilihan === 'cancel') {
            delete state.sesiAIMode[senderId];
            await reply('Nn... Pemilihan mode AI dibatalkan.');
            return true;
        }

        const num = parseInt(pilihan);
        const core = getCoreNumber(senderId);

        function simpanMode(mode) {
            state.userAIMode[senderId] = mode;
            if (core) state.userAIMode[core] = mode;
            if (isOwner) {
                state.ownerAIMode = mode;
                db.setSetting('ownerAIMode', mode);
            }
            db.setSetting('userAIMode', state.userAIMode);
            AIProvider.clearMemory(senderId);
            if (core) AIProvider.clearMemory(core);
        }

        if (sesi.step === 'family') {
            const families = modelCatalog.getFamilies();
            if (isNaN(num) || num < 1 || num > families.length) {
                await reply(`Nn... Angka tidak valid. Balas dengan angka 1-${families.length}, atau ketik *batal*.`);
                return true;
            }

            const family = families[num - 1];

            if (family.openSource) {
                sesi.step = 'opensource';
                let teks = `🌱 *${family.label.toUpperCase()}*\n\nNn... Pilih penyedia open source:\n\n`;
                modelCatalog.OPEN_SOURCE_PROVIDERS.forEach((p, i) => { teks += `*${i + 1}.* ${p.label} — 1 limit/request\n`; });
                teks += `\n_Semua user bisa memakai tingkatan ini._\n_Ketik *batal* untuk membatalkan._`;
                await reply(teks);
                return true;
            }

            sesi.step = 'tier';
            sesi.familyKey = family.key;
            await reply(`🎚️ *PILIH TINGKATAN — ${family.label.toUpperCase()}*\n\n*1.* Standard — untuk semua user\n*2.* Premium — khusus VIP Premium\n\n_Ketik *batal* untuk membatalkan._`);
            return true;
        }

        if (sesi.step === 'opensource') {
            const providers = modelCatalog.OPEN_SOURCE_PROVIDERS;
            if (isNaN(num) || num < 1 || num > providers.length) {
                await reply(`Nn... Angka tidak valid. Balas dengan angka 1-${providers.length}, atau ketik *batal*.`);
                return true;
            }

            const chosenProvider = providers[num - 1];

            try {
                await reply(`Nn... Sedang memuat daftar model ${chosenProvider.label}...`);
                const userRole = state.userRole ? (state.userRole[senderId] || (core && state.userRole[core])) : null;
                let models = await AIProvider.fetchModels(chosenProvider.key);

                if (!models || models.length === 0) {
                    await reply(PESAN_GAGAL_MODEL);
                    return true;
                }

                models = filterModelsByRole(models, userRole, chosenProvider.key);

                if (chosenProvider.key === 'openrouter') state.sesiOpenRouterMode[senderId] = { list: models };
                else state.sesiCloudflareMode[senderId] = { list: models };
                delete state.sesiAIMode[senderId];

                const roleNotice = userRole && userRole !== 'normal' ? ` (Sesuai Peran: ${userRole.toUpperCase()})` : '';
                let teks = `🌱 *DAFTAR MODEL ${chosenProvider.label.toUpperCase()}*${roleNotice}\n\nNn... Pilih model dengan membalas angkanya (1 limit/request):\n\n`;
                models.forEach((m, i) => { teks += `*${i + 1}.* ${m.name}\n`; });
                teks += `\n_Ketik *batal* untuk membatalkan._`;
                await reply(teks);
            } catch (err) {
                console.error(`[AIMODE] Gagal memuat model ${chosenProvider.key}:`, err);
                await reply(PESAN_GAGAL_MODEL);
            }
            return true;
        }

        if (sesi.step === 'tier') {
            const family = modelCatalog.getFamilyByKey(sesi.familyKey);
            if (!family) {
                delete state.sesiAIMode[senderId];
                await reply('Nn... Sesi pemilihan mode sudah tidak valid. Ketik *!aimode* untuk mengulang.');
                return true;
            }

            if (num === 1) {
                try {
                    simpanMode(family.standardMode);
                    const arisuModel = AIProvider.providers.arisu.fetchModels().find(m => m.id === AIProvider.resolveMode(family.standardMode, senderId).model);
                    delete state.sesiAIMode[senderId];
                    await replyNow(`✅ *MODE STANDARD AKTIF*\n\nNn... Otak Shiroko sekarang memakai *${family.label}* (Standard).\nBiaya: *${arisuModel?.limitCost || 2} limit/request*. ✨`);
                } catch (err) {
                    console.error('[AIMODE] Gagal mengaktifkan mode Standard:', err);
                    await replyNow(PESAN_GANGGUAN_AI);
                }
                return true;
            }

            if (num === 2) {
                const isPremium = hasActivePremium(senderId);
                if (!isOwner && !isPremium) {
                    delete state.sesiAIMode[senderId];
                    await reply('Nn... Tingkatan Premium hanya untuk VIP Premium. Silakan pilih tingkatan *Standard* atau *Open Source*, atau aktifkan VIP Premium dulu.');
                    return true;
                }

                try {
                    await reply('Nn... Sedang menyiapkan otak Premium...');
                    const models = await AIProvider.fetchModels('xkiro');
                    const chosenModel = modelCatalog.resolveXKiroModel(family, models, model => isXKiroModelUsable(model, { isOwner, isPremium }));

                    if (!chosenModel) {
                        delete state.sesiAIMode[senderId];
                        await reply('Nn... Versi Premium untuk model ini sedang tidak tersedia. Silakan pilih tingkatan *Standard*.');
                        return true;
                    }

                    state.userXKiroModel[senderId] = chosenModel.id;
                    if (core) state.userXKiroModel[core] = chosenModel.id;
                    if (isOwner) {
                        state.ownerXKiroModel = chosenModel.id;
                        db.setSetting('ownerXKiroModel', chosenModel.id);
                    }
                    db.setSetting('userXKiroModel', state.userXKiroModel);
                    simpanMode('xkiro');

                    const biaya = getXKiroModelCost(chosenModel.id, { isOwner, isPremium, model: chosenModel });
                    const biayaTeks = isOwner ? 'unlimited (Owner)' : `${biaya} limit/request`;
                    delete state.sesiAIMode[senderId];
                    await replyNow(`✅ *MODE PREMIUM AKTIF*\n\nNn... Otak Shiroko sekarang memakai *${family.label}* (Premium).\nBiaya: *${biayaTeks}*. ✨`);
                } catch (err) {
                    console.error('[AIMODE] Gagal menyiapkan model premium:', err);
                    await replyNow(PESAN_GAGAL_MODEL);
                }
                return true;
            }

            await reply('Nn... Angka tidak valid. Balas *1* untuk Standard atau *2* untuk Premium, atau ketik *batal*.');
            return true;
        }

        delete state.sesiAIMode[senderId];
        return true;
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
        if (!isXKiroModelUsable(chosenModel, { isOwner, isPremium: chosenIsPremium })) {
            delete state.sesiXKiroMode[senderId];
            await reply('Nn... Tingkatan Premium hanya tersedia untuk VIP Premium. Gunakan tingkatan *Standard* atau *Open Source*.');
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
        if (!state.sesiMybini) state.sesiMybini = {};
        state.sesiMybini[senderId] = { step: 1 };
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
        if (state.sesiMybini) delete state.sesiMybini[senderId];
        AIProvider.clearMemory(senderId);
        const core = getCoreNumber(senderId);
        if (core) AIProvider.clearMemory(core);
        await replyNow('Nn... Mode waifu dinonaktifkan. Persona default kembali aktif.');
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
        const core = getCoreNumber(senderId);
        const currentMode = AIProvider.getUserMode(senderId);
        const families = modelCatalog.getFamilies();

        delete state.sesiOllamaMode[senderId];
        delete state.sesiArisuMode[senderId];
        delete state.sesiOpenRouterMode[senderId];
        delete state.sesiCloudflareMode[senderId];
        delete state.sesiXKiroMode[senderId];
        state.sesiAIMode[senderId] = { step: 'family' };

        let teks = `🧠 *PILIH OTAK AI SHIROKO*\n\nNn... Pilih model yang ingin dipakai:\n\n`;
        families.forEach((family, i) => { teks += `*${i + 1}.* ${family.label}\n`; });
        teks += `\nMode saat ini: *${currentMode.toUpperCase()}*\n\n_Balas dengan angka, atau ketik *batal*._`;

        await reply(teks);
        return true;
    }

    // ==========================================
    // SHIROKO PINTAR
    // ==========================================
    if (textLower.startsWith('!shiroko_pintar ')) {
        const core = getCoreNumber(senderId);
        const userMode = AIProvider.getUserMode(senderId);
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
            await reply(PESAN_GANGGUAN_AI);
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
            state.sesiKaryaIlmiah[senderId] || state.sesiPixiv[senderId] || state.sesiWaifu[senderId] || state.sesiMybini[senderId] ||
            state.sesiTopup[senderId] || state.sesiMeme[senderId] || state.sesiOllamaMode[senderId] ||
            state.sesiOpenRouterMode[senderId] || state.sesiCloudflareMode[senderId] ||
            state.sesiAIMode[senderId] ||
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
        const userMode = AIProvider.getUserMode(senderId);
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
        const userMode = AIProvider.getUserMode(senderId);
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
                    await reply(PESAN_GANGGUAN_AI);
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
            await reply(`${PESAN_GANGGUAN_AI}\n\n_(Coba ketik !lupa jika dirasa memori percakapan nyangkut)_`);
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

        await ctx.replyNow('Nn... *(Menggelengkan kepala)*. Shiroko sudah melupakan seluruh riwayat obrolan dan mereset sistem pengingat/alarm.');
        return true;
    }

    return false;
}

module.exports = { handle };
