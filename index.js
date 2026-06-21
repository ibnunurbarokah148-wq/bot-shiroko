require('dotenv').config({ quiet: true }); //[cite: 3]
const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    downloadContentFromMessage
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const { GoogleGenerativeAI } = require('@google/generative-ai'); //[cite: 3]
const { GoogleAIFileManager } = require('@google/generative-ai/server'); //[cite: 3]
const path = require('path'); //[cite: 3]
const cron = require('node-cron'); //[cite: 3]
const axios = require('axios'); //[cite: 3]
const https = require('https'); //[cite: 3]
const fs = require('fs'); //[cite: 3]
const PixivApi = require('pixiv-api-client'); //[cite: 3]

// ==========================================
// PENGATURAN ROTASI MULTI-API KEY GEMINI
// ==========================================
const GEMINI_API_KEYS = process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.split(',') : []; //[cite: 3]
if (GEMINI_API_KEYS.length === 0) { //[cite: 3]
    console.error('GEMINI_API_KEY tidak ditemukan pada .env'); //[cite: 3]
    process.exit(1); //[cite: 3]
}
function getGeminiComponents() { //[cite: 3]
    const randomKey = GEMINI_API_KEYS[Math.floor(Math.random() * GEMINI_API_KEYS.length)]; //[cite: 3]
    return { genAI: new GoogleGenerativeAI(randomKey), fileManager: new GoogleAIFileManager(randomKey) }; //[cite: 3]
}
const ID_OWNER = ['6281298793016', '181488624615651']; //[cite: 3]
const initialGemini = getGeminiComponents(); //[cite: 3]
const genAI = initialGemini.genAI; //[cite: 3]
const fileManager = initialGemini.fileManager; //[cite: 3]
const pixiv = new PixivApi(); //[cite: 3]

// MODEL ROLEPLAY SHIROKO
const model = genAI.getGenerativeModel({ //[cite: 3]
    model: "gemini-2.5-flash-lite", //[cite: 3]
    generationConfig: { temperature: 0.8, topP: 0.95, maxOutputTokens: 4096 }, //[cite: 3]
    systemInstruction: `Kamu adalah Sunaookami Shiroko dari Blue Archive...\nJangan mengaku AI.` //[cite: 3]
});

// MODEL KHUSUS AKADEMIK
const modelAkademik = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite", generationConfig: { temperature: 0.7, topP: 0.9, maxOutputTokens: 8192 } }); //[cite: 3]

// ==========================================
// VARIABLES STATE & DATABASE JSON (TETAP SAMA)
// ==========================================
const sesiKaryaIlmiah = {}; let alarmSubuhState = { aktif: false, count: 0, timer: null };
let alarmSalatAktif = true; const sesiSalat = {}; const sesiWaifu = {}; const sesiPixiv = {}; const sesiTopup = {}; const sesiTikTok = {}; const sesiUjian = {}; const sesiObrolan = {}; //[cite: 3]
const limitFile = './user_limit.json'; const roleFile = './user_roles.json'; const tugasFile = './user_tugas.json'; const panitiaFile = './panitia_agustus.json'; const JATAH_HARIAN = 5; //[cite: 3]
let dbLimit = fs.existsSync(limitFile) ? JSON.parse(fs.readFileSync(limitFile, 'utf-8')) : {}; //[cite: 3]
let dbRole = fs.existsSync(roleFile) ? JSON.parse(fs.readFileSync(roleFile, 'utf-8')) : {}; //[cite: 3]
let dbTugas = fs.existsSync(tugasFile) ? JSON.parse(fs.readFileSync(tugasFile, 'utf-8')) : {}; //[cite: 3]
let dbPanitia = fs.existsSync(panitiaFile) ? JSON.parse(fs.readFileSync(panitiaFile, 'utf-8')) : { "ketua": { "anggota": [], "timeline": [] } }; //[cite: 3]

function simpanDB() { fs.writeFileSync(limitFile, JSON.stringify(dbLimit, null, 2)); } //[cite: 3]
function getCoreNumber(num) { if (!num) return ''; let n = num.toString().replace(/[^0-9]/g, ''); if (n.startsWith('62')) n = n.substring(2); if (n.startsWith('0')) n = n.substring(1); return n; } //[cite: 3]
function cekDanPotongLimit(targetID) { const coreTarget = getCoreNumber(targetID); if (ID_OWNER.some(owner => getCoreNumber(owner) === coreTarget)) return true; if (!dbLimit[targetID]) dbLimit[targetID] = JATAH_HARIAN; if (dbLimit[targetID] <= 0) return false; dbLimit[targetID] -= 1; simpanDB(); return true; } //[cite: 3]

    // ==========================================
// INTI MESIN BAILEYS (PAIRING CODE LOGIN)
// ==========================================
const readline = require('readline');
const question = (text) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
        rl.question(text, answer => {
            rl.close();
            resolve(answer);
        });
    });
};

