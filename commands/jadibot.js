const { dbJadibot } = require('../config/db');
const { startJadibot, stopJadibot } = require('../services/jadibot.service');
const state = require('../config/state');
const fs = require('fs');

async function handle(ctx) {
    const { textLower, textClean, reply, senderId, sock, from } = ctx;

    if (textLower === '!jadibot') {
        const teks = `🤖 *LAYANAN JADIBOT SHIROKO* 🤖\n\nNn... Sensei ingin punya bot WhatsApp sendiri dengan kemampuan Shiroko? Bisa!\n\n💳 *Biaya:* Rp 20.000 (Sewa 30 Hari)\n\nKetik:\n*!jadibot beli* -> Untuk membayar via QRIS\n*!jadibot [nomor_wa]* -> Untuk menyambungkan nomor jika sudah membayar (contoh: *!jadibot 6281234567890*)\n*!stopbot* -> Untuk mematikan bot-mu`;
        await reply(teks);
        return true;
    }

    if (textLower === '!jadibot beli') {
        const dbEntry = dbJadibot[senderId];
        const isPremium = dbEntry && (typeof dbEntry === 'boolean' || dbEntry > Date.now());
        if (isPremium) {
            await reply('Nn... Sensei masih memiliki masa aktif Jadibot. Silakan langsung ketik *!jadibot [nomormu]*');
            return true;
        }

        state.sesiJadibot[senderId] = true;
        try {
            const staticQris = process.env.STATIC_QRIS;
            if (!staticQris) {
                throw new Error('STATIC_QRIS not set in .env');
            }
            const { makeDynamicQris } = require('../utils/qris');
            const dynamicQris = makeDynamicQris(staticQris, 20000);
            const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=10&data=${encodeURIComponent(dynamicQris)}`;

            let teks = `Nn... Silakan scan QRIS di atas sebesar *Rp 20.000* untuk sewa Jadibot 30 Hari (nominal akan otomatis terkunci saat di-scan).\n\nJika sudah melakukan pembayaran, kirim/reply screenshot struk pembayaran dengan caption *!bukti*.`;
            await sock.sendMessage(from, { image: { url: qrImageUrl }, caption: teks });
        } catch (err) {
            console.error('Error generating dynamic QRIS for Jadibot:', err.message);
            await reply('Nn... Terjadi kegagalan saat membuat kode QRIS otomatis. Silakan lapor ke Komandan.');
        }
        return true;
    }

    if (textLower.startsWith('!jadibot ')) {
        const dbEntry = dbJadibot[senderId];
        const isPremium = dbEntry && (typeof dbEntry === 'boolean' || dbEntry > Date.now());
        if (!isPremium) {
            await reply('Nn... Sensei belum membeli atau masa aktif lisensi Jadibot sudah habis. Ketik *!jadibot beli* dulu.');
            return true;
        }

        const nomorTelepon = textClean.split(' ')[1];
        if (!nomorTelepon || nomorTelepon.length < 10) {
            await reply('Nn... Format nomor salah. Contoh: *!jadibot 6281234567890*');
            return true;
        }

        await reply(`Nn... Menyiapkan sistem untuk nomor ${nomorTelepon}. Mohon tunggu sebentar...`);
        startJadibot(senderId, nomorTelepon, reply);
        return true;
    }

    if (textLower === '!stopbot') {
        const dbEntry = dbJadibot[senderId];
        const isPremium = dbEntry && (typeof dbEntry === 'boolean' || dbEntry > Date.now());
        if (!isPremium) {
            await reply('Nn... Sensei belum punya jadibot.');
            return true;
        }

        const stopped = stopJadibot(senderId);
        if (stopped) {
            await reply('Nn... Bot-mu sudah dimatikan dan logout.');
        } else {
            await reply('Nn... Bot-mu sedang tidak aktif.');
        }
        return true;
    }

    return false;
}

module.exports = { handle };
