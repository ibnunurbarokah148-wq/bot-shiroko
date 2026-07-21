// ==========================================
// COMMAND: MANAJEMEN TUGAS PRIBADI
// Handler: !simpan_tugas, !tugas, !list_tugas, !hapus_tugas
// ==========================================
const { dbTugas, simpanTugas } = require('../config/db');

async function handle(ctx) {
    const { senderId, textClean, textLower, reply } = ctx;

    if (textLower.startsWith('!simpan_tugas ')) {
        const isiTugas = textClean.substring(14).trim();
        if (!isiTugas) { await reply('Nn... Format salah.'); return true; }
        if (!dbTugas[senderId]) dbTugas[senderId] = [];
        dbTugas[senderId].push(isiTugas);
        simpanTugas();
        await reply(`✅ *TUGAS DISIMPAN*\n\nTotal tugas tersimpan: *${dbTugas[senderId].length}*.`);
        return true;
    }

    if (textLower === '!tugas' || textLower === '!list_tugas') {
        const listTugas = dbTugas[senderId] || [];
        if (listTugas.length === 0) { await reply('Nn... Brankas tugasmu masih kosong.'); return true; }
        let teks = `🎒 *BRANKAS TUGAS PRIBADI* 🎒\n\n`;
        listTugas.forEach((tugas, index) => { teks += `*${index + 1}.* ${tugas}\n\n`; });
        await reply(teks);
        return true;
    }

    if (textLower.startsWith('!hapus_tugas ')) {
        const index = parseInt(textClean.split(' ')[1]) - 1;
        const listTugas = dbTugas[senderId] || [];
        if (isNaN(index) || index < 0 || index >= listTugas.length) { await reply('Nn... Nomor tidak ditemukan.'); return true; }
        listTugas.splice(index, 1);
        dbTugas[senderId] = listTugas;
        simpanTugas();
        await reply(`🗑️ *TUGAS DIHAPUS*\n\nCatatan tugas berhasil dihapus.`);
        return true;
    }

    return false;
}

module.exports = { handle };
