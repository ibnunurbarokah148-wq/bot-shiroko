// ==========================================
// COMMAND: TOP-UP & OWNER APPROVAL
// Handler: !topup, !beli, !bukti, !acc, !tolak
// ==========================================
const fs = require('fs');
const { ID_OWNER, DAFTAR_PAKET, JATAH_HARIAN } = require('../config/constants');
const { dbLimit, dbRole, simpanDB, simpanRole } = require('../config/db');
const state = require('../config/state');

async function handle(ctx) {
    const { sock, msg, from, senderId, isOwner, textClean, textLower, msgType,
            isQuoted, quotedMsg, quotedType, reply, downloadMediaBaileys } = ctx;

    // ==========================================
    // DAFTAR PAKET TOP-UP
    // ==========================================
    if (textLower === '!topup') {
        let teks = `🏦 *LAYANAN BOT SHIROKO* 🏦\n\nNn... Token Sensei menipis? Ini daftar token yang tersedia:\n\n📦 *Paket 1:* 50 Token - Rp 5.000\n📦 *Paket 2:* 150 Token - Rp 10.000\n📦 *Paket 3:* 500 Token - Rp 25.000\n📦 *Paket 4:* 1500 Token - Rp 50.000\n\nKirim perintah ini untuk membeli:\n*!beli [nomor_paket]*`;
        await reply(teks);
        return true;
    }

    // ==========================================
    // BELI PAKET
    // ==========================================
    if (textLower.startsWith('!beli ')) {
        const pilihan = textClean.split(' ')[1];
        if (!DAFTAR_PAKET[pilihan]) { await reply('Nn... Paket tidak ditemukan.'); return true; }

        const paket = DAFTAR_PAKET[pilihan];
        state.sesiTopup[senderId] = { token: paket.token, harga: paket.harga };

        try {
            let teks = `Nn... Sensei memilih paket *${paket.token} Token* seharga *Rp ${paket.harga.toLocaleString('id-ID')}*.\n\nSilakan transfer ke QRIS ini. Kalau sudah bayar, reply fotonya dengan tulisan *!bukti*.`;
            await sock.sendMessage(from, { image: fs.readFileSync('./qris.jpg'), caption: teks });
        } catch (err) {
            await reply('Nn... Gambar QRIS tidak ditemukan di sistem. Lapor ke Komandan.');
        }
        return true;
    }

    // ==========================================
    // KIRIM BUKTI TRANSFER
    // ==========================================
    if (textLower.startsWith('!bukti')) {
        if (!state.sesiTopup[senderId]) { await reply('Nn... Sensei belum memesan paket logistik. Ketik *!topup* dulu.'); return true; }

        const isTargetImage = msgType === 'imageMessage';
        const isQuotedImage = isQuoted && quotedType === 'imageMessage';

        if (isTargetImage || isQuotedImage) {
            try {
                const messageToDownload = isQuotedImage ? quotedMsg?.imageMessage : msg?.message?.imageMessage;
                if (!messageToDownload) throw new Error("Media tidak ditemukan");

                const mediaBuffer = await downloadMediaBaileys(messageToDownload, 'image');
                const paket = state.sesiTopup[senderId];
                const idOwnerUtama = ID_OWNER[0] + '@s.whatsapp.net';

                let laporan = `🚨 *LAPORAN TRANSAKSI LOGISTIK* 🚨\n\n*ID Pembeli:* ${senderId}\n*Jumlah Token:* ${paket.token}\n*Total Bayar:* Rp ${paket.harga.toLocaleString('id-ID')}\n\nNn... Komandan, periksa mutasi rekening. Silakan Reply pesan ini dengan:\n✅ *!acc*\n❌ *!tolak [alasan]*`;

                await sock.sendMessage(idOwnerUtama, { image: mediaBuffer, caption: laporan });
                await reply('Nn... Bukti transfer sudah diteruskan ke markas komando pusat. Tunggu sebentar ya.');
                delete state.sesiTopup[senderId];
            } catch (error) {
                await reply('Nn... Gagal mengamankan gambar bukti.');
            }
        } else {
            await reply('Nn... Fotonya mana, Sensei? Harus kirim foto bukti transfer dengan caption *!bukti*.');
        }
        return true;
    }

    // ==========================================
    // ACC / TOLAK (Top-Up & Registrasi)
    // ==========================================
    if (textLower === '!acc' || textLower.startsWith('!tolak')) {
        if (!isOwner) { await reply('Nn... Akses ditolak. Tangan di atas kepala! 🔫'); return true; }
        if (!isQuoted) { await reply('Nn... Komandan harus membalas (reply) pesan laporan dari Shiroko.'); return true; }

        const isAcc = textLower === '!acc';
        let alasanTolak = textClean.substring(6).trim() || 'Tidak ada alasan khusus dari komando pusat.';

        const teksLaporan = quotedMsg?.conversation || quotedMsg?.extendedTextMessage?.text || quotedMsg?.imageMessage?.caption || '';

        if (teksLaporan.includes('LAPORAN TRANSAKSI LOGISTIK')) {
            const matchId = teksLaporan.match(/\*ID Pembeli:\*\s*([^\n]+)/);
            if (!matchId) { await reply('Nn... Format laporan tidak dikenali.'); return true; }
            const targetNomor = matchId[1].trim();

            if (isAcc) {
                const matchToken = teksLaporan.match(/\*Jumlah Token:\*\s*(\d+)/);
                const jumlahToken = parseInt(matchToken[1], 10);

                if (dbLimit[targetNomor] === undefined) dbLimit[targetNomor] = JATAH_HARIAN;
                dbLimit[targetNomor] += jumlahToken;
                simpanDB();

                await reply(`✅ *TRANSAKSI BERHASIL*\nNn... Top-up disetujui.\n*Target:* ${targetNomor}\n*Jumlah:* +${jumlahToken} Token`);
                try { await sock.sendMessage(targetNomor, { text: `🏦 *PEMBAYARAN DITERIMA*\n\nNn... Logistik amunisi sebesar *+${jumlahToken} Token* sudah ditambahkan. Saldo: *${dbLimit[targetNomor]}*` }); } catch (err) { }
            } else {
                await reply(`❌ *TRANSAKSI DITOLAK*\nNn... Laporan dikirim ke target.`);
                try { await sock.sendMessage(targetNomor, { text: `⚠️ *PEMBAYARAN DITOLAK*\n\nNn... Dana tidak masuk.\n*Alasan:* ${alasanTolak}` }); } catch (err) { }
            }
        } else if (teksLaporan.includes('PENDAFTARAN USER BARU')) {
            const matchId = teksLaporan.match(/\*ID Pendaftar:\*\s*([^\n]+)/);
            const matchRole = teksLaporan.match(/\*Role Diminta:\*\s*([^\n]+)/);
            const matchNama = teksLaporan.match(/\*Nama:\*\s*([^\n]+)/);

            if (!matchId || !matchRole) { await reply('Nn... Format laporan registrasi tidak dikenali.'); return true; }

            const targetNomor = matchId[1].trim();
            const targetRole = matchRole[1].trim().toLowerCase();
            const targetNama = matchNama[1] ? matchNama[1].trim() : 'User';

            if (isAcc) {
                dbRole[targetNomor] = { role: targetRole, nama: targetNama, bank_soal: [] };
                simpanRole();
                await reply(`✅ *REGISTRASI BERHASIL*\nNn... Otoritas diberikan.\n*Target:* ${targetNomor}`);
                try { await sock.sendMessage(targetNomor, { text: `🎓 *AKSES DIBERIKAN* 🎓\n\nNn... Halo ${targetNama}, Komando Pusat menyetujui aksesmu sebagai *${targetRole.toUpperCase()}*.` }); } catch (err) { }
            } else {
                await reply(`❌ *REGISTRASI DITOLAK*`);
                try { await sock.sendMessage(targetNomor, { text: `⚠️ *REGISTRASI DITOLAK*\n\nNn... Maaf, permohonan akses LMS ditolak.\n*Alasan:* ${alasanTolak}` }); } catch (err) { }
            }
        } else {
            await reply('Nn... Laporan apa ini Komandan? Format tidak sesuai protokol.');
        }
        return true;
    }

    return false;
}

module.exports = { handle };
