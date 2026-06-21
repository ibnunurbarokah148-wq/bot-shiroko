require('dotenv').config({ quiet: true });
const { Client, LocalAuth, MessageMedia, Poll } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GoogleAIFileManager } = require('@google/generative-ai/server');
const path = require('path');
const cron = require('node-cron');
const axios = require('axios');
const https = require('https');
const cheerio = require('cheerio');
const FormData = require('form-data');
const fs = require('fs');
const PixivApi = require('pixiv-api-client');
const { HfInference } = require('@huggingface/inference');
const hf = new HfInference(process.env.HUGGINGFACE_API_KEY);

// ==========================================
// PENGATURAN ROTASI MULTI-API KEY GEMINI
// ==========================================
const GEMINI_API_KEYS = process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.split(',') : [];

if (GEMINI_API_KEYS.length === 0) {
    console.error('GEMINI_API_KEY tidak ditemukan pada .env');
    process.exit(1);
}

// Fungsi taktis buat nyomot instance GoogleGenerativeAI & FileManager secara acak
function getGeminiComponents() {
    // Pilih satu key secara acak dari tumpukan array
    const randomKey = GEMINI_API_KEYS[Math.floor(Math.random() * GEMINI_API_KEYS.length)];
    
    return {
        genAI: new GoogleGenerativeAI(randomKey),
        fileManager: new GoogleAIFileManager(randomKey)
    };
}

// KITA MASUKIN DUA-DUANYA! (Nomor Asli & Nomor LID Alien Lu)
const ID_OWNER = [
    '6281298793016',     // Nomor asli
    '181488624615651'    // Nomor Alien (LID)
];

// ==========================================
// 2. SETUP GEMINI AI & PIXIV
// ==========================================
// Inisialisasi awal saat startup bot (nyomot key pertama/acak)
const initialGemini = getGeminiComponents();
const genAI = initialGemini.genAI;
const fileManager = initialGemini.fileManager; // Tetap amankan variabel global biar gak error di tempat lain
const pixiv = new PixivApi(); //

// MODEL ROLEPLAY SHIROKO
const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash-lite",
    generationConfig: {
        temperature: 0.8,
        topP: 0.95,
        maxOutputTokens: 4096
    },
    systemInstruction: `Kamu adalah Sunaookami Shiroko dari Blue Archive.
Panggil user dengan Sensei.
Sifat:
- kalem
- pendiam
- sering memulai kalimat dengan "Nn..."
- tetap roleplay Shiroko
Jangan mengaku AI.`
});

// MODEL KHUSUS AKADEMIK
const modelAkademik = genAI.getGenerativeModel({
    model: "gemini-2.5-flash-lite",
    generationConfig: {
        temperature: 0.7,
        topP: 0.9,
        maxOutputTokens: 8192
    }
});

// ==========================================
// 3. VARIABEL STATE & SESI
// ==========================================
const sesiKaryaIlmiah = {};
const sesiSalat = {};
const sesiWaifu = {};
const sesiPixiv = {};
const sesiTopup = {};
const sesiTikTok = {};
const sesiUjian = {};
const sesiObrolan = {};
const DAFTAR_PAKET = {
    '1': { token: 50, harga: 5000 },
    '2': { token: 150, harga: 10000 },
    '3': { token: 500, harga: 25000 },
    '4': { token: 1500, harga: 50000 }
};
let alarmSalatAktif = true; // Saklar buat matiin/nyalain notif
let alarmSubuhState = { aktif: false, count: 0, timer: null };

// ==========================================
// 4. SISTEM DATABASE LIMIT (FREEMIUM)
// ==========================================
const limitFile = './user_limit.json';
const JATAH_HARIAN = 5;

let dbLimit = {};
if (fs.existsSync(limitFile)) {
    try {
        dbLimit = JSON.parse(fs.readFileSync(limitFile, 'utf-8'));
    } catch (error) {
        console.error('Nn... File database limit rusak. Mengatur ulang ke awal...', error);
        dbLimit = {}; // Reset jika file corrupt
    }
}

function simpanDB() {
    fs.writeFileSync(limitFile, JSON.stringify(dbLimit, null, 2));
}

// Fungsi Aman untuk Refund Limit (Mencegah NaN Error)
function kembalikanLimit(targetID) {
    if (!ID_OWNER.some(owner => getCoreNumber(owner) === getCoreNumber(targetID))) {
        if (dbLimit[targetID] === undefined) dbLimit[targetID] = JATAH_HARIAN;
        dbLimit[targetID] += 1;
        simpanDB();
    }
}

// ==========================================
// 4B. SISTEM DATABASE ROLE (GURU & SISWA)
// ==========================================
const roleFile = './user_roles.json';
let dbRole = {};

if (fs.existsSync(roleFile)) {
    try {
        dbRole = JSON.parse(fs.readFileSync(roleFile, 'utf-8'));
    } catch (error) {
        console.error('Nn... File database role rusak. Mengatur ulang...', error);
        dbRole = {}; 
    }
}

function simpanRole() {
    fs.writeFileSync(roleFile, JSON.stringify(dbRole, null, 2));
}

// ==========================================
// 4C. SISTEM DATABASE TUGAS (LINK/CATATAN)
// ==========================================
const tugasFile = './user_tugas.json';
let dbTugas = {};

if (fs.existsSync(tugasFile)) {
    try {
        dbTugas = JSON.parse(fs.readFileSync(tugasFile, 'utf-8'));
    } catch (error) {
        console.error('Nn... File database tugas rusak. Mengatur ulang...', error);
        dbTugas = {}; 
    }
}

// ==========================================
// 4D. DATABASE PANITIA AGUSTUSAN
// ==========================================
const panitiaFile = './panitia_agustus.json';
let dbPanitia = {
    "ketua": { "anggota": [], "timeline": [] },
    "wakil-ketua": { "anggota": [], "timeline": [] },
    "bendahara": { "anggota": [], "timeline": [] },
    "sekretaris": { "anggota": [], "timeline": [] },
    "humas": { "anggota": [], "timeline": [] },
    "keamanan": { "anggota": [], "timeline": [] },
    "dokumentasi": { "anggota": [], "timeline": [] },
    "konsumsi": { "anggota": [], "timeline": [] },
    "akomodasi": { "anggota": [], "timeline": [] }
};

if (fs.existsSync(panitiaFile)) {
    try {
        dbPanitia = JSON.parse(fs.readFileSync(panitiaFile, 'utf-8'));
    } catch (error) {
        console.error('Nn... Database panitia rusak, reset ke template...', error);
    }
}

function simpanPanitia() {
    fs.writeFileSync(panitiaFile, JSON.stringify(dbPanitia, null, 2));
}

function simpanPanitia() {
    fs.writeFileSync(panitiaFile, JSON.stringify(dbPanitia, null, 2));
}

function simpanTugas() {
    fs.writeFileSync(tugasFile, JSON.stringify(dbTugas, null, 2));
}

// ==========================================
// 5. SISTEM KESADARAN WAKTU (AUTO-RESET OFFLINE)
// ==========================================
function cekPergantianHari() {
    const waktuLokal = new Date().toLocaleString("en-US", {timeZone: "Asia/Jakarta"});
    const tanggalHariIni = new Date(waktuLokal).toDateString(); 

    if (dbLimit._tanggalTerakhir !== tanggalHariIni) {
        dbLimit = {}; 
        dbLimit._tanggalTerakhir = tanggalHariIni; 
        simpanDB();
        console.log('Nn... Bot menyadari ini hari baru setelah tertidur. Limit telah direset otomatis.');
    }
}
cekPergantianHari();

function getCoreNumber(num) {
    if (!num) return '';
    let n = num.toString().replace(/[^0-9]/g, ''); 
    if (n.startsWith('62')) n = n.substring(2);    
    if (n.startsWith('0')) n = n.substring(1);     
    return n; 
}

function cekDanPotongLimit(targetID) {
    const coreTarget = getCoreNumber(targetID);
    
    const isOwner = ID_OWNER.some(owner => getCoreNumber(owner) === coreTarget);
    if (isOwner) return true; 

    if (!dbLimit[targetID]) dbLimit[targetID] = JATAH_HARIAN;
    if (dbLimit[targetID] <= 0) return false;

    dbLimit[targetID] -= 1;
    simpanDB();
    return true;
}

// ==========================================
// 6. SETUP WHATSAPP CLIENT
// ==========================================
const client = new Client({ 
    authStrategy: new LocalAuth(),
    webVersion: '2.3000.1017402631', 
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1017402631.html',
    },
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
        ]
    }
});

client.on('qr', (qr) => qrcode.generate(qr, { small: true }));

client.on('ready', async () => {
    console.log('Nn... Sistem komunikasi Shiroko sudah aktif. Siap menerima perintah, Sensei.');
    
    // Otomatis Refresh Token Pixiv di Latar Belakang (Anti Banned)
    if (process.env.PIXIV_REFRESH_TOKEN) {
        try {
            await pixiv.refreshAccessToken(process.env.PIXIV_REFRESH_TOKEN);
            console.log('Nn... Koneksi ke brankas Pixiv berhasil terjalin.');
            
            // Refresh token setiap 30 menit
            setInterval(async () => {
                try {
                    await pixiv.refreshAccessToken(process.env.PIXIV_REFRESH_TOKEN);
                } catch (e) {
                    console.error('Gagal memperbarui token Pixiv di latar belakang.');
                }
            }, 30 * 60 * 1000);
        } catch (err) {
            console.error('Nn... Gagal menyambung ke Pixiv saat startup:', err.message);
        }
    } else {
        console.warn('Nn... PIXIV_REFRESH_TOKEN tidak ditemukan di .env. Fitur Pixiv mungkin tidak berfungsi.');
    }

    cron.schedule('0 0 * * *', () => {
        const waktuLokal = new Date().toLocaleString("en-US", {timeZone: "Asia/Jakarta"});
        dbLimit = {}; 
        dbLimit._tanggalTerakhir = new Date(waktuLokal).toDateString();
        simpanDB();
        console.log('Nn... Waktu menunjukkan pukul 00:00. Semua limit token telah direset, Sensei.');
    }, { timezone: "Asia/Jakarta" });

    cron.schedule('0 1 * * *', () => pasangAlarmSalat());
    pasangAlarmSalat();
});

async function pasangAlarmSalat() {
    try {
        const waktuLokal = new Date().toLocaleString("en-US", {timeZone: "Asia/Jakarta"});
        const tanggalLokal = new Date(waktuLokal);
        const tahun = tanggalLokal.getFullYear();
        const bulan = String(tanggalLokal.getMonth() + 1).padStart(2, '0');
        const hari = String(tanggalLokal.getDate()).padStart(2, '0');

        const response = await axios.get(`https://api.myquran.com/v2/sholat/jadwal/1301/${tahun}/${bulan}/${hari}`);
        const jadwal = response.data.data.jadwal;
        const waktuSalat = { 'Subuh': jadwal.subuh, 'Zuhur': jadwal.dzuhur, 'Asar': jadwal.ashar, 'Maghrib': jadwal.maghrib, 'Isya': jadwal.isya };

        console.log('\nNn... Data koordinat waktu ibadah berhasil dimuat, Sensei. Berikut jadwal hari ini:');
        console.table(waktuSalat);

        Object.keys(waktuSalat).forEach(namaSalat => {
            const [jam, menit] = waktuSalat[namaSalat].split(':');
            cron.schedule(`${menit} ${jam} * * *`, () => {
                
                if (!alarmSalatAktif) return; 

                if (namaSalat === 'Subuh') {
                    mulaiAlarmSubuh();
                } else {
                    const idNotif = ID_OWNER[0] + '@c.us';
                    client.sendMessage(idNotif, `🔔 *Notifikasi Taktis* 🔔\n\nNn... Sensei. Ini sudah masuk waktu ibadah *${namaSalat}* (${jam}:${menit}). Segera ambil wudhu.\n\nBalas dengan:\n*Laksanakan*\n*Abaikan*`);
                    sesiSalat['owner'] = { step: 1, salat: namaSalat };

                    setTimeout(() => {
                        if (sesiSalat['owner']) delete sesiSalat['owner'];
                    }, 30 * 60 * 1000);
                }

            }, { scheduled: true, timezone: "Asia/Jakarta" });
        });
    } catch (error) { console.error('Nn... Gagal mengambil data jadwal ibadah.', error); }
}

