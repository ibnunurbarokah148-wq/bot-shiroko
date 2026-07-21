// ==========================================
// COMMAND: KEPANITIAAN AGUSTUSAN
// Handler: !tambah_panitia, !cabut_divisi, !tambah_tugas (panitia),
//          !selesai_tugas, !divisi, !daftar_anggota, !daftar_tugas, !list_tugas_panitia
// ==========================================
const { dbPanitia, simpanPanitia } = require('../config/db');

async function handle(ctx) {
    const { senderId, isOwner, textClean, textLower, reply } = ctx;

    if (textLower.startsWith('!tambah_panitia ')) {
        if (!isOwner) { await reply('Nn... Akses ditolak.'); return true; }
        const args = textClean.substring(16).trim().split(' ');
        const divisi = args[0].toLowerCase();
        const namaAnggota = args.slice(1).join(' ');

        if (!dbPanitia[divisi]) { await reply('Nn... Divisi tidak ditemukan.'); return true; }
        dbPanitia[divisi].anggota.push(namaAnggota);
        simpanPanitia();
        await reply(`✅ *PANITIA DIURUTKAN*\n\nNn... *${namaAnggota}* resmi dimasukkan ke **Divisi ${divisi.toUpperCase()}**.`);
        return true;
    }

    if (textLower.startsWith('!cabut_divisi ')) {
        if (!isOwner) { await reply('Nn... Akses ditolak.'); return true; }
        const args = textClean.substring(14).trim().split(' ');
        const divisi = args[0].toLowerCase();
        const namaAnggota = args.slice(1).join(' ');

        if (!dbPanitia[divisi]) { await reply('Nn... Divisi tidak terdaftar.'); return true; }
        const indexAnggota = dbPanitia[divisi].anggota.findIndex(nama => nama.toLowerCase() === namaAnggota.toLowerCase());

        if (indexAnggota === -1) { await reply(`Nn... Tidak ada anggota bernama *${namaAnggota}*.`); return true; }
        dbPanitia[divisi].anggota.splice(indexAnggota, 1);
        simpanPanitia();
        await reply(`🗑️ *FORMASI DIPERBARUI*\n\nNn... *${namaAnggota}* telah dicabut dari **Divisi ${divisi.toUpperCase()}**.`);
        return true;
    }

    if (textLower.startsWith('!tambah_tugas ')) {
        if (!isOwner) { await reply('Nn... Akses khusus pimpinan panitia.'); return true; }
        const konten = textClean.substring(14).trim();
        const bagian = konten.split('|');
        if (bagian.length < 3) { await reply('Nn... Format salah.\nContoh: *!tambah_tugas acara | Sewa Panggung Utama | 1 Agustus - 10 Agustus*'); return true; }

        const divisi = bagian[0].trim().toLowerCase();
        if (!dbPanitia[divisi]) { await reply('Nn... Divisi tidak valid.'); return true; }
        dbPanitia[divisi].timeline.push({ tugas: bagian[1].trim(), deadline: bagian[2].trim(), status: "❌ Belum" });
        simpanPanitia();
        await reply(`📅 *TIMELINE BARU DITAMBAHKAN*`);
        return true;
    }

    if (textLower.startsWith('!selesai_tugas ')) {
        if (!isOwner) { await reply('Nn... Akses ditolak.'); return true; }
        const args = textClean.split(' ');
        const divisi = args[1].toLowerCase();
        const idx = parseInt(args[2]) - 1;

        if (!dbPanitia[divisi] || isNaN(idx) || !dbPanitia[divisi].timeline[idx]) { await reply('Nn... Data tidak ditemukan.'); return true; }
        dbPanitia[divisi].timeline[idx].status = "✅ Selesai";
        simpanPanitia();
        await reply(`🎉 *PROGRESS UPDATE*\n\nTugas Ke-${idx + 1} dinyatakan *SELESAI*.`);
        return true;
    }

    if (textLower.startsWith('!divisi ')) {
        const divisi = textLower.substring(8).trim().toLowerCase();
        if (!dbPanitia[divisi]) { await reply('Nn... Divisi tidak terdaftar.'); return true; }

        const dataDivisi = dbPanitia[divisi];
        let teks = `🇮🇩 *RADAR OPERASIONAL: DIVISI ${divisi.toUpperCase()}* 🇮🇩\n\n👥 *DAFTAR ANGGOTA:* \n`;
        if (dataDivisi.anggota.length === 0) teks += `_Belum ada anggota._\n`;
        else dataDivisi.anggota.forEach((nama, i) => { teks += `${i + 1}. ${nama}\n`; });

        teks += `\n━━━━━━━━━━━━━━━━━━━━\n\n📅 *TIMELINE & DEADLINE:* \n`;
        if (dataDivisi.timeline.length === 0) teks += `_Belum ada tugas._\n`;
        else dataDivisi.timeline.forEach((item, i) => { teks += `*${i + 1}. ${item.tugas}*\n⏱️ Rentang: _${item.deadline}_\n📊 Status: ${item.status}\n\n`; });
        await reply(teks);
        return true;
    }

    if (textLower === '!daftar_anggota' || textLower === '!list_anggota') {
        let teks = `🇮🇩 *STRUKTUR BESAR PANITIA AGUSTUSAN* 🇮🇩\n\n`;
        let totalPanitia = 0;
        Object.keys(dbPanitia).forEach(divisi => {
            teks += `👥 *DIVISI: ${divisi.toUpperCase()}*\n`;
            if (dbPanitia[divisi].anggota.length === 0) teks += `_• Kosong_\n`;
            else dbPanitia[divisi].anggota.forEach((nama, i) => { teks += `${i + 1}. ${nama}\n`; totalPanitia++; });
            teks += `\n`;
        });
        teks += `📈 *Total Personel:* ${totalPanitia} Orang`;
        await reply(teks);
        return true;
    }

    if (textLower === '!daftar_tugas' || textLower === '!list_tugas_panitia') {
        let teks = `🇮🇩 *PAPAN MONITORING TUGAS AGUSTUSAN* 🇮🇩\n\n`;
        let totalTugas = 0, tugasSelesai = 0;
        Object.keys(dbPanitia).forEach(divisi => {
            teks += `📢 *DIVISI: ${divisi.toUpperCase()}*\n`;
            const listTimeline = dbPanitia[divisi].timeline;
            if (listTimeline.length === 0) teks += `_• Kosong_\n`;
            else listTimeline.forEach((item, i) => {
                teks += `${i + 1}. [${item.status}] ${item.tugas}\n   ⏱️ Durasi: _${item.deadline}_\n`;
                totalTugas++;
                if (item.status.includes('✅')) tugasSelesai++;
            });
            teks += `\n`;
        });
        const persentase = totalTugas > 0 ? Math.round((tugasSelesai / totalTugas) * 100) : 0;
        teks += `━━━━━━━━━━━━━━━━━━━━\n📊 *Total Progress:* ${tugasSelesai}/${totalTugas} Tugas Selesai (${persentase}%)`;
        await reply(teks);
        return true;
    }

    return false;
}

module.exports = { handle };
