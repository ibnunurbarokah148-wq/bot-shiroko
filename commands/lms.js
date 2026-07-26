// ==========================================
// COMMAND: LMS & EVALUASI
// Handler: !reg_guru, !reg_siswa, !submit_reg, !tambah_soal, !list_soal,
//          !hapus_soal, !ujian, !resign, !cabut_role + sesi handlers
// ==========================================
const { ID_OWNER } = require('../config/constants');
const { dbRole, simpanRole, getCoreNumber, cekDanPotongLimit, kembalikanLimit } = require('../config/db');
const { getGeminiComponents } = require('../services/ai/providers/gemini');
const state = require('../config/state');

async function handle(ctx) {
    const { sock, msg, from, senderId, isOwner, textClean, textLower, reply } = ctx;

    // ==========================================
    // HANDLER SESI CABUT ROLE (INTERAKTIF)
    // ==========================================
    if (state.sesiCabutRole[senderId]) {
        const pilihan = textLower;
        if (pilihan === 'batal' || pilihan === 'cancel') {
            delete state.sesiCabutRole[senderId];
            await reply('Nn... Operasi pencabutan otoritas dibatalkan.');
            return true;
        }

        const num = parseInt(pilihan) - 1;
        const listUser = state.sesiCabutRole[senderId].list;

        if (isNaN(num) || num < 0 || num >= listUser.length) {
            await reply('Nn... Angka tidak valid, Komandan. Balas dengan angka yang ada di daftar, atau ketik *batal*.');
            return true;
        }

        const targetKey = listUser[num];
        const namaLama = dbRole[targetKey].nama;

        delete dbRole[targetKey];
        simpanRole();
        delete state.sesiCabutRole[senderId];

        await reply(`🗑️ *OTORITAS DICABUT*\n\nNn... Akses atas nama *${namaLama}* telah dihapus dari sistem.`);
        try {
            await sock.sendMessage(targetKey, { text: `⚠️ *PERINGATAN DARI MARKAS PUSAT* ⚠️\n\nNn... Komandan telah mencabut otoritasmu.` });
        } catch (e) { }
        return true;
    }

    // ==========================================
    // HANDLER SESI UJIAN (INTERAKTIF)
    // ==========================================
    if (state.sesiUjian[senderId] && !textLower.startsWith('!')) {
        const sesi = state.sesiUjian[senderId];
        if (textLower === 'batal' || textLower === 'cancel') {
            delete state.sesiUjian[senderId];
            kembalikanLimit(senderId);
            await reply('Nn... Sayang sekali Kouhai menyerah di tengah jalan. Operasi evaluasi dibatalkan.');
            return true;
        }
        try {
            await sock.sendPresenceUpdate('composing', from);
            const result = await sesi.chat.sendMessage(textClean);
            const balasanAI = result.response.text();
            await reply(balasanAI);
            if (balasanAI.includes('[UJIAN_SELESAI]')) delete state.sesiUjian[senderId];
        } catch (err) {
            await reply('Nn... Sistem AI untuk ujian sedang mengalami gangguan sinyal. Coba balas lagi atau ketik "batal".');
        }
        return true;
    }

    // ==========================================
    // REGISTRASI GURU & SISWA
    // ==========================================
    if (textLower === '!reg_guru' || textLower === '!reg_siswa') {
        const tipe = textLower.split('_')[1];
        if (dbRole[senderId]) { await reply(`Nn... Identitasmu sudah terdaftar sebagai *${dbRole[senderId].role.toUpperCase()}*.`); return true; }

        let teks = `🏫 *FORM PENDAFTARAN ${tipe.toUpperCase()}* 🏫\n\nNn... Silakan copy teks di bawah ini:\n\n!submit_reg\nDaftar: ${tipe.toUpperCase()}\nNama: \nInstansi/Kelas: `;
        await reply(teks);
        return true;
    }

    if (textLower.startsWith('!submit_reg')) {
        const baris = textClean.split('\n');
        let tipeDaftar = '', namaLengkap = '';

        for (let b of baris) {
            if (b.toLowerCase().startsWith('daftar:')) tipeDaftar = b.split(':')[1].trim().toUpperCase();
            if (b.toLowerCase().startsWith('nama:')) namaLengkap = b.split(':')[1].trim();
        }

        if (!tipeDaftar || !namaLengkap) { await reply('Nn... Format salah.'); return true; }

        const idOwnerUtama = ID_OWNER[0] + '@s.whatsapp.net';
        let laporan = `🚨 *PENDAFTARAN USER BARU* 🚨\n\n*ID Pendaftar:* ${senderId}\n*Role Diminta:* ${tipeDaftar}\n*Nama:* ${namaLengkap}\n\nNn... Komandan, silakan Reply pesan ini dengan:\n✅ *!acc*\n❌ *!tolak [alasan]*`;

        await sock.sendMessage(idOwnerUtama, { text: laporan });
        await reply(`Nn... Formulir atas nama *${namaLengkap}* sudah dikirim ke Markas Pusat.`);
        return true;
    }

    // ==========================================
    // FITUR GURU — SOAL
    // ==========================================
    if (textLower.startsWith('!tambah_soal ')) {
        if (!dbRole[senderId] || dbRole[senderId].role !== 'guru') { await reply('Nn... Akses ditolak.'); return true; }
        const teksSoal = textClean.substring(13).trim();
        if (!teksSoal) { await reply('Nn... Masukkan teks skenario kasusnya.'); return true; }

        dbRole[senderId].bank_soal.push(teksSoal);
        simpanRole();
        await reply(`✅ *SOAL DITAMBAHKAN*\n\nTotal soal Sensei sekarang: *${dbRole[senderId].bank_soal.length} soal*.`);
        return true;
    }

    if (textLower === '!list_soal') {
        if (!dbRole[senderId] || dbRole[senderId].role !== 'guru') { await reply('Nn... Akses ditolak.'); return true; }
        const soal = dbRole[senderId].bank_soal;
        let idGuruBersih = getCoreNumber(senderId);

        if (soal.length === 0) { await reply(`Nn... Brankas soal masih kosong.\n_Catatan ID Sensei: *${idGuruBersih}*_`); return true; }

        let teks = `🏫 *BANK SOAL SENSEI ${dbRole[senderId].nama.toUpperCase()}* 🏫\n\n`;
        soal.forEach((s, i) => { teks += `*Babak ${i + 1}:* ${s}\n\n`; });
        teks += `📢 *INFO UNTUK SISWA:*\nSuruh siswa ngetik ini buat ujian:\n*!ujian ${idGuruBersih}*`;
        await reply(teks);
        return true;
    }

    if (textLower.startsWith('!hapus_soal ')) {
        if (!dbRole[senderId] || dbRole[senderId].role !== 'guru') { await reply('Nn... Akses ditolak.'); return true; }
        const index = parseInt(textClean.split(' ')[1]) - 1;
        if (isNaN(index) || index < 0 || index >= dbRole[senderId].bank_soal.length) { await reply('Nn... Nomor tidak ditemukan.'); return true; }
        dbRole[senderId].bank_soal.splice(index, 1);
        simpanRole();
        await reply(`🗑️ *SOAL DIHAPUS*\n\nSisa soal: *${dbRole[senderId].bank_soal.length}*.`);
        return true;
    }

    // ==========================================
    // CABUT ROLE
    // ==========================================
    if (textLower === '!cabut_role') {
        if (!isOwner) { await reply('Nn... Akses ditolak.'); return true; }

        const listUser = Object.keys(dbRole);
        if (listUser.length === 0) { await reply('Nn... Belum ada user yang terdaftar memiliki role di server.'); return true; }

        state.sesiCabutRole[senderId] = { list: listUser };

        let teks = `🗑️ *CABUT OTORITAS USER* 🗑️\n\nNn... Komandan, pilih nomor urut user yang ingin dicabut aksesnya:\n\n`;
        listUser.forEach((jid, index) => {
            const data = dbRole[jid];
            teks += `*${index + 1}.* ${data.nama} (${data.role.toUpperCase()})\n`;
        });
        teks += `\n_Ketik *batal* untuk membatalkan._`;

        await reply(teks);
        return true;
    }

    // ==========================================
    // RESIGN
    // ==========================================
    if (textLower === '!resign') {
        if (!dbRole[senderId]) { await reply('Nn... Kamu tidak terdaftar.'); return true; }
        const namaLama = dbRole[senderId].nama;
        delete dbRole[senderId];
        simpanRole();
        await reply(`🗑️ *PENGUNDURAN DIRI DITERIMA*\n\nNn... Terima kasih, *${namaLama}*. Data otoritasmu telah dihapus.`);
        return true;
    }

    // ==========================================
    // UJIAN AKHLAK (INTERAKTIF ROLEPLAY)
    // ==========================================
    if (textLower.startsWith('!ujian')) {
        const args = textClean.split(' ');
        if (args.length < 2) { await reply('Nn... Format salah. Kouhai harus memasukkan ID Guru penguji.\nContoh: *!ujian 628123456789*'); return true; }

        const isSiswa = dbRole[senderId] && dbRole[senderId].role === 'siswa';
        if (!isSiswa && !isOwner) { await reply('Nn... Akses ditolak. Hanya Kouhai (Siswa) terdaftar yang bisa mengikuti ujian ini.'); return true; }

        let idGuruMinta = args[1].replace(/[^0-9]/g, '');
        let keyGuru = Object.keys(dbRole).find(k => getCoreNumber(k) === idGuruMinta && dbRole[k].role === 'guru');

        if (!keyGuru) { await reply('Nn... Data Sensei penguji tidak ditemukan di server.'); return true; }
        const dataGuru = dbRole[keyGuru];
        const bankSoalGuru = dataGuru.bank_soal;

        if (bankSoalGuru.length === 0) { await reply(`Nn... Sensei ${dataGuru.nama} belum memasukkan kasus ujian. Ujian tidak bisa dimulai.`); return true; }
        if (!cekDanPotongLimit(senderId)) { await reply('Nn... Token harian Kouhai sudah habis.'); return true; }

        try {
            await reply(`Nn... Menyiapkan ruang ujian dengan skenario dari Sensei *${dataGuru.nama}*. Mohon tunggu sebentar...`);
            let listSoalTeks = "";
            bankSoalGuru.forEach((s, i) => { listSoalTeks += `- Babak ${i + 1}: ${s}\n`; });

            const { genAI } = getGeminiComponents();
            const modelUjianDinamis = genAI.getGenerativeModel({
                model: "gemini-2.5-flash",
                generationConfig: { temperature: 0.7, topP: 0.9, maxOutputTokens: 2048 },
                systemInstruction: `Kamu adalah Shiroko (Blue Archive), seorang Senpai. User adalah: Kouhai.\nTugasmu: Simulasi ujian Akidah Akhlak sebanyak ${bankSoalGuru.length} babak menggunakan BANK SOAL ini:\n${listSoalTeks}\nJangan berikan nilai di tengah cerita. Penilaian HANYA di akhir. Di pesan terakhir wajib mencetak kode ini: [UJIAN_SELESAI]`
            });

            const chatSession = modelUjianDinamis.startChat({ history: [] });
            state.sesiUjian[senderId] = { chat: chatSession };

            const triggerResult = await chatSession.sendMessage('Mulai ujiannya sekarang. Buka dengan sapaan sebagai Senpai dan berikan narasi/kasus pertama.');
            let teksAwal = `*🏫 [ UJIAN AKHLAK DIMULAI ] 🏫*\n*Penguji:* ${dataGuru.nama}\n*Total Kasus:* ${bankSoalGuru.length} Babak\n\n_Jawablah pertanyaan Senpai secara wajar._\n_Ketik *batal* kapan saja untuk menghentikan simulasi._\n━━━━━━━━━━━━━━━━━━━━\n\n${triggerResult.response.text()}`;

            await reply(teksAwal);
        } catch (error) {
            kembalikanLimit(senderId);
            await reply('Nn... Gagal menginisiasi ruang ujian. Server sedang sibuk.');
        }
        return true;
    }

    return false;
}

module.exports = { handle };