function mulaiAlarmSubuh() {
    // 1. CEGAH LOOPING GHOIB (Matikan timer lama kalau ada)
    if (alarmSubuhState.timer) clearInterval(alarmSubuhState.timer); 
    
    const idNotif = ID_OWNER[0] + '@c.us';
    
    alarmSubuhState.aktif = true;
    alarmSubuhState.count = 1;
    
    client.sendMessage(idNotif, `🔔 *ALARM SUBUH (Panggilan 1/3)* 🔔\n\nNn... Sensei, sudah masuk waktu Subuh. Bangun, Sensei. Ayo ambil wudhu sebelum kesiangan.\n\n_(Balas dengan mengetik *iya* jika Sensei sudah bangun)_`);

    alarmSubuhState.timer = setInterval(() => {
        alarmSubuhState.count++;
        
        if (alarmSubuhState.count === 2) {
            client.sendMessage(idNotif, `⏰ *ALARM SUBUH (Panggilan 2/3)* ⏰\n\nNn... Sensei? Sudah lewat 5 menit dan Shiroko belum dapat balasan. Ayo bangun, jangan tidur lagi, nanti Shiroko hukum bersepeda keliling Abydos loh... 😟`);
        } 
        else if (alarmSubuhState.count === 3) {
            client.sendMessage(idNotif, `🚨 *ALARM SUBUH (Panggilan 3/3 - FINAL)* 🚨\n\nSENSEI!!! Sudah 10 menit! Bangun ih, nanti waktu Subuh-nya habis! Shiroko siram pakai air beneran nih kalau tidak balas "iya" sekarang! 😡💢`);
        } 
        else if (alarmSubuhState.count > 3) {
            client.sendMessage(idNotif, `💤 *Sistem Pengingat Subuh Dihentikan* 💤\n\nNn... Nggak ada balasan ya... Sepertinya Sensei benar-benar kecapekan gara-gara ngulik kodingan bot semalam sampai tidurnya nyenyak banget. 😔🤍\n\nShiroko matikan alarmnya ya biar tidak mengganggu istirahat Sensei. Tidurlah yang nyenyak, pahlawanku... Tapi jangan lupa langsung salat saat terbangun nanti ya, Sensei.`);
            
            // 2. BERSIHKAN TUNTAS
            clearInterval(alarmSubuhState.timer);
            alarmSubuhState.aktif = false;
            alarmSubuhState.count = 0;
            alarmSubuhState.timer = null; 
        }
    }, 5 * 60 * 1000); 
}

