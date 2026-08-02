// ==========================================
// COMMAND: GENERAL — Menu, Ping, Cekid, Limit, Nak Coba
// ==========================================
const { ID_OWNER, JATAH_HARIAN } = require('../config/constants');
const { dbLimit, dbRole, dbCoba, simpanCoba } = require('../config/db');
const prayerService = require('../services/prayer.service');

async function handle(ctx) {
    const { senderId, isOwner, textClean, textLower, msg, reply } = ctx;

    // ==========================================
    // CEK ID
    // ==========================================
    if (textLower === '!cekid') {
        let teks = `🔍 *DIAGNOSTIK SISTEM BAILEYS*\n\n*ID Anda:* ${senderId}\n*Status:* ${isOwner ? '👑 OWNER (UNLIMITED)' : '👤 USER BIASA'}\n\n_Nn... Jika token habis, kirim ID Anda kepada Owner._`;
        await reply(teks);
        return true;
    }

    // ==========================================
    // LIMIT
    // ==========================================
    if (textLower === '!limit') {
        if (isOwner) {
            await reply('Nn... Sensei adalah Owner. Token Sensei Unlimited. 🌟');
            return true;
        }
        let sisa = dbLimit[senderId] !== undefined ? dbLimit[senderId] : JATAH_HARIAN;
        await reply(`Nn... Sisa token taktis Sensei hari ini adalah: *${sisa} token*.`);
        return true;
    }

    // ==========================================
    // PING
    // ==========================================
    if (textLower === '!ping') {
        await reply('Nn... Pong. Shiroko standby via Baileys, Sensei.');
        return true;
    }

    // KONTROL MINECRAFT DIPINDAHKAN KE commands/minecraft.js

    // ==========================================
    // NAK COBA (dari Website)
    // ==========================================
    if (textLower === 'nak coba') {
        if (dbCoba[senderId]) {
            await reply(`Nn... Sensei, kamu kan sudah pernah menyapa Shiroko sebelumnya. Jangan diulang terus ya, nanti memorinya penuh. ✨`);
            return true;
        }
        dbCoba[senderId] = true;
        simpanCoba();
        await reply(`Nn... Halo Sensei! Selamat datang di sistem komunikasi Shiroko. 🐺✨\n\nTerima kasih sudah berkunjung dari website resmi kami. Shiroko siap membantu segala keperluan Sensei di sini.\n\nKetik *!menu* untuk melihat perlengkapan taktis Shiroko.`);
        return true;
    }

    // ==========================================
    // JADWAL SALAT & IMSAKIYAH (PRESISI BEKASI)
    // ==========================================
    if (['!jadwal', '!jadwalsholat', '!sholat', '!jadwalsalat', '!salat'].includes(textLower)) {
        const scheduleMsg = await prayerService.getFormattedPrayerSchedule();
        await reply(scheduleMsg);
        return true;
    }

    // ==========================================
    // MENU UTAMA BOT
    // ==========================================
    if (textLower === '!menu' || textLower === '!fitur') {
        const namaProfilWa = msg.pushName || (isOwner ? 'Owner' : 'Sensei');
        const namaUser = dbRole[senderId] ? dbRole[senderId].nama : namaProfilWa;
        const sisaLimit = dbLimit[senderId] !== undefined ? dbLimit[senderId] : JATAH_HARIAN;

        let roleUser = 'User Biasa';
        if (isOwner) {
            roleUser = '👑 Owner';
        } else if (dbRole[senderId]) {
            roleUser = '🎓 ' + dbRole[senderId].role.charAt(0).toUpperCase() + dbRole[senderId].role.slice(1);
        }

        const teksMenu = `*╔═══「 INFORMASI USER 」*
*║* \`\`\`Nama     : ${namaUser}\`\`\`
*║* \`\`\`Limit    : ${sisaLimit}\`\`\`
*║* \`\`\`Role     : ${roleUser}\`\`\`
*╚════════════════════*

_Command yang ditandai dengan backtick ( \` ) memakan Token Limit_

*╔═══「 AI ASSISTANT 」*
*║* ➸ \`!shiroko [pesan]\`
*║* ➸ \`!shiroko_pintar [tanya]\`
*║* ➸ !aimode [mode] (Ganti Otak AI)
*║* ➸ !jadwal (Jadwal Salat & Imsakiyah)
*║* ➸ !lupa (Reset Memori AI)
*║* ➸ !limit (Cek Sisa Limit)
*║* ➸ !ping (Cek Status Bot)
*║* ➸ !cekid (Cek ID WA & Role)
*║*
*╠═══「 LMS & EVALUASI 」*
*║* ➸ !reg_guru
*║* ➸ !reg_siswa
*║* ➸ !resign
*║* ➸ !tambah_soal
*║* ➸ !list_soal
*║* ➸ !hapus_soal
*║* ➸ \`!ujian [ID]\`
*║*
*╠═══「 KEPANITIAAN 」*
*║* ➸ !divisi [nama]
*║* ➸ !daftar_anggota
*║* ➸ !daftar_tugas
*║* ➸ !tambah_panitia
*║* ➸ !cabut_divisi
*║* ➸ !tambah_tugas
*║* ➸ !selesai_tugas
*║*
*╠═══「 MANAJEMEN TUGAS 」*
*║* ➸ !simpan_tugas
*║* ➸ !tugas
*║* ➸ !hapus_tugas
*║*
*╠═══「 AKADEMIK 」*
*║* ➸ \`!karyailmiah\`
*║* ➸ \`!jurnal [topik]\`
*║* ➸ \`!para [teks]\`
*║* ➸ \`!ringkas\` (Reply Teks)
*║* ➸ \`!ide\` (Ide Karya Ilmiah)
*║*
*╠═══「 EKSEKUSI MEDIA 」*
*║* ➸ \`!gambar [prompt]\` (AI Image Generator)
*║* ➸ \`!tts [teks]\` (Ubah Teks ke Suara/VN)
*║* ➸ \`!pdf2jpg\` (Reply PDF)
*║* ➸ \`!stiker\` (Kirim Gambar)
*║* ➸ \`!toimg\` (Reply Stiker)
*║* ➸ \`!meme [teks]\` (Reply Gambar)
*║* ➸ \`!tiktok [link]\` (Download Video/Audio)
*║* ➸ \`!dengar\` (Reply VN ke Teks)
*║*
*╠═══「 DATA INTEL 」*
*║* ➸ \`!pixiv [query]\`
*║* ➸ \`!waifu [nama]\`
*║* ➸ \`!gacha\`
*║* ➸ \`!neko [kategori]\`
*║*
*╠═══「 LAYANAN PREMIUM & BOT 」*
*║* ➸ !premium (Info VIP Premium)
*║* ➸ !topup (Beli Token Limit)
*║* ➸ !bukti (Upload Struk Topup)
*║* ➸ !jadibot (Sewa Bot Waifu)
*║* ➸ !stopbot (Hentikan Jadibot)
*║* ➸ \`!kepo\` (Ghost Mode Messages VIP)
*║*
*╠═══「 KHUSUS OWNER 」*
*║* ➸ !mc start (Nyalakan Bot MC)
*║* ➸ !mc stop (Matikan Bot MC)
*║* ➸ !mc status (Cek Status Bot MC)
*║* ➸ !mc chat [teks] (Kirim Chat MC)
*║*
*╚═══▼△▼△▼△▼△▼*`;

        await reply(teksMenu);
        return true;
    }

    return false;
}

module.exports = { handle };