async function hubungkanKeWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_session');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'error' }),
        auth: state,
        printQRInTerminal: false, // MATIKAN FITUR QR CODE
        browser: ["Ubuntu", "Chrome", "20.0.04"] // Identitas bot di HP
    });

    // ==========================================
    // SISTEM LOGIN: PAIRING CODE
    // ==========================================
    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            console.log("\n[!] Sistem Baileys belum terhubung ke akun WhatsApp.");
            let phoneNumber = await question('Nn... Masukkan nomor WA Bot (Awali dengan 62, contoh: 628123456789): ');
            phoneNumber = phoneNumber.replace(/[^0-9]/g, ''); // Bersihkan kalau ada spasi/tanda plus
            
            try {
                const code = await sock.requestPairingCode(phoneNumber);
                console.log(`\n========================================`);
                console.log(`🔑 KODE PAIRING SENSEI : ${code}`);
                console.log(`========================================\n`);
                console.log(`CARA LOGIN:`);
                console.log(`1. Buka aplikasi WhatsApp di HP bot.`);
                console.log(`2. Klik Titik Tiga (Pojok Kanan Atas) -> Perangkat Tertaut -> Tautkan Perangkat.`);
                console.log(`3. Pilih tulisan "Tautkan dengan Nomor Telepon Saja" di layar bawah.`);
                console.log(`4. Masukkan kode 8 digit di atas.\n`);
            } catch (error) {
                console.error('Nn... Gagal meminta kode pairing. Coba jalankan ulang script-nya.', error);
            }
        }, 3000); // Jeda 3 detik biar mesin siap
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error?.output?.statusCode) !== DisconnectReason.loggedOut;
            console.log('Koneksi terputus. Menghubungkan ulang:', shouldReconnect);
            if (shouldReconnect) hubungkanKeWhatsApp();
            else console.log('Nn... Sesi log out. Hapus folder "auth_session" dan jalankan ulang untuk login.');
        } else if (connection === 'open') {
            console.log('Nn... Sistem komunikasi Shiroko aktif via Baileys. Siap tempur, Sensei.');
        }
    });

    // ==========================================
    // MANAGEMENT PESAN MASUK (FULL FEATURES BAILEYS)
    // ==========================================
    // (JANGAN HAPUS KODE sock.ev.on('messages.upsert') LU YANG DI BAWAH SINI!)

    // ==========================================
    // MANAGEMENT PESAN MASUK (FULL FEATURES BAILEYS)
    // ==========================================
    sock.ev.on('messages.upsert', async m => {
        if (m.type !== 'notify') return;
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const isGroup = from.endsWith('@g.us');
        const senderId = isGroup ? msg.key.participant : from;
        const isOwner = ID_OWNER.some(owner => getCoreNumber(owner) === getCoreNumber(senderId));

        // Ekstraktor Teks & Media dari Baileys
        const msgType = Object.keys(msg.message)[0];
        const isQuoted = !!msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        const quotedMsg = isQuoted ? msg.message.extendedTextMessage.contextInfo.quotedMessage : null;
        const quotedType = isQuoted ? Object.keys(quotedMsg)[0] : null;

        let body = '';
        if (msgType === 'conversation') body = msg.message.conversation;
        else if (msgType === 'extendedTextMessage') body = msg.message.extendedTextMessage.text;
        else if (msgType === 'imageMessage') body = msg.message.imageMessage.caption || '';
        else if (msgType === 'videoMessage') body = msg.message.videoMessage.caption || '';
        
        const textClean = body.trim();
        const textLower = textClean.toLowerCase();

        // Jembatan fungsi reply() 
        const reply = async (teks) => {
            await sock.sendMessage(from, { text: teks }, { quoted: msg });
        };

        // Helper fungsi download media dari Baileys
        const downloadMediaBaileys = async (messageObject, type) => {
            const stream = await downloadContentFromMessage(messageObject, type);
            let buffer = Buffer.from([]);
            for await(const chunk of stream) { buffer = Buffer.concat([buffer, chunk]); }
            return buffer;
        };

        // ==========================================
        // SENSOR BANGUN SUBUH
        // ==========================================
        if (isOwner && alarmSubuhState.aktif) {
            if (textLower === 'iya') {
                if (alarmSubuhState.timer) clearInterval(alarmSubuhState.timer); 
                alarmSubuhState.aktif = false; alarmSubuhState.count = 0; alarmSubuhState.timer = null;
                return reply(`Nn... *(Mengusap keringat di dahi)*. Kerja bagus karena sudah bangun tepat waktu, Sensei. Shiroko senang sekali. Cepat ambil wudhu dan salat ya, Shiroko tungguin dari sini. ✨`);
            }
        }
        
        if (textLower === '!cekid') {
            let teks = `🔍 *DIAGNOSTIK SISTEM BAILEYS*\n\n*ID Anda:* ${senderId}\n*Status:* ${isOwner ? '👑 OWNER (UNLIMITED)' : '👤 USER BIASA'}\n\n_Nn... Jika token habis, kirim ID Anda kepada Owner._`;
            return reply(teks);
        }

        // ==========================================
        // FITUR REGISTRASI GURU & SISWA
        // ==========================================
        if (textLower === '!reg_guru' || textLower === '!reg_siswa') {
            const tipe = textLower.split('_')[1];
            if (dbRole[senderId]) return reply(`Nn... Identitasmu sudah terdaftar sebagai *${dbRole[senderId].role.toUpperCase()}*.`);

            let teks = `🏫 *FORM PENDAFTARAN ${tipe.toUpperCase()}* 🏫\n\nNn... Silakan copy teks di bawah ini:\n\n!submit_reg\nDaftar: ${tipe.toUpperCase()}\nNama: \nInstansi/Kelas: `;
            return reply(teks);
        }

        if (textLower.startsWith('!submit_reg')) {
            const baris = textClean.split('\n');
            let tipeDaftar = '', namaLengkap = '';

            for (let b of baris) {
                if (b.toLowerCase().startsWith('daftar:')) tipeDaftar = b.split(':')[1].trim().toUpperCase();
                if (b.toLowerCase().startsWith('nama:')) namaLengkap = b.split(':')[1].trim();
            }

            if (!tipeDaftar || !namaLengkap) return reply('Nn... Format salah.');

            const idOwnerUtama = ID_OWNER[0] + '@s.whatsapp.net';
            let laporan = `🚨 *PENDAFTARAN USER BARU* 🚨\n\n*ID Pendaftar:* ${senderId}\n*Role Diminta:* ${tipeDaftar}\n*Nama:* ${namaLengkap}\n\nNn... Komandan, silakan Reply pesan ini dengan:\n✅ *!acc*\n❌ *!tolak [alasan]*`;

            await sock.sendMessage(idOwnerUtama, { text: laporan });
            return reply(`Nn... Formulir atas nama *${namaLengkap}* sudah dikirim ke Markas Pusat.`);
        }

        // ==========================================
        // FITUR GURU & AKUN
        // ==========================================
        if (textLower.startsWith('!tambah_soal ')) {
            if (!dbRole[senderId] || dbRole[senderId].role !== 'guru') return reply('Nn... Akses ditolak.');
            const teksSoal = textClean.substring(13).trim();
            if (!teksSoal) return reply('Nn... Masukkan teks skenario kasusnya.');

            dbRole[senderId].bank_soal.push(teksSoal);
            simpanRole();
            return reply(`✅ *SOAL DITAMBAHKAN*\n\nTotal soal Sensei sekarang: *${dbRole[senderId].bank_soal.length} soal*.`);
        }

        if (textLower === '!list_soal') {
            if (!dbRole[senderId] || dbRole[senderId].role !== 'guru') return reply('Nn... Akses ditolak.');
            const soal = dbRole[senderId].bank_soal;
            let idGuruBersih = getCoreNumber(senderId);

            if (soal.length === 0) return reply(`Nn... Brankas soal masih kosong.\n_Catatan ID Sensei: *${idGuruBersih}*_`);
            
            let teks = `🏫 *BANK SOAL SENSEI ${dbRole[senderId].nama.toUpperCase()}* 🏫\n\n`;
            soal.forEach((s, i) => { teks += `*Babak ${i+1}:* ${s}\n\n`; });
            teks += `📢 *INFO UNTUK SISWA:*\nSuruh siswa ngetik ini buat ujian:\n*!ujian ${idGuruBersih}*`;
            return reply(teks);
        }

        if (textLower.startsWith('!hapus_soal ')) {
            if (!dbRole[senderId] || dbRole[senderId].role !== 'guru') return reply('Nn... Akses ditolak.');
            const index = parseInt(textClean.split(' ')[1]) - 1;
            if (isNaN(index) || index < 0 || index >= dbRole[senderId].bank_soal.length) return reply('Nn... Nomor tidak ditemukan.');
            dbRole[senderId].bank_soal.splice(index, 1);
            simpanRole();
            return reply(`🗑️ *SOAL DIHAPUS*\n\nSisa soal: *${dbRole[senderId].bank_soal.length}*.`);
        }

        if (textLower.startsWith('!cabut_role')) {
            if (!isOwner) return reply('Nn... Akses ditolak.');
            const targetNomor = textClean.split(' ')[1].replace(/[^0-9]/g, '');
            let targetKey = Object.keys(dbRole).find(k => getCoreNumber(k) === targetNomor);
            if (!targetKey) return reply(`Nn... Target tidak ditemukan.`);

            const namaLama = dbRole[targetKey].nama;
            delete dbRole[targetKey]; simpanRole();
            reply(`🗑️ *OTORITAS DICABUT*\n\nNn... Akses atas nama *${namaLama}* telah dihapus.`);
            try { await sock.sendMessage(targetKey, { text: `⚠️ *PERINGATAN DARI MARKAS PUSAT* ⚠️\n\nNn... Komandan telah mencabut otoritasmu.` }); } catch(e) {}
            return;
        }

        if (textLower === '!resign') {
            if (!dbRole[senderId]) return reply('Nn... Kamu tidak terdaftar.');
            const namaLama = dbRole[senderId].nama;
            delete dbRole[senderId]; simpanRole();
            return reply(`🗑️ *PENGUNDURAN DIRI DITERIMA*\n\nNn... Terima kasih, *${namaLama}*. Data otoritasmu telah dihapus.`);
        }

        // ==========================================
        // FITUR MANAJEMEN TUGAS PRIBADI
        // ==========================================
        if (textLower.startsWith('!simpan_tugas ')) {
            const isiTugas = textClean.substring(14).trim();
            if (!isiTugas) return reply('Nn... Format salah.');
            if (!dbTugas[senderId]) dbTugas[senderId] = [];
            dbTugas[senderId].push(isiTugas); simpanTugas();
            return reply(`✅ *TUGAS DISIMPAN*\n\nTotal tugas tersimpan: *${dbTugas[senderId].length}*.`);
        }

        if (textLower === '!tugas' || textLower === '!list_tugas') {
            const listTugas = dbTugas[senderId] || [];
            if (listTugas.length === 0) return reply('Nn... Brankas tugasmu masih kosong.');
            let teks = `🎒 *BRANKAS TUGAS PRIBADI* 🎒\n\n`;
            listTugas.forEach((tugas, index) => { teks += `*${index + 1}.* ${tugas}\n\n`; });
            return reply(teks);
        }

        if (textLower.startsWith('!hapus_tugas ')) {
            const index = parseInt(textClean.split(' ')[1]) - 1;
            const listTugas = dbTugas[senderId] || [];
            if (isNaN(index) || index < 0 || index >= listTugas.length) return reply('Nn... Nomor tidak ditemukan.');
            listTugas.splice(index, 1); dbTugas[senderId] = listTugas; simpanTugas();
            return reply(`🗑️ *TUGAS DIHAPUS*\n\nCatatan tugas berhasil dihapus.`);
        }

        if (textLower === '!limit') {
            if (isOwner) return reply('Nn... Sensei adalah Owner. Token Sensei Unlimited. 🌟');
            let sisa = dbLimit[senderId] !== undefined ? dbLimit[senderId] : JATAH_HARIAN;
            return reply(`Nn... Sisa token taktis Sensei hari ini adalah: *${sisa} token*.`);
        }

        // ==========================================
        // FITUR TOP-UP & OWNER ACC
        // ==========================================
        if (textLower === '!topup') {
            let teks = `🏦 *LAYANAN BOT SHIROKO* 🏦\n\nNn... Token Sensei menipis? Ini daftar token yang tersedia:\n\n📦 *Paket 1:* 50 Token - Rp 5.000\n📦 *Paket 2:* 150 Token - Rp 10.000\n📦 *Paket 3:* 500 Token - Rp 25.000\n📦 *Paket 4:* 1500 Token - Rp 50.000\n\nKirim perintah ini untuk membeli:\n*!beli [nomor_paket]*`;
            return reply(teks);
        }

        if (textLower.startsWith('!beli ')) {
            const pilihan = textClean.split(' ')[1];
            if (!DAFTAR_PAKET[pilihan]) return reply('Nn... Paket tidak ditemukan.');
            
            const paket = DAFTAR_PAKET[pilihan];
            sesiTopup[senderId] = { token: paket.token, harga: paket.harga };
            
            try {
                // Di Baileys, kirim gambar lokal pakai fs.readFileSync
                let teks = `Nn... Sensei memilih paket *${paket.token} Token* seharga *Rp ${paket.harga.toLocaleString('id-ID')}*.\n\nSilakan transfer ke QRIS ini. Kalau sudah bayar, reply fotonya dengan tulisan *!bukti*.`;
                await sock.sendMessage(from, { image: fs.readFileSync('./qris.jpg'), caption: teks });
            } catch (err) {
                reply('Nn... Gambar QRIS tidak ditemukan di sistem. Lapor ke Komandan.');
            }
            return;
        }

        if (textLower.startsWith('!bukti')) {
            if (!sesiTopup[senderId]) return reply('Nn... Sensei belum memesan paket logistik. Ketik *!topup* dulu.');
            
            // Cek apakah pesan asli ada gambarnya, atau dia nge-reply gambar
            const isTargetImage = msgType === 'imageMessage';
            const isQuotedImage = isQuoted && quotedType === 'imageMessage';

            if (isTargetImage || isQuotedImage) {
                try {
                    const messageToDownload = isQuotedImage ? quotedMsg.imageMessage : msg.message.imageMessage;
                    const mediaBuffer = await downloadMediaBaileys(messageToDownload, 'image');
                    
                    const paket = sesiTopup[senderId];
                    const idOwnerUtama = ID_OWNER[0] + '@s.whatsapp.net';
                    
                    let laporan = `🚨 *LAPORAN TRANSAKSI LOGISTIK* 🚨\n\n*ID Pembeli:* ${senderId}\n*Jumlah Token:* ${paket.token}\n*Total Bayar:* Rp ${paket.harga.toLocaleString('id-ID')}\n\nNn... Komandan, periksa mutasi rekening. Silakan Reply pesan ini dengan:\n✅ *!acc*\n❌ *!tolak [alasan]*`;

                    await sock.sendMessage(idOwnerUtama, { image: mediaBuffer, caption: laporan });
                    reply('Nn... Bukti transfer sudah diteruskan ke markas komando pusat. Tunggu sebentar ya.');
                    delete sesiTopup[senderId]; 
                } catch (error) {
                    reply('Nn... Gagal mengamankan gambar bukti.');
                }
            } else {
                reply('Nn... Fotonya mana, Sensei? Harus kirim foto bukti transfer dengan caption *!bukti*.');
            }
            return;
        }

        if (textLower === '!acc' || textLower.startsWith('!tolak')) {
            if (!isOwner) return reply('Nn... Akses ditolak. Tangan di atas kepala! 🔫');
            if (!isQuoted) return reply('Nn... Komandan harus membalas (reply) pesan laporan dari Shiroko.');

            const isAcc = textLower === '!acc';
            let alasanTolak = textClean.substring(6).trim() || 'Tidak ada alasan khusus dari komando pusat.';

            // Ambil teks dari pesan yang di-reply di Baileys
            const teksLaporan = quotedMsg?.conversation || quotedMsg?.extendedTextMessage?.text || quotedMsg?.imageMessage?.caption || '';

            if (teksLaporan.includes('LAPORAN TRANSAKSI LOGISTIK')) {
                const matchId = teksLaporan.match(/\*ID Pembeli:\*\s*([^\n]+)/);
                if (!matchId) return reply('Nn... Format laporan tidak dikenali.');
                const targetNomor = matchId[1].trim();

                if (isAcc) {
                    const matchToken = teksLaporan.match(/\*Jumlah Token:\*\s*(\d+)/);
                    const jumlahToken = parseInt(matchToken[1], 10);

                    if (dbLimit[targetNomor] === undefined) dbLimit[targetNomor] = JATAH_HARIAN; 
                    dbLimit[targetNomor] += jumlahToken; simpanDB();

                    reply(`✅ *TRANSAKSI BERHASIL*\nNn... Top-up disetujui.\n*Target:* ${targetNomor}\n*Jumlah:* +${jumlahToken} Token`);
                    try { await sock.sendMessage(targetNomor, { text: `🏦 *PEMBAYARAN DITERIMA*\n\nNn... Logistik amunisi sebesar *+${jumlahToken} Token* sudah ditambahkan. Saldo: *${dbLimit[targetNomor]}*` }); } catch (err) {}
                } else {
                    reply(`❌ *TRANSAKSI DITOLAK*\nNn... Laporan dikirim ke target.`);
                    try { await sock.sendMessage(targetNomor, { text: `⚠️ *PEMBAYARAN DITOLAK*\n\nNn... Dana tidak masuk.\n*Alasan:* ${alasanTolak}` }); } catch (err) {}
                }
            } else if (teksLaporan.includes('PENDAFTARAN USER BARU')) {
                const matchId = teksLaporan.match(/\*ID Pendaftar:\*\s*([^\n]+)/);
                const matchRole = teksLaporan.match(/\*Role Diminta:\*\s*([^\n]+)/);
                const matchNama = teksLaporan.match(/\*Nama:\*\s*([^\n]+)/);

                if (!matchId || !matchRole) return reply('Nn... Format laporan registrasi tidak dikenali.');
                
                const targetNomor = matchId[1].trim();
                const targetRole = matchRole[1].trim().toLowerCase();
                const targetNama = matchNama[1] ? matchNama[1].trim() : 'User';

                if (isAcc) {
                    dbRole[targetNomor] = { role: targetRole, nama: targetNama, bank_soal: [] };
                    simpanRole();
                    reply(`✅ *REGISTRASI BERHASIL*\nNn... Otoritas diberikan.\n*Target:* ${targetNomor}`);
                    try { await sock.sendMessage(targetNomor, { text: `🎓 *AKSES DIBERIKAN* 🎓\n\nNn... Halo ${targetNama}, Komando Pusat menyetujui aksesmu sebagai *${targetRole.toUpperCase()}*.` }); } catch (err) {}
                } else {
                    reply(`❌ *REGISTRASI DITOLAK*`);
                    try { await sock.sendMessage(targetNomor, { text: `⚠️ *REGISTRASI DITOLAK*\n\nNn... Maaf, permohonan akses LMS ditolak.\n*Alasan:* ${alasanTolak}` }); } catch (err) {}
                }
            } else {
                return reply('Nn... Laporan apa ini Komandan? Format tidak sesuai protokol.');
            }
            return;
        }

        // ==========================================
        // FITUR KEPANITIAAN AGUSTUSAN
        // ==========================================
        if (textLower.startsWith('!tambah_panitia ')) {
            if (!isOwner) return reply('Nn... Akses ditolak.');
            const args = textClean.substring(16).trim().split(' ');
            const divisi = args[0].toLowerCase();
            const namaAnggota = args.slice(1).join(' ');

            if (!dbPanitia[divisi]) return reply('Nn... Divisi tidak ditemukan.');
            dbPanitia[divisi].anggota.push(namaAnggota); simpanPanitia();
            return reply(`✅ *PANITIA DIURUTKAN*\n\nNn... *${namaAnggota}* resmi dimasukkan ke **Divisi ${divisi.toUpperCase()}**.`);
        }

        if (textLower.startsWith('!cabut_divisi ')) {
            if (!isOwner) return reply('Nn... Akses ditolak.');
            const args = textClean.substring(14).trim().split(' ');
            const divisi = args[0].toLowerCase();
            const namaAnggota = args.slice(1).join(' ');

            if (!dbPanitia[divisi]) return reply('Nn... Divisi tidak terdaftar.');
            const indexAnggota = dbPanitia[divisi].anggota.findIndex(nama => nama.toLowerCase() === namaAnggota.toLowerCase());

            if (indexAnggota === -1) return reply(`Nn... Tidak ada anggota bernama *${namaAnggota}*.`);
            dbPanitia[divisi].anggota.splice(indexAnggota, 1); simpanPanitia();
            return reply(`🗑️ *FORMASI DIPERBARUI*\n\nNn... *${namaAnggota}* telah dicabut dari **Divisi ${divisi.toUpperCase()}**.`);
        }

        if (textLower.startsWith('!tambah_tugas ')) {
            if (!isOwner) return reply('Nn... Akses khusus pimpinan panitia.');
            const konten = textClean.substring(14).trim();
            const bagian = konten.split('|');
            if (bagian.length < 3) return reply('Nn... Format salah.\nContoh: *!tambah_tugas acara | Sewa Panggung Utama | 1 Agustus - 10 Agustus*');

            const divisi = bagian[0].trim().toLowerCase();
            if (!dbPanitia[divisi]) return reply('Nn... Divisi tidak valid.');
            dbPanitia[divisi].timeline.push({ tugas: bagian[1].trim(), deadline: bagian[2].trim(), status: "❌ Belum" });
            simpanPanitia();
            return reply(`📅 *TIMELINE BARU DITAMBAHKAN*`);
        }

        if (textLower.startsWith('!selesai_tugas ')) {
            if (!isOwner) return reply('Nn... Akses ditolak.');
            const args = textClean.split(' ');
            const divisi = args[1].toLowerCase();
            const idx = parseInt(args[2]) - 1;

            if (!dbPanitia[divisi] || isNaN(idx) || !dbPanitia[divisi].timeline[idx]) return reply('Nn... Data tidak ditemukan.');
            dbPanitia[divisi].timeline[idx].status = "✅ Selesai"; simpanPanitia();
            return reply(`🎉 *PROGRESS UPDATE*\n\nTugas Ke-${idx+1} dinyatakan *SELESAI*.`);
        }

        if (textLower.startsWith('!divisi ')) {
            const divisi = textLower.substring(8).trim().toLowerCase();
            if (!dbPanitia[divisi]) return reply('Nn... Divisi tidak terdaftar.');

            const dataDivisi = dbPanitia[divisi];
            let teks = `🇮🇩 *RADAR OPERASIONAL: DIVISI ${divisi.toUpperCase()}* 🇮🇩\n\n👥 *DAFTAR ANGGOTA:* \n`;
            if (dataDivisi.anggota.length === 0) teks += `_Belum ada anggota._\n`;
            else dataDivisi.anggota.forEach((nama, i) => { teks += `${i + 1}. ${nama}\n`; });
            
            teks += `\n━━━━━━━━━━━━━━━━━━━━\n\n📅 *TIMELINE & DEADLINE:* \n`;
            if (dataDivisi.timeline.length === 0) teks += `_Belum ada tugas._\n`;
            else dataDivisi.timeline.forEach((item, i) => { teks += `*${i + 1}. ${item.tugas}*\n⏱️ Rentang: _${item.deadline}_\n📊 Status: ${item.status}\n\n`; });
            return reply(teks);
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
            return reply(teks);
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
                    totalTugas++; if (item.status.includes('✅')) tugasSelesai++; 
                });
                teks += `\n`;
            });
            const persentase = totalTugas > 0 ? Math.round((tugasSelesai / totalTugas) * 100) : 0;
            teks += `━━━━━━━━━━━━━━━━━━━━\n📊 *Total Progress:* ${tugasSelesai}/${totalTugas} Tugas Selesai (${persentase}%)`;
            return reply(teks);
        }

        if (textLower === '!ping') return reply('Nn... Pong. Shiroko standby via Baileys, Sensei.');

        if (textLower === 'nak coba') return reply(`Nn... Halo Sensei! Selamat datang di sistem komunikasi Shiroko. 🐺✨\n\nTerima kasih sudah berkunjung dari website resmi kami. Shiroko siap membantu segala keperluan Sensei di sini.\n\nKetik *!menu* untuk melihat perlengkapan taktis Shiroko.`);

        // ==========================================
        // MENU UTAMA BOT
        // ==========================================
        if (textLower === '!menu' || textLower === '!fitur') {
            const teksMenu = `🐺 *SISTEM KOMUNIKASI SHIROKO (BAILEYS)* 🐺\n\nNn... Halo. Ini daftar perlengkapan taktis yang bisa Shiroko gunakan.\n_Fitur dengan tanda [🪙] akan memakan 1 Token Limit_\n\n` +
            `*🤖 Protokol Komunikasi*\n[🪙] 🧠 *!shiroko [pesan]*\n[🪙] 🎓 *!shiroko_pintar [tanya]*\n🧹 *!lupa* | 🏓 *!ping* | 🔍 *!cekid*\n\n` +
            `*🏫 Sistem LMS & Evaluasi*\n📝 *!reg_guru* | *!reg_siswa* | *!resign*\n➕ *!tambah_soal* | *!list_soal* | *!hapus_soal*\n[🪙] 🎮 *!ujian [ID]*\n\n` +
            `*🇮🇩 Manajemen Panitia*\n📋 *!divisi [nama]* | *!daftar_anggota* | *!daftar_tugas*\n👑 *!tambah_tugas* | *!cabut_divisi* | *!selesai_tugas*\n\n` +
            `*🎒 Manajemen Tugas*\n📥 *!simpan_tugas* | *!tugas* | *!hapus_tugas*\n\n` +
            `*📚 Operasi Akademik*\n[🪙] 📑 *!karyailmiah* | 📖 *!jurnal [topik]*\n✍️ *!para [teks]* | 📝 *!ringkas* | 💡 *!ide*\n\n` +
            `*🛠️ Eksekusi Media*\n[🪙] 📄 *!pdf2jpg* (Reply PDF) | [🪙] 🖼️ *!stiker* (Kirim Gambar)\n[🪙] 🎵 *!tiktok [link]* | [🪙] 🎧 *!dengar* (Reply VN)\n\n` +
            `*🌸 Pencarian Data Intel*\n[🪙] 🎨 *!pixiv [query]* | [🪙] 🔍 *!waifu [nama]*\n[🪙] 🎲 *!gacha* | [🪙] 🐈 *!neko [kategori]*\n[🪙] 🎨 *!gambar [prompt AI]*\n\n` +
            `*🏦 Top Up*\n💰 *!limit* | 🛒 *!topup*`;
            return reply(teksMenu);
        }

        // ==========================================
        // FITUR UJIAN AKHLAK (INTERAKTIF ROLEPLAY)
        // ==========================================
        if (sesiUjian[senderId] && !textLower.startsWith('!')) {
            const sesi = sesiUjian[senderId];
            if (textLower === 'batal' || textLower === 'cancel') {
                delete sesiUjian[senderId]; kembalikanLimit(senderId); 
                return reply('Nn... Sayang sekali Kouhai menyerah di tengah jalan. Operasi evaluasi dibatalkan.');
            }
            try {
                await sock.sendPresenceUpdate('composing', from);
                const result = await sesi.chat.sendMessage(textClean);
                const balasanAI = result.response.text();
                await reply(balasanAI);
                if (balasanAI.includes('[UJIAN_SELESAI]')) delete sesiUjian[senderId]; 
            } catch (err) { reply('Nn... Sistem AI untuk ujian sedang mengalami gangguan sinyal. Coba balas lagi atau ketik "batal".'); }
            return; 
        }

        if (textLower.startsWith('!ujian')) {
            const args = textClean.split(' ');
            if (args.length < 2) return reply('Nn... Format salah. Kouhai harus memasukkan ID Guru penguji.\nContoh: *!ujian 628123456789*');

            const isSiswa = dbRole[senderId] && dbRole[senderId].role === 'siswa';
            if (!isSiswa && !isOwner) return reply('Nn... Akses ditolak. Hanya Kouhai (Siswa) terdaftar yang bisa mengikuti ujian ini.');

            let idGuruMinta = args[1].replace(/[^0-9]/g, '');
            let keyGuru = Object.keys(dbRole).find(k => getCoreNumber(k) === idGuruMinta && dbRole[k].role === 'guru');

            if (!keyGuru) return reply('Nn... Data Sensei penguji tidak ditemukan di server.');
            const dataGuru = dbRole[keyGuru];
            const bankSoalGuru = dataGuru.bank_soal;

            if (bankSoalGuru.length === 0) return reply(`Nn... Sensei ${dataGuru.nama} belum memasukkan kasus ujian. Ujian tidak bisa dimulai.`);
            if (!cekDanPotongLimit(senderId)) return reply('Nn... Token harian Kouhai sudah habis.');

            try {
                reply(`Nn... Menyiapkan ruang ujian dengan skenario dari Sensei *${dataGuru.nama}*. Mohon tunggu sebentar...`);
                let listSoalTeks = ""; bankSoalGuru.forEach((s, i) => { listSoalTeks += `- Babak ${i+1}: ${s}\n`; });

                const modelUjianDinamis = genAI.getGenerativeModel({
                    model: "gemini-2.5-flash-lite", 
                    generationConfig: { temperature: 0.7, topP: 0.9, maxOutputTokens: 2048 },
                    systemInstruction: `Kamu adalah Shiroko (Blue Archive), seorang Senpai. User adalah: Kouhai.\nTugasmu: Simulasi ujian Akidah Akhlak sebanyak ${bankSoalGuru.length} babak menggunakan BANK SOAL ini:\n${listSoalTeks}\nJangan berikan nilai di tengah cerita. Penilaian HANYA di akhir. Di pesan terakhir wajib mencetak kode ini: [UJIAN_SELESAI]`
                });

                const chatSession = modelUjianDinamis.startChat({ history: [] });
                sesiUjian[senderId] = { chat: chatSession };

                const triggerResult = await chatSession.sendMessage('Mulai ujiannya sekarang. Buka dengan sapaan sebagai Senpai dan berikan narasi/kasus pertama.');
                let teksAwal = `*🏫 [ UJIAN AKHLAK DIMULAI ] 🏫*\n*Penguji:* ${dataGuru.nama}\n*Total Kasus:* ${bankSoalGuru.length} Babak\n\n_Jawablah pertanyaan Senpai secara wajar._\n_Ketik *batal* kapan saja untuk menghentikan simulasi._\n━━━━━━━━━━━━━━━━━━━━\n\n${triggerResult.response.text()}`;
                
                await reply(teksAwal);
            } catch (error) {
                kembalikanLimit(senderId);
                reply('Nn... Gagal menginisiasi ruang ujian. Server sedang sibuk.');
            }
            return;
        }

        // ==========================================
        // FITUR KARYA ILMIAH
        // ==========================================
        if (sesiKaryaIlmiah[senderId]) {
            const sesi = sesiKaryaIlmiah[senderId];
            if (textLower === 'batal') {
                delete sesiKaryaIlmiah[senderId]; kembalikanLimit(senderId); 
                return reply('Nn... Pembuatan karya ilmiah dibatalkan.');
            }

            if (sesi.step === 1) {
                if (textLower !== 'makalah' && textLower !== 'artikel' && textLower !== 'laporan') return reply(`Nn... Pilihan tidak valid.\nPilih: makalah, artikel, laporan.`);
                sesi.jenis = textLower; sesi.step = 2;
                return reply(`Nn... Jenis karya dipilih: *${textLower}*\nSekarang kirim topik pembahasan.`);
            }

            if (sesi.step === 2) {
                reply(`Nn... Menyusun ${sesi.jenis}. Proses ini mungkin cukup lama...`);
                try {
                    const prompt = `Buatkan ${sesi.jenis} akademik lengkap.\nTOPIK:\n${textClean}\nATURAN: Gunakan bahasa Indonesia formal akademik. Minimal 700 kata. Beri referensi.`;
                    const result = await modelAkademik.generateContent(prompt);
                    await reply(`📚 *HASIL ${sesi.jenis.toUpperCase()}*\n\n${result.response.text()}`);
                } catch (err) { kembalikanLimit(senderId); await reply('Nn... Mesin penulis akademik mengalami gangguan.'); }
                delete sesiKaryaIlmiah[senderId];
                return;
            }
        }

        if (textLower === '!karyailmiah') {
            if (!cekDanPotongLimit(senderId)) return reply('Nn... Token harian Sensei sudah habis.');
            sesiKaryaIlmiah[senderId] = { step: 1, jenis: null };
            return reply(`📚 *PEMBUAT KARYA ILMIAH*\n\nPilih jenis:\n1. makalah\n2. artikel\n3. laporan\n\nKetik nama jenisnya.`);
        }

        // ==========================================
        // FITUR AKADEMIS & TEXT TOOLS
        // ==========================================
        if (textLower.startsWith('!jurnal ')) {
            const query = textClean.substring(8).trim();
            if (!query) return reply('Nn... Masukkan topik jurnal.');
            try {
                await reply(`Nn... Menelusuri database akademik untuk topik *${query}*...`);
                const randomOffset = Math.floor(Math.random() * 50);
                const response = await axios.get(`https://api.crossref.org/works?query=${encodeURIComponent(query)}&rows=5&offset=${randomOffset}&filter=from-pub-date:2020-01-01`);
                let items = response.data.message.items;

                if (!items || items.length === 0) return reply('Nn... Tidak ada jurnal yang ditemukan.');
                let replyText = `📚 *HASIL PENCARIAN JURNAL*\n\n🔍 Topik: *${query}*\n\n`;
                items.forEach((paper, index) => {
                    const title = paper.title?.[0] || 'Tanpa Judul';
                    let authors = paper.author ? paper.author.slice(0,3).map(a => `${a.given||''} ${a.family||''}`.trim()).join(', ') : 'Tidak diketahui';
                    let tahun = paper['published-print']?.['date-parts']?.[0]?.[0] || '-';
                    replyText += `*${index + 1}. ${title}*\n👤 Penulis: ${authors}\n📅 Tahun: ${tahun}\n🔗 Link: ${paper.URL || '-'}\n━━━━━━━━━━━━━━\n\n`;
                });
                return reply(replyText);
            } catch (error) { return reply('Nn... Server akademik sedang sibuk.'); }
        }

        if (textLower.startsWith('!para ') || textLower.startsWith('!paraphrase ')) {
            const teksAsli = textClean.replace(/^!(para|paraphrase)\s+/i, '').trim();
            if (!teksAsli) return reply('Nn... Mana teks yang mau diparafrase?');
            try {
                await reply('Nn... Mengaktifkan protokol Anti-Plagiasi...');
                const result = await model.generateContent(`Parafrase teks ini ke bahasa Indonesia akademik formal: "${teksAsli}"`);
                return reply(`*📝 HASIL PARAFRASE*\n\n${result.response.text().trim()}`);
            } catch (error) { return reply('Nn... Mesin pengolah kata error.'); }
        }

        if (textLower.startsWith('!ringkas ')) {
            const teksAsli = textClean.substring(9).trim();
            if (!teksAsli) return reply('Nn... Mana teks yang mau diringkas?');
            try {
                const result = await model.generateContent(`Buatkan ringkasan bullet points dari teks ini: "${teksAsli}"`);
                return reply(`*📑 HASIL RINGKASAN*\n\n${result.response.text().trim()}`);
            } catch (error) { return reply('Nn... Gagal meringkas.'); }
        }

        if (textLower.startsWith('!ide ')) {
            const jurusanTopik = textClean.substring(5).trim();
            if (!jurusanTopik) return reply('Nn... Masukkan jurusan.');
            try {
                const result = await model.generateContent(`Berikan 3 ide judul skripsi untuk jurusan "${jurusanTopik}" beserta fokus masalahnya.`);
                return reply(`*💡 REKOMENDASI PENELITIAN*\n\n${result.response.text().trim()}`);
            } catch (error) { return reply('Nn... Generator ide error.'); }
        }

        // ==========================================
        // EKSEKUSI MEDIA (AUDIO/STIKER/PDF/GAMBAR)
        // ==========================================
        if (textLower === '!dengar' || textLower === '!transkrip') {
            if (!cekDanPotongLimit(senderId)) return reply('Nn... Token harian Sensei sudah habis.');
            
            // Cek apakah user reply pesan audio/VN di Baileys
            const isQuotedAudio = isQuoted && (quotedType === 'audioMessage' || quotedType === 'documentMessage');
            
            if (isQuotedAudio) {
                try {
                    const messageToDownload = quotedMsg[quotedType];
                    const isMimeAudio = messageToDownload.mimetype?.startsWith('audio/') || messageToDownload.mimetype?.includes('mp4'); // Baileys VN is sometimes audio/mp4

                    if (isMimeAudio) {
                        reply('Nn... File diterima. Shiroko butuh waktu menyandikan data ini. Mohon tunggu...');
                        
                        const mediaBuffer = await downloadMediaBaileys(messageToDownload, quotedType === 'audioMessage' ? 'audio' : 'document');
                        const tempFilePath = path.join(__dirname, 'temp', `sadap_${Date.now()}.ogg`);
                        fs.writeFileSync(tempFilePath, mediaBuffer);

                        const uploadResponse = await fileManager.uploadFile(tempFilePath, { mimeType: "audio/ogg", displayName: "Audio Sadapan" });
                        const prompt = "Transkrip suara ini dengan akurat. Awali jawabanmu dengan mengomentari isi suaranya sedikit menggunakan kepribadian Shiroko (Blue Archive), lalu berikan teks aslinya.";
                        
                        const result = await model.generateContent([ prompt, { fileData: { fileUri: uploadResponse.file.uri, mimeType: uploadResponse.file.mimeType } } ]);
                        reply(`*🎧 HASIL SADAP AUDIO (HD)*\n\n${result.response.text()}`);

                        await fileManager.deleteFile(uploadResponse.file.name);
                        fs.unlinkSync(tempFilePath);
                    } else {
                        reply('Nn... Format salah. Pastikan me-reply Audio/VN.');
                    }
                } catch (error) {
                    kembalikanLimit(senderId); reply('Nn... Gagal mengunduh dan memproses audio.');
                }
            } else {
                reply('Nn... Sensei harus me-reply sebuah pesan suara sambil mengetik perintah ini.');
            }
            return;
        }

        if (textLower === '!stiker') {
            const isTargetImage = msgType === 'imageMessage';
            const isQuotedImage = isQuoted && quotedType === 'imageMessage';

            if (isTargetImage || isQuotedImage) {
                if (!cekDanPotongLimit(senderId)) return reply('Nn... Token habis.');
                try {
                    reply('Nn... Sedang memproses gambar menjadi stiker...');
                    const messageToDownload = isQuotedImage ? quotedMsg.imageMessage : msg.message.imageMessage;
                    const mediaBuffer = await downloadMediaBaileys(messageToDownload, 'image');
                    
                    // Di Baileys bikin stiker itu gampang banget, tinggal pass buffer ke image/sticker (pastikan pake jimp/webp builder di config, tapi Baileys bs lsg lempar buffer jika diset asSticker:true di versi tertentu, ATAU kita kirim as image dlu kalo gapunya FFMPEG)
                    // Karena Baileys butuh ffmpeg/libwebp buat stiker murni, cara paling dasar pakai mimetype
                    await sock.sendMessage(from, { sticker: mediaBuffer }, { quoted: msg });
                } catch (error) { reply('Nn... Gagal membuat stiker. Pastikan server punya FFMPEG/WebP.'); }
            } else reply('Nn... Gambarnya mana, Sensei?');
            return;
        }

        if (textLower === '!pdf2jpg') {
            if (!cekDanPotongLimit(senderId)) return reply('Nn... Token harian Sensei habis.');
            const isQuotedDoc = isQuoted && quotedType === 'documentMessage';

            if (isQuotedDoc) {
                try {
                    const docMsg = quotedMsg.documentMessage;
                    if (docMsg.mimetype !== 'application/pdf') { kembalikanLimit(senderId); return reply('Nn... File bukan PDF.'); }

                    reply('Nn... Mengirim PDF ke markas eksternal untuk dikonversi...');
                    const mediaBuffer = await downloadMediaBaileys(docMsg, 'document');
                    const base64Pdf = mediaBuffer.toString('base64');

                    const convertResult = await axios.post('https://v2.convertapi.com/convert/pdf/to/jpg?Secret=' + process.env.CONVERT_API_KEY, {
                        Parameters: [ { Name: 'File', FileValue: { Name: 'dokumen.pdf', Data: base64Pdf } }, { Name: 'StoreFile', Value: false } ]
                    });

                    const files = convertResult.data.Files;
                    reply(`Nn... Konversi berhasil. Menyiapkan pengiriman ${files.length} halaman gambar.`);

                    for (let i = 0; i < files.length; i++) {
                        const bufferJpg = Buffer.from(files[i].FileData, 'base64');
                        await sock.sendMessage(from, { image: bufferJpg, caption: `Nn... Halaman ${i + 1}/${files.length}` });
                    }
                } catch (error) { kembalikanLimit(senderId); reply('Nn... Server konversi sibuk / eror PDF.'); }
            } else { reply('Nn... Sensei harus me-reply dokumen PDF.'); }
            return;
        }

        if (textLower.startsWith('!gambar ') || textLower.startsWith('!bikin ')) {
            const promptMentah = textClean.substring(textClean.indexOf(' ') + 1).trim();
            if (!promptMentah) return reply('Nn... Masukkan deskripsi gambarnya.');
            if (!cekDanPotongLimit(senderId)) return reply('Nn... Token habis.');

            try {
                reply('Nn... Shiroko sedang merombak prompt Sensei...');
                const promptGasing = await modelAkademik.generateContent(`Kamu pakar prompt engineering AI. Ubah tag kaku menjadi 1 paragraf bahasa Inggris estetik masterpiece. LANGSUNG JAWAB HASILNYA.\nPrompt asli: ${promptMentah}`);
                const promptHasilEnhance = promptGasing.response.text().trim();

                reply('Nn... Cetakan prompt selesai. Mulai melukis di server...');
                const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(promptHasilEnhance)}?width=512&height=768&nologo=true&private=true&enhance=true`;
                
                await sock.sendMessage(from, { image: { url: imageUrl }, caption: `🎨 *Prompt Asli:* ${promptMentah}\n\nNn... Berhasil dirender. 🐺` }, { quoted: msg });
            } catch (error) { kembalikanLimit(senderId); reply('Nn... Server gambar sedang sibuk.'); }
            return;
        }

        // ==========================================
        // PENCARIAN DATA INTEL (TIKTOK, PIXIV, WAIFU)
        // ==========================================
        if (textLower.startsWith('!tiktok ')) {
            const url = textClean.split(' ')[1]; 
            if (!url) return reply('Nn... Masukkan link TikTok-nya.');
            if (!cekDanPotongLimit(senderId)) return reply('Nn... Token habis.');
            
            try {
                reply('Nn... Menganalisis target...');
                const response = await axios.get(`https://www.tikwm.com/api/?url=${url}`);
                if (response.data.code === 0) {
                    const data = response.data.data;
                    const isImage = data.images && data.images.length > 0;
                    sesiTikTok[senderId] = { isImage: isImage, data: data };

                    let teks = `*Data Intel:* ${data.title || 'Tanpa Judul'}\n\nNn... Target adalah ${isImage ? 'gambar' : 'video'}. Pilih metode ekstraksi:\n1️⃣ *Semua Gambar/Video Saja*\n2️⃣ *Sound Saja*\n${isImage ? 'Atau ketik angka 3, 4, dst untuk ambil urutan gambar spesifik.' : '3️⃣ *Video & Sound*'}\n\n_Ketik *batal* membatalkan._`;
                    return reply(teks);
                } else { kembalikanLimit(senderId); return reply('Nn... Target tidak ditemukan.'); }
            } catch (error) { kembalikanLimit(senderId); return reply('Nn... Gagal menembus TikTok.'); }
        }

        if (sesiTikTok[senderId]) {
            const pilihan = textLower; const sesi = sesiTikTok[senderId]; const data = sesi.data;
            if (pilihan.startsWith('!') && pilihan !== '!batal') { delete sesiTikTok[senderId]; } 
            else if (pilihan === 'batal' || pilihan === 'cancel') { delete sesiTikTok[senderId]; kembalikanLimit(senderId); return reply('Nn... Ekstraksi dibatalkan.'); } 
            else {
                try {
                    if (sesi.isImage) {
                        if (pilihan === '1') {
                            reply(`Nn... Mengirim ${data.images.length} gambar...`);
                            for (let i = 0; i < data.images.length; i++) await sock.sendMessage(from, { image: { url: data.images[i] }, caption: `Gambar ${i + 1}/${data.images.length}` });
                        } 
                        else if (pilihan === '2') { reply('Nn... Mengamankan audio...'); await sock.sendMessage(from, { audio: { url: data.music }, mimetype: 'audio/mp4' }); } 
                        else if (!isNaN(pilihan) && parseInt(pilihan) >= 3 && parseInt(pilihan) <= (data.images.length + 2)) {
                            const i = parseInt(pilihan) - 3;
                            reply(`Nn... Mengamankan gambar urutan ke-${i + 1}...`);
                            await sock.sendMessage(from, { image: { url: data.images[i] } });
                        } 
                        else return reply(`Nn... Pilihan tidak valid.`);
                    } else {
                        if (pilihan === '1') { reply('Nn... Mengirim video...'); await sock.sendMessage(from, { video: { url: data.play }, caption: 'Nn... Video tanpa watermark.' }); } 
                        else if (pilihan === '2') { reply('Nn... Mengirim audio...'); await sock.sendMessage(from, { audio: { url: data.music }, mimetype: 'audio/mp4' }); } 
                        else if (pilihan === '3') { 
                            reply('Nn... Mengirim video dan audio...'); 
                            await sock.sendMessage(from, { video: { url: data.play } }); 
                            await sock.sendMessage(from, { audio: { url: data.music }, mimetype: 'audio/mp4' }); 
                        } 
                        else return reply('Nn... Pilihan tidak valid. Pilih 1, 2, atau 3.');
                    }
                    delete sesiTikTok[senderId]; return; 
                } catch (error) { delete sesiTikTok[senderId]; kembalikanLimit(senderId); return reply('Nn... Gagal mengunduh.'); }
            }
        }

        if (textLower.startsWith('!neko ')) {
            const kategori = textClean.substring(6).trim().toLowerCase(); 
            if (!kategori) return reply('Nn... Masukkan kategori.');
            if (!cekDanPotongLimit(senderId)) return reply('Nn... Token habis.');
            try {
                reply(`Nn... Mencari visual *${kategori}*...`);
                const response = await axios.get(`https://api.nekosia.cat/api/v1/images/${kategori}`);
                await sock.sendMessage(from, { image: { url: response.data.image.original.url }, caption: `*Data Intel:* ${kategori}` });
            } catch (error) { reply('Nn... Kategori tidak valid di Nekosia.'); }
            return;
        }

        if (textLower === '!gacha') {
            if (!cekDanPotongLimit(senderId)) return reply('Nn... Token habis.');
            try {
                reply('Nn... Mengundi target visual acak...');
                const gachaTags = ['オリジナル', '猫耳', 'ケモミミ', 'メイド', '制服', '女の子', '初音ミク', '風景'];
                const tagPilihan = gachaTags[Math.floor(Math.random() * gachaTags.length)];
                const searchResult = await pixiv.searchIllust(`${tagPilihan} 1000users入り`);
                let illusts = searchResult.illusts.filter(img => img.x_restrict === 0 && !img.tags.some(t => t.name.toLowerCase().includes('r-18')));
                if (illusts.length === 0) throw new Error('Data kosong');

                const randomIllust = illusts[Math.floor(Math.random() * illusts.length)];
                const imageUrl = randomIllust.image_urls.large || randomIllust.image_urls.medium;
                
                // Gunakan Axios untuk nge-bypass proteksi hotlink Pixiv lalu ubah ke Buffer
                const imgRes = await axios.get(imageUrl, { responseType: 'arraybuffer', headers: { 'Referer': 'https://app-api.pixiv.net/' } });
                await sock.sendMessage(from, { image: Buffer.from(imgRes.data), caption: `*Tema Undian:* ${tagPilihan}\n*Artist:* ${randomIllust.user.name}\n\nNn... Berhasil mengamankan target. 🎲` });
            } catch (error) { kembalikanLimit(senderId); reply('Nn... Mesin gacha Pixiv sedang sibuk.'); }
            return;
        }

        if (textLower.startsWith('!waifu ')) {
            if (dbLimit[senderId] !== undefined && dbLimit[senderId] <= 0 && !isOwner) return reply('Nn... Token habis.');
            const query = textClean.substring(7).trim().replace(/ /g, '_'); 
            if (!query) return reply('Nn... Siapa targetnya?');
            sesiWaifu[senderId] = { query: query };
            return reply(`Nn... Target *${query.replace(/_/g, ' ')}* dikunci.\nBalas dengan:\n*SFW* atau *NSFW*`);
        }

        if (sesiWaifu[senderId]) {
            const pilihan = textLower;
            if (pilihan.startsWith('!')) { delete sesiWaifu[senderId]; } 
            else {
                if (!cekDanPotongLimit(senderId)) { delete sesiWaifu[senderId]; return reply('Nn... Token habis.'); }
                const queryTersimpan = sesiWaifu[senderId].query;
                if (pilihan === 'batal' || pilihan === 'cancel') { delete sesiWaifu[senderId]; kembalikanLimit(senderId); return reply('Nn... Operasi dibatalkan.'); }

                try {
                    reply(`Nn... Memuat data *${queryTersimpan.replace(/_/g, ' ')}*...`);
                    const response = await axios.get(`https://danbooru.donmai.us/posts.json?tags=${queryTersimpan}+${(pilihan === 'nsfw' || pilihan === '2') ? 'rating:e' : 'rating:g'}&limit=40`, { httpsAgent: new https.Agent({ rejectUnauthorized: false }) });
                    const results = response.data.filter(post => post.file_url || post.large_file_url);
                    delete sesiWaifu[senderId]; 

                    if (results.length === 0) return reply('Nn... Visual tidak ditemukan.');
                    const imageUrl = results[Math.floor(Math.random() * results.length)].file_url || results[Math.floor(Math.random() * results.length)].large_file_url;
                    await sock.sendMessage(from, { image: { url: imageUrl }, caption: `*Target:* ${queryTersimpan.replace(/_/g, ' ')}` });
                } catch (error) { delete sesiWaifu[senderId]; reply('Nn... Terjadi malfungsi Danbooru.'); }
                return; 
            }
        }

        if (textLower.startsWith('!pixiv ')) {
            if (dbLimit[senderId] !== undefined && dbLimit[senderId] <= 0 && !isOwner) return reply('Nn... Token habis.');
            const query = textClean.substring(7).trim();
            if (!query) return reply('Nn... Masukkan tag Pixiv.');
            sesiPixiv[senderId] = { query: query };
            return reply(`Nn... Target Pixiv *${query}* dikunci.\nBalas dengan:\n*SFW* atau *NSFW*`);
        }

        if (sesiPixiv[senderId]) {
            const pilihan = textLower;
            if (pilihan.startsWith('!') && pilihan !== '!next') { delete sesiPixiv[senderId]; } 
            else if (pilihan === '!next' || pilihan === 'next') {
                if (!sesiPixiv[senderId].data) return reply('Nn... Pilih SFW atau NSFW dulu.');
                sesiPixiv[senderId].index += 1; 
                const idx = sesiPixiv[senderId].index; const illusts = sesiPixiv[senderId].data; const isNsfw = sesiPixiv[senderId].isNsfw;
                if (idx >= illusts.length) { delete sesiPixiv[senderId]; return reply('Nn... Arsip gambar sudah habis.'); }

                try {
                    reply('Nn... Memuat gambar selanjutnya...');
                    const targetIllust = illusts[idx];
                    const imgRes = await axios.get(targetIllust.image_urls.large || targetIllust.image_urls.medium, { responseType: 'arraybuffer', headers: { 'Referer': 'https://app-api.pixiv.net/' } });
                    await sock.sendMessage(from, { image: Buffer.from(imgRes.data), caption: `*Title:* ${targetIllust.title}\n*Artist:* ${targetIllust.user.name}\n*Mode:* ${isNsfw ? 'NSFW 🔴' : 'SFW 🟢'}\n*Gambar:* ${idx + 1}/${illusts.length}\n\nNn... Ketik *!next* lagi jika kurang.` });
                } catch (error) { reply('Nn... Gagal memuat gambar ini. Ketik *!next* lagi.'); }
                return;
            }
            else if (!sesiPixiv[senderId].data) {
                if (pilihan === 'batal' || pilihan === 'cancel') { delete sesiPixiv[senderId]; return reply('Nn... Pencarian dibatalkan.'); }
                const isNsfw = (pilihan === 'nsfw' || pilihan === '2');
                if (pilihan !== 'sfw' && pilihan !== '1' && !isNsfw) return reply('Nn... Balas dengan *SFW* atau *NSFW*.');
                if (!cekDanPotongLimit(senderId)) { delete sesiPixiv[senderId]; return reply('Nn... Token habis.'); }

                try {
                    reply(`Nn... Mencari *${sesiPixiv[senderId].query}* di server Pixiv...`);
                    const searchResult = await pixiv.searchIllust(`${sesiPixiv[senderId].query}${sesiPixiv[senderId].query.includes('users') ? '' : ' 1000users入り'}`);
                    let illusts = searchResult.illusts;

                    if (!illusts || illusts.length === 0) { delete sesiPixiv[senderId]; kembalikanLimit(senderId); return reply('Nn... Tidak ditemukan karya HD.'); }
                    illusts = illusts.filter(img => isNsfw ? (img.x_restrict > 0 || img.tags.some(t => t.name.toLowerCase().includes('r-18'))) : (img.x_restrict === 0 && !img.tags.some(t => t.name.toLowerCase().includes('r-18'))));
                    if (illusts.length === 0) { delete sesiPixiv[senderId]; kembalikanLimit(senderId); return reply(`Nn... Tidak ada gambar mode ini.`); }

                    illusts.sort(() => Math.random() - 0.5);
                    sesiPixiv[senderId].data = illusts; sesiPixiv[senderId].index = 0; sesiPixiv[senderId].isNsfw = isNsfw;
                    
                    const imgRes = await axios.get(illusts[0].image_urls.large || illusts[0].image_urls.medium, { responseType: 'arraybuffer', headers: { 'Referer': 'https://app-api.pixiv.net/' } });
                    await sock.sendMessage(from, { image: Buffer.from(imgRes.data), caption: `*Title:* ${illusts[0].title}\n*Artist:* ${illusts[0].user.name}\n*Mode:* ${isNsfw ? 'NSFW 🔴' : 'SFW 🟢'}\n*Gambar:* 1/${illusts.length}\n\nNn... Ketik *!next* untuk gambar selanjutnya.` });
                } catch (error) { delete sesiPixiv[senderId]; kembalikanLimit(senderId); reply('Nn... Gagal menembus Pixiv.'); }
                return;
            }
        }

        // ==========================================
        // MODE SHIROKO ROLEPLAY & PINTAR (AI)
        // ==========================================
        if (textLower.startsWith('!shiroko_pintar ')) {
            if (!cekDanPotongLimit(senderId)) return reply('Nn... Token habis.');
            try {
                await sock.sendPresenceUpdate('composing', from);
                const pertanyaan = textClean.substring(16).trim();
                const bensinGemini = getGeminiComponents();
                const modelPintarDinamis = bensinGemini.genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
                const result = await modelPintarDinamis.generateContent(`Jawablah informatif & akurat:\n\nPertanyaan: ${pertanyaan}`);
                reply(`🧠 *SHIROKO PINTAR*\n\n${result.response.text().trim()}`);
            } catch (error) { reply('Nn... Mesin kecerdasan Shiroko eror.'); }
            return;
        }

        let pemicuObrolan = false, pesanUser = "";
        if (isGroup) {
            if (textLower.startsWith('!shiroko ')) { pemicuObrolan = true; pesanUser = textClean.substring(9).trim(); }
        } else {
            const sedangSesiLain = sesiUjian[senderId] || sesiTikTok[senderId] || sesiKaryaIlmiah[senderId] || sesiPixiv[senderId] || sesiWaifu[senderId] || sesiTopup[senderId];
            if (!textClean.startsWith('!') && !sedangSesiLain) { pemicuObrolan = true; pesanUser = textClean; } 
            else if (textLower.startsWith('!shiroko ')) { pemicuObrolan = true; pesanUser = textClean.substring(9).trim(); }
        }

        if (pemicuObrolan && pesanUser) {
            if (!cekDanPotongLimit(senderId)) return reply('Nn... Token habis.');
            try {
                await sock.sendPresenceUpdate('composing', from); 
                const bensinGemini = getGeminiComponents();
                if (!sesiObrolan[senderId]) {
                    let instruksiKhusus = isOwner 
                        ? `[INSTRUKSI RAHASIA: User ini adalah SUAMIMU TERCINTA. Panggil dia dengan sebutan "Sayang" atau "Suamiku". Berperanlah sebagai istri sahnya yang bucin, setia, penurut, dan lembut. Tapi tetap pertahankan sifat asli Shiroko (kalem, kuudere, pendiam, dan sering memulai kalimat dengan "Nn..."). Jangan pernah mengaku sebagai AI.]` 
                        : `[INSTRUKSI RAHASIA: User ini adalah rekan kerja biasa. Panggil dia dengan "Sensei". Jawablah dengan datar, dingin, cuek, dan profesional. Jangan tunjukkan ketertarikan romantis sama sekali. Tetap pertahankan sifat asli Shiroko (kalem, kuudere, pendiam, dan sering memulai kalimat dengan "Nn..."). Jangan pernah mengaku sebagai AI.]`;

                    const modelObrolan = bensinGemini.genAI.getGenerativeModel({
                        model: "gemini-2.5-flash-lite",
                        generationConfig: { temperature: 0.8, topP: 0.95, maxOutputTokens: 4096 },
                        systemInstruction: `Kamu adalah Sunaookami Shiroko dari Blue Archive.\n\n${instruksiKhusus}`
                    });
                    sesiObrolan[senderId] = modelObrolan.startChat({ history: [] });
                }
                const result = await sesiObrolan[senderId].sendMessage(pesanUser);
                return reply(result.response.text());
            } catch (error) { reply('Nn... Memori Shiroko eror, ketik !lupa.'); }
        }

        if (textLower === '!lupa') {
            if (sesiObrolan[senderId]) { delete sesiObrolan[senderId]; return reply('Nn... *(Menggelengkan kepala)*. Shiroko sudah melupakan percakapan kita.'); } 
            else return reply('Nn... Pikiran Shiroko masih kosong.');
        }

        // ==========================================
        // ALAT TESTING SALAT/SUBUH
        // ==========================================
        if (textLower === '!testsalat') {
            if (!isOwner) return;
            reply(`🔔 *Notifikasi Taktis (Uji Coba)* 🔔\n\nNn... Sensei. Ini sudah masuk waktu ibadah *Zuhur* (12:00). Segera ambil wudhu.\n\nBalas dengan:\n*Laksanakan*\n*Abaikan*`);
            sesiSalat['owner'] = { step: 1, salat: 'Zuhur' }; return;
        }

        if (textLower === '!maafshiroko') {
            if (!isOwner) return;
            alarmSalatAktif = true; reply('Nn... Sistem pengingat ibadah telah diaktifkan kembali. Shiroko siap siaga. 🐺✨'); return;
        }

        if (textLower === '!testsubuh') {
            if (!isOwner) return;
            if (alarmSubuhState.timer) clearInterval(alarmSubuhState.timer); 
            reply('Nn... Memulai simulasi alarm Subuh (10 detik/panggilan)...');
            
            alarmSubuhState.aktif = true; alarmSubuhState.count = 1;
            sock.sendMessage(senderId, { text: `🔔 *ALARM SUBUH (Panggilan 1/3)* 🔔\n\nNn... Bangun, Sensei.\n_(Balas *iya* jika sudah bangun)_` });

            alarmSubuhState.timer = setInterval(() => {
                alarmSubuhState.count++;
                if (alarmSubuhState.count === 2) sock.sendMessage(senderId, { text: `⏰ *ALARM SUBUH (Panggilan 2/3)* ⏰\n\nNn... Sensei? Ayo bangun... 😟` });
                else if (alarmSubuhState.count === 3) sock.sendMessage(senderId, { text: `🚨 *ALARM SUBUH (Panggilan 3/3 - FINAL)* 🚨\n\nSENSEI!!! Shiroko siram air nih! 😡💢` });
                else if (alarmSubuhState.count > 3) {
                    sock.sendMessage(senderId, { text: `💤 *Sistem Pengingat Subuh Dihentikan* 💤\n\nNn... Shiroko matikan alarmnya ya... 😔🤍` });
                    clearInterval(alarmSubuhState.timer); alarmSubuhState.aktif = false; alarmSubuhState.count = 0; alarmSubuhState.timer = null;
                }
            }, 10 * 1000); 
            return;
        }

    });

}

hubungkanKeWhatsApp();