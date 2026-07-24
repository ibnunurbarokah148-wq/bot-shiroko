// ==========================================
// COMMAND: DATA INTEL
// Handler: !tiktok, !pixiv, !waifu, !gacha, !neko + sesi handlers
// ==========================================
const axios = require('axios');
const https = require('https');
const state = require('../config/state');
const { cekDanPotongLimit, kembalikanLimit } = require('../config/db');
const { pixiv } = require('../services/pixiv.service');

async function handle(ctx) {
    const { sock, msg, from, senderId, isOwner, textClean, textLower, reply } = ctx;

    // ==========================================
    // HANDLER SESI TIKTOK (INTERAKTIF)
    // ==========================================
    if (state.sesiTikTok[senderId]) {
        const pilihan = textLower;
        const sesi = state.sesiTikTok[senderId];
        const data = sesi.data;
        clearTimeout(sesi.timer);

        if (pilihan.startsWith('!') && pilihan !== '!batal') {
            delete state.sesiTikTok[senderId];
            // Jatuh ke handler lain
        } else if (pilihan === 'batal' || pilihan === 'cancel') {
            delete state.sesiTikTok[senderId];
            kembalikanLimit(senderId);
            await reply('Nn... Ekstraksi dibatalkan.');
            return true;
        } else {
            try {
                if (sesi.isImage) {
                    if (pilihan === '1') {
                        await reply(`Nn... Mengirim ${data.images.length} gambar...`);
                        for (let i = 0; i < data.images.length; i++) await sock.sendMessage(from, { image: { url: data.images[i] }, caption: `Gambar ${i + 1}/${data.images.length}` });
                    }
                    else if (pilihan === '2') { await reply('Nn... Mengamankan audio...'); await sock.sendMessage(from, { audio: { url: data.music }, mimetype: 'audio/mp4' }); }
                    else if (!isNaN(pilihan) && parseInt(pilihan) >= 3 && parseInt(pilihan) <= (data.images.length + 2)) {
                        const i = parseInt(pilihan) - 3;
                        await reply(`Nn... Mengamankan gambar urutan ke-${i + 1}...`);
                        await sock.sendMessage(from, { image: { url: data.images[i] } });
                    }
                    else { await reply(`Nn... Pilihan tidak valid.`); return true; }
                } else {
                    if (pilihan === '1') { await reply('Nn... Mengirim video...'); await sock.sendMessage(from, { video: { url: data.play }, caption: 'Nn... Video tanpa watermark.' }); }
                    else if (pilihan === '2') { await reply('Nn... Mengirim audio...'); await sock.sendMessage(from, { audio: { url: data.music }, mimetype: 'audio/mp4' }); }
                    else if (pilihan === '3') {
                        await reply('Nn... Mengirim video dan audio...');
                        await sock.sendMessage(from, { video: { url: data.play } });
                        await sock.sendMessage(from, { audio: { url: data.music }, mimetype: 'audio/mp4' });
                    }
                    else { await reply('Nn... Pilihan tidak valid. Pilih 1, 2, atau 3.'); return true; }
                }
                delete state.sesiTikTok[senderId];
                return true;
            } catch (error) { delete state.sesiTikTok[senderId]; kembalikanLimit(senderId); await reply('Nn... Gagal mengunduh.'); return true; }
        }
    }

    // ==========================================
    // HANDLER SESI WAIFU (INTERAKTIF)
    // ==========================================
    if (state.sesiWaifu[senderId]) {
        const pilihan = textLower;
        if (pilihan.startsWith('!')) {
            delete state.sesiWaifu[senderId];
            // Jatuh ke handler lain
        } else {
            if (!cekDanPotongLimit(senderId)) { delete state.sesiWaifu[senderId]; await reply('Nn... Token habis.'); return true; }
            const queryTersimpan = state.sesiWaifu[senderId].query;
            if (pilihan === 'batal' || pilihan === 'cancel') { delete state.sesiWaifu[senderId]; kembalikanLimit(senderId); await reply('Nn... Operasi dibatalkan.'); return true; }

            try {
                const { dbPremium } = require('../config/db');
                const isPremium = dbPremium[senderId] && (dbPremium[senderId] === true || dbPremium[senderId] > Date.now());
                const isNsfw = pilihan === 'nsfw' || pilihan === '2';
                
                if (isNsfw && !isPremium && !isOwner) {
                    delete state.sesiWaifu[senderId]; kembalikanLimit(senderId);
                    await reply('❌ Nn... Mode NSFW (R-18) dikunci secara eksklusif untuk pengguna *VIP Premium*.\n\nKetik *!premium* untuk berlangganan.');
                    return true;
                }

                await reply(`Nn... Memuat data *${queryTersimpan.replace(/_/g, ' ')}*...`);
                const response = await axios.get(`https://danbooru.donmai.us/posts.json?tags=${queryTersimpan}+${isNsfw ? 'rating:e' : 'rating:g'}&limit=40`, { httpsAgent: new https.Agent({ rejectUnauthorized: false }) });
                const results = response.data.filter(post => post.file_url || post.large_file_url);
                delete state.sesiWaifu[senderId];

                if (results.length === 0) { await reply('Nn... Visual tidak ditemukan.'); return true; }
                const imageUrl = results[Math.floor(Math.random() * results.length)].file_url || results[Math.floor(Math.random() * results.length)].large_file_url;
                await sock.sendMessage(from, { image: { url: imageUrl }, caption: `*Target:* ${queryTersimpan.replace(/_/g, ' ')}` });
            } catch (error) { delete state.sesiWaifu[senderId]; await reply('Nn... Terjadi malfungsi Danbooru.'); }
            return true;
        }
    }

    // ==========================================
    // HANDLER SESI PIXIV (INTERAKTIF)
    // ==========================================
    if (state.sesiPixiv[senderId]) {
        const pilihan = textLower;
        if (pilihan.startsWith('!') && pilihan !== '!next') {
            delete state.sesiPixiv[senderId];
            // Jatuh ke handler lain
        } else if (pilihan === '!next' || pilihan === 'next') {
            if (!state.sesiPixiv[senderId].data) { await reply('Nn... Pilih SFW atau NSFW dulu.'); return true; }
            state.sesiPixiv[senderId].index += 1;
            const idx = state.sesiPixiv[senderId].index;
            const illusts = state.sesiPixiv[senderId].data;
            const isNsfw = state.sesiPixiv[senderId].isNsfw;
            if (idx >= illusts.length) { delete state.sesiPixiv[senderId]; await reply('Nn... Arsip gambar sudah habis.'); return true; }

            try {
                await reply('Nn... Memuat gambar selanjutnya...');
                const targetIllust = illusts[idx];
                const imgRes = await axios.get(targetIllust.image_urls.large || targetIllust.image_urls.medium, { responseType: 'arraybuffer', headers: { 'Referer': 'https://app-api.pixiv.net/' } });
                await sock.sendMessage(from, { image: Buffer.from(imgRes.data), caption: `*Title:* ${targetIllust.title}\n*Artist:* ${targetIllust.user.name}\n*Mode:* ${isNsfw ? 'NSFW 🔴' : 'SFW 🟢'}\n*Gambar:* ${idx + 1}/${illusts.length}\n\nNn... Ketik *!next* lagi jika kurang.` });
            } catch (error) { await reply('Nn... Gagal memuat gambar ini. Ketik *!next* lagi.'); }
            return true;
        }
        else if (!state.sesiPixiv[senderId].data) {
            if (pilihan === 'batal' || pilihan === 'cancel') { delete state.sesiPixiv[senderId]; await reply('Nn... Pencarian dibatalkan.'); return true; }
            const isNsfw = (pilihan === 'nsfw' || pilihan === '2');
            if (pilihan !== 'sfw' && pilihan !== '1' && !isNsfw) { await reply('Nn... Balas dengan *SFW* atau *NSFW*.'); return true; }
            if (!cekDanPotongLimit(senderId)) { delete state.sesiPixiv[senderId]; await reply('Nn... Token habis.'); return true; }

            const { dbPremium } = require('../config/db');
            const isPremium = dbPremium[senderId] && (dbPremium[senderId] === true || dbPremium[senderId] > Date.now());
            if (isNsfw && !isPremium && !isOwner) {
                delete state.sesiPixiv[senderId]; kembalikanLimit(senderId);
                await reply('❌ Nn... Mode NSFW (R-18) dikunci secara eksklusif untuk pengguna *VIP Premium*.\n\nKetik *!premium* untuk berlangganan.');
                return true;
            }

            try {
                await reply(`Nn... Mencari *${state.sesiPixiv[senderId].query}* di server Pixiv...`);

                const searchResult = await pixiv.searchIllust(`${state.sesiPixiv[senderId].query}${state.sesiPixiv[senderId].query.includes('users') ? '' : ' 1000users入り'}`);

                if (!searchResult || !searchResult.illusts || searchResult.illusts.length === 0) {
                    delete state.sesiPixiv[senderId];
                    kembalikanLimit(senderId);
                    await reply('Nn... Tidak ditemukan karya HD atau server Pixiv menolak permintaan kita.');
                    return true;
                }

                let illusts = searchResult.illusts;
                illusts = illusts.filter(img => isNsfw ? (img.x_restrict > 0 || img.tags.some(t => t.name.toLowerCase().includes('r-18'))) : (img.x_restrict === 0 && !img.tags.some(t => t.name.toLowerCase().includes('r-18'))));
                if (illusts.length === 0) { delete state.sesiPixiv[senderId]; kembalikanLimit(senderId); await reply(`Nn... Tidak ada gambar mode ini.`); return true; }

                illusts.sort(() => Math.random() - 0.5);
                state.sesiPixiv[senderId].data = illusts;
                state.sesiPixiv[senderId].index = 0;
                state.sesiPixiv[senderId].isNsfw = isNsfw;

                const imgRes = await axios.get(illusts[0].image_urls.large || illusts[0].image_urls.medium, { responseType: 'arraybuffer', headers: { 'Referer': 'https://app-api.pixiv.net/' } });
                await sock.sendMessage(from, { image: Buffer.from(imgRes.data), caption: `*Title:* ${illusts[0].title}\n*Artist:* ${illusts[0].user.name}\n*Mode:* ${isNsfw ? 'NSFW 🔴' : 'SFW 🟢'}\n*Gambar:* 1/${illusts.length}\n\nNn... Ketik *!next* untuk gambar selanjutnya.` });
            } catch (error) {
                console.error('🚨 ERROR PIXIV SEARCH:', error.message);
                delete state.sesiPixiv[senderId];
                kembalikanLimit(senderId);
                await reply('Nn... Gagal menembus Pixiv. Sesi token mungkin diblokir sementara.');
            }
            return true;
        }
    }

    // ==========================================
    // TIKTOK DOWNLOADER
    // ==========================================
    if (textLower.startsWith('!tiktok ')) {
        const url = textClean.split(' ')[1];
        if (!url) { await reply('Nn... Masukkan link TikTok-nya.'); return true; }
        if (!cekDanPotongLimit(senderId)) { await reply('Nn... Token habis.'); return true; }

        try {
            await reply('Nn... Menganalisis target...');
            const response = await axios.get(`https://www.tikwm.com/api/?url=${url}`);
            if (response.data.code === 0) {
                const data = response.data.data;
                const isImage = data.images && data.images.length > 0;
                const timeoutId = setTimeout(() => {
                    delete state.sesiTikTok[senderId];
                    try { sock.sendMessage(from, { text: 'Nn... Sesi TikTok kedaluwarsa karena Sensei terlalu lama merespons.' }); } catch (e) { }
                }, 120000);

                state.sesiTikTok[senderId] = { isImage: isImage, data: data, timer: timeoutId };

                let teks = `*Data Intel:* ${data.title || 'Tanpa Judul'}\n\nNn... Target adalah ${isImage ? 'gambar' : 'video'}. Pilih metode ekstraksi:\n1️⃣ *Semua Gambar/Video Saja*\n2️⃣ *Sound Saja*\n${isImage ? 'Atau ketik angka 3, 4, dst untuk ambil urutan gambar spesifik.' : '3️⃣ *Video & Sound*'}\n\n_Ketik *batal* membatalkan._`;
                await reply(teks);
            } else { kembalikanLimit(senderId); await reply('Nn... Target tidak ditemukan.'); }
        } catch (error) { kembalikanLimit(senderId); await reply('Nn... Gagal menembus TikTok.'); }
        return true;
    }

    // ==========================================
    // NEKO
    // ==========================================
    if (textLower.startsWith('!neko ')) {
        const kategori = textClean.substring(6).trim().toLowerCase();
        if (!kategori) { await reply('Nn... Masukkan kategori.'); return true; }
        if (!cekDanPotongLimit(senderId)) { await reply('Nn... Token habis.'); return true; }
        try {
            await reply(`Nn... Mencari visual *${kategori}*...`);
            const response = await axios.get(`https://api.nekosia.cat/api/v1/images/${kategori}`);
            await sock.sendMessage(from, { image: { url: response.data.image.original.url }, caption: `*Data Intel:* ${kategori}` });
        } catch (error) { await reply('Nn... Kategori tidak valid di Nekosia.'); }
        return true;
    }

    // ==========================================
    // GACHA PIXIV
    // ==========================================
    if (textLower.startsWith('!gacha')) {
        const isNsfwRequest = textLower.includes('nsfw');
        if (isNsfwRequest) {
            const { dbPremium } = require('../config/db');
            const isPremium = dbPremium[senderId] && (dbPremium[senderId] === true || dbPremium[senderId] > Date.now());
            if (!isPremium && !isOwner) {
                await reply('❌ Nn... Mode *!gacha nsfw* dikunci secara eksklusif untuk pengguna *VIP Premium*.\n\nKetik *!premium* untuk berlangganan.');
                return true;
            }
        }

        if (state.cooldownGacha.has(senderId)) {
            await reply('Nn... Jangan terburu-buru, Sensei. Tunggu 5-10 detik lagi agar server Pixiv tidak memblokir kita.');
            return true;
        }

        if (!cekDanPotongLimit(senderId)) { await reply('Nn... Token habis.'); return true; }

        state.cooldownGacha.add(senderId);
        setTimeout(() => state.cooldownGacha.delete(senderId), 7000);

        try {
            await reply('Nn... Mengundi target visual acak...');

            let gachaTags = ['オリジナル', '猫耳', 'ケモミミ', 'メイド', '制服', '女の子', '初音ミク', '風景'];
            if (isNsfwRequest) {
                gachaTags = ['魅惑の谷間', '極上の女体', '尻神様', '触手', 'おっぱい', 'R-18'];
            }
            const tagPilihan = gachaTags[Math.floor(Math.random() * gachaTags.length)];

            const searchResult = await pixiv.searchIllust(`${tagPilihan} 1000users入り`);

            if (!searchResult || !searchResult.illusts || searchResult.illusts.length === 0) {
                throw new Error('Response Pixiv kosong atau undefined');
            }

            let illusts = searchResult.illusts.filter(img => isNsfwRequest ? (img.x_restrict > 0 || img.tags.some(t => t.name.toLowerCase().includes('r-18'))) : (img.x_restrict === 0 && !img.tags.some(t => t.name.toLowerCase().includes('r-18'))));
            if (illusts.length === 0) throw new Error('Tidak ada ilustrasi yang lolos filter');

            const randomIllust = illusts[Math.floor(Math.random() * illusts.length)];
            const imageUrl = randomIllust.image_urls.large || randomIllust.image_urls.medium;

            const imgRes = await axios.get(imageUrl, {
                responseType: 'arraybuffer',
                headers: { 'Referer': 'https://app-api.pixiv.net/' },
                timeout: 10000
            });

            await sock.sendMessage(from, { image: Buffer.from(imgRes.data), caption: `*Tema Undian:* ${tagPilihan}\n*Artist:* ${randomIllust.user.name}\n\nNn... Berhasil mengamankan target. 🎲` });
        } catch (error) {
            console.error('🚨 ERROR GACHA:', error.message);
            kembalikanLimit(senderId);
            await reply('Nn... Mesin gacha Pixiv sedang sibuk atau token Shiroko dibatasi sementara oleh Pixiv. Coba lagi nanti.');
        }
        return true;
    }

    // ==========================================
    // WAIFU (FIX BUG #5: Gunakan cekDanPotongLimit)
    // ==========================================
    if (textLower.startsWith('!waifu ')) {
        if (!cekDanPotongLimit(senderId)) { await reply('Nn... Token habis.'); return true; }
        const query = textClean.substring(7).trim().replace(/ /g, '_');
        if (!query) { kembalikanLimit(senderId); await reply('Nn... Siapa targetnya?'); return true; }
        state.sesiWaifu[senderId] = { query: query };
        await reply(`Nn... Target *${query.replace(/_/g, ' ')}* dikunci.\nBalas dengan:\n*SFW* atau *NSFW*`);
        return true;
    }

    // ==========================================
    // PIXIV SEARCH (FIX BUG #5: Gunakan cekDanPotongLimit)
    // ==========================================
    if (textLower.startsWith('!pixiv ')) {
        if (!cekDanPotongLimit(senderId)) { await reply('Nn... Token habis.'); return true; }
        const query = textClean.substring(7).trim();
        if (!query) { kembalikanLimit(senderId); await reply('Nn... Apa yang mau dicari? Masukkan query-nya.'); return true; }
        state.sesiPixiv[senderId] = { query: query };
        await reply(`Nn... Target pencarian *${query}* dikunci.\nBalas dengan:\n*SFW* atau *NSFW*`);
        return true;
    }

    return false;
}

module.exports = { handle };
