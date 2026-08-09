// ==========================================
// COMMAND: EKSEKUSI MEDIA
// Handler: !stiker, !toimg, !pdf2jpg, !gambar, !dengar, !meme + sesi handler
// ==========================================
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const axios = require('axios');
const state = require('../config/state');
const { cekDanPotongLimit, kembalikanLimit } = require('../config/db');
const { getGeminiComponents, getShirokoModel } = require('../services/ai/providers/gemini');
const { tambahMetadataStiker } = require('../utils/sticker');
const { antrianGambar, prosesAntrianGambar, isComfyUIActive } = require('../services/comfyui.service');
const sharp = require('sharp');
const pixaiService = require('../services/pixai.service');

async function handle(ctx) {
    const { sock, msg, from, senderId, isOwner, textClean, textLower, msgType,
            isQuoted, quotedMsg, quotedType, reply, downloadMediaBaileys } = ctx;

    // ==========================================
    // HANDLER !PIXAI (PIXAI.ART ANIME GENERATOR)
    // ==========================================
    if (textLower.startsWith('!pixai')) {
        const prompt = textClean.split(' ').slice(1).join(' ').trim();
        if (!prompt) {
            await reply('Nn... Tolong masukkan prompt setelah perintah *!pixai*.\n\nContoh:\n*!pixai 1girl, sunaookami shiroko, halo, blue archive, detailed eyes*');
            return true;
        }

        const cost = 2;
        if (!cekDanPotongLimit(senderId, cost)) {
            await reply(`Nn... Token harian Sensei tidak cukup. Perintah *!pixai* membutuhkan *${cost} limit token*.`);
            return true;
        }

        const pos = pixaiService.tambahAntrianPixAI({
            prompt: prompt,
            senderId: senderId,
            reply: reply,
            onSuccess: async (buffer) => {
                await sock.sendMessage(from, {
                    image: buffer,
                    caption: `🎨 *[ PIXAI.ART GENERATED ]*\n\n*Prompt:* ${prompt}\n*Engine:* PixAI.art Anime Generator`
                }, { quoted: msg });
            },
            onError: async (error) => {
                console.error('🚨 ERROR PIXAI:', error.message);
                kembalikanLimit(senderId, cost);
                await reply(`❌ Nn... Gagal generate gambar via PixAI:\n_${error.message}_`);
            }
        });

        await reply(`🎨 *[ PIXAI.ART ANIME GENERATOR ]*\n\nNn... Pesanan diterima! Posisi antreanmu saat ini: *${pos}*.\nMohon tunggu sebentar ya, Sensei... 🐺✨`);
        return true;
    }

    // ==========================================
    // HANDLER !API-PIXAI (WEB AUTH OTP GENERATOR)
    // ==========================================
    if (textLower === '!api-pixai' || textLower === '!pixailink') {
        const crypto = require('crypto');
        const otp = 'SRO-' + crypto.randomBytes(2).toString('hex').toUpperCase();
        
        if (!global.webAuthSessions) global.webAuthSessions = new Map();
        
        // Simpan OTP (5 Menit kedaluwarsa)
        global.webAuthSessions.set(otp, {
            expires: Date.now() + 5 * 60 * 1000,
            jid: msg.key.remoteJid
        });

        // Bersihkan OTP yang sudah kedaluwarsa
        for (const [key, session] of global.webAuthSessions.entries()) {
            if (Date.now() > session.expires) {
                global.webAuthSessions.delete(key);
            }
        }

        const webUrl = process.env.WEB_SHIROKO_URL || 'https://shiroko-project.my.id';
        let linkMsg = `🌐 *[ PIXAI WEB AUTH OTP ]*\n\n`;
        linkMsg += `Nn... Akses generator Web Auth untuk akun Anda.\n\n`;
        linkMsg += `🔗 *Website:* ${webUrl}/pixai-api\n`;
        linkMsg += `🔑 *Kode OTP:* *${otp}*\n\n`;
        linkMsg += `_Kode ini hanya berlaku selama 5 menit. Masukkan kode di Web Shiroko untuk mendapatkan akses Generator otomatis._ 🎨✨`;

        await reply(linkMsg);
        return true;
    }

    // ==========================================
    // HANDLER !CEKPIXAI (CEK STATUS PIXAI TOKEN)
    // ==========================================
    if (textLower === '!cekpixai' || textLower === '!pixaitoken') {
        const pixaiAuth = require('../pixai-auth');
        const tokens = pixaiAuth.getAllTokens();
        if (tokens.length === 0) {
            await reply('❌ *[ PIXAI TOKEN POOL ]*\n\nNn... Belum ada PIXAI_TOKEN yang terpasang pada .env server.');
            return true;
        }

        let textInfo = `🔑 *[ STATUS PIXAI TOKEN POOL ]*\nTotal Token: *${tokens.length} Key(s)*\n\n`;

        for (let idx = 0; idx < tokens.length; idx++) {
            const t = tokens[idx];
            const payload = pixaiAuth.decodeJwt(t);

            textInfo += `*🔑 Token #${idx + 1}:*\n`;
            if (payload) {
                textInfo += `• *User ID:* \`${payload.sub || 'N/A'}\`\n`;
                if (payload.exp) {
                    const expDate = new Date(payload.exp * 1000);
                    const now = new Date();
                    const diffDays = ((expDate - now) / (1000 * 60 * 60 * 24)).toFixed(1);
                    const isExpired = diffDays <= 0;
                    textInfo += `• *Masa Aktif:* ${isExpired ? 'KEDALUWARSA 🔴' : `*${diffDays} Hari Tersisa* 🟢`}\n`;
                }
            } else {
                textInfo += `• *Format:* Custom Token\n`;
            }
            textInfo += `• *Status Kredit:* *Aktif / Siap Render* 💎\n`;
            textInfo += `• *Status Server:* Siap Digunakan ✨\n\n`;
        }
        
        textInfo += `📊 *Antrean Aktif:* ${pixaiService.antrianPixAI.length} pesanan\n`;
        textInfo += '_Sistem pemantauan kredit & failover otomatis aktif untuk seluruh token pool._ 🎨✨';
        
        await reply(textInfo);
        return true;
    }

    // ==========================================
    // HANDLER !BUATPIXAI / !GENPIXAI (PIXAI API TOKEN GENERATOR)
    // ==========================================
    if (textLower.startsWith('!buatpixai') || textLower.startsWith('!genpixai')) {
        const args = textClean.split(' ').slice(1);
        if (args.length < 2) {
            await reply('🔑 *[ PIXAI API TOKEN GENERATOR ]*\n\nNn... Fitur ini digunakan untuk membuat/mengambil Token API PixAI baru dari akun PixAI.\n\n*Format:* \n*!buatpixai [email_pixai] [password_pixai]*\n\n⚠️ *Perhatian:* Jalankan perintah ini di Private Chat (Japri) demi keamanan password Anda!');
            return true;
        }

        const email = args[0].trim();
        const password = args.slice(1).join(' ').trim();

        await reply(`🔑 Nn... Sedang memproses pembuatan API Token PixAI untuk *${email}*...`);

        try {
            const pixaiAuth = require('../pixai-auth');
            const newToken = await pixaiAuth.loginWithCredentials(email, password);

            const payload = pixaiAuth.decodeJwt(newToken);
            let diffDays = 'N/A';
            if (payload?.exp) {
                diffDays = ((new Date(payload.exp * 1000) - new Date()) / (1000 * 60 * 60 * 24)).toFixed(1);
            }

            let msgSuccess = `🎉 *[ PIXAI API TOKEN SUCCESS ]*\n\n`;
            msgSuccess += `Nn... Token API PixAI berhasil dibuat! ✨\n\n`;
            msgSuccess += `📌 *User ID:* \`${payload?.sub || 'N/A'}\`\n`;
            msgSuccess += `⏳ *Masa Aktif:* *${diffDays} Hari* 🟢\n\n`;
            msgSuccess += `🔑 *API TOKEN:* \`${newToken}\`\n\n`;

            if (isOwner) {
                pixaiAuth.addTokenToEnv(newToken);
                msgSuccess += `✅ *Info Owner:* Token ini telah otomatis ditambahkan ke \`PIXAI_TOKEN\` pool di server bot.`;
            } else {
                msgSuccess += `💡 *Petunjuk Dev:* Salin kode token di atas ke file \`.env\` (variabel \`PIXAI_TOKEN\`) atau gunakan pada header HTTP: \`Authorization: Bearer <TOKEN>\`.`;
            }

            await reply(msgSuccess);
        } catch (err) {
            await reply(`❌ *[ GENERATE TOKEN GAGAL ]*\n\n_${err.message}_\n\n💡 *Catatan:* Pastikan Email & Password akun PixAI sudah benar.`);
        }
        return true;
    }

    // ==========================================
    // HANDLER !LOGINPIXAI (KHUSUS OWNER)
    // ==========================================
    // HANDLER !SETPIXAI (SET PIXAI TOKEN MANUAL - KHUSUS OWNER)
    // ==========================================
    if (textLower.startsWith('!setpixai')) {
        if (!isOwner) {
            await reply('❌ Perintah ini khusus Komandan (Owner).');
            return true;
        }

        const newToken = textClean.split(' ').slice(1).join(' ').trim();
        if (!newToken) {
            await reply('⚠️ *[ SET PIXAI TOKEN ]*\n\nFormat:\n*!setpixai [JWT_TOKEN_BARU]*');
            return true;
        }

        const pixaiAuth = require('../pixai-auth');
        pixaiAuth.saveTokenToEnv(newToken);

        const payload = pixaiAuth.decodeJwt(newToken);
        let diffDays = 'N/A';
        if (payload?.exp) {
            diffDays = ((new Date(payload.exp * 1000) - new Date()) / (1000 * 60 * 60 * 24)).toFixed(1);
        }

        await reply(`✅ *[ SET PIXAI TOKEN SUKSES ]*\n\nNn... PIXAI_TOKEN berhasil diperbarui pada file .env dan memori bot!\n\n📌 *User ID:* ${payload?.sub || 'N/A'}\n⏳ *Masa Aktif:* ${diffDays} Hari Tersisa 🟢`);
        return true;
    }

    // ==========================================
    // HANDLER !GAMBAR (INTERAKTIF STEP 1)
    // ==========================================
    if (textLower.startsWith('!gambar')) {
        const prompt = textClean.split(' ').slice(1).join(' ').trim();
        if (!prompt) {
            await reply('Nn... Tolong masukkan prompt setelah perintah *!gambar*. Contoh:\n!gambar seorang gadis anime di pantai');
            return true;
        }
        
        state.sesiArisu[senderId] = { step: 1, promptMentah: prompt, from, msg };
        await reply('Nn... Pilih Server/Provider Render Gambar dengan membalas angka:\n' +
            '1️⃣ *ComfyUI* (Vast.ai Cloud GPU — Support NSFW 🔞, 4 limit)\n' +
            '2️⃣ *ArisuSoft Satelit AI* 🛰️\n' +
            '3️⃣ *Cloudflare Workers AI* (Super Cepat) ⚡\n' +
            '4️⃣ *PixAI.art* (Anime Generator) ✨\n' +
            '\nKetik *batal* untuk membatalkan.');
        return true;
    }

    // ==========================================
    // HANDLER SESI RENDER GAMBAR (INTERAKTIF STEP 2)
    // ==========================================
    if (state.sesiArisu[senderId]) {
        const sesi = state.sesiArisu[senderId];
        const pilihan = textLower.trim();
        
        if (pilihan === 'batal' || pilihan === 'cancel') {
            delete state.sesiArisu[senderId];
            await reply('Nn... Operasi dibatalkan.');
            return true;
        }

        // TAHAP 1: PILIH PROVIDER/SERVER
        if (sesi.step === 1 || !sesi.step) {
            if (pilihan === '1') {
                if (!isComfyUIActive()) {
                    await reply('❌ Nn... Mohon maaf, mesin Render GPU ComfyUI sedang *DIMATIKAN*. (Jam Operasional otomatis: 07:00 - 23:00 WIB). Silakan pilih server/provider lain (misalnya nomor 2 atau 3).');
                    return true;
                }

                const { dbPremium } = require('../config/db');
                const dbEntry = dbPremium[senderId];
                const isPremium = dbEntry && (typeof dbEntry === 'boolean' || dbEntry > Date.now());
                if (!isPremium && !isOwner) {
                    await reply('❌ Nn... Mesin ComfyUI ini mengkonsumsi daya render yang sangat besar. Akses ke mesin ini hanya diizinkan untuk pelanggan *VIP Premium*.\n\nKetik *!premium* untuk berlangganan.');
                    return true;
                }

                const cost = 4;
                const { dbLimit, simpanDB } = require('../config/db');
                if (dbLimit[senderId] !== undefined && !isOwner) {
                    if (dbLimit[senderId] < cost) {
                        await reply(`Nn... Tokenmu tidak cukup untuk membayar ${cost} limit.\nSilakan pilih server lain atau ketik *batal*.`);
                        return true;
                    }
                    dbLimit[senderId] -= cost;
                    simpanDB();
                }

                delete state.sesiArisu[senderId];
                antrianGambar.push({ from: sesi.from, msg: sesi.msg, promptMentah: sesi.promptMentah, senderId, reply });
                await reply('Nn... Mengirimkan permintaan ke ComfyUI (Vast.ai). Mohon tunggu...');
                prosesAntrianGambar();
                return true;

            } else if (pilihan === '2') {
                // Sub-menu ArisuSoft (3 Model Khas)
                sesi.step = 2;
                sesi.provider = 'arisu';
                await reply('Nn... Pilih Model ArisuSoft Satelit AI:\n' +
                    '1️⃣ *SDXL Turbo* (biaya 3 limit)\n' +
                    '2️⃣ *Agnes 2.0* (biaya 2 limit)\n' +
                    '3️⃣ *Agnes 2.1* (biaya 2 limit)\n' +
                    '\nKetik *batal* untuk membatalkan.');
                return true;

            } else if (pilihan === '3') {
                // Sub-menu Cloudflare Workers AI (Hasil Scanning Dinamis)
                await reply('⏳ Nn... Memindai semua model gambar yang tersedia di API Cloudflare kamu...');
                const { fetchCloudflareImageModels } = require('../services/ai/providers/cloudflare');
                const cfModels = await fetchCloudflareImageModels();
                
                sesi.step = 2;
                sesi.provider = 'cloudflare';
                sesi.cfModels = cfModels;

                let textMenu = `Nn... Ditemukan *${cfModels.length} Model Gambar* di Cloudflare AI (biaya 1 limit / Cepat ⚡):\n\n`;
                cfModels.forEach((m, idx) => {
                    textMenu += `${idx + 1}️⃣ *${m.name}*\n`;
                });
                textMenu += `\nBalas dengan angka 1 - ${cfModels.length} atau ketik *batal*.`;

                await reply(textMenu);
                return true;

            } else if (pilihan === '4') {
                const cost = 2;
                const { dbLimit, simpanDB } = require('../config/db');
                if (dbLimit[senderId] !== undefined && !isOwner) {
                    if (dbLimit[senderId] < cost) {
                        await reply(`Nn... Tokenmu tidak cukup untuk membayar ${cost} limit.\nSilakan pilih server lain atau ketik *batal*.`);
                        return true;
                    }
                    dbLimit[senderId] -= cost;
                    simpanDB();
                }

                const promptMentah = sesi.promptMentah;
                const targetFrom = sesi.from;
                const targetMsg = sesi.msg;
                delete state.sesiArisu[senderId];

                const pos = pixaiService.tambahAntrianPixAI({
                    prompt: promptMentah,
                    senderId: senderId,
                    reply: reply,
                    onSuccess: async (buffer) => {
                        await sock.sendMessage(targetFrom, {
                            image: buffer,
                            caption: `🎨 *[ PIXAI.ART GENERATED ]*\n\n*Prompt:* ${promptMentah}\n*Engine:* PixAI.art Anime Generator`
                        }, { quoted: targetMsg });
                    },
                    onError: async (error) => {
                        console.error('🚨 ERROR PIXAI:', error.message);
                        kembalikanLimit(senderId, cost);
                        await reply(`❌ Nn... Gagal render gambar via PixAI:\n_${error.message}_`);
                    }
                });

                await reply(`🎨 *[ PIXAI.ART ANIME GENERATOR ]*\n\nNn... Pesanan diterima! Posisi antreanmu saat ini: *${pos}*.\nMohon tunggu sebentar ya, Sensei... 🐺✨`);
                return true;

            } else {
                await reply('Nn... Pilihan tidak valid. Balas dengan angka 1, 2, 3, atau 4. Atau ketik *batal*.');
                return true;
            }
        }

        // TAHAP 2: PILIH MODEL SPESIFIK BERDASARKAN PROVIDER
        if (sesi.step === 2) {
            let cost = 0;
            let namaModel = '';
            let isCloudflare = false;
            let cfModel = '';
            let endpointModel = '';

            if (sesi.provider === 'arisu') {
                if (pilihan === '1') {
                    cost = 3; endpointModel = 'sdxl-turbo'; namaModel = 'SDXL Turbo';
                } else if (pilihan === '2') {
                    cost = 2; endpointModel = 'agnes-2.0'; namaModel = 'Agnes 2.0';
                } else if (pilihan === '3') {
                    cost = 2; endpointModel = 'agnes-2.1'; namaModel = 'Agnes 2.1';
                } else {
                    await reply('Nn... Pilihan model ArisuSoft tidak valid. Balas dengan 1, 2, atau 3.');
                    return true;
                }
            } else if (sesi.provider === 'cloudflare') {
                isCloudflare = true;
                const idx = parseInt(pilihan) - 1;
                const cfList = sesi.cfModels || [];
                if (!isNaN(idx) && idx >= 0 && idx < cfList.length) {
                    cost = 1;
                    cfModel = cfList[idx].id;
                    namaModel = cfList[idx].name;
                } else {
                    await reply(`Nn... Pilihan model Cloudflare tidak valid. Balas dengan angka 1 sampai ${cfList.length || 10}.`);
                    return true;
                }
            }

            const { dbLimit, simpanDB } = require('../config/db');
            if (dbLimit[senderId] !== undefined && !isOwner) {
                if (dbLimit[senderId] < cost) {
                    await reply(`Nn... Tokenmu tidak cukup untuk membayar ${cost} limit.\nSilakan pilih model lain atau ketik *batal*.`);
                    return true;
                }
                dbLimit[senderId] -= cost;
                simpanDB();
            }

            const promptMentah = sesi.promptMentah;
            const targetFrom = sesi.from;
            const targetMsg = sesi.msg;
            delete state.sesiArisu[senderId];

            if (isCloudflare) {
                try {
                    await reply(`Nn... Mengalihkan render ke Cloudflare AI (${namaModel}). Mohon tunggu...`);
                    const { generateCloudflareImage } = require('../services/ai/providers/cloudflare');
                    const { buffer, mime } = await generateCloudflareImage(promptMentah, cfModel);
                    
                    await sock.sendMessage(targetFrom, {
                        image: buffer,
                        mimetype: mime,
                        caption: `🎨 *Ide Sensei:* ${promptMentah}\n☁️ *Mesin:* Cloudflare Workers AI (${namaModel})\n\nNn... Render dari Cloudflare AI berhasil diselesaikan! ⚡`
                    }, { quoted: targetMsg });
                    
                    const { incrementStat } = require('../config/database');
                    incrementStat('imageGenerated');
                } catch (cfErr) {
                    const { kembalikanLimit } = require('../config/db');
                    if (!isOwner) kembalikanLimit(senderId);
                    console.error("🚨 ERROR CLOUDFLARE IMAGE:", cfErr.message);
                    await reply(`⚠️ Nn... Gagal membuat gambar di Cloudflare AI.\n*Laporan Sistem:* ${cfErr.message}\nToken limit dikembalikan.`);
                }
                return true;
            } else {
                try {
                    await reply(`Nn... Mengalihkan ke server ArisuSoft (${namaModel}). Mohon tunggu...`);
                    const arisuKey = process.env.ARISU_API_KEY;
                    const response = await axios.post(`https://api.arisusoft.com/api/v2/image/${endpointModel}`, {
                        prompt: promptMentah
                    }, {
                        headers: {
                            "Authorization": `Bearer ${arisuKey}`,
                            "Content-Type": "application/json"
                        }
                    });

                    const data = response.data;
                    let imageUrl = data.url || (data.data && data.data.url) || data.image || data.imageUrl; 
                    let base64 = data.base64 || (data.data && data.base64);

                    if (imageUrl) {
                        await sock.sendMessage(targetFrom, {
                            image: { url: imageUrl },
                            caption: `🎨 *Ide Sensei:* ${promptMentah}\n☁️ *Mesin:* ArisuSoft (${namaModel})\n\nNn... Render dari satelit berhasil diselesaikan! 🐺✨`
                        }, { quoted: targetMsg });
                    } else if (base64) {
                        await sock.sendMessage(targetFrom, {
                            image: Buffer.from(base64, 'base64'),
                            caption: `🎨 *Ide Sensei:* ${promptMentah}\n☁️ *Mesin:* ArisuSoft (${namaModel})\n\nNn... Render dari satelit berhasil diselesaikan! 🐺✨`
                        }, { quoted: targetMsg });
                    } else {
                        throw new Error("Respons ArisuSoft tidak berisi URL/Base64 gambar yang valid");
                    }
                    
                    const { incrementStat } = require('../config/database');
                    incrementStat('imageGenerated');
                } catch (arisuErr) {
                    const { kembalikanLimit } = require('../config/db');
                    if (!isOwner) kembalikanLimit(senderId);
                    console.error("🚨 ERROR ARISUSOFT IMAGE:", arisuErr.message);
                    await reply(`⚠️ Nn... Gagal membuat gambar di ArisuSoft.\n*Laporan Sistem:* ${arisuErr.message}\nToken limit dikembalikan.`);
                }
                return true;
            }
        }
    }

    // ==========================================
    // HANDLER SESI INTERAKTIF !TTS
    // ==========================================
    if (state.sesiTTS[senderId]) {
        const sesi = state.sesiTTS[senderId];
        const pilihan = textLower;

        if (pilihan === 'batal' || pilihan === 'cancel') {
            delete state.sesiTTS[senderId];
            await reply('Nn... Pembuatan suara (TTS) dibatalkan.');
            return true;
        }

        // TAHAP 1: PILIH PROVIDER (Cloudflare vs ArisuSoft)
        if (sesi.step === 1) {
            const { fetchCloudflareTTSModels } = require('../services/ai/providers/cloudflare');
            const { fetchTTSModels: fetchArisuTTSModels } = require('../services/ai/providers/arisu');

            if (pilihan === '1' || pilihan === 'cloudflare') {
                await reply('⏳ Nn... Memindai semua model suara dari Cloudflare Workers AI...');
                const cfModels = await fetchCloudflareTTSModels();

                sesi.step = 2;
                sesi.provider = 'cloudflare';
                sesi.models = cfModels;

                let menuText = `🎙️ *MODEL SUARA CLOUDFLARE WORKERS AI*\n\nNn... Balas dengan angka untuk memilih model suara (biaya 2 limit):\n\n`;
                cfModels.forEach((m, i) => {
                    menuText += `${i + 1}️⃣ *${m.name}*\n   └ 📌 _${m.desc}_\n\n`;
                });
                menuText += `Ketik *batal* untuk membatalkan.`;

                await reply(menuText);
                return true;

            } else if (pilihan === '2' || pilihan === 'arisu') {
                const arisuModels = fetchArisuTTSModels();

                sesi.step = 2;
                sesi.provider = 'arisu';
                sesi.models = arisuModels;

                let menuText = `🎙️ *MODEL SUARA ARISUSOFT SATELIT AI*\n\nNn... Balas dengan angka untuk memilih model suara (biaya 2 limit):\n\n`;
                arisuModels.forEach((m, i) => {
                    menuText += `${i + 1}️⃣ *${m.name}*\n   └ 📌 _${m.desc}_\n\n`;
                });
                menuText += `Ketik *batal* untuk membatalkan.`;

                await reply(menuText);
                return true;

            } else {
                await reply('Nn... Pilihan tidak valid. Balas dengan angka *1* (Cloudflare AI) atau *2* (ArisuSoft AI). Atau ketik *batal*.');
                return true;
            }
        }

        // TAHAP 2: PILIH MODEL SPESIFIK & GENERATE AUDIO
        if (sesi.step === 2) {
            const idx = parseInt(pilihan) - 1;
            const list = sesi.models || [];

            if (isNaN(idx) || idx < 0 || idx >= list.length) {
                await reply(`Nn... Pilihan model suara tidak valid. Balas dengan angka 1 sampai ${list.length} atau ketik *batal*.`);
                return true;
            }

            const cost = 2;
            const { cekDanPotongLimit, kembalikanLimit } = require('../config/db');
            if (!cekDanPotongLimit(senderId, cost)) {
                delete state.sesiTTS[senderId];
                await reply(`Nn... Tokenmu tidak cukup. Butuh ${cost} limit untuk menggunakan fitur Text-to-Speech.`);
                return true;
            }

            const chosenModel = list[idx];
            const textTTS = sesi.textTTS;
            const targetFrom = sesi.from;
            const targetMsg = sesi.msg;
            delete state.sesiTTS[senderId];

            try {
                await reply(`⏳ Nn... Mengubah teks menjadi suara menggunakan *${chosenModel.name}*. Mohon tunggu...`);
                
                let buffer, mime;
                if (sesi.provider === 'cloudflare') {
                    const { textToSpeechCloudflare } = require('../services/ai/providers/cloudflare');
                    const res = await textToSpeechCloudflare(textTTS, chosenModel.id);
                    buffer = res.buffer;
                    mime = res.mime;
                } else if (sesi.provider === 'arisu') {
                    const { textToSpeech: textToSpeechArisu } = require('../services/ai/providers/arisu');
                    const res = await textToSpeechArisu(textTTS, chosenModel.id);
                    buffer = res.buffer;
                    mime = res.mime;
                } else {
                    throw new Error("Provider TTS tidak valid atau tidak dikenali.");
                }

                const ext = (mime || '').includes('wav') ? 'wav' : 'mp3';

                // Kirim file audio via Document Media (Paling Stabil & 100% Langsung Terkirim Tanpa Hang)
                await sock.sendMessage(targetFrom, {
                    document: buffer,
                    mimetype: mime || 'audio/mpeg',
                    fileName: `shiroko_tts_${chosenModel.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${Date.now()}.${ext}`,
                    caption: `🎙️ *Hasil Suara AI (${chosenModel.name}):*\n"${textTTS}"\n\nNn... Berhasil mengubah teks menjadi suara! 🔊`
                }, { quoted: targetMsg });

                // Kirim juga sebagai pemutar audio langsung jika memungkinkan
                try {
                    await sock.sendMessage(targetFrom, {
                        audio: buffer,
                        mimetype: 'audio/mp4',
                        ptt: false
                    });
                } catch (e) {
                    // Abaikan jika pemutar audio audio/mp4 ditolak WhatsApp
                }

            } catch (ttsErr) {
                if (!isOwner) kembalikanLimit(senderId, cost);
                console.error("🚨 ERROR TTS:", ttsErr.message);
                await reply(`⚠️ Nn... Gagal membuat suara AI.\n*Laporan Sistem:* ${ttsErr.message}\nToken limit dikembalikan.`);
            }
            return true;
        }
    }

    // ==========================================
    // HANDLER !TTS / !SUARA (TEXT-TO-SPEECH MULTI-PROVIDER)
    // ==========================================
    if (textLower.startsWith('!tts') || textLower.startsWith('!suara')) {
        const textTTS = textClean.split(' ').slice(1).join(' ').trim();
        if (!textTTS) {
            await reply('Nn... Masukkan teks yang ingin diubah menjadi suara. Contoh:\n!tts Halo Sensei, selamat pagi!');
            return true;
        }

        state.sesiTTS[senderId] = {
            step: 1,
            textTTS: textTTS,
            from: from,
            msg: msg
        };

        let menuText = `🎙️ *PILIH PROVIDER SUARA (TEXT-TO-SPEECH)*\n\n` +
            `Nn... Pilih Provider / Server Suara dengan membalas angka:\n\n` +
            `1️⃣ *Cloudflare Workers AI* ⚡ (Multi-Language & Realtime Voice)\n` +
            `2️⃣ *ArisuSoft Satelit AI* 🛰️ (Bahasa Indonesia & Voicevox Anime JP)\n\n` +
            `Ketik *batal* untuk membatalkan.`;

        await reply(menuText);
        return true;
    }

    // ==========================================
    // HANDLER SESI MEME (INTERAKTIF)
    // ==========================================
    if (state.sesiMeme[senderId]) {
        const sesi = state.sesiMeme[senderId];
        const pilihan = textLower;

        if (pilihan === 'batal' || pilihan === 'cancel') {
            delete state.sesiMeme[senderId];
            kembalikanLimit(senderId);
            await reply('Nn... Operasi pembuatan meme dibatalkan.');
            return true;
        }

        if (sesi.step === 1) {
            if (pilihan === '1' || pilihan === 'stiker') sesi.format = 'stiker';
            else if (pilihan === '2' || pilihan === 'gambar') sesi.format = 'gambar';
            else { await reply('Nn... Pilihan tidak valid. Balas dengan angka *1* (Stiker) atau *2* (Gambar).'); return true; }

            sesi.step = 2;
            await reply('Nn... Format dikunci. Sekarang pilih posisi teks:\n1️⃣ *Atas*\n2️⃣ *Bawah*');
            return true;
        }

        if (sesi.step === 2) {
            let posisiY = '';
            if (pilihan === '1' || pilihan === 'atas') posisiY = '10';
            else if (pilihan === '2' || pilihan === 'bawah') posisiY = 'h-text_h-10';
            else { await reply('Nn... Pilihan tidak valid. Balas dengan angka *1* (Atas) atau *2* (Bawah).'); return true; }

            await reply(`Nn... Memproses ${sesi.format} meme di server lokal, mohon tunggu...`);

            const tempDir = path.join(__dirname, '..', 'temp');
            if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

            const namaID = Date.now();
            const tempInput = path.join(tempDir, `meme_in_${namaID}.jpg`);
            const tempTeks = path.join(tempDir, `meme_teks_${namaID}.txt`);
            const tempOutput = path.join(tempDir, `meme_out_${namaID}.${sesi.format === 'stiker' ? 'webp' : 'jpg'}`);

            try {
                fs.writeFileSync(tempInput, sesi.buffer);
                fs.writeFileSync(tempTeks, sesi.teks);

                const fontPath = path.join(__dirname, '..', 'impact.ttf').replace(/\\/g, '/').replace(/:/g, '\\:');
                const textFileFfmpeg = tempTeks.replace(/\\/g, '/').replace(/:/g, '\\:');

                let vfFilter = `drawtext=fontfile='${fontPath}':textfile='${textFileFfmpeg}':fontcolor=white:bordercolor=black:borderw=2:fontsize=(w/8):x=(w-text_w)/2:y=${posisiY}`;

                if (sesi.format === 'stiker') {
                    vfFilter += `,scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000`;
                }

                let command = '';
                if (sesi.format === 'stiker') {
                    command = `ffmpeg -i "${tempInput}" -vcodec libwebp -vf "${vfFilter}" -lossless 0 -qscale 50 -preset default -loop 0 -an -vsync 0 "${tempOutput}"`;
                } else {
                    command = `ffmpeg -i "${tempInput}" -vf "${vfFilter}" -y "${tempOutput}"`;
                }

                exec(command, async (err) => {
                    if (err) {
                        console.error('🚨 ERROR MEME:', err);
                        await reply('Nn... FFMPEG gagal memproses meme. Pastikan font Impact ada di sistem OS Sensei.');
                    } else {
                        const outBuffer = fs.readFileSync(tempOutput);
                        if (sesi.format === 'stiker') {
                            await sock.sendMessage(from, { sticker: outBuffer }, { quoted: msg });
                        } else {
                            await sock.sendMessage(from, { image: outBuffer, caption: 'Nn... Mememu sudah jadi, Sensei. 🐺✨' }, { quoted: msg });
                        }
                    }

                    if (fs.existsSync(tempInput)) fs.unlinkSync(tempInput);
                    if (fs.existsSync(tempTeks)) fs.unlinkSync(tempTeks);
                    if (fs.existsSync(tempOutput)) fs.unlinkSync(tempOutput);
                    delete state.sesiMeme[senderId];
                });

            } catch (err) {
                console.error(err);
                await reply('Nn... Terjadi kesalahan sistem saat membuat meme.');
                delete state.sesiMeme[senderId];
                kembalikanLimit(senderId);
            }
            return true;
        }
    }

    // ==========================================
    // DENGAR / TRANSKRIP AUDIO
    // ==========================================
    if (textLower === '!dengar' || textLower === '!transkrip') {
        if (!cekDanPotongLimit(senderId)) { await reply('Nn... Token harian Sensei sudah habis.'); return true; }

        const isQuotedAudio = isQuoted && (quotedType === 'audioMessage' || quotedType === 'documentMessage');

        if (isQuotedAudio) {
            try {
                const messageToDownload = quotedMsg[quotedType];
                const isMimeAudio = messageToDownload.mimetype?.startsWith('audio/') || messageToDownload.mimetype?.includes('mp4');

                if (isMimeAudio) {
                    await reply('Nn... File diterima. Shiroko butuh waktu menyandikan data ini. Mohon tunggu...');

                    const mediaBuffer = await downloadMediaBaileys(messageToDownload, quotedType === 'audioMessage' ? 'audio' : 'document');
                    const tempDir = path.join(__dirname, '..', 'temp');
                    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

                    const tempFilePath = path.join(tempDir, `sadap_${Date.now()}.ogg`);
                    fs.writeFileSync(tempFilePath, mediaBuffer);

                    const { fileManager } = getGeminiComponents();

                    const uploadResponse = await fileManager.uploadFile(tempFilePath, { mimeType: "audio/ogg", displayName: "Audio Sadapan" });
                    const prompt = "Transkrip suara ini dengan akurat. Awali jawabanmu dengan mengomentari isi suaranya sedikit menggunakan kepribadian Shiroko (Blue Archive), lalu berikan teks aslinya.";

                    const result = await getShirokoModel().generateContent([prompt, { fileData: { fileUri: uploadResponse.file.uri, mimeType: uploadResponse.file.mimeType } }]);
                    await reply(`*🎧 HASIL SADAP AUDIO (HD)*\n\n${result.response.text()}`);

                    await fileManager.deleteFile(uploadResponse.file.name);
                    fs.unlinkSync(tempFilePath);
                } else {
                    await reply('Nn... Format salah. Pastikan me-reply Audio/VN.');
                }
            } catch (error) {
                kembalikanLimit(senderId);
                await reply('Nn... Gagal mengunduh dan memproses audio.');
            }
        } else {
            await reply('Nn... Sensei harus me-reply sebuah pesan suara sambil mengetik perintah ini.');
        }
        return true;
    }

    // ==========================================
    // CIVITAI (KHUSUS OWNER)
    // ==========================================
    if (textLower.startsWith('!civitai ')) {
        if (!isOwner) {
            await reply('❌ Nn... Fitur ini menggunakan saldo berbayar (Buzz), sehingga dikunci khusus hanya untuk Sensei Owner.');
            return true;
        }

        const promptMentah = textClean.slice(9).trim();
        if (!promptMentah) {
            await reply('Nn... Tolong masukkan prompt-nya, contoh:\n*!civitai A beautiful anime girl in a field of flowers*');
            return true;
        }

        try {
            if (!process.env.CIVITAI_API_KEY) {
                await reply('❌ API Key Civitai belum disetel di .env');
                return true;
            }

            await reply('⏳ Nn... Memulai render gambar di kluster Civitai. Proses antrean ini memakan waktu beberapa menit, mohon tunggu dengan sabar... 🐺');

            const { Civitai } = require("civitai");
            const civitaiClient = new Civitai({ auth: process.env.CIVITAI_API_KEY });

            const input = {
                model: "urn:air:sdxl:checkpoint:civitai:101055@128078", // Juggernaut XL (Default SDK)
                params: {
                    prompt: promptMentah,
                    negativePrompt: "lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry",
                    scheduler: "EulerA",
                    steps: 20,
                    cfgScale: 7,
                    width: 1024,
                    height: 1024,
                    clipSkip: 2
                }
            };

            // Gunakan flag `true` untuk polling otomatis (menunggu sampai selesai)
            const response = await civitaiClient.image.fromText(input, true); 

            // Ekstrak blobUrl
            let imageUrl = null;
            if (response && response.jobs && response.jobs.length > 0) {
                const job = response.jobs[0];
                if (job.result && job.result.blobUrl) {
                    imageUrl = job.result.blobUrl;
                }
            }

            if (imageUrl) {
                await sock.sendMessage(from, {
                    image: { url: imageUrl },
                    caption: `🎨 *Ide Sensei:* ${promptMentah}\n☁️ *Mesin:* Civitai API (Juggernaut XL)\n\nNn... Render dari kluster Civitai berhasil! Saldo Buzz sudah dipotong otomatis. 🐺✨`
                }, { quoted: msg });
            } else {
                throw new Error("Job selesai tetapi gambar (blobUrl) tidak ditemukan dalam respons JSON Civitai.");
            }

        } catch (error) {
            console.error("🚨 ERROR CIVITAI API:", error);
            await reply(`Nn... Gagal merender gambar di Civitai.\n*Laporan Sistem:* ${error.message || error}`);
        }
        return true;
    }

    // ==========================================
    // STIKER
    // ==========================================
    if (textLower === '!stiker') {
        const isTargetImage = msgType === 'imageMessage';
        const isQuotedImage = isQuoted && quotedType === 'imageMessage';

        if (isTargetImage || isQuotedImage) {
            if (!cekDanPotongLimit(senderId)) { await reply('Nn... Token habis.'); return true; }
            try {
                await reply('Nn... Sedang mencetak stiker di server lokal. Mohon tunggu...');
                const messageToDownload = isQuotedImage ? quotedMsg.imageMessage : msg.message.imageMessage;
                const mediaBuffer = await downloadMediaBaileys(messageToDownload, 'image');

                const tempDir = path.join(__dirname, '..', 'temp');
                if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

                const namaFile = `stiker_${Date.now()}`;
                const tempInput = path.join(tempDir, `${namaFile}.jpg`);
                const tempOutput = path.join(tempDir, `${namaFile}.webp`);

                fs.writeFileSync(tempInput, mediaBuffer);

                const command = `ffmpeg -i "${tempInput}" -vcodec libwebp -vf "scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000" -lossless 0 -qscale 50 -preset default -loop 0 -an -vsync 0 "${tempOutput}"`;

                exec(command, async (err) => {
                    if (err) {
                        console.error('🚨 ERROR FFMPEG:', err);
                        await reply('Nn... FFMPEG gagal memproses gambar. Pastikan modul ffmpeg benar-benar telah di instal.');
                        if (fs.existsSync(tempInput)) fs.unlinkSync(tempInput);
                        return;
                    }

                    try {
                        const webpBuffer = fs.readFileSync(tempOutput);
                        const stikerFinal = await tambahMetadataStiker(webpBuffer, "Dibuat oleh", "Bot Shiroko");
                        await sock.sendMessage(from, { sticker: stikerFinal }, { quoted: msg });
                    } catch (sendErr) {
                        console.error('🚨 ERROR KIRIM STIKER:', sendErr);
                        await reply('Nn... Gagal mengirim stiker yang sudah jadi.');
                    } finally {
                        if (fs.existsSync(tempInput)) fs.unlinkSync(tempInput);
                        if (fs.existsSync(tempOutput)) fs.unlinkSync(tempOutput);
                    }
                });

            } catch (error) {
                await reply('Nn... Terjadi kesalahan saat mengunduh gambar.');
                console.error('ERROR STIKER:', error.message);
            }
        } else {
            await reply('Nn... Gambarnya mana, Sensei? Harus kirim atau reply gambar dengan caption *!stiker*.');
        }
        return true;
    }

    // ==========================================
    // STIKER KE GAMBAR
    // ==========================================
    if (textLower === '!toimg' || textLower === '!togambar') {
        if (!isQuoted) { await reply('Nn... Sensei harus me-reply stiker yang ingin diubah menjadi gambar.'); return true; }

        const isQuotedSticker = quotedType === 'stickerMessage';
        if (!isQuotedSticker) { await reply('Nn... Maaf Sensei, perintah ini hanya berlaku untuk me-reply stiker.'); return true; }

        if (!cekDanPotongLimit(senderId)) { await reply('Nn... Token habis.'); return true; }

        try {
            await reply('Nn... Sedang mengekstraksi dan mengonversi visual stiker menjadi gambar nyata, mohon tunggu...');
            const stickerMessageObject = quotedMsg.stickerMessage;
            const mediaBuffer = await downloadMediaBaileys(stickerMessageObject, 'sticker');

            // Konversi dari WebP ke PNG berkualitas tinggi
            const pngBuffer = await sharp(mediaBuffer)
                .png({ quality: 100 })
                .toBuffer();

            await sock.sendMessage(from,
                {
                    image: pngBuffer,
                    caption: 'Nn... Ini dia gambarnya, Sensei! 🐺🖼️'
                },
                { quoted: msg }
            );
        } catch (error) {
            console.error('🚨 ERROR TOIMG:', error.message);
            kembalikanLimit(senderId);
            await reply('Nn... Gagal mengonversi stiker. Pastikan stikernya valid dan bukan stiker animasi (GIF).');
        }
        return true;
    }

    // ==========================================
    // PDF KE JPG
    // ==========================================
    if (textLower === '!pdf2jpg') {
        if (!cekDanPotongLimit(senderId)) { await reply('Nn... Token harian Sensei habis.'); return true; }
        const isQuotedDoc = isQuoted && quotedType === 'documentMessage';

        if (isQuotedDoc) {
            try {
                const docMsg = quotedMsg.documentMessage;
                if (docMsg.mimetype !== 'application/pdf') { kembalikanLimit(senderId); await reply('Nn... File bukan PDF.'); return true; }

                await reply('Nn... Mengirim PDF ke markas eksternal untuk dikonversi...');
                const mediaBuffer = await downloadMediaBaileys(docMsg, 'document');
                const base64Pdf = mediaBuffer.toString('base64');

                const convertResult = await axios.post('https://v2.convertapi.com/convert/pdf/to/jpg?Secret=' + process.env.CONVERT_API_KEY, {
                    Parameters: [{ Name: 'File', FileValue: { Name: 'dokumen.pdf', Data: base64Pdf } }, { Name: 'StoreFile', Value: false }]
                });

                const files = convertResult.data.Files;
                await reply(`Nn... Konversi berhasil. Menyiapkan pengiriman ${files.length} halaman gambar.`);

                for (let i = 0; i < files.length; i++) {
                    const bufferJpg = Buffer.from(files[i].FileData, 'base64');
                    await sock.sendMessage(from, {
                        image: bufferJpg,
                        caption: `📄 Halaman ${i + 1} dari ${files.length}`
                    }, { quoted: msg });
                }

            } catch (error) {
                kembalikanLimit(senderId);
                console.error('🚨 ERROR PDF2JPG:', error.message);
                await reply(`Nn... Gagal mengonversi PDF.\n*Laporan:* ${error.message}`);
            }
        } else {
            await reply('Nn... Sensei harus me-reply sebuah file PDF dengan perintah *!pdf2jpg*.');
        }
        return true;
    }

    // ==========================================
    // MEME GENERATOR (ENTRY POINT)
    // ==========================================
    if (textLower.startsWith('!meme ')) {
        const teks = textClean.slice(6).trim();
        if (!teks) { await reply('Nn... Teks memenya apa? Format: *!meme [teks]*'); return true; }

        const isTargetImage = msgType === 'imageMessage';
        const isQuotedImage = isQuoted && quotedType === 'imageMessage';

        if (isTargetImage || isQuotedImage) {
            if (!cekDanPotongLimit(senderId)) { await reply('Nn... Token habis.'); return true; }

            try {
                const messageToDownload = isQuotedImage ? quotedMsg.imageMessage : msg.message.imageMessage;
                const mediaBuffer = await downloadMediaBaileys(messageToDownload, 'image');

                state.sesiMeme[senderId] = { step: 1, teks: teks, buffer: mediaBuffer };
                await reply('Nn... Gambar diterima. Pilih format output dengan membalas angka:\n1️⃣ *Stiker*\n2️⃣ *Gambar*\n\n_Ketik *batal* untuk membatalkan._');
            } catch (err) {
                kembalikanLimit(senderId);
                await reply('Nn... Gagal mengunduh gambar.');
            }
        } else {
            await reply('Nn... Sensei harus mengirim gambar dengan caption *!meme [teks]* atau me-reply sebuah gambar.');
        }
        return true;
    }

    return false;
}

module.exports = { handle };