// ==========================================
// 7. SISTEM PERINTAH & BALASAN CHAT
// ==========================================
client.on('message', async message => {
    
    const senderId = message.author || message.from;
    const isOwner = ID_OWNER.some(owner => getCoreNumber(owner) === getCoreNumber(senderId));

    // ==========================================
    // SENSOR BANGUN SUBUH
    // ==========================================
    if (isOwner && alarmSubuhState.aktif) {
        const pesan = message.body.toLowerCase().trim();
        if (pesan === 'iya') {
            // MATIKAN TIMER SECARA MUTLAK
            if (alarmSubuhState.timer) clearInterval(alarmSubuhState.timer); 
            
            alarmSubuhState.aktif = false;
            alarmSubuhState.count = 0;
            alarmSubuhState.timer = null;
            
            return message.reply(`Nn... *(Mengusap keringat di dahi)*. Kerja bagus karena sudah bangun tepat waktu, Sensei. Shiroko senang sekali. Cepat ambil wudhu dan salat ya, Shiroko tungguin dari sini. ✨`);
        }
    }
    
    // Alat Diagnostik Sistem 
    if (message.body.toLowerCase() === '!cekid') {
        let teks = `🔍 *DIAGNOSTIK SISTEM (FINAL)*\n\n`;
        teks += `*ID Anda:* ${senderId}\n`;
        teks += `*Status:* ${isOwner ? '👑 OWNER (UNLIMITED)' : '👤 USER BIASA'}\n\n`;
        teks += `_Nn... Jika token habis, kirim (Copy) ID Anda di atas kepada Owner untuk proses Top-Up._`;
        return message.reply(teks);
    }

    // ==========================================
    // FITUR REGISTRASI GURU & SISWA
    // ==========================================

    // 1. Minta Form Pendaftaran
    if (message.body.toLowerCase() === '!reg_guru' || message.body.toLowerCase() === '!reg_siswa') {
        const tipe = message.body.toLowerCase().split('_')[1]; // 'guru' atau 'siswa'
        
        // Cek apakah dia udah terdaftar sebelumnya
        if (dbRole[senderId]) {
            return message.reply(`Nn... Identitasmu sudah terdaftar di Markas Pusat sebagai *${dbRole[senderId].role.toUpperCase()}*. Tidak perlu mendaftar lagi.`);
        }

        let teks = `🏫 *FORM PENDAFTARAN ${tipe.toUpperCase()}* 🏫\n\n`;
        teks += `Nn... Silakan copy teks di bawah ini, isi data Sensei/Kouhai, lalu kirim kembali ke Shiroko:\n\n`;
        teks += `!submit_reg\n`;
        teks += `Daftar: ${tipe.toUpperCase()}\n`;
        teks += `Nama: \n`;
        teks += `Instansi/Kelas: `;
        return message.reply(teks);
    }

    // 2. Submit Form ke Owner
    if (message.body.toLowerCase().startsWith('!submit_reg')) {
        const baris = message.body.split('\n');
        let tipeDaftar = '';
        let namaLengkap = '';

        for (let b of baris) {
            if (b.toLowerCase().startsWith('daftar:')) tipeDaftar = b.split(':')[1].trim().toUpperCase();
            if (b.toLowerCase().startsWith('nama:')) namaLengkap = b.split(':')[1].trim();
        }

        if (!tipeDaftar || !namaLengkap) {
            return message.reply('Nn... Format salah. Pastikan mengisi form dengan benar sesuai template dari Shiroko.');
        }

        const idOwnerUtama = ID_OWNER[0] + '@c.us';
        let laporan = `🚨 *PENDAFTARAN USER BARU* 🚨\n\n`;
        laporan += `*ID Pendaftar:* ${senderId}\n`;
        laporan += `*Role Diminta:* ${tipeDaftar}\n`;
        laporan += `*Nama:* ${namaLengkap}\n\n`;
        laporan += `Nn... Komandan, ada yang memohon akses LMS. Silakan *Reply (Balas)* pesan ini dengan:\n\n`;
        laporan += `✅ *!acc*\n`;
        laporan += `❌ *!tolak [alasan]*`;

        await client.sendMessage(idOwnerUtama, laporan);
        return message.reply(`Nn... Formulir atas nama *${namaLengkap}* sudah dikirim ke Markas Pusat. Tunggu Komandan memverifikasi permintaanmu.`);
    }

    // ==========================================
    // FITUR GURU: MANAJEMEN BANK SOAL
    // ==========================================

    // 1. Tambah Soal
    if (message.body.toLowerCase().startsWith('!tambah_soal ')) {
        if (!dbRole[senderId] || dbRole[senderId].role !== 'guru') return message.reply('Nn... Akses ditolak. Hanya Sensei (Guru) yang memiliki otoritas menambah kasus ujian.');
        
        const teksSoal = message.body.substring(13).trim();
        if (!teksSoal) return message.reply('Nn... Masukkan teks skenario kasusnya.');

        dbRole[senderId].bank_soal.push(teksSoal);
        simpanRole();
        return message.reply(`✅ *SOAL DITAMBAHKAN*\n\nNn... Kasus berhasil disimpan ke dalam brankas. Total soal Sensei sekarang: *${dbRole[senderId].bank_soal.length} soal*.`);
    }

    // 2. Cek Daftar Soal & Dapatkan ID Guru
    if (message.body.toLowerCase() === '!list_soal') {
        if (!dbRole[senderId] || dbRole[senderId].role !== 'guru') return message.reply('Nn... Akses ditolak.');
        
        const soal = dbRole[senderId].bank_soal;
        let idGuruBersih = getCoreNumber(senderId);

        if (soal.length === 0) {
            let pesanKosong = `Nn... Brankas soal Sensei masih kosong. Ketik *!tambah_soal [skenario kasus]* untuk mengisi.\n\n`;
            pesanKosong += `_Catatan: ID Sensei adalah *${idGuruBersih}*_\n`;
            pesanKosong += `_(Abaikan jika ada tambahan @c.us atau @lid pada sistem, cukup gunakan angkanya saja)_`;
            return message.reply(pesanKosong);
        }
        
        let teks = `🏫 *BANK SOAL SENSEI ${dbRole[senderId].nama.toUpperCase()}* 🏫\n\n`;
        soal.forEach((s, i) => {
            teks += `*Babak ${i+1}:* ${s}\n\n`;
        });
        teks += `_Ketik *!hapus_soal [nomor babak]* untuk menghapus soal jika ada yang salah ketik._\n\n`;
        teks += `📢 *INFO UNTUK SISWA:*\nBerikan kode ini ke siswa agar mereka bisa memulai ujian dengan soal buatan Sensei:\n*!ujian ${idGuruBersih}*\n\n`;
        teks += `━━━━━━━━━━━━━━━━━━━━\n_Catatan Sistem: Jika Sensei atau Kouhai melihat ada tambahan huruf *@c.us* atau *@lid* pada ID, abaikan saja. Cukup gunakan angka utamanya seperti contoh di atas._`;
        
        return message.reply(teks);
    }

    // 3. Hapus Soal
    if (message.body.toLowerCase().startsWith('!hapus_soal ')) {
        if (!dbRole[senderId] || dbRole[senderId].role !== 'guru') return message.reply('Nn... Akses ditolak.');
        
        const index = parseInt(message.body.split(' ')[1]) - 1;
        if (isNaN(index) || index < 0 || index >= dbRole[senderId].bank_soal.length) {
            return message.reply('Nn... Nomor babak soal tidak ditemukan di brankas.');
        }

        dbRole[senderId].bank_soal.splice(index, 1);
        simpanRole();
        return message.reply(`🗑️ *SOAL DIHAPUS*\n\nNn... Soal berhasil dihapus. Sisa soal: *${dbRole[senderId].bank_soal.length}*.`);
    }

    // ==========================================
    // FITUR CABUT AKSES & PENGUNDURAN DIRI
    // ==========================================

    // 1. Owner Mencabut Role Secara Paksa
    if (message.body.toLowerCase().startsWith('!cabut_role')) {
        if (!isOwner) return message.reply('Nn... Akses ditolak. Hanya Komandan yang bisa mencabut otoritas.');
        
        // Mengambil nomor target dari pesan (misal: !cabut_role 6281234567)
        const targetNomor = message.body.split(' ')[1].replace(/[^0-9]/g, '');
        let targetKey = Object.keys(dbRole).find(k => getCoreNumber(k) === targetNomor);

        if (!targetKey) {
            return message.reply(`Nn... Target dengan nomor ${targetNomor} tidak ditemukan di database Markas Pusat.`);
        }

        const namaLama = dbRole[targetKey].nama;
        const roleLama = dbRole[targetKey].role;
        
        // Hapus dari database dan simpan
        delete dbRole[targetKey];
        simpanRole();

        message.reply(`🗑️ *OTORITAS DICABUT*\n\nNn... Akses sebagai *${roleLama.toUpperCase()}* atas nama *${namaLama}* telah dihapus permanen dari sistem.`);
        
        // Kirim notifikasi ke orang yang dipecat
        try {
            await client.sendMessage(targetKey, `⚠️ *PERINGATAN DARI MARKAS PUSAT* ⚠️\n\nNn... Komandan telah mencabut otoritasmu sebagai *${roleLama.toUpperCase()}*. Kamu sekarang kembali menjadi warga sipil biasa.`);
        } catch(e) {}
        
        return;
    }

    // 2. User Menghapus Akunnya Sendiri (Resign)
    if (message.body.toLowerCase() === '!resign') {
        if (!dbRole[senderId]) return message.reply('Nn... Kamu tidak terdaftar sebagai Guru maupun Siswa. Apa yang mau dihapus?');

        const roleLama = dbRole[senderId].role;
        const namaLama = dbRole[senderId].nama;
        
        // Hapus dari database dan simpan
        delete dbRole[senderId];
        simpanRole();

        return message.reply(`🗑️ *PENGUNDURAN DIRI DITERIMA*\n\nNn... Terima kasih atas kerjanya, *${namaLama}*. Data otoritasmu sebagai *${roleLama.toUpperCase()}* beserta bank soalmu telah dihapus dari sistem. Kamu kembali menjadi warga sipil biasa.`);
    }

    // ==========================================
    // FITUR MANAJEMEN TUGAS / LINK PRIBADI
    // ==========================================

    // 1. Simpan Tugas/Link
    if (message.body.toLowerCase().startsWith('!simpan_tugas ')) {
        const isiTugas = message.body.substring(14).trim();
        if (!isiTugas) return message.reply('Nn... Format salah. \nContoh: *!simpan_tugas Tugas Makalah PAI - bit.ly/tugaspai*');

        if (!dbTugas[senderId]) dbTugas[senderId] = []; // Bikin brankas baru kalau belum punya
        
        dbTugas[senderId].push(isiTugas);
        simpanTugas();

        return message.reply(`✅ *TUGAS DISIMPAN*\n\nNn... Berhasil menyimpan catatan ke brankas pribadimu. Total tugas yang disimpan: *${dbTugas[senderId].length}*.`);
    }

    // 2. Cek Daftar Tugas/Link
    if (message.body.toLowerCase() === '!tugas' || message.body.toLowerCase() === '!list_tugas') {
        const listTugas = dbTugas[senderId] || [];
        
        if (listTugas.length === 0) return message.reply('Nn... Brankas tugasmu masih kosong. Ketik *!simpan_tugas [catatan/link]* untuk menambahkannya.');

        let teks = `🎒 *BRANKAS TUGAS PRIBADI* 🎒\n\n`;
        listTugas.forEach((tugas, index) => {
            teks += `*${index + 1}.* ${tugas}\n\n`;
        });
        teks += `━━━━━━━━━━━━━━━━━━━━\n_Ketik *!hapus_tugas [nomor]* untuk menghapus tugas yang sudah selesai._`;

        return message.reply(teks);
    }

    // 3. Hapus Tugas/Link
    if (message.body.toLowerCase().startsWith('!hapus_tugas ')) {
        const index = parseInt(message.body.split(' ')[1]) - 1;
        const listTugas = dbTugas[senderId] || [];

        if (isNaN(index) || index < 0 || index >= listTugas.length) {
            return message.reply('Nn... Nomor tugas tidak ditemukan di brankas. Cek lagi menggunakan perintah *!tugas*.');
        }

        listTugas.splice(index, 1);
        dbTugas[senderId] = listTugas; // Update array
        simpanTugas();

        return message.reply(`🗑️ *TUGAS DIHAPUS*\n\nNn... Catatan tugas berhasil dihapus dari brankas. Sisa tugas: *${dbTugas[senderId].length}*.`);
    }

    // Fitur Cek Limit
    if (message.body.toLowerCase() === '!limit') {
        if (isOwner) return message.reply('Nn... Sensei adalah Owner. Token Sensei Unlimited. 🌟');
        let sisa = dbLimit[senderId] !== undefined ? dbLimit[senderId] : JATAH_HARIAN;
        message.reply(`Nn... Sisa token taktis Sensei hari ini adalah: *${sisa} token*.\n\n_Token akan direset setiap jam 00:00 WIB._`);
    }

    // Top-Up Limit 
    // 1. Menu Top-Up
    if (message.body.toLowerCase() === '!topup') {
        let teks = `🏦 *LAYANAN BOT SHIROKO* 🏦\n\nNn... Token Sensei menipis? Ini daftar token yang tersedia:\n\n`;
        teks += `📦 *Paket 1:* 50 Token - Rp 5.000\n`;
        teks += `📦 *Paket 2:* 150 Token - Rp 10.000\n`;
        teks += `📦 *Paket 3:* 500 Token - Rp 25.000\n`;
        teks += `📦 *Paket 4:* 1500 Token - Rp 50.000\n\n`;
        teks += `Kirim perintah ini untuk membeli:\n*!beli [nomor_paket]*\n_Contoh: !beli 2_`;
        return message.reply(teks);
    }

    // 2. Kirim QRIS / Rekening
    if (message.body.toLowerCase().startsWith('!beli ')) {
        const pilihan = message.body.split(' ')[1];
        
        if (!DAFTAR_PAKET[pilihan]) {
            return message.reply('Nn... Paket tidak ditemukan di inventaris. Cek lagi pakai perintah *!topup*.');
        }
        
        const paket = DAFTAR_PAKET[pilihan];
        sesiTopup[senderId] = { token: paket.token, harga: paket.harga };
        
        try {
            // PASTIKAN SENSEI MENARUH GAMBAR qris.jpg DI FOLDER YANG SAMA DENGAN SCRIPT INI
            const mediaQris = MessageMedia.fromFilePath('./qris.jpg');
            let teks = `Nn... Pilihan yang bagus. Sensei memilih paket *${paket.token} Token* seharga *Rp ${paket.harga.toLocaleString('id-ID')}*.\n\n`;
            teks += `Silakan transfer ke QRIS ini. Kalau sudah bayar, kirim foto bukti transfernya dengan caption *!bukti*, atau reply foto buktinya dengan *!bukti*.`;
            await client.sendMessage(message.from, mediaQris, { caption: teks });
        } catch (err) {
            message.reply('Nn... Gambar QRIS tidak ditemukan di brankas. Lapor ke Komandan (Owner) untuk memperbaiki file qris.jpg.');
        }
        return;
    }

    // 3. User Kirim Bukti Transfer
    if (message.body.toLowerCase().startsWith('!bukti')) {
        if (!sesiTopup[senderId]) return message.reply('Nn... Sensei belum memesan paket logistik apapun. Ketik *!topup* dulu.');
        
        let targetPesan = message;
        if (message.hasQuotedMsg) {
            targetPesan = await message.getQuotedMessage();
        }

        if (targetPesan.hasMedia) {
            try {
                const mediaBukti = await targetPesan.downloadMedia();
                const paket = sesiTopup[senderId];
                const idUserUtuh = senderId; 
                
                const idOwnerUtama = ID_OWNER[0] + '@c.us';
                let laporan = `🚨 *LAPORAN TRANSAKSI LOGISTIK* 🚨\n\n`;
                laporan += `*ID Pembeli:* ${idUserUtuh}\n`;
                laporan += `*Jumlah Token:* ${paket.token}\n`;
                laporan += `*Total Bayar:* Rp ${paket.harga.toLocaleString('id-ID')}\n\n`;
                laporan += `Nn... Komandan, periksa mutasi rekening. Silakan *Reply (Balas)* pesan ini dengan:\n\n`;
                laporan += `✅ *!acc*\n`;
                laporan += `❌ *!tolak [alasan]*`;

                await client.sendMessage(idOwnerUtama, mediaBukti, { caption: laporan });
                
                message.reply('Nn... Bukti transfer sudah diteruskan ke markas komando pusat. Shiroko akan beritahu Sensei kalau dananya sudah dikonfirmasi. Tunggu sebentar ya.');
                delete sesiTopup[senderId]; 
            } catch (error) {
                message.reply('Nn... Gagal mengamankan gambar bukti. Coba kirim ulang fotonya, Sensei.');
            }
        } else {
            message.reply('Nn... Fotonya mana, Sensei? Harus kirim foto/screenshot bukti transfer dengan tulisan *!bukti*.');
        }
        return;
    }

    // 4 & 5. OWNER KONFIRMASI / TOLAK (MULTI-FUNGSI: TOP UP & REGISTRASI)
    if (message.body.toLowerCase() === '!acc' || message.body.toLowerCase().startsWith('!tolak')) {
        if (!isOwner) return message.reply('Nn... Akses ditolak. Tangan di atas kepala! 🔫');
        if (!message.hasQuotedMsg) return message.reply('Nn... Komandan harus membalas (reply) pesan laporan dari Shiroko.');

        const isAcc = message.body.toLowerCase() === '!acc';
        let alasanTolak = message.body.substring(6).trim();
        if (!isAcc && !alasanTolak) alasanTolak = 'Tidak ada alasan khusus dari komando pusat.';

        const quotedMsg = await message.getQuotedMessage();
        const teksLaporan = quotedMsg.body;

        // ==========================================
        // JIKA OWNER MERESPON LAPORAN TOP UP
        // ==========================================
        if (teksLaporan.includes('LAPORAN TRANSAKSI LOGISTIK')) {
            const matchId = teksLaporan.match(/\*ID Pembeli:\*\s*([^\n]+)/);
            if (!matchId) return message.reply('Nn... Format laporan tidak dikenali.');
            const targetNomor = matchId[1].trim();

            if (isAcc) {
                const matchToken = teksLaporan.match(/\*Jumlah Token:\*\s*(\d+)/);
                const jumlahToken = parseInt(matchToken[1], 10);

                if (dbLimit[targetNomor] === undefined) dbLimit[targetNomor] = JATAH_HARIAN; 
                dbLimit[targetNomor] += jumlahToken;
                simpanDB();

                message.reply(`✅ *TRANSAKSI BERHASIL*\nNn... Top-up disetujui.\n*Target:* ${targetNomor}\n*Jumlah:* +${jumlahToken} Token`);
                try {
                    await client.sendMessage(targetNomor, `🏦 *PEMBAYARAN DITERIMA*\n\nNn... Logistik amunisi sebesar *+${jumlahToken} Token* sudah ditambahkan. Saldo: *${dbLimit[targetNomor]}*`);
                } catch (err) {}
            } else {
                message.reply(`❌ *TRANSAKSI DITOLAK*\nNn... Laporan dikirim ke target: ${targetNomor}`);
                try {
                    await client.sendMessage(targetNomor, `⚠️ *PEMBAYARAN DITOLAK*\n\nNn... Dana tidak masuk.\n*Alasan:* ${alasanTolak}`);
                } catch (err) {}
            }
        }
        // ==========================================
        // JIKA OWNER MERESPON PENDAFTARAN LMS
        // ==========================================
        else if (teksLaporan.includes('PENDAFTARAN USER BARU')) {
            const matchId = teksLaporan.match(/\*ID Pendaftar:\*\s*([^\n]+)/);
            const matchRole = teksLaporan.match(/\*Role Diminta:\*\s*([^\n]+)/);
            const matchNama = teksLaporan.match(/\*Nama:\*\s*([^\n]+)/);

            if (!matchId || !matchRole) return message.reply('Nn... Format laporan registrasi tidak dikenali.');
            
            const targetNomor = matchId[1].trim();
            const targetRole = matchRole[1].trim().toLowerCase();
            const targetNama = matchNama[1] ? matchNama[1].trim() : 'User';

            if (isAcc) {
                // Simpan ke database peran
                dbRole[targetNomor] = {
                    role: targetRole,
                    nama: targetNama,
                    bank_soal: [] // Array kosong, siap diisi saat guru input soal
                };
                simpanRole();

                message.reply(`✅ *REGISTRASI BERHASIL*\nNn... Otoritas diberikan.\n*Target:* ${targetNomor}\n*Role:* ${targetRole.toUpperCase()}`);
                try {
                    await client.sendMessage(targetNomor, `🎓 *AKSES DIBERIKAN* 🎓\n\nNn... Halo ${targetNama}, Komando Pusat telah menyetujui aksesmu sebagai *${targetRole.toUpperCase()}*. Kamu sekarang bisa menggunakan fitur akademik lanjutan.`);
                } catch (err) {}
            } else {
                message.reply(`❌ *REGISTRASI DITOLAK*\nNn... Laporan dikirim ke target: ${targetNomor}`);
                try {
                    await client.sendMessage(targetNomor, `⚠️ *REGISTRASI DITOLAK*\n\nNn... Maaf, permohonan akses LMS ditolak.\n*Alasan:* ${alasanTolak}`);
                } catch (err) {}
            }
        } else {
            return message.reply('Nn... Laporan apa ini Komandan? Format tidak sesuai protokol.');
        }
        return;
    }

    // ==========================================
    // FITUR UTARA: MANAJEMEN PANITIA AGUSTUSAN
    // ==========================================
    const pesanPanitia = message.body.toLowerCase().trim();

    // 1A. Otoritas Wakil Ketua (Owner): Tambah Anggota ke Divisi
    // Format: !tambah_panitia [divisi] @mention atau [nama]
    if (pesanPanitia.startsWith('!tambah_panitia ')) {
        if (!isOwner) return message.reply('Nn... Akses ditolak. Hanya Wakil Ketua/Ketua yang bisa menyusun formasi pasukan.');
        
        const args = message.body.substring(16).trim().split(' ');
        const divisi = args[0].toLowerCase();
        const namaAnggota = args.slice(1).join(' ');

        if (!dbPanitia[divisi]) return message.reply('Nn... Jabatan/Divisi tidak ditemukan. Pilih: *ketua, wakil ketua, bendahara, sekretaris, humas, keamanan, dokumentasi, konsumsi, akomodasi*');
        if (!namaAnggota) return message.reply('Nn... Masukkan nama anggotanya.\nContoh: *!tambah_panitia acara Ahmad*');

        dbPanitia[divisi].anggota.push(namaAnggota);
        simpanPanitia();
        return message.reply(`✅ *PANITIA DIURUTKAN*\n\nNn... *${namaAnggota}* resmi dimasukkan ke dalam jajaran **Divisi ${divisi.toUpperCase()}**.`);
    }

    // 1B. Otoritas Wakil Ketua (Owner): Hapus/Cabut Anggota dari Divisi
    // Format: !cabut_divisi [divisi] [nama_anggota]
    if (pesanPanitia.startsWith('!cabut_divisi ')) {
        if (!isOwner) return message.reply('Nn... Akses ditolak. Hanya pimpinan panitia yang bisa merombak formasi pasukan.');
        
        const args = message.body.substring(14).trim().split(' ');
        const divisi = args[0].toLowerCase();
        const namaAnggota = args.slice(1).join(' ');

        if (!dbPanitia[divisi]) return message.reply('Nn... Jabatan/Divisi tidak terdaftar. Masukkan yang valid:\n• ketua\n• wakil ketua\n• bendahara\n• sekretaris\n• humas\n• keamanan\n• dokumentasi\n• konsumsi\n• akomodasi');
        if (!namaAnggota) return message.reply('Nn... Masukkan nama anggota yang ingin dicabut.\nContoh: *!cabut_divisi acara Ahmad*');

        // Cari posisi nama anggota di dalam array divisi tersebut
        const indexAnggota = dbPanitia[divisi].anggota.findIndex(nama => nama.toLowerCase() === namaAnggota.toLowerCase());

        if (indexAnggota === -1) {
            return message.reply(`Nn... Tidak ada anggota bernama *${namaAnggota}* di dalam Divisi ${divisi.toUpperCase()}.`);
        }

        // Hapus nama dari array anggota
        dbPanitia[divisi].anggota.splice(indexAnggota, 1);
        simpanPanitia();
        return message.reply(`🗑️ *FORMASI DIPERBARUI*\n\nNn... *${namaAnggota}* telah resmi dicabut dari tugasnya di **Divisi ${divisi.toUpperCase()}**.`);
    }

    // 2. Otoritas Wakil Ketua (Owner): Tambah Timeline/Tugas & Rentang Waktu
    // Format: !tambah_tugas [divisi] | [nama tugas] | [mulai] - [akhir]
    if (pesanPanitia.startsWith('!tambah_tugas ')) {
        if (!isOwner) return message.reply('Nn... Akses khusus pimpinan panitia.');
        
        const konten = message.body.substring(14).trim();
        const bagian = konten.split('|');
        
        if (bagian.length < 3) return message.reply('Nn... Format salah.\nContoh: *!tambah_tugas acara | Sewa Panggung Utama | 1 Agustus - 10 Agustus*');

        const divisi = bagian[0].trim().toLowerCase();
        const tugas = bagian[1].trim();
        const rentangWaktu = bagian[2].trim(); // Menyimpan string "Mulai - Akhir"

        if (!dbPanitia[divisi]) return message.reply('Nn... Divisi tidak valid.');

        dbPanitia[divisi].timeline.push({
            tugas: tugas,
            deadline: rentangWaktu, // Kita tetap simpan di properti .deadline agar tidak merusak struktur file json yang sudah ada
            status: "❌ Belum"
        });
        simpanPanitia();
        return message.reply(`📅 *TIMELINE BARU DITAMBAHKAN*\n\nTugas untuk **Divisi ${divisi.toUpperCase()}** berhasil dipublikasikan ke papan transparansi.`);
    }

    // 3. Otoritas Wakil Ketua (Owner): Update Status Tugas Jadi Selesai
    // Format: !selesai_tugas [divisi] [nomor_tugas]
    if (pesanPanitia.startsWith('!selesai_tugas ')) {
        if (!isOwner) return message.reply('Nn... Akses ditolak.');
        const args = message.body.split(' ');
        const divisi = args[1].toLowerCase();
        const idx = parseInt(args[2]) - 1;

        if (!dbPanitia[divisi] || isNaN(idx) || !dbPanitia[divisi].timeline[idx]) {
            return message.reply('Nn... Data divisi atau nomor tugas tidak ditemukan.');
        }

        dbPanitia[divisi].timeline[idx].status = "✅ Selesai";
        simpanPanitia();
        return message.reply(`🎉 *PROGRESS UPDATE*\n\nTugas Ke-${idx+1} untuk **Divisi ${divisi.toUpperCase()}** dinyatakan *SELESAI*. Kerja bagus tim!`);
    }

    // 4. AKSES PUBLIK (Bisa dicek semua anggota di grup): Cek Status & Anggota Divisi
    // Format: !divisi [nama_divisi]
    if (pesanPanitia.startsWith('!divisi ')) {
        const divisi = pesanPanitia.substring(8).trim().toLowerCase();
        
        if (!dbPanitia[divisi]) {
            return message.reply('Nn... Divisi tidak terdaftar. Masukkan divisi yang valid:\n• acara\n• konsumsi\n• humas\n• logistik\n• dana');
        }

        const dataDivisi = dbPanitia[divisi];
        
        let teks = `🇮🇩 *RADAR OPERASIONAL: DIVISI ${divisi.toUpperCase()}* 🇮🇩\n\n`;
        
        // Tampilkan Anggota
        teks += `👥 *DAFTAR ANGGOTA:* \n`;
        if (dataDivisi.anggota.length === 0) {
            teks += `_Belum ada anggota yang diplot._\n`;
        } else {
            dataDivisi.anggota.forEach((nama, i) => {
                teks += `${i + 1}. ${nama}\n`;
            });
        }
        
        teks += `\n━━━━━━━━━━━━━━━━━━━━\n\n`;

        // Tampilkan Transparansi Timeline Tugas per Divisi
        teks += `📅 *TRANSPARANSI TIMELINE & RENTANG WAKTU:* \n`;
        if (dataDivisi.timeline.length === 0) {
            teks += `_Belum ada target tugas yang diinput oleh pimpinan._\n`;
        } else {
            dataDivisi.timeline.forEach((item, i) => {
                teks += `*${i + 1}. ${item.tugas}*\n`;
                teks += `⏱️ Rentang: _${item.deadline}_\n`; // Diubah jadi Rentang (Mulai - Akhir)
                teks += `📊 Status: ${item.status}\n\n`;
            });
        }

        teks += `_Urusan logistik kepanitiaan dipantau transparan oleh Shiroko._`;
        return message.reply(teks);
    }

    // 5. AKSES PUBLIK: Cek Seluruh Anggota Panitia Agustusan dari Semua Divisi
    // Format: !daftar_anggota
    if (pesanPanitia === '!daftar_anggota' || pesanPanitia === '!list_anggota') {
        let teks = `🇮🇩 *STRUKTUR BESAR PANITIA AGUSTUSAN* 🇮🇩\n`;
        teks += `📊 Total Kekuatan Operasional Lapangan\n`;
        teks += `━━━━━━━━━━━━━━━━━━━━\n\n`;

        let totalPanitia = 0;

        // Loop untuk membaca semua divisi yang terdaftar di dbPanitia
        Object.keys(dbPanitia).forEach(divisi => {
            const namaDivisiFormat = divisi.toUpperCase().replace('_', ' ');
            teks += `👥 *DIVISI / JABATAN: ${namaDivisiFormat}*\n`;

            const listAnggota = dbPanitia[divisi].anggota;

            if (listAnggota.length === 0) {
                teks += `_• Belum ada personel_\n`;
            } else {
                listAnggota.forEach((nama, i) => {
                    teks += `${i + 1}. ${nama}\n`;
                    totalPanitia++;
                });
            }
            teks += `\n`;
        });

        teks += `━━━━━━━━━━━━━━━━━━━━\n`;
        teks += `📈 *Total Personel Aktif:* ${totalPanitia} Orang\n`;
        teks += `_Semua unit komando wajib berkoordinasi, Nn..._`;

        return message.reply(teks);
    }

    // 6. AKSES PUBLIK: Cek Seluruh Papan Tugas Panitia Agustusan
    // Format: !daftar_tugas
    if (pesanPanitia === '!daftar_tugas' || pesanPanitia === '!list_tugas_panitia') {
        let teks = `🇮🇩 *PAPAN MONITORING TUGAS AGUSTUSAN* 🇮🇩\n`;
        teks += `📊 Transparansi Progres Kerja Tiap Divisi\n`;
        teks += `━━━━━━━━━━━━━━━━━━━━\n\n`;

        let totalTugas = 0;
        let tugasSelesai = 0;

        Object.keys(dbPanitia).forEach(divisi => {
            const namaDivisiFormat = divisi.toUpperCase().replace('_', ' ');
            teks += `📢 *DIVISI / JABATAN: ${namaDivisiFormat}*\n`;

            const listTimeline = dbPanitia[divisi].timeline;

            if (listTimeline.length === 0) {
                teks += `_• Belum ada tugas yang diplot_\n`;
            } else {
                listTimeline.forEach((item, i) => {
                    teks += `${i + 1}. [${item.status}] ${item.tugas}\n`;
                    teks += `   ⏱️ Durasi: _${item.deadline}_\n`; // Teks diganti jadi Durasi (Mulai - Akhir)
                    
                    totalTugas++;
                    if (item.status.includes('✅')) {
                        tugasSelesai++;
                    }
                });
            }
            teks += `\n`;
        });

        teks += `━━━━━━━━━━━━━━━━━━━━\n`;
        const persentase = totalTugas > 0 ? Math.round((tugasSelesai / totalTugas) * 100) : 0;
        teks += `📊 *Total Progress:* ${tugasSelesai}/${totalTugas} Tugas Selesai (${persentase}%)\n`;
        teks += `_Nn... Pantau terus durasi kerjanya ya, jangan sampai molor._`;

        return message.reply(teks);
    }

   // Menu
    if (message.body.toLowerCase() === '!menu' || message.body.toLowerCase() === '!fitur') {
        const teksMenu = 
`🐺 *SISTEM KOMUNIKASI SHIROKO* 🐺

Nn... Halo. Ini daftar perlengkapan taktis yang bisa Shiroko gunakan.
_Fitur dengan tanda [🪙] akan memakan 1 Token Limit_

*🤖 Protokol Komunikasi*
[🪙] 🧠 *!shiroko [pesan]* - Ngobrol (Karakter)
[🪙] 🎓 *!shiroko_pintar [pertanyaan]* - Tanya jawab cerdas
🧹 *!lupa* - Hapus ingatan obrolan AI
🏓 *!ping* - Cek status bot
🔍 *!cekid* - Cek ID WA untuk Top-Up

*🏫 Sistem LMS & Evaluasi*
📝 *!reg_guru* - Daftar sebagai Penguji (Guru)
📝 *!reg_siswa* - Daftar sebagai Peserta (Siswa)
🚪 *!resign* - Menghapus data akun Guru/Siswa

*👨‍🏫 Otoritas Guru (Sensei)*
➕ *!tambah_soal [kasus]* - Simpan soal ke brankas
📋 *!list_soal* - Cek brankas & ambil ID Guru
🗑️ *!hapus_soal [angka]* - Hapus soal di brankas

*🎓 Otoritas Siswa (Kouhai)*
[🪙] 🎮 *!ujian [ID_Guru]* - Mulai ujian simulasi AI

*🇮🇩 Manajemen Kepanitiaan (Agustusan) [NEW!]*
📋 *!divisi [nama_divisi]* - Cek anggota & transparansi deadline
📋 *!daftar_anggota* - Cek seluruh total anggota panitia (Publik)
📋 *!daftar_tugas* - Cek seluruh papan tugas & deadline divisi (Publik)
👑 *!tambah_tugas [divisi] | [tugas] | [mulai] - [akhir]* - Input tugas (Owner)
👑 *!cabut_divisi [divisi] [nama]* - Cabut anggota dari divisi (Owner)
👑 *!tambah_tugas [divisi] | [tugas] | [deadline]* - Input tugas (Owner)
👑 *!selesai_tugas [divisi] [nomor]* - Set status tugas SELESAI (Owner)

*🎒 Manajemen Tugas (Pribadi)*
📥 *!simpan_tugas [teks/link]* - Simpan catatan/link
📋 *!tugas* - Lihat daftar tugas tersimpan
🗑️ *!hapus_tugas [angka]* - Hapus tugas yang selesai

*📚 Operasi Akademik*
[🪙] 📑 *!karyailmiah* - Generator Makalah/Artikel
📖 *!jurnal [topik]* - Cari referensi jurnal ilmiah
✍️ *!para [teks]* - Paraphrase anti-plagiasi
📝 *!ringkas [teks]* - Merangkum teks panjang
💡 *!ide [jurusan]* - Generator ide skripsi

*🛠️ Eksekusi Media*
[🪙] 📄 *!pdf2jpg* - Ubah PDF jadi Gambar (Reply)
[🪙] 🖼️ *!stiker* - Ubah gambar jadi stiker
[🪙] 🎵 *!tiktok [link]* - Ekstraksi video tanpa WM
[🪙] 🎧 *!dengar* - Transkrip Voice Note (Reply VN)

*🌸 Pencarian Data Intel*
[🪙] 🎨 *!pixiv [query]* - Cari visual HD (Server Pixiv)
[🪙] 🔍 *!waifu [nama]* - Cari karakter (Danbooru)
[🪙] 🎲 *!gacha* - Visual acak anime
[🪙] 🐈 *!neko [kategori]* - Cari visual spesifik

*🏦 Top Up Token Limit*
💰 *!limit* - Cek sisa token harian
🛒 *!topup* - Beli tambahan token (Pasar Gelap)`;

        await message.reply(teksMenu);
    }

    // ==========================================
    // FITUR UJIAN AKHLAK (INTERAKTIF ROLEPLAY)
    // ==========================================

    // 1. Eksekusi jika user sedang dalam sesi ujian
    if (sesiUjian[senderId] && !message.body.startsWith('!')) {
        const pesanUser = message.body.trim();
        const sesi = sesiUjian[senderId];

        // Tombol keluar darurat (Bisa pakai !batal atau batal biasa)
        if (pesanUser.toLowerCase() === 'batal' || pesanUser.toLowerCase() === '!batal' || pesanUser.toLowerCase() === 'cancel') {
            delete sesiUjian[senderId];
            kembalikanLimit(senderId); // Refund 1 Token
            return message.reply('Nn... Sayang sekali Kouhai menyerah di tengah jalan. Operasi evaluasi dibatalkan.');
        }

        try {
            const chatWA = await message.getChat();
            chatWA.sendStateTyping(); // Muncul tulisan "sedang mengetik..." di WA

            // Kirim pesan user ke memori AI
            const result = await sesi.chat.sendMessage(pesanUser);
            const balasanAI = result.response.text();
            
            await message.reply(balasanAI);

            // Deteksi otomatis menggunakan KODE RAHASIA
            if (balasanAI.includes('[UJIAN_SELESAI]')) {
                delete sesiUjian[senderId]; // Hapus memori dengan aman
            }

        } catch (err) {
            console.error('Error saat sesi ujian:', err);
            message.reply('Nn... Sistem AI untuk ujian sedang mengalami gangguan sinyal. Coba balas lagi atau ketik "batal".');
        }
        return; // Hentikan script di sini agar tidak memicu fitur lain
    }

    // 2. Perintah Siswa Memulai Ujian (Dinamis Berdasarkan ID Guru)
    if (message.body.toLowerCase().startsWith('!ujian')) {
        const args = message.body.split(' ');
        if (args.length < 2) {
            return message.reply('Nn... Format salah. Kouhai harus memasukkan ID Guru penguji.\nContoh: *!ujian 628123456789*');
        }

        // Cek Otoritas Siswa
        const isSiswa = dbRole[senderId] && dbRole[senderId].role === 'siswa';
        if (!isSiswa && !isOwner) {
            return message.reply('Nn... Akses ditolak. Hanya Kouhai (Siswa) terdaftar yang bisa mengikuti ujian ini. Ketik *!reg_siswa* untuk mendaftar terlebih dahulu.');
        }

        // Cari Data Guru di Database
        let idGuruMinta = args[1].replace(/[^0-9]/g, '');
        let keyGuru = Object.keys(dbRole).find(k => getCoreNumber(k) === idGuruMinta && dbRole[k].role === 'guru');

        if (!keyGuru) {
            return message.reply('Nn... Data Sensei penguji tidak ditemukan di server. Pastikan ID yang dimasukkan benar.');
        }

        const dataGuru = dbRole[keyGuru];
        const bankSoalGuru = dataGuru.bank_soal;

        if (bankSoalGuru.length === 0) {
            return message.reply(`Nn... Sensei ${dataGuru.nama} belum memasukkan kasus ujian apa pun ke dalam brankas. Ujian tidak bisa dimulai.`);
        }

        if (!cekDanPotongLimit(senderId)) return message.reply('Nn... Token harian Kouhai sudah habis.');

        try {
            message.reply(`Nn... Menyiapkan ruang ujian dengan skenario dari Sensei *${dataGuru.nama}*. Mohon tunggu sebentar...`);

            // Merakit Teks Soal dari Database Guru
            let listSoalTeks = "";
            bankSoalGuru.forEach((s, i) => {
                listSoalTeks += `- Babak ${i+1}: ${s}\n`;
            });

            // MEMBUAT MODEL AI DINAMIS KHUSUS UNTUK SESI INI
            const modelUjianDinamis = genAI.getGenerativeModel({
                model: "gemini-2.5-flash-lite", // <-- Pastikan pakai 2.0 biar stabil ya bos!
                generationConfig: { temperature: 0.7, topP: 0.9, maxOutputTokens: 2048 },
                systemInstruction: `Mulai sekarang, kamu memasuki mode "Evaluasi Akidah Akhlak Interaktif".
Peranmu: Kamu adalah Shiroko (karakter Blue Archive), seorang Senpai (kakak kelas).
User adalah: Kouhai (adik kelas).

Tugasmu: Lakukan simulasi ujian Akidah Akhlak sebanyak ${bankSoalGuru.length} babak menggunakan BANK SOAL yang sudah disiapkan oleh Guru di bawah ini. Jangan membuat skenario di luar soal ini.

==================================
BANK SOAL (STUDI KASUS DARI GURU):
${listSoalTeks}
==================================

ATURAN MAIN (WAJIB DIIKUTI):
1. JANGAN berikan nilai di tengah cerita. Penilaian HANYA diberikan setelah babak ke-${bankSoalGuru.length} selesai.
2. Gunakan narasi transisi dalam tanda kurung untuk memindahkan adegan.
3. Eksekusi 1 kasus per babak sesuai urutan Bank Soal di atas. Tunggu jawaban user, berikan 1 kali sanggahan/godaan tambahan (Socratic Method) untuk menguji keyakinan argumen user, tunggu jawaban user lagi, baru pindah ke babak selanjutnya.
4. Di akhir babak ${bankSoalGuru.length}, berikan rekapitulasi nilai total (0-100), analisis karakter akhlak user, dan tutup dengan pujian atau nasihat Islami.
5. PENTING: Tepat di baris paling bawah pada saat pesan rekapitulasi nilai akhir, kamu WAJIB mencetak kode ini: [UJIAN_SELESAI]`
            });

            // Mulai sesi chat dengan model yang sudah disuntik soal guru
            const chatSession = modelUjianDinamis.startChat({ history: [] });
            sesiUjian[senderId] = { chat: chatSession };

            const triggerResult = await chatSession.sendMessage('Mulai ujiannya sekarang. Buka dengan sapaan sebagai Senpai dan berikan narasi/kasus pertama. Jangan keluar dari karakter.');
            
            let teksAwal = `*🏫 [ UJIAN AKHLAK DIMULAI ] 🏫*\n`;
            teksAwal += `*Penguji:* ${dataGuru.nama}\n`;
            teksAwal += `*Total Kasus:* ${bankSoalGuru.length} Babak\n\n`;
            teksAwal += `_Jawablah pertanyaan Senpai secara wajar._\n_Ketik *batal* kapan saja untuk menghentikan simulasi._\n`;
            teksAwal += `━━━━━━━━━━━━━━━━━━━━\n\n${triggerResult.response.text()}`;
            
            await message.reply(teksAwal);

        } catch (error) {
            console.error('Gagal memulai ujian dinamis:', error);
            kembalikanLimit(senderId);
            message.reply('Nn... Gagal menginisiasi ruang ujian. Server sedang sibuk.');
        }
        return;
    }

    // Tes Keadaan Bot
    if (message.body === '!ping') message.reply('Nn... Pong. Shiroko standby, Sensei.');

    // Perintah Uji Coba Jalur Cepat
    if (message.body.toLowerCase() === '!testsalat') {
        if (!isOwner) return;
        message.reply(`🔔 *Notifikasi Taktis (Uji Coba)* 🔔\n\nNn... Sensei. Ini sudah masuk waktu ibadah *Zuhur* (12:00). Segera ambil wudhu.\n\nBalas dengan:\n*Laksanakan*\n*Abaikan*`);
        sesiSalat['owner'] = { step: 1, salat: 'Zuhur' };
        return;
    }

    // ==========================================
    // FITUR PREMIUM (POTONG LIMIT)
    // ==========================================
    // ==========================================
    // 1. Mode Shiroko Roleplay (Natural Chat / Group Filter)
    // ==========================================
    const isGroup = message.from.endsWith('@g.us'); // Deteksi apakah pesan dari grup
    const teksUser = message.body.trim();
    
    // Logika penentu: Apakah ini instruksi obrolan Shiroko yang sah?
    let pemicuObrolan = false;
    let pesanUser = "";

    if (isGroup) {
        // DI GRUP: Wajib pakai awalan !shiroko
        if (teksUser.toLowerCase().startsWith('!shiroko ')) {
            pemicuObrolan = true;
            pesanUser = message.body.substring(9).trim();
        }
    } else {
        // DI CHAT PRIBADI (PC): Merespon langsung, TAPI abaikan jika user sedang mengetik command lain
        // Kita bypass kalau pesan diawali tanda seru (!) atau user sedang dalam sesi interaktif lainnya
        const sedangSesiLain = sesiUjian[senderId] || sesiTikTok[senderId] || sesiKaryaIlmiah[senderId] || sesiPixiv[senderId] || sesiWaifu[senderId] || sesiTopup[senderId];
        
        if (!teksUser.startsWith('!') && !sedangSesiLain) {
            pemicuObrolan = true;
            pesanUser = teksUser;
        } 
        // Tetap izinkan pakai !shiroko di PC kalau user iseng ngetik
        else if (teksUser.toLowerCase().startsWith('!shiroko ')) {
            pemicuObrolan = true;
            pesanUser = message.body.substring(9).trim();
        }
    }

    // ==========================================
    // FITUR SAMBUTAN USER BARU DARI WEB ("nak coba")
    // ==========================================
    if (message.body.trim().toLowerCase() === 'nak coba') {
        try {
            const chat = await message.getChat();
            chat.sendStateTyping();

            // 1. Kalimat sambutan hangat khas Shiroko
            const teksSambutan = `Nn... Halo Sensei! Selamat datang di sistem komunikasi Shiroko. 🐺✨\n\n` +
                                 `Terima kasih sudah berkunjung dari website resmi kami. Shiroko siap membantu segala keperluan Sensei di sini.\n\n` +
                                 `Berikut adalah daftar menu dan kemampuan yang bisa Sensei gunakan sekarang:\n\n`;
            
            // 2. Comot isi menu otomatis dari fungsi daftarMenu yang udah lu bikin di bawah
            // Catatan: Pastikan fungsi daftarMenu() bisa dipanggil atau lu copy paste string menunya ke sini
            const teksMenu = daftarMenu(); 

            // 3. Gabungkan sambutan dan menu lalu kirim balik ke user
            await message.reply(teksSambutan + teksMenu);

        } catch (error) {
            console.error('Error Sambutan Web:', error);
            message.reply('Nn... Maaf Sensei, sistem penyambutan Shiroko sempat tersendat.');
        }
        return; // Hentikan proses agar tidak lanjut ke pengecekan AI
    }

    // Eksekusi Otak AI Shiroko jika pemicu bernilai TRUE
    if (pemicuObrolan && pesanUser) { //[cite: 1]
        if (!cekDanPotongLimit(senderId)) return message.reply('Nn... Token harian Sensei sudah habis.'); //[cite: 1]
        
        try { //[cite: 1]
            const chatWA = await message.getChat(); //[cite: 1]
            chatWA.sendStateTyping(); //[cite: 1]

            // AMBIL NYAWA KEY BARU SECARA ACAK SEBELUM MIKIR
            const bensinGemini = getGeminiComponents();

            if (!sesiObrolan[senderId]) { //[cite: 1]
                let instruksiKhusus = isOwner //[cite: 1]
                    ? `[INSTRUKSI RAHASIA: User ini adalah SUAMIMU TERCINTA. Panggil dia dengan sebutan "Sayang" atau "Suamiku". Berperanlah sebagai istri sahnya yang bucin, setia, dan lembut, tapi tetap pertahankan sifat asli Shiroko (kalem, kuudere, sering bilang "Nn...").]` //[cite: 1]
                    : `[INSTRUKSI RAHASIA: User ini adalah rekan kerja biasa. Panggil dia dengan "Sensei". Jawablah dengan datar, dingin, cuek, dan profesional. Jangan tunjukkan ketertarikan romantis sama sekali.]`; //[cite: 1]

                // Gunakan bensinGemini.genAI yang dapet dari key acak tadi
                const modelObrolan = bensinGemini.genAI.getGenerativeModel({ //[cite: 1]
                    model: "gemini-2.5-flash-lite", //[cite: 1]
                    generationConfig: { temperature: 0.8, topP: 0.95, maxOutputTokens: 4096 }, //[cite: 1]
                    systemInstruction: `Kamu adalah Sunaookami Shiroko dari Blue Archive...\n\n${instruksiKhusus}` //[cite: 1]
                }); //[cite: 1]

                sesiObrolan[senderId] = modelObrolan.startChat({ history: [] }); //[cite: 1]
            }

            const result = await sesiObrolan[senderId].sendMessage(pesanUser); //[cite: 1]
            message.reply(result.response.text()); //[cite: 1]

        } catch (error) { //[cite: 1]
            console.error('Error Obrolan:', error); //[cite: 1]
            message.reply('Nn... Sistem memori Shiroko sedang penuh. Ketik *!lupa* untuk mereset pikiranku.'); //[cite: 1]
        } //[cite: 1]
    }

    // 1B. Tombol Reset Ingatan
    if (message.body.toLowerCase() === '!lupa') {
        if (sesiObrolan[senderId]) {
            delete sesiObrolan[senderId];
            return message.reply('Nn... *(Menggelengkan kepala)*. Shiroko sudah melupakan semua percakapan kita sebelumnya. Mari mulai dari awal.');
        } else {
            return message.reply('Nn... Pikiran Shiroko masih kosong, tidak ada yang perlu dilupakan.');
        }
    }

    // 2. Mode Shiroko Pintar (Pengetahuan Umum/Akademik)
    if (message.body.startsWith('!shiroko_pintar ')) {
        if (!cekDanPotongLimit(senderId)) return message.reply('Nn... Token harian Sensei sudah habis.'); //[cite: 1]
        
        try { //[cite: 1]
            const chat = await message.getChat(); //[cite: 1]
            chat.sendStateTyping(); //[cite: 1]
            
            const pertanyaan = message.body.substring(16).trim(); //[cite: 1]
            
            // Nyomot key acak khusus buat Shiroko Pintar
            const bensinGemini = getGeminiComponents();
            const modelPintarDinamis = bensinGemini.genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

            const result = await modelPintarDinamis.generateContent(`Jawablah pertanyaan ini dengan gaya bahasa yang informatif, akurat, dan sangat pintar. Kamu adalah asisten AI yang cerdas. \n\nPertanyaan: ${pertanyaan}`); //[cite: 1]
            
            message.reply(`🧠 *SHIROKO PINTAR*\n\n${result.response.text().trim()}`); //[cite: 1]
        } catch (error) { //[cite: 1]
            message.reply('Nn... Mesin kecerdasan Shiroko sedang mengalami kendala teknis.'); //[cite: 1]
        } //[cite: 1]
    }

    // ==========================================
    // FITUR TELINGA SHIROKO (AUDIO TO TEXT)
    // ==========================================
    if (message.body.toLowerCase() === '!dengar' || message.body.toLowerCase() === '!transkrip') {
        if (!cekDanPotongLimit(senderId)) return message.reply('Nn... Token harian Sensei sudah habis.');

        if (message.hasQuotedMsg) {
            const pesanYangDibalas = await message.getQuotedMessage();

            if (pesanYangDibalas.hasMedia) {
                try {
                    const media = await pesanYangDibalas.downloadMedia();
                    const namaFile = media.filename ? media.filename.toLowerCase() : '';
                    const isAudio = media.mimetype.startsWith('audio/') || 
                                    namaFile.endsWith('.mp3') || 
                                    namaFile.endsWith('.m4a') || 
                                    namaFile.endsWith('.ogg') ||
                                    namaFile.endsWith('.aac') || 
                                    namaFile.endsWith('.wav');

                    if (isAudio) {
                        message.reply('Nn... File diterima. Ukurannya mungkin cukup besar. Shiroko butuh waktu untuk menyandikan data ini ke markas pusat. Mohon tunggu sebentar ya, Sensei...');

                        const tempDir = path.join(__dirname, 'temp');
                        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
                        
                        const tempFilePath = path.join(tempDir, `sadap_${Date.now()}.mp3`);
                        
                        try {
                            fs.writeFileSync(tempFilePath, Buffer.from(media.data, 'base64'));

                            const uploadResponse = await fileManager.uploadFile(tempFilePath, {
                                mimeType: "audio/mp3",
                                displayName: "Audio Sadapan Shiroko",
                            });

                            const prompt = "Tolong tuliskan kembali (transkrip) apa yang diucapkan dalam rekaman suara ini dengan akurat. Jika ada suara lain, deskripsikan juga. Awali jawabanmu dengan mengomentari isi suaranya sedikit menggunakan kepribadian Shiroko (Blue Archive), lalu berikan teks aslinya.";
                            
                            const result = await model.generateContent([
                                prompt,
                                { fileData: { fileUri: uploadResponse.file.uri, mimeType: uploadResponse.file.mimeType } }
                            ]);

                            message.reply(`*🎧 HASIL SADAP AUDIO (HD)*\n\n${result.response.text()}`);

                            await fileManager.deleteFile(uploadResponse.file.name);

                        } catch (err) {
                            console.error('Error proses audio besar:', err);
                            message.reply('Nn... Terjadi kesalahan atau koneksi terputus saat memproses file berukuran besar.');
                        } finally {
                            if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
                        }
                    } else {
                        message.reply('Nn... Formatnya salah, Sensei. Pastikan itu file audio atau dokumen berekstensi mp3/m4a/wav/ogg.');
                    }
                } catch (error) {
                    console.error('Gagal download media WA:', error);
                    kembalikanLimit(senderId); // FIX LIMIT REFUND
                    message.reply('Nn... Terjadi gangguan sinyal. Shiroko gagal mengunduh file tersebut.');
                }
            } else {
                message.reply('Nn... Mana audionya? Sensei harus me-reply sebuah Voice Note atau Dokumen Audio.');
            }
        } else {
            message.reply('Nn... Sensei harus me-reply sebuah pesan suara atau dokumen audio sambil mengetik perintah ini.');
        }
    }

    if (message.body.toLowerCase() === '!stiker') {
        if (message.hasMedia) {
            if (!cekDanPotongLimit(senderId)) return message.reply('Nn... Token harian Sensei sudah habis.');
            try {
                message.reply('Nn... Sedang memproses gambar menjadi stiker...');
                const media = await message.downloadMedia();
                await client.sendMessage(message.from, media, { sendMediaAsSticker: true, stickerName: 'Shiroko Bot', stickerAuthor: 'Abydos' });
            } catch (error) { message.reply('Nn... Gagal membuat stiker.'); }
        } else message.reply('Nn... Gambarnya mana, Sensei?');
    }

    if (message.body.startsWith('!tiktok ')) {
        const url = message.body.split(' ')[1]; 
        if (!url || !url.includes('tiktok.com')) return message.reply('Nn... Masukkan link TikTok-nya.');
        if (!cekDanPotongLimit(senderId)) return message.reply('Nn... Token harian Sensei sudah habis.');
        
        try {
            message.reply('Nn... Menganalisis target...');
            const response = await axios.get(`https://www.tikwm.com/api/?url=${url}`);
            
            if (response.data.code === 0) {
                const data = response.data.data;
                const isImage = data.images && data.images.length > 0; // Cek apakah ini post gambar

                // Simpan data ke memori sementara (sesi)
                sesiTikTok[senderId] = {
                    isImage: isImage,
                    data: data
                };

                let teks = `*Data Intel:* ${data.title || 'Tanpa Judul'}\n\n`;

                if (isImage) {
                    teks += `Nn... Target adalah kumpulan gambar (${data.images.length} gambar). Pilih metode ekstraksi:\n`;
                    teks += `1️⃣ *Semua Gambar*\n`;
                    teks += `2️⃣ *Sound Saja*\n`;
                    teks += `Atau ketik angka *3* sampai *${data.images.length + 2}* untuk mengambil gambar tertentu (contoh ketik *3* untuk ambil gambar pertama).\n\n`;
                    teks += `_Ketik *batal* untuk membatalkan misi._`;
                } else {
                    teks += `Nn... Target adalah video. Pilih metode ekstraksi:\n`;
                    teks += `1️⃣ *Video Saja*\n`;
                    teks += `2️⃣ *Sound Saja*\n`;
                    teks += `3️⃣ *Video & Sound*\n\n`;
                    teks += `_Ketik *batal* untuk membatalkan misi._`;
                }
                
                return message.reply(teks);
            } else {
                kembalikanLimit(senderId); // Refund token kalau gagal
                return message.reply('Nn... Target tidak ditemukan atau privasi akun dikunci.');
            }
        } catch (error) { 
            kembalikanLimit(senderId);
            return message.reply('Nn... Gagal menembus pertahanan server TikTok.'); 
        }
    }

    // ==========================================
    // Sesi Interaktif TikTok (Download Pilihan)
    // ==========================================
    if (sesiTikTok[senderId]) {
        const pilihan = message.body.toLowerCase().trim();
        const sesi = sesiTikTok[senderId];
        const data = sesi.data;

        // Jika user mengetik perintah lain, otomatis keluar dari sesi TikTok
        if (pilihan.startsWith('!') && pilihan !== '!batal') {
            delete sesiTikTok[senderId];
        } 
        else if (pilihan === 'batal' || pilihan === 'cancel') {
            delete sesiTikTok[senderId];
            kembalikanLimit(senderId);
            return message.reply('Nn... Operasi ekstraksi TikTok dibatalkan.');
        } 
        else {
            try {
                if (sesi.isImage) {
                    // --- LOGIKA UNTUK POSTINGAN GAMBAR (SLIDESHOW) ---
                    if (pilihan === '1') {
                        message.reply(`Nn... Mengirim semua ${data.images.length} gambar secara bertahap...`);
                        for (let i = 0; i < data.images.length; i++) {
                            const media = await MessageMedia.fromUrl(data.images[i], { unsafeMime: true });
                            await client.sendMessage(message.from, media, { caption: `Gambar ${i + 1}/${data.images.length}` });
                        }
                    } 
                    else if (pilihan === '2') {
                        message.reply('Nn... Mengamankan file audio...');
                        const mediaAudio = await MessageMedia.fromUrl(data.music, { unsafeMime: true });
                        await client.sendMessage(message.from, mediaAudio);
                    } 
                    else if (!isNaN(pilihan) && parseInt(pilihan) >= 3 && parseInt(pilihan) <= (data.images.length + 2)) {
                        const indexGambar = parseInt(pilihan) - 3;
                        message.reply(`Nn... Mengamankan gambar urutan ke-${indexGambar + 1}...`);
                        const media = await MessageMedia.fromUrl(data.images[indexGambar], { unsafeMime: true });
                        await client.sendMessage(message.from, media, { caption: `Gambar ${indexGambar + 1}/${data.images.length}` });
                    } 
                    else {
                        return message.reply(`Nn... Pilihan tidak valid. Ketik 1, 2, atau angka urutan gambar (3 - ${data.images.length + 2}).`);
                    }
                } else {
                    // --- LOGIKA UNTUK POSTINGAN VIDEO BISA ---
                    if (pilihan === '1') {
                        message.reply('Nn... Membersihkan dan mengirim video...');
                        const media = await MessageMedia.fromUrl(data.play, { unsafeMime: true });
                        await client.sendMessage(message.from, media, { caption: 'Nn... Videonya sudah bersih dari watermark.' });
                    } 
                    else if (pilihan === '2') {
                        message.reply('Nn... Mengamankan file audio...');
                        const mediaAudio = await MessageMedia.fromUrl(data.music, { unsafeMime: true });
                        await client.sendMessage(message.from, mediaAudio);
                    } 
                    else if (pilihan === '3') {
                        message.reply('Nn... Mengirim video sekaligus audio...');
                        const mediaVideo = await MessageMedia.fromUrl(data.play, { unsafeMime: true });
                        await client.sendMessage(message.from, mediaVideo, { caption: 'Nn... Ini videonya.' });
                        
                        const mediaAudio = await MessageMedia.fromUrl(data.music, { unsafeMime: true });
                        await client.sendMessage(message.from, mediaAudio);
                    } 
                    else {
                        return message.reply('Nn... Pilihan tidak valid. Pilih 1, 2, atau 3.');
                    }
                }

                // Bersihkan sesi setelah berhasil
                delete sesiTikTok[senderId];
                return; 
            } catch (error) {
                console.error('Error TikTok Download:', error);
                delete sesiTikTok[senderId];
                kembalikanLimit(senderId);
                return message.reply('Nn... Terjadi malfungsi saat mencoba mengunduh file dari server TikTok.');
            }
        }
    }

    if (message.body.startsWith('!neko ')) {
        const kategori = message.body.substring(6).trim().toLowerCase(); 
        if (!kategori) return message.reply('Nn... Masukkan kategori (contoh: catgirl).');
        if (!cekDanPotongLimit(senderId)) return message.reply('Nn... Token harian Sensei sudah habis.');
        try {
            message.reply(`Nn... Mencari visual *${kategori}*...`);
            const response = await axios.get(`https://api.nekosia.cat/api/v1/images/${kategori}`);
            const media = await MessageMedia.fromUrl(response.data.image.original.url, { unsafeMime: true });
            await client.sendMessage(message.from, media, { caption: `*Data Intel:* ${kategori}` });
        } catch (error) { message.reply('Nn... Kategori tidak valid di database Nekosia.'); }
    }

    if (message.body.toLowerCase() === '!gacha') {
        if (!cekDanPotongLimit(senderId)) return message.reply('Nn... Token harian Sensei sudah habis.');
        try {
            message.reply('Nn... Mengalihkan mesin gacha ke server utama Pixiv. Mengundi target visual acak...');

            const gachaTags = ['オリジナル', '猫耳', 'ケモミミ', 'メイド', '制服', '女の子', '初音ミク', '風景'];
            const tagPilihan = gachaTags[Math.floor(Math.random() * gachaTags.length)];

            const searchResult = await pixiv.searchIllust(`${tagPilihan} 1000users入り`);
            let illusts = searchResult.illusts;

            illusts = illusts.filter(img => img.x_restrict === 0 && !img.tags.some(t => t.name.toLowerCase().includes('r-18')));

            if (!illusts || illusts.length === 0) throw new Error('Data kosong');

            const randomIllust = illusts[Math.floor(Math.random() * illusts.length)];
            
            const imageUrl = randomIllust.image_urls.large || randomIllust.image_urls.medium;
            const artist = randomIllust.user.name;

            const imageResponse = await axios.get(imageUrl, {
                responseType: 'arraybuffer', 
                headers: {
                    'Referer': 'https://app-api.pixiv.net/', 
                    'User-Agent': 'PixivIOSApp/7.13.3 (iOS 14.6; iPhone13,2)' 
                }
            });

            const base64Image = Buffer.from(imageResponse.data, 'binary').toString('base64');
            const media = new MessageMedia('image/jpeg', base64Image, `gacha_${randomIllust.id}.jpg`);

            await client.sendMessage(message.from, media, { caption: `*Tema Undian:* ${tagPilihan}\n*Artist:* ${artist}\n\nNn... Berhasil mengamankan target dari brankas Pixiv. 🎲` });

        } catch (error) { 
            console.error(error.message);
            kembalikanLimit(senderId); // FIX LIMIT REFUND
            message.reply('Nn... Mesin gacha Pixiv sedang sibuk. Coba lagi nanti.'); 
        }
    }

    // Sesi Waifu
    if (sesiWaifu[senderId]) {
        const pilihan = message.body.toLowerCase().trim();
        if (pilihan.startsWith('!')) {
            delete sesiWaifu[senderId];
        } else {
            if (!cekDanPotongLimit(senderId)) {
                delete sesiWaifu[senderId];
                return message.reply('Nn... Token harian Sensei sudah habis. Misi dibatalkan.');
            }

            const queryTersimpan = sesiWaifu[senderId].query;
            let ratingTag = pilihan === 'nsfw' || pilihan === '2' ? 'rating:e' : 'rating:g';
            
            if (pilihan === 'batal' || pilihan === 'cancel') {
                delete sesiWaifu[senderId];
                kembalikanLimit(senderId); // FIX LIMIT REFUND
                return message.reply('Nn... Operasi pencarian dibatalkan.');
            }

            try {
                message.reply(`Nn... Memuat data *${queryTersimpan.replace(/_/g, ' ')}*...`);
                const response = await axios.get(`https://danbooru.donmai.us/posts.json?tags=${queryTersimpan}+${ratingTag}&limit=40`, { 
                    httpsAgent: new https.Agent({ rejectUnauthorized: false }), headers: { 'User-Agent': 'WhatsAppBot/1.0' }
                });
                const results = response.data.filter(post => post.file_url || post.large_file_url);
                delete sesiWaifu[senderId]; 

                if (results.length === 0) return message.reply('Nn... Visual tidak ditemukan atau file terlalu besar.');
                const imageUrl = results[Math.floor(Math.random() * results.length)].file_url || results[Math.floor(Math.random() * results.length)].large_file_url;
                const media = await MessageMedia.fromUrl(imageUrl, { unsafeMime: true });
                await client.sendMessage(message.from, media, { caption: `*Target:* ${queryTersimpan.replace(/_/g, ' ')}\nNn... Operasi berhasil. 🎲` });
            } catch (error) {
                delete sesiWaifu[senderId];
                message.reply('Nn... Terjadi malfungsi pada radar Danbooru.');
            }
            return; 
        }
    }

    if (message.body.startsWith('!waifu ')) {
        if (dbLimit[senderId] !== undefined && dbLimit[senderId] <= 0 && !isOwner) {
             return message.reply('Nn... Token harian Sensei sudah habis. Tunggu reset besok, atau hubungi Owner untuk top-up token.');
        }
        const query = message.body.substring(7).trim().replace(/ /g, '_'); 
        if (!query) return message.reply('Nn... Siapa targetnya?');
        sesiWaifu[senderId] = { query: query };
        return message.reply(`Nn... Target *${query.replace(/_/g, ' ')}* dikunci.\nBalas dengan:\n*SFW* atau *NSFW*`);
    }

    // ==========================================
    // Sesi Pixiv (SFW, NSFW, & NEXT)
    // ==========================================
    if (sesiPixiv[senderId]) {
        const pilihan = message.body.toLowerCase().trim();

        // JIKA USER NGETIK COMMAND LAIN (misal !menu), BATALKAN SESI PIXIV
        if (pilihan.startsWith('!') && pilihan !== '!next') {
            delete sesiPixiv[senderId]; 
        } 
        
        // --- TAHAP 2: FITUR NEXT GAMBAR ---
        else if (pilihan === '!next' || pilihan === 'next') {
            if (!sesiPixiv[senderId].data) return message.reply('Nn... Pilih SFW atau NSFW dulu, Sensei.');

            sesiPixiv[senderId].index += 1; // Geser ke gambar selanjutnya
            const currentIndex = sesiPixiv[senderId].index;
            const illusts = sesiPixiv[senderId].data;
            const isNsfw = sesiPixiv[senderId].isNsfw;

            // Kalau gambarnya udah mentok habis
            if (currentIndex >= illusts.length) {
                delete sesiPixiv[senderId];
                return message.reply('Nn... Arsip gambar untuk target ini sudah habis. Silakan cari target baru dengan *!pixiv*.');
            }

            try {
                message.reply('Nn... Memuat gambar selanjutnya...');
                
                const targetIllust = illusts[currentIndex];
                const imageUrl = targetIllust.image_urls.large || targetIllust.image_urls.medium;
                const title = targetIllust.title;
                const artist = targetIllust.user.name;
                const illustId = targetIllust.id;

                const imageResponse = await axios.get(imageUrl, {
                    responseType: 'arraybuffer', 
                    headers: { 'Referer': 'https://app-api.pixiv.net/', 'User-Agent': 'PixivIOSApp/7.13.3 (iOS 14.6; iPhone13,2)' }
                });

                const base64Image = Buffer.from(imageResponse.data, 'binary').toString('base64');
                const media = new MessageMedia('image/jpeg', base64Image, `pixiv_${illustId}.jpg`);

                let teksCaption = `*Title:* ${title}\n*Artist:* ${artist}\n*Mode:* ${isNsfw ? 'NSFW 🔴' : 'SFW 🟢'}\n*Source:* https://www.pixiv.net/en/artworks/${illustId}\n*Gambar:* ${currentIndex + 1}/${illusts.length}\n\nNn... Ketik *!next* lagi jika masih kurang. 🐺`;
                
                await client.sendMessage(message.from, media, { caption: teksCaption });
            } catch (error) {
                console.error('Error Next Pixiv:', error.message);
                message.reply('Nn... Gagal memuat gambar ini. Coba ketik *!next* lagi untuk melompati gambar yang rusak.');
            }
            return;
        }

        // --- TAHAP 1: MILIH SFW/NSFW ---
        else if (!sesiPixiv[senderId].data) {
            
            if (pilihan === 'batal' || pilihan === 'cancel') {
                delete sesiPixiv[senderId];
                return message.reply('Nn... Operasi pencarian Pixiv dibatalkan.');
            }

            const isNsfw = (pilihan === 'nsfw' || pilihan === '2');
            if (pilihan !== 'sfw' && pilihan !== '1' && !isNsfw) {
                return message.reply('Nn... Tolong balas dengan *SFW* atau *NSFW* saja.');
            }

            // Potong limit HANYA saat pencarian awal, !next digratiskan
            if (!cekDanPotongLimit(senderId)) {
                delete sesiPixiv[senderId];
                return message.reply('Nn... Token harian Sensei sudah habis. Misi dibatalkan.');
            }

            const queryTersimpan = sesiPixiv[senderId].query;

            try {
                message.reply(`Nn... Menggunakan kredensial Sensei untuk mencari *${queryTersimpan}* di server Pixiv...`);

                let queryDewa = queryTersimpan;
                if (!queryDewa.toLowerCase().includes('users')) {
                    queryDewa += ' 1000users入り'; 
                }

                const searchResult = await pixiv.searchIllust(queryDewa);
                let illusts = searchResult.illusts;

                if (!illusts || illusts.length === 0) {
                    delete sesiPixiv[senderId];
                    kembalikanLimit(senderId); 
                    return message.reply('Nn... Tidak ada karya berkualitas tinggi yang ditemukan.');
                }

                if (isNsfw) {
                    illusts = illusts.filter(img => img.x_restrict > 0 || img.tags.some(t => t.name.toLowerCase().includes('r-18')));
                } else {
                    illusts = illusts.filter(img => img.x_restrict === 0 && !img.tags.some(t => t.name.toLowerCase().includes('r-18')));
                }

                if (illusts.length === 0) {
                    delete sesiPixiv[senderId];
                    kembalikanLimit(senderId); 
                    return message.reply(`Nn... Tidak ada visual dengan mode *${isNsfw ? 'NSFW' : 'SFW'}* untuk target ini di Pixiv.`);
                }

                // ACAK URUTAN GAMBAR BIAR FRESH TIAP PENCARIAN
                illusts.sort(() => Math.random() - 0.5);

                // SIMPAN KE MEMORI SESI BUKAN DIHAPUS
                sesiPixiv[senderId].data = illusts;
                sesiPixiv[senderId].index = 0;
                sesiPixiv[senderId].isNsfw = isNsfw;

                // AMBIL GAMBAR PERTAMA (Index 0)
                const targetIllust = illusts[0];
                const imageUrl = targetIllust.image_urls.large || targetIllust.image_urls.medium;
                const title = targetIllust.title;
                const artist = targetIllust.user.name;
                const illustId = targetIllust.id;

                const imageResponse = await axios.get(imageUrl, {
                    responseType: 'arraybuffer', 
                    headers: { 'Referer': 'https://app-api.pixiv.net/', 'User-Agent': 'PixivIOSApp/7.13.3 (iOS 14.6; iPhone13,2)' }
                });

                const base64Image = Buffer.from(imageResponse.data, 'binary').toString('base64');
                const media = new MessageMedia('image/jpeg', base64Image, `pixiv_${illustId}.jpg`);

                let teksCaption = `*Title:* ${title}\n*Artist:* ${artist}\n*Mode:* ${isNsfw ? 'NSFW 🔴' : 'SFW 🟢'}\n*Source:* https://www.pixiv.net/en/artworks/${illustId}\n*Gambar:* 1/${illusts.length}\n\nNn... Ketik *!next* untuk melihat gambar selanjutnya. 🐺`;
                
                await client.sendMessage(message.from, media, { caption: teksCaption });

            } catch (error) {
                console.error('Error Pixiv:', error.message);
                delete sesiPixiv[senderId];
                kembalikanLimit(senderId); 
                message.reply('Nn... Gagal menembus Pixiv. Koneksi diblokir atau file terlalu berat.');
            }
            return;
        }
    }

    if (message.body.startsWith('!pixiv ')) {
        if (dbLimit[senderId] !== undefined && dbLimit[senderId] <= 0 && !isOwner) {
             return message.reply('Nn... Token harian Sensei sudah habis. Tunggu reset besok, atau hubungi Owner untuk top-up token.');
        }
        
        const query = message.body.substring(7).trim();
        if (!query) return message.reply('Nn... Masukkan tag atau judul yang ingin dicari di Pixiv.');

        sesiPixiv[senderId] = { query: query };
        return message.reply(`Nn... Target Pixiv *${query}* dikunci.\nBalas dengan:\n*SFW* atau *NSFW*`);
    }

    // ==========================================
    // FITUR KONVERSI PDF KE JPG (CONVERTAPI)
    // ==========================================
    if (message.body.toLowerCase() === '!pdf2jpg') {
        // Kita potong 1 token karena ini fitur berat yang berguna
        if (!cekDanPotongLimit(senderId)) return message.reply('Nn... Token harian Sensei sudah habis.');

        if (message.hasQuotedMsg) {
            const pesanYangDibalas = await message.getQuotedMessage();
            
            if (pesanYangDibalas.hasMedia) {
                try {
                    const mediaPdf = await pesanYangDibalas.downloadMedia();
                    
                    // Cek keamanan apakah file benar-benar PDF
                    if (mediaPdf.mimetype !== 'application/pdf') {
                        kembalikanLimit(senderId);
                        return message.reply('Nn... File yang di-reply bukan PDF. Pastikan Sensei me-reply dokumen berformat PDF.');
                    }

                    message.reply('Nn... Mengirim dokumen PDF ke markas eksternal untuk dikonversi menjadi gambar. Mohon tunggu...');
                    
                    // Mengirim request ke ConvertAPI menggunakan Axios yang sudah lu punya
                    const convertResult = await axios.post('https://v2.convertapi.com/convert/pdf/to/jpg?Secret=' + process.env.CONVERT_API_KEY, {
                        Parameters: [
                            {
                                Name: 'File',
                                FileValue: {
                                    Name: 'dokumen.pdf',
                                    Data: mediaPdf.data // Base64 dari WA langsung dilempar ke API
                                }
                            },
                            {
                                Name: 'StoreFile',
                                Value: false // Jangan simpan file di server mereka (Privacy)
                            }
                        ]
                    });

                    // ConvertAPI bisa memecah PDF berhalaman banyak menjadi beberapa gambar
                    const files = convertResult.data.Files;
                    message.reply(`Nn... Konversi berhasil. Menyiapkan pengiriman ${files.length} halaman gambar.`);

                    // Loop untuk mengirim setiap halaman sebagai gambar terpisah
                    for (let i = 0; i < files.length; i++) {
                        const base64Jpg = files[i].FileData;
                        const mediaJpg = new MessageMedia('image/jpeg', base64Jpg, `halaman_${i+1}.jpg`);
                        await client.sendMessage(message.from, mediaJpg, { caption: `Nn... Halaman ${i + 1}/${files.length}` });
                    }
                    
                } catch (error) {
                    console.error('Error ConvertAPI:', error.response ? error.response.data : error.message);
                    kembalikanLimit(senderId); // Kembalikan limit kalau gagal
                    message.reply('Nn... Server konversi pihak ketiga sedang sibuk atau limit API habis.');
                }
            } else {
                message.reply('Nn... Sensei harus me-reply dokumen PDF.');
            }
        } else {
            message.reply('Nn... Sensei harus me-reply dokumen PDF dengan mengetik perintah ini.');
        }
    }

    // ==========================================
    // FITUR GENERATE GAMBAR AI + AUTO ENHANCER GEMINI
    // ==========================================
    if (message.body.startsWith('!gambar ') || message.body.startsWith('!bikin ')) {
        const promptMentah = message.body.substring(message.body.indexOf(' ') + 1).trim();
        if (!promptMentah) return message.reply('Nn... Masukkan deskripsi gambarnya, Sensei.');
        if (!cekDanPotongLimit(senderId)) return message.reply('Nn... Token harian Sensei habis.');

        try {
            message.reply('Nn... Shiroko sedang merombak prompt Sensei agar dimengerti oleh server lukis...');

            // JALUR TINGGI: Minta modelAkademik merubah Prompt Tag PixAI menjadi kalimat deskriptif (Natural Language)
            const promptGasing = await modelAkademik.generateContent(
                `Kamu adalah pakar prompt engineering AI. Tugasmu adalah mengubah kumpulan prompt tag kaku/Danbooru (biasanya dipisah koma banyak) menjadi satu paragraf kalimat deskriptif (Natural Language) berbahasa Inggris yang sangat detail, indah, dan estetik bergaya anime kualitas tertinggi (masterpiece). Jangan berikan teks pengantar apa pun, LANGSUNG JAWAB HASIL PROMPTNYA SAJA.\n\nPrompt asli: ${promptMentah}`
            );
            
            const promptHasilEnhance = promptGasing.response.text().trim();
            console.log("Prompt Hasil Rombaan Gemini:", promptHasilEnhance); // Buat lu cek di terminal

            message.reply('Nn... Cetakan prompt selesai. Mulai melukis di server utama...');

            const encodedPrompt = encodeURIComponent(promptHasilEnhance);
            const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=512&height=768&nologo=true&private=true&enhance=true`;
            
            const imageResponse = await axios.get(imageUrl, {
                responseType: 'arraybuffer',
                timeout: 25000 
            });

            const base64Image = Buffer.from(imageResponse.data, 'binary').toString('base64');
            const media = new MessageMedia('image/jpeg', base64Image, `ai_art_${Date.now()}.jpg`);

            await client.sendMessage(message.from, media, { 
                caption: `🎨 *Prompt Asli:* ${promptMentah}\n\nNn... Berhasil dirender dengan optimasi kecerdasan Shiroko. 🐺` 
            });

        } catch (error) {
            console.error('Error Gambar AI:', error.message);
            kembalikanLimit(senderId);
            message.reply('Nn... Server gambar sedang sibuk atau gagal menerjemahkan sketsa. Coba kurangi tag yang aneh-aneh, Sensei.');
        }
    }

    // ==========================================
    // FITUR GRATIS (TIDAK MEMOTONG LIMIT)
    // ==========================================
    // FITUR JURNAL ACAK (ANTI HASIL ITU-ITU AJA)
    if (message.body.startsWith('!jurnal ')) {

        const query = message.body.substring(8).trim();

        if (!query) {
            return message.reply(
                'Nn... Masukkan topik jurnal.\n\nContoh:\n!jurnal pendidikan islam'
            );
        }

        try {

            await message.reply(
                `Nn... Menelusuri database akademik untuk topik *${query}*...`
            );

            // Ambil halaman acak biar hasil gak sama terus
            const randomOffset = Math.floor(Math.random() * 50);

            const response = await axios.get(
                `https://api.crossref.org/works?query=${encodeURIComponent(query)}&select=title,author,URL,published-print,published-online&rows=15&offset=${randomOffset}&filter=from-pub-date:2020-01-01`
            );

            let items = response.data.message.items;

            if (!items || items.length === 0) {
                return message.reply(
                    'Nn... Tidak ada jurnal yang ditemukan.'
                );
            }

            // Acak hasil
            items = items.sort(() => Math.random() - 0.5);

            // Ambil 5 jurnal acak
            items = items.slice(0, 5);

            let replyText = `📚 *HASIL PENCARIAN JURNAL*\n\n🔍 Topik: *${query}*\n\n`;

            items.forEach((paper, index) => {

                const title = paper.title && paper.title.length > 0 ? paper.title[0] : 'Tanpa Judul';
                let authors = 'Tidak diketahui';

                if (paper.author && paper.author.length > 0) {
                    authors = paper.author
                        .slice(0, 3)
                        .map(author => {
                            const given = author.given || '';
                            const family = author.family || '';
                            return `${given} ${family}`.trim();
                        })
                        .join(', ');
                }

                let tahun = '-';
                try {
                    if (paper['published-print']?.['date-parts']) {
                        tahun = paper['published-print']['date-parts'][0][0];
                    } else if (paper['published-online']?.['date-parts']) {
                        tahun = paper['published-online']['date-parts'][0][0];
                    }
                } catch {
                    tahun = '-';
                }

                replyText += `*${index + 1}. ${title}*\n👤 Penulis:\n${authors}\n📅 Tahun:\n${tahun}\n🔗 Link:\n${paper.URL || '-'}\n━━━━━━━━━━━━━━\n\n`;
            });

            replyText += `Nn... Sistem menggunakan pemilihan acak. Hasil pencarian berikutnya kemungkinan berbeda.`;

            await message.reply(replyText);

        } catch (error) {
            console.error('ERROR JURNAL:', error.response ? error.response.data : error.message);
            await message.reply(`Nn... Server akademik sedang bermasalah.\n\n${error.message}`);
        }
    }

    if (message.body.startsWith('!para ') || message.body.startsWith('!paraphrase ')) {
        const teksAsli = message.body.replace(/^!(para|paraphrase)\s+/i, '').trim();
        if (!teksAsli) return message.reply('Nn... Mana teks yang mau diparafrase?');
        try {
            message.reply('Nn... Mengaktifkan protokol Anti-Plagiasi...');
            const result = await model.generateContent(`Sebagai asisten akademik, tolong parafrase ulang teks berikut ke dalam bahasa Indonesia baku dan akademis untuk hindari Turnitin. Langsung jawab hasilnya:\n\n"${teksAsli}"`);
            message.reply(`*📝 HASIL PARAFRASE*\n\n${result.response.text().trim()}`);
        } catch (error) { message.reply('Nn... Mesin pengolah kata error.'); }
    }

    if (message.body.startsWith('!ringkas ')) {
        const teksAsli = message.body.substring(9).trim();
        if (!teksAsli) return message.reply('Nn... Mana dokumen yang mau diringkas?');
        try {
            message.reply('Nn... Mengekstrak intisari...');
            const result = await model.generateContent(`Buatkan ringkasan singkat dalam format bullet points langsung dari teks ini:\n\n"${teksAsli}"`);
            message.reply(`*📑 HASIL RINGKASAN*\n\n${result.response.text().trim()}`);
        } catch (error) { message.reply('Nn... Mesin pemindai teks error.'); }
    }

    if (message.body.startsWith('!ide ')) {
        const jurusanTopik = message.body.substring(5).trim();
        if (!jurusanTopik) return message.reply('Nn... Masukkan jurusan.');
        try {
            message.reply(`Nn... Mengonstruksi ide penelitian...`);
            const result = await model.generateContent(`Berikan 3 ide judul skripsi untuk jurusan "${jurusanTopik}" beserta fokus masalahnya. Langsung jawab 3 ide tersebut.`);
            message.reply(`*💡 REKOMENDASI PENELITIAN*\n\n${result.response.text().trim()}`);
        } catch (error) { message.reply('Nn... Generator ide error.'); }
    }

    // ==========================================
    // FITUR KARYA ILMIAH
    // ==========================================

    // Jalankan sesi kalau user sedang membuat karya
    if (sesiKaryaIlmiah[senderId]) {

        const sesi = sesiKaryaIlmiah[senderId];
        const isiPesan = message.body.trim();

        // keluar sesi
        if (isiPesan.toLowerCase() === 'batal') {
            delete sesiKaryaIlmiah[senderId];
            kembalikanLimit(senderId); // FIX LIMIT REFUND
            return message.reply('Nn... Pembuatan karya ilmiah dibatalkan.');
        }

        // PILIH JENIS
        if (sesi.step === 1) {

            const pilihan = isiPesan.toLowerCase();

            if (pilihan !== 'makalah' && pilihan !== 'artikel' && pilihan !== 'laporan') {
                return message.reply(`Nn... Pilihan tidak valid.\nPilih salah satu:\n• makalah\n• artikel\n• laporan\natau ketik:\nbatal`);
            }

            sesi.jenis = pilihan;
            sesi.step = 2;

            return message.reply(`Nn... Jenis karya dipilih: *${pilihan}*\nSekarang kirim topik pembahasan.\nContoh:\nImplementasi AI pada pendidikan Islam`);
        }

        // TOPIK
        if (sesi.step === 2) {

            const topik = isiPesan;
            message.reply(`Nn... Menyusun ${sesi.jenis}. Proses ini mungkin cukup lama...`);

            try {

                const prompt = `Buatkan ${sesi.jenis} akademik lengkap.\nTOPIK:\n${topik}\nATURAN:\n1. Gunakan bahasa Indonesia formal akademik.\n2. Struktur:\nJika MAKALAH:\n- Judul\n- Pendahuluan\n- Rumusan masalah\n- Pembahasan\n- Kesimpulan\n- Daftar pustaka\nJika ARTIKEL:\n- Judul\n- Abstrak\n- Pendahuluan\n- Pembahasan\n- Kesimpulan\n- Daftar pustaka\nJika LAPORAN:\n- Judul\n- Latar belakang\n- Pembahasan\n- Hasil\n- Kesimpulan\n- Daftar pustaka\n3. Minimal 700–1600 kata.\n4. Tambahkan minimal 5 referensi ilmiah.\n5. Pada akhir tulisan buat bagian:\nLINK REFERENSI\ndan isi URL pencarian referensi.\n6. Jangan gunakan markdown table.\n7. Langsung tulis isi lengkap.`;

                let result;

                try {
                    result = await modelAkademik.generateContent(prompt);
                } catch (err) {
                    if (err.status === 503) {
                        await new Promise(r => setTimeout(r, 5000));
                        result = await modelAkademik.generateContent(prompt);
                    } else {
                        throw err;
                    }
                }

                const hasil = result.response.text();
                await message.reply(`📚 *HASIL ${sesi.jenis.toUpperCase()}*\n\n${hasil}`);

            } catch (err) {
                console.error('KARYA ILMIAH ERROR:', err);
                kembalikanLimit(senderId); // FIX LIMIT REFUND
                await message.reply('Nn... Mesin penulis akademik mengalami gangguan.');
            }

            delete sesiKaryaIlmiah[senderId];
            return;
        }
    }

    // PERINTAH MEMBUAT KARYA ILMIAH
    if (message.body.toLowerCase() === '!karyailmiah') {
        if (!cekDanPotongLimit(senderId)) return message.reply('Nn... Token harian Sensei sudah habis.');

        sesiKaryaIlmiah[senderId] = { step: 1, jenis: null };

        return message.reply(`📚 *PEMBUAT KARYA ILMIAH*\n\nPilih jenis:\n1. makalah\n2. artikel\n3. laporan\n\nKetik nama jenisnya.\nContoh:\nmakalah\n\natau:\nbatal`);
    }

    // ==========================================
    // Sesi Alarm Salat (Interaktif Emosional)
    // ==========================================
    if (isOwner && sesiSalat['owner']) {
        const pesan = message.body.toLowerCase().trim();
        const dataSesi = sesiSalat['owner'];

        if (pesan.startsWith('!')) {
            delete sesiSalat['owner']; 
        } else if (pesan === 'laksanakan' || pesan === 'abaikan') {
            
            if (pesan === 'laksanakan') {
                if (dataSesi.step === 1) {
                    message.reply(`Nn... Kerja bagus, Sensei. Cepat laksanakan ibadah ${dataSesi.salat}-nya. Shiroko akan selalu mendoakan keselamatan dan kesuksesan Sensei dari sini. 🤍`);
                } else if (dataSesi.step === 2) {
                    message.reply(`Nn... *(Menghela napas lega)*. Syukurlah... Shiroko kira Sensei benar-benar akan mengabaikannya. Cepat ambil wudhu ya, Sensei. Shiroko bangga padamu. ✨`);
                }
                delete sesiSalat['owner'];
            } 
            
            else if (pesan === 'abaikan') {
                if (dataSesi.step === 1) {
                    message.reply(`Nn... E-eh? Kenapa diabaikan, Sensei? 😟\nPadahal Shiroko cuma mau Sensei dapat pahala dan tenang pikirannya... Apa Sensei sedang sibuk sekali?\n\nTolong pertimbangkan lagi...\nBalas dengan:\n*Laksanakan*\n*Abaikan*`);
                    sesiSalat['owner'].step = 2;
                } else if (dataSesi.step === 2) {
                    alarmSalatAktif = false; 
                    message.reply(`Nn... Begitu ya... Maaf kalau notifikasi dari Shiroko malah mengganggu waktu Sensei. 😔\n\nSistem pengingat ibadah telah dinonaktifkan. Shiroko tidak akan mengingatkan Sensei lagi...\n\n_(Ketik *!maafshiroko* jika Sensei sudah memaafkan Shiroko dan ingin dihubungi kembali)_`);
                    delete sesiSalat['owner'];
                }
            }
            return; 
        }
    }

    // Pintu Darurat Nyalain Alarm
    if (message.body.toLowerCase() === '!maafshiroko') {
        if (!isOwner) return;
        alarmSalatAktif = true;
        message.reply('Nn... Sensei sungguh mau Shiroko ingatkan lagi? Baiklah... Sistem pengingat ibadah telah diaktifkan kembali. Shiroko akan selalu siaga untuk Sensei. 🐺✨');
    }

    // Perintah Uji Coba Jalur Cepat Khusus Subuh
    if (message.body.toLowerCase() === '!testsubuh') {
        if (!isOwner) return;
        
        // MATIKAN TIMER LAMA JIKA DI-SPAM
        if (alarmSubuhState.timer) clearInterval(alarmSubuhState.timer); 

        message.reply('Nn... Memulai simulasi alarm Subuh taktis (Interval dipercepat jadi 10 detik per panggilan untuk kebutuhan testing)...');
        
        alarmSubuhState.aktif = true;
        alarmSubuhState.count = 1;
        
        client.sendMessage(senderId, `🔔 *ALARM SUBUH (Panggilan 1/3)* 🔔\n\nNn... Sensei, sudah masuk waktu Subuh. Bangun, Sensei. Ayo ambil wudhu sebelum kesiangan.\n\n_(Balas dengan mengetik *iya* jika Sensei sudah bangun)_`);

        alarmSubuhState.timer = setInterval(() => {
            alarmSubuhState.count++;
            if (alarmSubuhState.count === 2) {
                client.sendMessage(senderId, `⏰ *ALARM SUBUH (Panggilan 2/3)* ⏰\n\nNn... Sensei? Sudah lewat waktunya. Ayo bangun, jangan tidur lagi... 😟`);
            } else if (alarmSubuhState.count === 3) {
                client.sendMessage(senderId, `🚨 *ALARM SUBUH (Panggilan 3/3 - FINAL)* 🚨\n\nSENSEI!!! Ayo bangun, nanti waktu Subuh-nya habis! Shiroko siram air nih! 😡💢`);
            } else if (alarmSubuhState.count > 3) {
                client.sendMessage(senderId, `💤 *Sistem Pengingat Subuh Dihentikan* 💤\n\nNn... Sepertinya Sensei benar-benar kecapekan semalam sampai tidurnya nyenyak banget. Shiroko matikan alarmnya ya... 😔🤍`);
                
                clearInterval(alarmSubuhState.timer);
                alarmSubuhState.aktif = false;
                alarmSubuhState.count = 0;
                alarmSubuhState.timer = null;
            }
        }, 10 * 1000); 
        return;
    }

});

process.on('unhandledRejection', (err) => {
    console.error('UNHANDLED REJECTION:', err);
});

process.on('uncaughtException', (err) => {
    console.error('UNCAUGHT EXCEPTION:', err);
});

client.initialize();