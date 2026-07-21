// ==========================================
// PIXIV SERVICE — Login & Auto Refresh Token
// ==========================================
const PixivApi = require('pixiv-api-client');

const pixiv = new PixivApi();

async function loginPixiv() {
    try {
        if (!process.env.PIXIV_REFRESH_TOKEN) return;
        await pixiv.refreshAccessToken(process.env.PIXIV_REFRESH_TOKEN);
        console.log("✅ Berhasil menembus server Pixiv! Token aktif.");
    } catch (err) {
        console.error("❌ Gagal login Pixiv:", err.message);
    }
}

// Login awal saat modul di-require
loginPixiv();

// Refresh token otomatis tiap 1 jam
setInterval(loginPixiv, 3600000);

module.exports = { pixiv };
