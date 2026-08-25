const { dbPremium } = require('../config/db');
const state = require('../config/state');
const { makeDynamicQris } = require('../utils/qris');

async function handle(ctx) {
    const { textLower, reply, senderId, sock, from } = ctx;

    if (textLower === '!premium') {
        const dbEntry = dbPremium[senderId];
        const isPremium = dbEntry && (typeof dbEntry === 'boolean' || dbEntry > Date.now());
        
        let statusTeks = isPremium 
            ? `🟢 *Status:* AKTIF\n⏳ *Berakhir Pada:* ${new Date(dbEntry).toLocaleString('id-ID')}`
            : `🔴 *Status:* NON-AKTIF`;

        const teks = `👑 *LAYANAN SHIROKO PREMIUM* 👑\n\n${statusTeks}\n\nNn... Jadilah Sensei VIP untuk mendapatkan fitur eksklusif!\n\n💳 *Biaya:* Rp 15.000 / Bulan\n\n✨ *Keuntungan Premium:*\n1. Limit Harian Ekstra Besar (1.000 Token / Hari)\n2. Akses terbatas ke model Premium Xkiro (biaya limit per request)\n3. Akses ke mesin ComfyUI (Tanpa antrean / VIP)\n4. Akses mode NSFW untuk semua visual (Waifu, Pixiv, Gacha)\n5. Fitur *!kepo* (Snipe / melihat pesan yang baru saja dihapus di grup)\n\nKetik:\n*!premium beli* -> Untuk mulai berlangganan.`;
        
        await reply(teks);
        return true;
    }

    if (textLower === '!premium beli') {
        state.sesiPremium[senderId] = true;
        try {
            const staticQris = process.env.STATIC_QRIS;
            if (!staticQris) {
                throw new Error('STATIC_QRIS not set in .env');
            }
            const dynamicQris = makeDynamicQris(staticQris, 15000);
            const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=10&data=${encodeURIComponent(dynamicQris)}`;
            
            let teks = `Nn... Silakan scan QRIS di atas sebesar *Rp 15.000* untuk berlangganan Premium 1 Bulan (nominal akan otomatis terkunci saat di-scan).\n\nJika sudah melakukan pembayaran, kirim/reply screenshot struk pembayaran dengan caption *!bukti*.`;
            await sock.sendMessage(from, { image: { url: qrImageUrl }, caption: teks });
        } catch (err) {
            console.error('Error generating dynamic QRIS for Premium:', err.message);
            await reply('Nn... Terjadi kegagalan saat membuat kode QRIS otomatis. Silakan lapor ke Komandan.');
        }
        return true;
    }

    return false;
}

module.exports = { handle };
