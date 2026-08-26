// ==========================================
// COMMAND: GENERAL — Menu, Ping, Cekid, Limit, Nak Coba
// ==========================================
const { ID_OWNER, JATAH_HARIAN } = require('../config/constants');
const { dbLimit, dbRole, dbCoba, simpanCoba } = require('../config/db');
const prayerService = require('../services/prayer.service');
const afkService = require('../services/afk.service');

async function handle(ctx) {
    const { sock, senderId, isOwner, isGroup, from, textClean, textLower, msg, reply } = ctx;

    // ==========================================
    // AFK GRUP
    // ==========================================
    if (isGroup && textLower === '!afklist') {
        const rows = afkService.list(from);
        if (!rows.length) { await reply('Nn... Tidak ada anggota yang sedang AFK.'); return true; }
        await sock.sendMessage(from, { text: `*DAFTAR AFK GRUP*\n\n${rows.map((row, i) => `${i + 1}. @${row.userJid.split('@')[0]} — ${row.reason} (${afkService.formatDuration(row.since)})`).join('\n')}`, mentions: rows.map(row => row.userJid) }, { quoted: msg });
        return true;
    }
    if (isGroup && (textLower === '!afk' || textLower.startsWith('!afk '))) {
        const reason = textClean.substring(4).trim() || 'Sedang AFK';
        afkService.set(from, senderId, reason);
        await reply(`Nn... Status AFK aktif: *${reason}*`);
        return true;
    }
    if (isGroup && textLower === '!back') {
        if (afkService.get(from, senderId)) {
            afkService.clear(ctx.from, senderId);
            await reply('Nn... Selamat datang kembali. Status AFK dihapus.');
        } else await reply('Nn... Kamu tidak sedang AFK.');
        return true;
    }

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
*║* ➸ !aimode [mode] (Ganti Otak AI; !aimode arisu untuk pilih model)
*║* ➸ !jadwal (Jadwal Salat & Imsakiyah)
*║* ➸ !lupa (Reset Memori AI)
*║* ➸ !limit (Cek Sisa Limit)
*║* ➸ !ping (Cek Status Bot)
*║* ➸ !cekid (Cek ID WA & Role)
*║* ➸ !bini / !mybini / !gantiwaifu (Pilih karakter waifu)
*║* ➸ !waifustatus / !stopwaifu
${isOwner ? `*║* ➸ !mood (Lihat Mood Shiroko)\n*║* ➸ !resetmood (Reset Mood Shiroko)\n` : ''}*║*
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
*║* ➸ !daftar_anggota / !list_anggota
*║* ➸ !daftar_tugas / !list_tugas_panitia
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
*║* ➸ \`!ringkas [teks]\` (Ringkas Teks)
*║* ➸ \`!ide\` (Ide Karya Ilmiah)
*║*
*╠═══「 EKSEKUSI MEDIA 」*
*║* ➸ \`!gambar [prompt]\` (AI Image Generator)
*║* ➸ \`!pixai [prompt]\` (PixAI Anime Generator)
*║* ➸ !cekpixai (Cek Status Token Pool PixAI)
*║* ➸ !buatpixai [email] [pass] (Generate API Token PixAI)
*║* ➸ \`!tts / !suara [teks]\` (Ubah Teks ke Suara/VN)
*║* ➸ \`!pdf2jpg\` (Reply PDF)
*║* ➸ \`!stiker\` (Kirim Gambar)
*║* ➸ \`!wm [teks]\` (Reply Foto/Stiker)
*║* ➸ \`!hd [2x/4x]\` (Reply Foto)
*║* ➸ \`!toimg\` (Reply Stiker)
*║* ➸ \`!meme [teks]\` (Reply Gambar)
*║* ➸ \`!tiktok [link]\` (Download Video/Audio)
*║* ➸ \`!dengar / !transkrip\` (Reply VN ke Teks)
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
*╠═══「 FITUR GRUP 」*
*║* ➸ !chat [pesan] (Chat waifu di grup)
*║* ➸ !afk [alasan] / !back / !afklist
*║* ➸ !warn / !warnings / !unwarn / !resetwarn
*║* ➸ !setwarnlimit [angka]
*║* ➸ !autokickwarn on/off
*║* ➸ !antispam on/off/status
*║* ➸ !antispam limit/window/action
*║* ➸ !antilink on/off/status
*║* ➸ !antilink whitelist add/del/list
*║* ➸ !welcome on/off / !goodbye on/off
*║* ➸ !welcome card/text
*║* ➸ !setwelcome / !setgoodbye [teks]
*║* ➸ !tagall / !hidetag [pesan]
*║* ➸ !infogc / !listadmin
*║* ➸ !closegc / !opengc
*║*
*╠═══「 KHUSUS OWNER 」*
*║* ➸ !setpixai [token] (Set Token PixAI Manual)
*║* ➸ !mc start (Nyalakan Bot MC Online)
*║* ➸ !mc lokal (Nyalakan Bot MC Server Lokal)
*║* ➸ !mc stop (Matikan Bot MC)
*║* ➸ !mc status (Cek Status & Mode Bot MC)
*║* ➸ !mc chat [teks] (Kirim Chat MC)
*║* ➸ !mc server (Cek Server MC)
*║* ── Alarm & Pengingat Salat ──
*║* ➸ !alarmstatus (Status Alarm Owner)
*║* ➸ !testsubuh / !testsalat (Tes Alarm Owner)
*║* ➸ !aktifkanalarm / !matikanalarm
*║*
*╚═══▼△▼△▼△▼△▼*`;

        await reply(teksMenu);
        return true;
    }

    return false;
}

module.exports = { handle };
