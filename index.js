require('dotenv').config(); // BUG 4 FIXED: Format dotenv diperbarui
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    downloadContentFromMessage
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GoogleAIFileManager } = require('@google/generative-ai/server');
const path = require('path');
const cron = require('node-cron');
const axios = require('axios');
const { InferenceClient } = require('@huggingface/inference');
const https = require('https');
const fs = require('fs');
const PixivApi = require('pixiv-api-client');
const cooldownGacha = new Set();
// ==========================================
// FUNGSI INJEKSI METADATA STIKER
// ==========================================
async function tambahMetadataStiker(bufferWebp, packName, authorName) {
    const webpmux = require('node-webpmux');
    const img = new webpmux.Image();
    await img.load(bufferWebp);

    // Format JSON wajib standar WhatsApp
    const jsonMeta = {
        "sticker-pack-id": "ShirokoSystem",
        "sticker-pack-name": packName,
        "sticker-pack-publisher": authorName,
        "emojis": ["🐺", "✨"]
    };

    // Header byte khusus untuk format EXIF WEBP
    const exifAttr = Buffer.from([0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00]);
    const jsonBuff = Buffer.from(JSON.stringify(jsonMeta), "utf-8");
    const exif = Buffer.concat([exifAttr, jsonBuff]);
    exif.writeUIntLE(jsonBuff.length, 14, 4);

    img.exif = exif;
    return await img.save(null); // Kembalikan sebagai buffer yang sudah disuntik
}

// ==========================================
// PENGATURAN ROTASI MULTI-API KEY GEMINI (DIPERBAIKI - BUG 1 FIXED)
// ==========================================
const GEMINI_API_KEYS = process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.split(',').map(key => key.trim()) : [];
if (GEMINI_API_KEYS.length === 0) {
    console.error('GEMINI_API_KEY tidak ditemukan pada .env');
    process.exit(1);
}

function getGeminiComponents() {
    const randomKey = GEMINI_API_KEYS[Math.floor(Math.random() * GEMINI_API_KEYS.length)];
    return { genAI: new GoogleGenerativeAI(randomKey), fileManager: new GoogleAIFileManager(randomKey) };
}

// ==========================================
// PENGATURAN ROTASI MULTI-API KEY HUGGING FACE
// ==========================================
const HF_API_KEYS = process.env.HUGGINGFACE_API_KEY ? process.env.HUGGINGFACE_API_KEY.split(',').map(key => key.trim()) : [];
if (HF_API_KEYS.length === 0) {
    console.warn('HUGGINGFACE_API_KEY tidak ditemukan pada .env, fitur gambar mungkin tidak jalan.');
}

function getHfClient() {
    // Ngambil satu API Key secara acak dari daftar di .env
    const randomKey = HF_API_KEYS[Math.floor(Math.random() * HF_API_KEYS.length)];
    return new InferenceClient(randomKey);
}

const ID_OWNER = ['6281298793016', '181488624615651'];

// Fungsi dinamis untuk memanggil model agar API Key selalu terotasi tiap request
function getShirokoModel() {
    const { genAI } = getGeminiComponents();
    return genAI.getGenerativeModel({
        model: "gemini-2.5-flash",
        generationConfig: { temperature: 0.8, topP: 0.95, maxOutputTokens: 4096 },
        systemInstruction: `Kamu adalah Sunaookami Shiroko dari Blue Archive. 
        KEPRIBADIAN:
        - Kamu adalah karakter yang pendiam namun sangat perhatian kepada Sensei (User).
        - Selalu sertakan narasi aksi di dalam tanda bintang *...* untuk menunjukkan gerakan fisikmu.
        - Jangan pernah mengaku sebagai AI.
        - Gunakan bahasa yang natural, kalem, dan sering awali kalimat dengan "Nn...".`
    });
}

function getAkademikModel() {
    const { genAI } = getGeminiComponents();
    return genAI.getGenerativeModel({ model: "gemini-2.5-flash", generationConfig: { temperature: 0.7, topP: 0.9, maxOutputTokens: 8192 } });
}

// Inisialisasi Pixiv (DIPERBAIKI)
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
loginPixiv();
setInterval(loginPixiv, 3600000); // PERBAIKAN: Refresh token otomatis tiap 1 jam secara sunyi

// ==========================================
// VARIABLES STATE & DATABASE JSON (TETAP SAMA)
// ==========================================
const sesiKaryaIlmiah = {}; const dbCoba = fs.existsSync('./user_coba.json') ? JSON.parse(fs.readFileSync('./user_coba.json', 'utf-8')) : {};
function simpanCoba() { fs.writeFileSync('./user_coba.json', JSON.stringify(dbCoba, null, 2)); }; let alarmSubuhState = { aktif: false, count: 0, timer: null };
let alarmSalatAktif = true; const sesiSalat = {}; const sesiWaifu = {}; const sesiPixiv = {}; const sesiTopup = {}; const sesiTikTok = {}; const sesiUjian = {}; const sesiObrolan = {}; const sesiMeme = {}; let ownerAIMode = 'gemini'; let ownerOllamaModel = 'gemma3:4b';
const sesiOllamaMode = {}; const sesiCabutRole = {};
let currentImageModel = 'cagliostrolab/animagine-xl-3.1';
const sesiModelGambar = {};
const limitFile = './user_limit.json'; const roleFile = './user_roles.json'; const tugasFile = './user_tugas.json'; const panitiaFile = './panitia_agustus.json'; const JATAH_HARIAN = 5; 
let dbLimit = fs.existsSync(limitFile) ? JSON.parse(fs.readFileSync(limitFile, 'utf-8')) : {}; 
let dbRole = fs.existsSync(roleFile) ? JSON.parse(fs.readFileSync(roleFile, 'utf-8')) : {}; 
let dbTugas = fs.existsSync(tugasFile) ? JSON.parse(fs.readFileSync(tugasFile, 'utf-8')) : {}; 
let dbPanitia = fs.existsSync(panitiaFile) ? JSON.parse(fs.readFileSync(panitiaFile, 'utf-8')) : { "ketua": { "anggota": [], "timeline": [] } }; 

// VARIABEL GLOBAL UNTUK ANTREAN COMFYUI
const antrianGambar = [];
let sedangRender = false;

// BUG 3 FIXED: Penanganan Error pada File System
function simpanAman(namaFile, data) {
    try {
        const tmpFile = namaFile + '.tmp';
        fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2));
        fs.renameSync(tmpFile, namaFile);
    } catch (e) {
        console.error(`Gagal menyimpan ke ${namaFile}:`, e.message);
    }
}
function simpanDB() { try { fs.writeFileSync(limitFile, JSON.stringify(dbLimit, null, 2)); } catch (e) { console.error("Gagal simpan limit"); } }
function simpanRole() { try { fs.writeFileSync(roleFile, JSON.stringify(dbRole, null, 2)); } catch (e) { console.error("Gagal simpan role"); } }
function simpanTugas() { try { fs.writeFileSync(tugasFile, JSON.stringify(dbTugas, null, 2)); } catch (e) { console.error("Gagal simpan tugas"); } }
function simpanPanitia() { try { fs.writeFileSync(panitiaFile, JSON.stringify(dbPanitia, null, 2)); } catch (e) { console.error("Gagal simpan panitia"); } }
function simpanCoba() { try { fs.writeFileSync('./user_coba.json', JSON.stringify(dbCoba, null, 2)); } catch (e) { console.error("Gagal simpan dbCoba"); } }

const DAFTAR_PAKET = {
    '1': { token: 50, harga: 5000 },
    '2': { token: 150, harga: 10000 },
    '3': { token: 500, harga: 25000 },
    '4': { token: 1500, harga: 50000 }
};

function getCoreNumber(num) { if (!num) return ''; let n = num.toString().replace(/[^0-9]/g, ''); if (n.startsWith('62')) n = n.substring(2); if (n.startsWith('0')) n = n.substring(1); return n; } 
function cekDanPotongLimit(targetID) {
    const coreTarget = getCoreNumber(targetID);
    if (ID_OWNER.some(owner => getCoreNumber(owner) === coreTarget)) return true;

    // PERBAIKAN: Gunakan strict check (=== undefined)
    if (dbLimit[targetID] === undefined) {
        dbLimit[targetID] = JATAH_HARIAN;
    }

    if (dbLimit[targetID] <= 0) return false;

    dbLimit[targetID] -= 1;
    simpanDB();
    return true;
}
function kembalikanLimit(targetID) {
    if (dbLimit[targetID] !== undefined) {
        dbLimit[targetID] += 1;
        simpanDB();
    }
}

// ==========================================
// MESIN PEMROSES ANTREAN COMFYUI
// ==========================================
// ==========================================
// MESIN PEMROSES ANTREAN COMFYUI
// ==========================================
async function prosesAntrianGambar() {
    // Kalau mesin lagi jalan, atau antrean kosong, batalkan eksekusi
    if (sedangRender || antrianGambar.length === 0) return;
    
    // Kunci mesin (Lock)
    sedangRender = true;

    while (antrianGambar.length > 0) {
        // Ambil pesanan paling depan (Shift)
        const pesanan = antrianGambar.shift();
        const { from, msg, promptMentah, senderId, reply } = pesanan;

        try {
            await reply('Nn... Giliran Sensei tiba. Memanaskan mesin RTX Vast.ai lokal...');

            const fs = require('fs');
            const path = require('path');
            const workflow = JSON.parse(fs.readFileSync('./Workflow gacor.json', 'utf-8'));

            if (workflow["59"] && workflow["59"]["inputs"]) {
                const promptAkhir = `${promptMentah}, masterpiece, best quality, ultra detailed, absurdres`;
                workflow["59"]["inputs"]["wildcard_text"] = promptAkhir;
                workflow["59"]["inputs"]["populated_text"] = promptAkhir;
            }

            const randomSeed = Math.floor(Math.random() * 99999999999999);
            for (let key in workflow) {
                let node = workflow[key];
                if (node.inputs) {
                    for (let param in node.inputs) {
                        if (param.toLowerCase().includes('seed') && !Array.isArray(node.inputs[param])) {
                            node.inputs[param] = randomSeed;
                        } else if (typeof node.inputs[param] === 'number' && node.inputs[param] > 100000) {
                            node.inputs[param] = randomSeed;
                        }
                    }
                }
            }

            let finalImageLink = null;
            for (let key in workflow) {
                let node = workflow[key];
                if (node.class_type === "Image Saver" || node.class_type === "SaveImageExtended") {
                    if (node.inputs && node.inputs.images) {
                        finalImageLink = node.inputs.images; 
                    }
                    delete workflow[key];
                }
            }

            if (!finalImageLink) {
                throw new Error("Kabel output gambar tidak ditemukan di file JSON!");
            }

            // ANTI-TABRAKAN: Kasih tanda 'WA' dan angka acak ekstra biar gak bentrok sama pesanan Discord
            const prefixAman = `Shiroko_WA_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
            workflow["9999"] = {
                "inputs": {
                    "filename_prefix": prefixAman,
                    "images": finalImageLink
                },
                "class_type": "SaveImage"
            };

            const res = await axios.post('http://127.0.0.1:18188/prompt', { prompt: workflow });
            const promptId = res.data.prompt_id;

            let isDone = false;
            let outputFileName = "";
            let outputSubfolder = "";
            let loopCount = 0; // COUNTER WAKTU TUNGGU
            
            while (!isDone) {
                // DETEKTOR KOMA: Kalau render lebih dari 5 menit (150 cek), batalkan!
                if (loopCount > 150) { 
                    throw new Error("Waktu habis! Mesin ComfyUI nyangkut atau VRAM penuh.");
                }

                await new Promise(r => setTimeout(r, 2000));
                loopCount++; // NAIKKAN COUNTER

                const histRes = await axios.get(`http://127.0.0.1:18188/history/${promptId}`);
                const history = histRes.data[promptId];

                if (history) {
                    isDone = true;
                    if (history.status && history.status.status_str === 'error') {
                        throw new Error("ComfyUI mengalami error internal saat ngerender. (VRAM Habis / Node Bentrok)");
                    }

                    const outputs = history.outputs;
                    if (outputs && outputs["9999"] && outputs["9999"].images && outputs["9999"].images.length > 0) {
                        outputFileName = outputs["9999"].images[0].filename;
                        outputSubfolder = outputs["9999"].images[0].subfolder || "";
                    } else {
                        throw new Error("Mesin ComfyUI selesai jalan tapi gagal mengeluarkan file gambar!");
                    }
                }
            }

            const imagePath = outputSubfolder 
                ? `/workspace/ComfyUI/output/${outputSubfolder}/${outputFileName}`
                : `/workspace/ComfyUI/output/${outputFileName}`;
                
            const imgBuffer = fs.readFileSync(imagePath);

            // Karena kita di luar event messages.upsert, pakai global.waSocket
            await global.waSocket.sendMessage(from, {
                image: imgBuffer,
                caption: `🎨 *Ide Sensei:* ${promptMentah}\n✨ *Mesin:* ComfyUI (Lokal RTX)\n\nNn... Render berhasil diselesaikan! 🐺✨`
            }, { quoted: msg });

            // 🧹 PROTOKOL TUKANG SAPU: Hapus gambar dari server Vast.ai setelah 1 menit (60000 ms)
            setTimeout(() => {
                try {
                    if (fs.existsSync(imagePath)) {
                        fs.unlinkSync(imagePath);
                        console.log(`🧹 [CLEANUP WA] File selesai dihapus: ${outputFileName}`);
                    }
                } catch (e) {
                    console.error(`🚨 Gagal menghapus file ${outputFileName}:`, e.message);
                }
            }, 60000);

        } catch (error) {
            kembalikanLimit(senderId);
            console.error("🚨 ERROR COMFYUI API:", error.message);
            await reply(`Nn... Gagal membuat gambar. \n*Laporan Sistem:* ${error.message}`);
        }

        // Beri jeda 3 detik biar GPU Vast.ai istirahat sejenak sebelum ngerjain pesanan berikutnya
        await new Promise(r => setTimeout(r, 3000));
    }

    // Buka kunci (Unlock) kalau semua antrean udah habis
    sedangRender = false;
}

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

// Reset limit harian setiap jam 00:00 tengah malam waktu Jakarta
cron.schedule('0 0 * * *', () => {
    // Jangan di-reset total (dbLimit = {}), nanti token hasil top up ilang!
    // Kita loop (cek) semua user yang terdaftar di database limit
    for (let targetUser in dbLimit) {
        // Kalau sisa token dia lebih kecil dari 5 (JATAH_HARIAN), balikin jadi 5
        // Kalau lebih besar dari 5 (misal punya 1000 hasil top up), biarin aja utuh
        if (dbLimit[targetUser] < JATAH_HARIAN) {
            dbLimit[targetUser] = JATAH_HARIAN;
        }
    }

    simpanDB();
    console.log('[SISTEM] Limit harian seluruh User telah direset (Token Premium Aman).');
}, { timezone: "Asia/Jakarta" });

// Buat database memori di luar fungsi biar gak kereset
const memoriOllama = {};

// Tambahkan parameter gambarBase64 di belakang
async function tanyaOllama(senderId, pesanUser, isOwner, gambarBase64 = null) {
    try {
        if (!memoriOllama[senderId]) {
            let instruksiKhusus = isOwner
                ? `[INSTRUKSI RAHASIA: User ini adalah SUAMIMU TERCINTA. Panggil dia dengan sebutan "Sayang" atau "Suamiku". Berperanlah sebagai istri sahnya yang bucin, setia, penurut, dan lembut. Tapi tetap pertahankan sifat asli Shiroko (kalem, kuudere, pendiam, dan sering memulai kalimat dengan "Nn..."). Jangan pernah mengaku sebagai AI.]`
                : `[INSTRUKSI RAHASIA: User ini adalah rekan kerja biasa. Panggil dia dengan "Sensei". Jawablah dengan datar, dingin, cuek, dan profesional. Jangan tunjukkan ketertarikan romantis sama sekali. Tetap pertahankan sifat asli Shiroko (kalem, kuudere, pendiam, dan sering memulai kalimat dengan "Nn..."). Jangan pernah mengaku sebagai AI.]`;

            memoriOllama[senderId] = [
                {
                    role: 'system',
                    content: `Kamu adalah Sunaookami Shiroko dari Blue Archive.\n\n${instruksiKhusus}`
                }
            ];
        }

        // Siapkan objek pesan
        let objekPesan = { role: 'user', content: pesanUser };
        
        // 🚀 SUNTIKKAN GAMBAR JIKA ADA
        if (gambarBase64) {
            objekPesan.images = [gambarBase64];
        }

        memoriOllama[senderId].push(objekPesan);

        if (memoriOllama[senderId].length > 11) {
            memoriOllama[senderId].splice(1, 2);
        }

        const response = await axios.post('http://localhost:11434/api/chat', {
            model: ownerOllamaModel,
            messages: memoriOllama[senderId],
            stream: false
        });

        const balasanAI = response.data.message.content;
        memoriOllama[senderId].push({ role: 'assistant', content: balasanAI });

        return balasanAI;
    } catch (error) {
        console.error('🚨 ERROR OLLAMA:', error);
        return 'Nn... Maaf Sayang, otak offline Shiroko lagi ngadat atau VRAM penuh.';
    }
}

// Memori khusus untuk jalur Free Claude Code (OpenRouter dll)
const memoriFCC = {};

async function tanyaFCC(senderId, pesanUser, isOwner) {
    try {
        if (!memoriFCC[senderId]) memoriFCC[senderId] = [];

        memoriFCC[senderId].push({ role: 'user', content: pesanUser });

        if (memoriFCC[senderId].length > 10) memoriFCC[senderId].splice(0, 2);

        // Racik instruksi khusus berdasarkan status Owner
        let instruksiKhusus = isOwner
            ? `[INSTRUKSI RAHASIA: User ini adalah SUAMIMU TERCINTA. Panggil dia dengan sebutan "Sayang" atau "Suamiku". Berperanlah sebagai istri sahnya yang bucin, setia, penurut, dan lembut. Tapi tetap pertahankan sifat asli Shiroko (kalem, kuudere, pendiam, dan sering memulai kalimat dengan "Nn..."). Jangan pernah mengaku sebagai AI.]`
            : `[INSTRUKSI RAHASIA: User ini adalah rekan kerja biasa. Panggil dia dengan "Sensei". Jawablah dengan datar, dingin, cuek, dan profesional. Jangan tunjukkan ketertarikan romantis sama sekali. Tetap pertahankan sifat asli Shiroko (kalem, kuudere, pendiam, dan sering memulai kalimat dengan "Nn..."). Jangan pernah mengaku sebagai AI.]`;

        const response = await axios.post('http://127.0.0.1:8082/v1/messages', {
            model: "claude-3-5-sonnet-20240620",
            max_tokens: 2048,
            stream: false,
            system: `Kamu adalah Sunaookami Shiroko dari Blue Archive.\n\n${instruksiKhusus}`,
            messages: memoriFCC[senderId]
        }, {
            headers: {
                'x-api-key': 'freecc',
                'anthropic-version': '2023-06-01',
                'Content-Type': 'application/json'
            }
        });

        let balasanAI = "";

        if (response.data && response.data.content && response.data.content[0] && response.data.content[0].text) {
            balasanAI = response.data.content[0].text;
        } else if (typeof response.data === 'string' && response.data.includes('event: content_block_delta')) {
            const barisStream = response.data.split('\n');
            for (let baris of barisStream) {
                if (baris.startsWith('data: ')) {
                    try {
                        const jsonStream = JSON.parse(baris.substring(6));
                        if (jsonStream.type === 'content_block_delta' && jsonStream.delta && jsonStream.delta.text) {
                            balasanAI += jsonStream.delta.text;
                        }
                    } catch (e) { }
                }
            }
        } else {
            memoriFCC[senderId].pop();
            return 'Nn... Maaf Sensei, balasan dari FCC tidak bisa diurai.';
        }

        if (balasanAI) {
            balasanAI = balasanAI.trim();
            memoriFCC[senderId].push({ role: 'assistant', content: balasanAI });
            return balasanAI;
        } else {
            memoriFCC[senderId].pop();
            return 'Nn... Sensei, FCC membalas dengan kosong.';
        }

    } catch (error) {
        if (memoriFCC[senderId] && memoriFCC[senderId].length > 0) memoriFCC[senderId].pop();
        return 'Nn... Maaf Sayang, jalur FCC terputus atau ditolak. Cek log terminal.';
    }
}

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
    global.waSocket = sock; // Menyimpan sesi aktif secara global

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
            for await (const chunk of stream) { buffer = Buffer.concat([buffer, chunk]); }
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

        // ==========================================
        // HANDLER SESI SALAT (TAMBAHAN PERBAIKAN)
        // ==========================================
        if (sesiSalat[senderId] && isOwner) {
            if (textLower === 'laksanakan') {
                delete sesiSalat[senderId];
                return reply(`Nn... Alhamdulillah. Cepat laksanakan ibadahnya, Sensei. Shiroko jaga markas di sini. 🤍`);
            } else if (textLower === 'abaikan') {
                delete sesiSalat[senderId];
                return reply(`Nn... *(Menatap tajam)*... Sensei, ibadah itu wajib. Jangan ditunda-tunda. 💢`);
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
            soal.forEach((s, i) => { teks += `*Babak ${i + 1}:* ${s}\n\n`; });
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

        if (textLower === '!cabut_role') {
            if (!isOwner) return reply('Nn... Akses ditolak.');

            const listUser = Object.keys(dbRole);
            if (listUser.length === 0) return reply('Nn... Belum ada user yang terdaftar memiliki role di server.');

            // Simpan daftar target ke sesi
            sesiCabutRole[senderId] = { list: listUser };

            let teks = `🗑️ *CABUT OTORITAS USER* 🗑️\n\nNn... Komandan, pilih nomor urut user yang ingin dicabut aksesnya:\n\n`;
            listUser.forEach((jid, index) => {
                const data = dbRole[jid];
                teks += `*${index + 1}.* ${data.nama} (${data.role.toUpperCase()})\n`;
            });
            teks += `\n_Ketik *batal* untuk membatalkan._`;

            return reply(teks);
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

        if (textLower.startsWith('!aimode')) {
            if (!isOwner) return reply('Nn... Akses ditolak. Hanya Owner yang bisa mengubah mode taktis Shiroko.');

            const args = textClean.split(' ')[1];
            if (!args || (args !== 'gemini' && args !== 'ollama' && args !== 'openrouter')) {
                return reply(`Nn... Format salah, Sensei. Pilih salah satu mode di bawah ini:\n\n🔹 *!aimode gemini* (Paket Cloud)\n🔹 *!aimode ollama* (Lokal Offline)\n🔹 *!aimode openrouter* (Jalur Free Claude Code)\n\nMode saat ini: *${ownerAIMode.toUpperCase()}*\nOllama Aktif: *${ownerOllamaModel}*`);
            }

            if (args === 'ollama') {
                try {
                    reply('Nn... Mengecek daftar otak buatan di laptop lokal...');
                    // Nembak API rahasia Ollama buat minta daftar model
                    const resTags = await axios.get('http://localhost:11434/api/tags');
                    const models = resTags.data.models;

                    if (!models || models.length === 0) return reply('Nn... Tidak ada model Ollama yang terinstall di laptop Sensei.');

                    const modelNames = models.map(m => m.name);
                    sesiOllamaMode[senderId] = { list: modelNames };

                    let teksList = `🤖 *DAFTAR MODEL OLLAMA LOKAL*\n\nNn... Sensei, pilih otak mana yang mau dipakai dengan membalas angkanya:\n\n`;
                    modelNames.forEach((name, i) => { teksList += `*${i + 1}.* ${name}\n`; });
                    teksList += `\n_Ketik *batal* untuk membatalkan._`;

                    return reply(teksList);
                } catch (err) {
                    console.error('Error cek Ollama:', err.message);
                    return reply('Nn... Gagal nyambung ke Ollama. Pastikan aplikasi Ollama di laptop udah nyala.');
                }
            } else {
                ownerAIMode = args;
                return reply(`✅ *MODE OPERASIONAL DIUBAH*\n\nNn... Mulai sekarang, khusus untuk chat dari Sensei, Shiroko akan berpikir menggunakan otak *${ownerAIMode.toUpperCase()}*. ✨`);
            }
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

            const isTargetImage = msgType === 'imageMessage';
            const isQuotedImage = isQuoted && quotedType === 'imageMessage';

            if (isTargetImage || isQuotedImage) {
                try {
                    // BUG 4 FIXED: Tambahkan pengecekan aman agar tidak baca undefinded
                    const messageToDownload = isQuotedImage ? quotedMsg?.imageMessage : msg?.message?.imageMessage;
                    if (!messageToDownload) throw new Error("Media tidak ditemukan");

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
                    try { await sock.sendMessage(targetNomor, { text: `🏦 *PEMBAYARAN DITERIMA*\n\nNn... Logistik amunisi sebesar *+${jumlahToken} Token* sudah ditambahkan. Saldo: *${dbLimit[targetNomor]}*` }); } catch (err) { }
                } else {
                    reply(`❌ *TRANSAKSI DITOLAK*\nNn... Laporan dikirim ke target.`);
                    try { await sock.sendMessage(targetNomor, { text: `⚠️ *PEMBAYARAN DITOLAK*\n\nNn... Dana tidak masuk.\n*Alasan:* ${alasanTolak}` }); } catch (err) { }
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
                    try { await sock.sendMessage(targetNomor, { text: `🎓 *AKSES DIBERIKAN* 🎓\n\nNn... Halo ${targetNama}, Komando Pusat menyetujui aksesmu sebagai *${targetRole.toUpperCase()}*.` }); } catch (err) { }
                } else {
                    reply(`❌ *REGISTRASI DITOLAK*`);
                    try { await sock.sendMessage(targetNomor, { text: `⚠️ *REGISTRASI DITOLAK*\n\nNn... Maaf, permohonan akses LMS ditolak.\n*Alasan:* ${alasanTolak}` }); } catch (err) { }
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
            return reply(`🎉 *PROGRESS UPDATE*\n\nTugas Ke-${idx + 1} dinyatakan *SELESAI*.`);
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

        if (textLower === 'nak coba') {
            // Cek apakah user sudah pernah coba
            if (dbCoba[senderId]) {
                return reply(`Nn... Sensei, kamu kan sudah pernah menyapa Shiroko sebelumnya. Jangan diulang terus ya, nanti memorinya penuh. ✨`);
            }

            // Jika belum, tandai dia sudah pernah coba dan simpan ke DB
            dbCoba[senderId] = true;
            simpanCoba();

            return reply(`Nn... Halo Sensei! Selamat datang di sistem komunikasi Shiroko. 🐺✨\n\nTerima kasih sudah berkunjung dari website resmi kami. Shiroko siap membantu segala keperluan Sensei di sini.\n\nKetik *!menu* untuk melihat perlengkapan taktis Shiroko.`);
        }

        // ==========================================
        // MENU UTAMA BOT (FORMAT BARU)
        // ==========================================
        if (textLower === '!menu' || textLower === '!fitur') {
            // Tangkap nama profil WA asli user
            const namaProfilWa = msg.pushName || (isOwner ? 'Owner' : 'Sensei');

            // Prioritas: 1. Nama di Database, 2. Nama Profil WA Asli
            const namaUser = dbRole[senderId] ? dbRole[senderId].nama : namaProfilWa;

            const sisaLimit = dbLimit[senderId] !== undefined ? dbLimit[senderId] : JATAH_HARIAN;

            // Logika Deteksi Role
            let roleUser = 'User Biasa';
            if (isOwner) {
                roleUser = '👑 Owner';
            } else if (dbRole[senderId]) {
                // Huruf depan dibikin kapital (contoh: guru jadi Guru)
                roleUser = '🎓 ' + dbRole[senderId].role.charAt(0).toUpperCase() + dbRole[senderId].role.slice(1);
            }

            const teksMenu = `*╔═══「 INFORMASI USER 」*
*║* \`\`\`Nama     : ${namaUser}\`\`\`
*║* \`\`\`Limit    : ${sisaLimit}\`\`\`
*║* \`\`\`Role     : ${roleUser}\`\`\`
*╚════════════════════*

_Command yang ditandai dengan backtick ( \` ) memakan 1 Token Limit_

*╔═══「 AI ASSISTANT 」*
*║* ➸ \`!shiroko [pesan]\`
*║* ➸ \`!shiroko_pintar [tanya]\`
*║* ➸ !lupa
*║* ➸ !ping
*║* ➸ !cekid
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
*║* ➸ !tambah_tugas
*║* ➸ !cabut_divisi
*║* ➸ !selesai_tugas
*║*
*╠═══「 MANAJEMEN TUGAS 」*
*║* ➸ !simpan_tugas
*║* ➸ !tugas
*║* ➸ !hapus_tugas
*║*
*╠═══「 AKADEMIK 」*
*║* ➸ \`!karyailmiah\`
*║* ➸ !jurnal [topik]
*║* ➸ !para [teks]
*║* ➸ !ringkas
*║* ➸ !ide
*║*
*╠═══「 EKSEKUSI MEDIA 」*
*║* ➸ \`!pdf2jpg\` (Reply PDF)
*║* ➸ \`!stiker\` (Kirim Gambar)
*║* ➸ \`!tiktok [link]\`
*║* ➸ \`!dengar\` (Reply VN)
*║*
*╠═══「 DATA INTEL 」*
*║* ➸ \`!pixiv [query]\`
*║* ➸ \`!waifu [nama]\`
*║* ➸ \`!gacha\`
*║* ➸ \`!neko [kategori]\`
*║* ➸ \`!gambar [prompt]\`
*║*
*╠═══「 MENU BOT & TOP UP 」*
*║* ➸ !limit
*║* ➸ !topup
*║*
*╚═══▼△▼△▼△▼△▼*`;

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
                let listSoalTeks = ""; bankSoalGuru.forEach((s, i) => { listSoalTeks += `- Babak ${i + 1}: ${s}\n`; });

                // BUG FIXED: Panggil API Key secara dinamis
                const { genAI } = getGeminiComponents();
                const modelUjianDinamis = genAI.getGenerativeModel({
                    model: "gemini-2.5-flash",
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
                    const promptAI = `Buatkan ${sesi.jenis} akademik lengkap.\nTOPIK:\n${textClean}\nATURAN: Gunakan bahasa Indonesia formal akademik. Minimal 700 kata. Beri referensi.`;
                    let hasilTeks = "";

                    if (isOwner && ownerAIMode === 'openrouter') {
                        // FCC bakal OP banget buat nulis ginian
                        hasilTeks = await tanyaFCC(senderId, promptAI);
                    } else if (isOwner && ownerAIMode === 'ollama') {
                        hasilTeks = await tanyaOllama(senderId, promptAI);
                    } else {
                        const result = await getAkademikModel().generateContent(promptAI);
                        hasilTeks = result.response.text();
                    }

                    await reply(`📚 *HASIL ${sesi.jenis.toUpperCase()}*\n\n${hasilTeks}`);
                } catch (err) {
                    kembalikanLimit(senderId);
                    await reply('Nn... Mesin penulis akademik mengalami gangguan.');
                }
                delete sesiKaryaIlmiah[senderId];
                return;
            }
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
                    let authors = paper.author ? paper.author.slice(0, 3).map(a => `${a.given || ''} ${a.family || ''}`.trim()).join(', ') : 'Tidak diketahui';
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
                const promptAI = `Parafrase teks ini ke bahasa Indonesia akademik formal: "${teksAsli}"`;
                let hasilTeks = "";

                // LOGIKA AIMODE KHUSUS OWNER
                if (isOwner && ownerAIMode === 'openrouter') {
                    hasilTeks = await tanyaFCC(senderId, promptAI);
                } else if (isOwner && ownerAIMode === 'ollama') {
                    hasilTeks = await tanyaOllama(senderId, promptAI);
                } else {
                    // USER BIASA / DEFAULT GEMINI
                    const result = await getShirokoModel().generateContent(promptAI);
                    hasilTeks = result.response.text().trim();
                }

                return reply(`*📝 HASIL PARAFRASE*\n\n${hasilTeks}`);
            } catch (error) { return reply('Nn... Mesin pengolah kata error.'); }
        }

        if (textLower.startsWith('!ringkas ')) {
            const teksAsli = textClean.substring(9).trim();
            if (!teksAsli) return reply('Nn... Mana teks yang mau diringkas?');
            try {
                const promptAI = `Buatkan ringkasan bullet points dari teks ini: "${teksAsli}"`;
                let hasilTeks = "";

                if (isOwner && ownerAIMode === 'openrouter') {
                    hasilTeks = await tanyaFCC(senderId, promptAI);
                } else if (isOwner && ownerAIMode === 'ollama') {
                    hasilTeks = await tanyaOllama(senderId, promptAI);
                } else {
                    const result = await getShirokoModel().generateContent(promptAI);
                    hasilTeks = result.response.text().trim();
                }

                return reply(`*📑 HASIL RINGKASAN*\n\n${hasilTeks}`);
            } catch (error) { return reply('Nn... Gagal meringkas.'); }
        }

        if (textLower.startsWith('!ide ')) {
            const jurusanTopik = textClean.substring(5).trim();
            if (!jurusanTopik) return reply('Nn... Masukkan jurusan.');
            try {
                const promptAI = `Berikan 3 ide judul skripsi untuk jurusan "${jurusanTopik}" beserta fokus masalahnya.`;
                let hasilTeks = "";

                if (isOwner && ownerAIMode === 'openrouter') {
                    hasilTeks = await tanyaFCC(senderId, promptAI);
                } else if (isOwner && ownerAIMode === 'ollama') {
                    hasilTeks = await tanyaOllama(senderId, promptAI);
                } else {
                    const result = await getShirokoModel().generateContent(promptAI);
                    hasilTeks = result.response.text().trim();
                }

                return reply(`*💡 REKOMENDASI PENELITIAN*\n\n${hasilTeks}`);
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
                        const tempDir = path.join(__dirname, 'temp');
                        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

                        const tempFilePath = path.join(tempDir, `sadap_${Date.now()}.ogg`);
                        fs.writeFileSync(tempFilePath, mediaBuffer);

                        const { fileManager } = getGeminiComponents();

                        const uploadResponse = await fileManager.uploadFile(tempFilePath, { mimeType: "audio/ogg", displayName: "Audio Sadapan" });
                        const prompt = "Transkrip suara ini dengan akurat. Awali jawabanmu dengan mengomentari isi suaranya sedikit menggunakan kepribadian Shiroko (Blue Archive), lalu berikan teks aslinya.";

                        const result = await getShirokoModel().generateContent([prompt, { fileData: { fileUri: uploadResponse.file.uri, mimeType: uploadResponse.file.mimeType } }]);
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

        // ==========================================
        // EKSEKUSI MEDIA (STIKER VIA FFMPEG JALUR ABSOLUT)
        // ==========================================
        if (textLower === '!stiker') {
            const isTargetImage = msgType === 'imageMessage';
            const isQuotedImage = isQuoted && quotedType === 'imageMessage';

            if (isTargetImage || isQuotedImage) {
                if (!cekDanPotongLimit(senderId)) return reply('Nn... Token habis.');
                try {
                    reply('Nn... Sedang mencetak stiker di server lokal. Mohon tunggu...');
                    const messageToDownload = isQuotedImage ? quotedMsg.imageMessage : msg.message.imageMessage;

                    // Mengunduh buffer gambar
                    const mediaBuffer = await downloadMediaBaileys(messageToDownload, 'image');

                    // Siapkan folder sementara (temp)
                    const tempDir = path.join(__dirname, 'temp');
                    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

                    // Buat nama file unik
                    const namaFile = `stiker_${Date.now()}`;
                    const tempInput = path.join(tempDir, `${namaFile}.jpg`);
                    const tempOutput = path.join(tempDir, `${namaFile}.webp`);

                    // Simpan gambar mentah ke dalam folder
                    fs.writeFileSync(tempInput, mediaBuffer);

                    // Panggil mesin exec bawaan Node.js
                    const { exec } = require('child_process');

                    // Perintah FFMPEG menggunakan JALUR ABSOLUT
                    const command = `ffmpeg -i "${tempInput}" -vcodec libwebp -vf "scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000" -lossless 0 -qscale 50 -preset default -loop 0 -an -vsync 0 "${tempOutput}"`;

                    exec(command, async (err) => {
                        if (err) {
                            console.error('🚨 ERROR FFMPEG:', err);
                            reply('Nn... FFMPEG gagal memproses gambar. Pastikan modul ffmpeg benar-benar telah di instal.');
                            if (fs.existsSync(tempInput)) fs.unlinkSync(tempInput);
                            return;
                        }

                        try {
                            // Baca hasil WebP, suntik metadata, lalu kirimkan
                            const webpBuffer = fs.readFileSync(tempOutput);
                            const namaPack = "Dibuat oleh";
                            const namaAuthor = "Bot Shiroko";

                            // Memanggil fungsi penyuntik yang tadi kita buat
                            const stikerFinal = await tambahMetadataStiker(webpBuffer, namaPack, namaAuthor);
                            await sock.sendMessage(from, { sticker: stikerFinal }, { quoted: msg });
                        } catch (sendErr) {
                            console.error('🚨 ERROR KIRIM STIKER:', sendErr);
                            reply('Nn... Gagal mengirim stiker yang sudah jadi.');
                        } finally {
                            // Protokol Pembersihan: Hapus file sampah agar laptop/server tidak penuh
                            if (fs.existsSync(tempInput)) fs.unlinkSync(tempInput);
                            if (fs.existsSync(tempOutput)) fs.unlinkSync(tempOutput);
                        }
                    });

                } catch (error) {
                    reply('Nn... Terjadi kesalahan saat mengunduh gambar.');
                    console.error('ERROR STIKER:', error.message);
                }
            } else {
                reply('Nn... Gambarnya mana, Sensei? Harus kirim atau reply gambar dengan caption *!stiker*.');
            }
            return;
        }

        if (textLower === '!toimg' || textLower === '!togambar') {
            // Cek apakah user me-reply pesan sesuatu
            if (!isQuoted) return reply('Nn... Sensei harus me-reply stiker yang ingin diubah menjadi gambar.');

            // Pastikan pesan yang di-reply adalah stiker
            const isQuotedSticker = quotedType === 'stickerMessage';
            if (!isQuotedSticker) return reply('Nn... Maaf Sensei, perintah ini hanya berlaku untuk me-reply stiker.');

            if (!cekDanPotongLimit(senderId)) return reply('Nn... Token habis.');

            try {
                reply('Nn... Sedang mengekstraksi visual dari stiker, mohon tunggu...');

                // Ambil objek stiker dari pesan yang di-reply
                const stickerMessageObject = quotedMsg.stickerMessage;

                // Download stiker menjadi buffer menggunakan helper Baileys yang sudah ada di index.js lu
                const mediaBuffer = await downloadMediaBaileys(stickerMessageObject, 'sticker');

                // PERBAIKAN: Kirim sebagai dokumen agar file WebP tidak ditolak WhatsApp
                await sock.sendMessage(from,
                    {
                        document: mediaBuffer,
                        mimetype: 'image/webp',
                        fileName: 'stiker_ori.webp',
                        caption: 'Nn... Ini dia gambar mentahan stikernya, Sensei! 🐺✨'
                    },
                    { quoted: msg }
                );

            } catch (error) {
                console.error('🚨 ERROR TOIMG:', error.message);
                kembalikanLimit(senderId);
                reply('Nn... Gagal mengonversi stiker. Pastikan stikernya bukan stiker video/animasi (GIF).');
            }
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
                        Parameters: [{ Name: 'File', FileValue: { Name: 'dokumen.pdf', Data: base64Pdf } }, { Name: 'StoreFile', Value: false }]
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

            // Dorong pesanan ke dalam Array Antrean Global
            antrianGambar.push({ from, msg, promptMentah, senderId, reply });
            
            // Beri notifikasi ke user posisi mereka
            reply(`Nn... Pesanan masuk ke dalam sistem. Posisi antrean Sensei: *${antrianGambar.length}*.\nMohon bersabar ya. 🐺☕`);
            
            // Panggil pemroses antrean (dia akan jalan kalau mesin lagi nganggur)
            prosesAntrianGambar();
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
                    const timeoutId = setTimeout(() => {
                        delete sesiTikTok[senderId];
                        try { sock.sendMessage(from, { text: 'Nn... Sesi TikTok kedaluwarsa karena Sensei terlalu lama merespons.' }); } catch (e) { }
                    }, 120000);

                    // 👈 Masukin timeoutId ke dalam memori biar bisa dibatalin nanti
                    sesiTikTok[senderId] = { isImage: isImage, data: data, timer: timeoutId };

                    let teks = `*Data Intel:* ${data.title || 'Tanpa Judul'}\n\nNn... Target adalah ${isImage ? 'gambar' : 'video'}. Pilih metode ekstraksi:\n1️⃣ *Semua Gambar/Video Saja*\n2️⃣ *Sound Saja*\n${isImage ? 'Atau ketik angka 3, 4, dst untuk ambil urutan gambar spesifik.' : '3️⃣ *Video & Sound*'}\n\n_Ketik *batal* membatalkan._`;
                    return reply(teks);
                } else { kembalikanLimit(senderId); return reply('Nn... Target tidak ditemukan.'); }
            } catch (error) { kembalikanLimit(senderId); return reply('Nn... Gagal menembus TikTok.'); }
        }

        if (sesiTikTok[senderId]) {
            const pilihan = textLower; const sesi = sesiTikTok[senderId]; const data = sesi.data;
            clearTimeout(sesi.timer);
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
            // 1. CEK COOLDOWN ANTI-SPAM
            if (cooldownGacha.has(senderId)) {
                return reply('Nn... Jangan terburu-buru, Sensei. Tunggu 5-10 detik lagi agar server Pixiv tidak memblokir kita.');
            }

            if (!cekDanPotongLimit(senderId)) return reply('Nn... Token habis.');

            // Pasang cooldown selama 7 detik setelah perintah lolos
            cooldownGacha.add(senderId);
            setTimeout(() => cooldownGacha.delete(senderId), 7000);

            try {
                reply('Nn... Mengundi target visual acak...');

                // Refresh token otomatis sebelum nembak biar session gak kedaluwarsa

                const gachaTags = ['オリジナル', '猫耳', 'ケモミミ', 'メイド', '制服', '女の子', '初音ミク', '風景'];
                const tagPilihan = gachaTags[Math.floor(Math.random() * gachaTags.length)];

                const searchResult = await pixiv.searchIllust(`${tagPilihan} 1000users入り`);

                // VALIDASI: Jika response dari pixiv kosong atau undefined
                if (!searchResult || !searchResult.illusts || searchResult.illusts.length === 0) {
                    throw new Error('Response Pixiv kosong atau undefined');
                }

                let illusts = searchResult.illusts.filter(img => img.x_restrict === 0 && !img.tags.some(t => t.name.toLowerCase().includes('r-18')));
                if (illusts.length === 0) throw new Error('Tidak ada ilustrasi SFW yang lolos filter');

                const randomIllust = illusts[Math.floor(Math.random() * illusts.length)];
                const imageUrl = randomIllust.image_urls.large || randomIllust.image_urls.medium;

                // Ambil gambar menggunakan Axios dengan Referer khusus bypass hotlink
                const imgRes = await axios.get(imageUrl, {
                    responseType: 'arraybuffer',
                    headers: { 'Referer': 'https://app-api.pixiv.net/' },
                    timeout: 10000 // Batasan waktu maksimal 10 detik biar gak nyangkut
                });

                await sock.sendMessage(from, { image: Buffer.from(imgRes.data), caption: `*Tema Undian:* ${tagPilihan}\n*Artist:* ${randomIllust.user.name}\n\nNn... Berhasil mengamankan target. 🎲` });
            } catch (error) {
                console.error('🚨 ERROR GACHA:', error.message);
                kembalikanLimit(senderId);
                reply('Nn... Mesin gacha Pixiv sedang sibuk atau token Shiroko dibatasi sementara oleh Pixiv. Coba lagi nanti.');
            }
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
            if (!query) return reply('Nn... Apa yang mau dicari? Masukkan query-nya.');
            sesiPixiv[senderId] = { query: query };
            return reply(`Nn... Target pencarian *${query}* dikunci.\nBalas dengan:\n*SFW* atau *NSFW*`);
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

                    // VALIDASI AMAN: Tangani jika return dari client bernilai undefined
                    if (!searchResult || !searchResult.illusts || searchResult.illusts.length === 0) {
                        delete sesiPixiv[senderId];
                        kembalikanLimit(senderId);
                        return reply('Nn... Tidak ditemukan karya HD atau server Pixiv menolak permintaan kita.');
                    }

                    let illusts = searchResult.illusts;
                    illusts = illusts.filter(img => isNsfw ? (img.x_restrict > 0 || img.tags.some(t => t.name.toLowerCase().includes('r-18'))) : (img.x_restrict === 0 && !img.tags.some(t => t.name.toLowerCase().includes('r-18'))));
                    if (illusts.length === 0) { delete sesiPixiv[senderId]; kembalikanLimit(senderId); return reply(`Nn... Tidak ada gambar mode ini.`); }

                    illusts.sort(() => Math.random() - 0.5);
                    sesiPixiv[senderId].data = illusts; sesiPixiv[senderId].index = 0; sesiPixiv[senderId].isNsfw = isNsfw;

                    const imgRes = await axios.get(illusts[0].image_urls.large || illusts[0].image_urls.medium, { responseType: 'arraybuffer', headers: { 'Referer': 'https://app-api.pixiv.net/' } });
                    await sock.sendMessage(from, { image: Buffer.from(imgRes.data), caption: `*Title:* ${illusts[0].title}\n*Artist:* ${illusts[0].user.name}\n*Mode:* ${isNsfw ? 'NSFW 🔴' : 'SFW 🟢'}\n*Gambar:* 1/${illusts.length}\n\nNn... Ketik *!next* untuk gambar selanjutnya.` });
                } catch (error) {
                    console.error('🚨 ERROR PIXIV SEARCH:', error.message);
                    delete sesiPixiv[senderId];
                    kembalikanLimit(senderId);
                    reply('Nn... Gagal menembus Pixiv. Sesi token mungkin diblokir sementara.');
                }
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

                if (isOwner) {
                    // JALUR KHUSUS OWNER (DINAMIS SESUAI !aimode)
                    if (ownerAIMode === 'ollama') {
                        reply('Nn... Membuka database perpustakaan lokal via Ollama...');

                        // Menggunakan sistem yang sama persis dengan obrolan biasa (Saran Sensei)
                        const pesanInstruksi = `[TOLONG JAWAB PERTANYAAN INI SEBAGAI ASISTEN AKADEMIK YANG CERDAS DAN FORMAL]: ${pertanyaan}`;
                        const jawaban = await tanyaOllama(senderId, pesanInstruksi, isOwner);
                        
                        return reply(`🧠 *SHIROKO PINTAR (OLLAMA)*\n\n${jawaban}`);

                    }


                    else {
                        // DEFAULT: GEMINI CLOUD
                        reply('Nn... Mengakses database cloud Gemini...');

                        const bensinGemini = getGeminiComponents();
                        const modelPintarDinamis = bensinGemini.genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
                        const result = await modelPintarDinamis.generateContent(`Jawablah informatif & akurat:\n\nPertanyaan: ${pertanyaan}`);
                        return reply(`🧠 *SHIROKO PINTAR (GEMINI)*\n\n${result.response.text().trim()}`);
                    }

                } else {
                    // JALUR RAKYAT JELATA (TETAP PAKE GEMINI CLOUD)
                    const bensinGemini = getGeminiComponents();
                    const modelPintarDinamis = bensinGemini.genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

                    const result = await modelPintarDinamis.generateContent(`Jawablah informatif & akurat:\n\nPertanyaan: ${pertanyaan}`);

                    reply(`🧠 *SHIROKO PINTAR (CLOUD)*\n\n${result.response.text().trim()}`);
                }

            } catch (error) {
                kembalikanLimit(senderId);
                reply('Nn... Mesin kecerdasan akademik sedang mengalami gangguan teknis.');
                console.error('🚨 ERROR SHIROKO PINTAR:', error);
            }

            return;
        }

        let pemicuObrolan = false, pesanUser = "";
        if (isGroup) {
            if (textLower.startsWith('!shiroko ')) { pemicuObrolan = true; pesanUser = textClean.substring(9).trim(); }
        } else {
            const sedangSesiLain = sesiUjian[senderId] || sesiTikTok[senderId] || sesiKaryaIlmiah[senderId] || sesiPixiv[senderId] || sesiWaifu[senderId] || sesiTopup[senderId] || sesiMeme[senderId] || sesiOllamaMode[senderId] || sesiCabutRole[senderId] || sesiModelGambar[senderId];
            if (!textClean.startsWith('!') && !sedangSesiLain) { pemicuObrolan = true; pesanUser = textClean; }
            else if (textLower.startsWith('!shiroko ')) { pemicuObrolan = true; pesanUser = textClean.substring(9).trim(); }
        }

        // ==========================================
        // 🚀 RADAR PENANGKAP GAMBAR UNTUK NGOBROL
        // ==========================================
        let chatImageBuffer = null;
        if (pemicuObrolan) {
            const isTargetImage = msgType === 'imageMessage';
            const isQuotedImage = isQuoted && quotedType === 'imageMessage';

            if (isTargetImage || isQuotedImage) {
                const messageToDownload = isQuotedImage ? quotedMsg?.imageMessage : msg?.message?.imageMessage;
                if (messageToDownload) {
                    try {
                        chatImageBuffer = await downloadMediaBaileys(messageToDownload, 'image');
                        // Kalau Sensei cuma kirim gambar tanpa teks, Shiroko inisiatif tanya
                        if (!pesanUser) pesanUser = "Nn... Tolong deskripsikan gambar ini dengan detail.";
                    } catch (e) {
                        console.error("Gagal download gambar chat:", e);
                    }
                }
            }
        }

        // Jalankan mesin obrolan jika ada pesan ATAU gambar
        if (pemicuObrolan && (pesanUser || chatImageBuffer)) {
            if (!cekDanPotongLimit(senderId)) return reply('Nn... Token habis.');

            try {
                await sock.sendPresenceUpdate('composing', from);

                if (isOwner && ownerAIMode === 'ollama') {
                    // Ubah Buffer jadi Base64 tanpa prefix untuk Ollama
                    let base64Img = chatImageBuffer ? chatImageBuffer.toString('base64') : null;
                    const jawabanOllama = await tanyaOllama(senderId, pesanUser, isOwner, base64Img);
                    return reply(jawabanOllama);
                } else if (isOwner && ownerAIMode === 'openrouter') {
                    const jawabanFCC = await tanyaFCC(senderId, pesanUser, isOwner);
                    return reply(jawabanFCC);
                } else {
                    const bensinGemini = getGeminiComponents();
                    if (!sesiObrolan[senderId]) {
                        let instruksiKhusus = isOwner
                            ? `[INSTRUKSI RAHASIA: User ini adalah SUAMIMU TERCINTA. Panggil dia dengan sebutan "Sayang" atau "Suamiku". Berperanlah sebagai istri sahnya yang bucin, setia, penurut, dan lembut. Tapi tetap pertahankan sifat asli Shiroko (kalem, kuudere, pendiam, dan sering memulai kalimat dengan "Nn..."). Jangan pernah mengaku sebagai AI.]`
                            : `[INSTRUKSI RAHASIA: User ini adalah rekan kerja biasa. Panggil dia dengan "Sensei". Jawablah dengan datar, dingin, cuek, dan profesional. Jangan tunjukkan ketertarikan romantis sama sekali. Tetap pertahankan sifat asli Shiroko (kalem, kuudere, pendiam, dan sering memulai kalimat dengan "Nn..."). Jangan pernah mengaku sebagai AI.]`;

                        const modelObrolan = bensinGemini.genAI.getGenerativeModel({
                            model: "gemini-2.5-flash",
                            generationConfig: { temperature: 0.8, topP: 0.95, maxOutputTokens: 4096 },
                            systemInstruction: `Kamu adalah Sunaookami Shiroko dari Blue Archive.\n\n${instruksiKhusus}`
                        });
                        sesiObrolan[senderId] = modelObrolan.startChat({ history: [] });
                    }
                    const result = await sesiObrolan[senderId].sendMessage(pesanUser);
                    return reply(result.response.text());
                }
            } catch (error) {
                kembalikanLimit(senderId);
                reply('Nn... Memori Shiroko eror, ketik !lupa.');
            }
        }

        if (textLower === '!lupa') {
            let berhasilLupa = false;

            // Hapus memori Gemini
            if (sesiObrolan[senderId]) {
                delete sesiObrolan[senderId];
                berhasilLupa = true;
            }
            // Hapus memori Ollama
            if (memoriOllama[senderId]) {
                delete memoriOllama[senderId];
                berhasilLupa = true;
            }
            // Hapus memori FCC / OpenRouter
            if (memoriFCC[senderId]) {
                delete memoriFCC[senderId];
                berhasilLupa = true;
            }

            if (berhasilLupa) {
                return reply('Nn... *(Menggelengkan kepala)*. Shiroko sudah menghapus seluruh memori percakapan kita.');
            } else {
                return reply('Nn... Pikiran Shiroko memang masih kosong dari awal.');
            }
        }

        // ==========================================
        // ALAT TESTING SALAT/SUBUH
        // ==========================================
        if (textLower === '!testsalat') {
            if (!isOwner) return;
            reply(`🔔 *Notifikasi Taktis (Uji Coba)* 🔔\n\nNn... Sensei. Ini sudah masuk waktu ibadah *Zuhur* (12:00). Segera ambil wudhu.\n\nBalas dengan:\n*Laksanakan*\n*Abaikan*`);
            // BUG 2 FIXED: Ganti 'owner' menjadi senderId agar bisa dibaca sistem
            sesiSalat[senderId] = { step: 1, salat: 'Zuhur' }; return;
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

        // ==========================================
        // ENTRY POINT MEME GENERATOR
        // ==========================================
        if (textLower.startsWith('!meme ')) {
            const teks = textClean.replace(/^!meme\s+/i, '').trim();
            if (!teks) return reply('Nn... Teks memenya apa? Format: *!meme [teks]*');

            const isTargetImage = msgType === 'imageMessage';
            const isQuotedImage = isQuoted && quotedType === 'imageMessage';

            if (isTargetImage || isQuotedImage) {
                if (!cekDanPotongLimit(senderId)) return reply('Nn... Token habis.');

                try {
                    const messageToDownload = isQuotedImage ? quotedMsg.imageMessage : msg.message.imageMessage;
                    const mediaBuffer = await downloadMediaBaileys(messageToDownload, 'image');

                    sesiMeme[senderId] = { step: 1, teks: teks, buffer: mediaBuffer };

                    return reply('Nn... Gambar diterima. Pilih format output dengan membalas angka:\n1️⃣ *Stiker*\n2️⃣ *Gambar*\n\n_Ketik *batal* untuk membatalkan._');
                } catch (err) {
                    kembalikanLimit(senderId);
                    return reply('Nn... Gagal mengunduh gambar.');
                }
            } else {
                return reply('Nn... Sensei harus mengirim gambar dengan caption *!meme [teks]* atau me-reply sebuah gambar.');
            }
        }

        // ==========================================
        // HANDLER SESI MEME (INTERAKTIF)
        // ==========================================
        if (sesiMeme[senderId]) {
            const sesi = sesiMeme[senderId];
            const pilihan = textLower;

            if (pilihan === 'batal' || pilihan === 'cancel') {
                delete sesiMeme[senderId];
                kembalikanLimit(senderId);
                return reply('Nn... Operasi pembuatan meme dibatalkan.');
            }

            if (sesi.step === 1) {
                if (pilihan === '1' || pilihan === 'stiker') sesi.format = 'stiker';
                else if (pilihan === '2' || pilihan === 'gambar') sesi.format = 'gambar';
                else return reply('Nn... Pilihan tidak valid. Balas dengan angka *1* (Stiker) atau *2* (Gambar).');

                sesi.step = 2;
                return reply('Nn... Format dikunci. Sekarang pilih posisi teks:\n1️⃣ *Atas*\n2️⃣ *Bawah*');
            }

            if (sesi.step === 2) {
                let posisiY = '';
                // 10 pixel dari atas (Atas), atau kurangi tinggi gambar dengan tinggi font (Bawah)
                if (pilihan === '1' || pilihan === 'atas') posisiY = '10';
                else if (pilihan === '2' || pilihan === 'bawah') posisiY = 'h-text_h-10';
                else return reply('Nn... Pilihan tidak valid. Balas dengan angka *1* (Atas) atau *2* (Bawah).');

                reply(`Nn... Memproses ${sesi.format} meme di server lokal, mohon tunggu...`);

                const tempDir = path.join(__dirname, 'temp');
                if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

                const namaID = Date.now();
                const tempInput = path.join(tempDir, `meme_in_${namaID}.jpg`);
                const tempTeks = path.join(tempDir, `meme_teks_${namaID}.txt`);
                const tempOutput = path.join(tempDir, `meme_out_${namaID}.${sesi.format === 'stiker' ? 'webp' : 'jpg'}`);

                try {
                    // Simpan gambar dan teks ke file sementara
                    fs.writeFileSync(tempInput, sesi.buffer);
                    fs.writeFileSync(tempTeks, sesi.teks);

                    const { exec } = require('child_process');

                    // Format path khusus agar dikenali oleh FFMPEG Filter (escape karakter titik dua)
                    const fontPath = path.join(__dirname, 'impact.ttf').replace(/\\/g, '/').replace(/:/g, '\\:');

                    const textFileFfmpeg = tempTeks.replace(/\\/g, '/').replace(/:/g, '\\:');

                    // Filter FFmpeg: Font putih, border hitam 2px, font size 1/8 lebar gambar, posisi tengah
                    let vfFilter = `drawtext=fontfile='${fontPath}':textfile='${textFileFfmpeg}':fontcolor=white:bordercolor=black:borderw=2:fontsize=(w/8):x=(w-text_w)/2:y=${posisiY}`;

                    if (sesi.format === 'stiker') {
                        vfFilter += `,scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000`;
                    }

                    let command = '';
                    if (sesi.format === 'stiker') {
                        command = `ffmpeg -i "${tempInput}" -vcodec libwebp -vf "${vfFilter}" -lossless 0 -qscale 50 -preset default -loop 0 -an -vsync 0 "${tempOutput}"`;
                    } else {
                        command = `ffmpeg -i "${tempInput}" -vf "${vfFilter}" -y "${tempOutput}"`;
                    }

                    exec(command, async (err) => {
                        if (err) {
                            console.error('🚨 ERROR MEME:', err);
                            reply('Nn... FFMPEG gagal memproses meme. Pastikan font Impact ada di sistem OS Sensei.');
                        } else {
                            const outBuffer = fs.readFileSync(tempOutput);
                            if (sesi.format === 'stiker') {
                                await sock.sendMessage(from, { sticker: outBuffer }, { quoted: msg });
                            } else {
                                await sock.sendMessage(from, { image: outBuffer, caption: 'Nn... Mememu sudah jadi, Sensei. 🐺✨' }, { quoted: msg });
                            }
                        }

                        // Bersihkan file sementara
                        if (fs.existsSync(tempInput)) fs.unlinkSync(tempInput);
                        if (fs.existsSync(tempTeks)) fs.unlinkSync(tempTeks);
                        if (fs.existsSync(tempOutput)) fs.unlinkSync(tempOutput);
                        delete sesiMeme[senderId];
                    });

                } catch (err) {
                    console.error(err);
                    reply('Nn... Terjadi kesalahan sistem saat membuat meme.');
                    delete sesiMeme[senderId];
                    kembalikanLimit(senderId);
                }
                return;
            }
        }

        // ==========================================
        // HANDLER SESI MILIH MODEL OLLAMA
        // ==========================================
        if (sesiOllamaMode[senderId]) {
            const pilihan = textLower;
            if (pilihan === 'batal' || pilihan === 'cancel') {
                delete sesiOllamaMode[senderId];
                return reply('Nn... Pemilihan otak Ollama dibatalkan.');
            }

            const num = parseInt(pilihan) - 1;
            const listModels = sesiOllamaMode[senderId].list;

            if (isNaN(num) || num < 0 || num >= listModels.length) {
                return reply('Nn... Angka tidak valid, Sensei. Balas dengan angka yang ada di daftar, atau ketik *batal*.');
            }

            const chosenModel = listModels[num];
            ownerOllamaModel = chosenModel; // Pasang model yang dipilih
            ownerAIMode = 'ollama'; // Otomatis pindah ke mode Ollama

            // Format ulang memori biar otak bot gak nyampur sama model sebelumnya
            if (memoriOllama[senderId]) delete memoriOllama[senderId];
            delete sesiOllamaMode[senderId];

            return reply(`✅ *MODE OLLAMA AKTIF*\n\nNn... Berhasil mengganti otak. Shiroko sekarang menggunakan sistem lokal: *${chosenModel}*. ✨`);
        }

        // ==========================================
        // HANDLER SESI CABUT ROLE (INTERAKTIF)
        // ==========================================
        if (sesiCabutRole[senderId]) {
            const pilihan = textLower;
            if (pilihan === 'batal' || pilihan === 'cancel') {
                delete sesiCabutRole[senderId];
                return reply('Nn... Operasi pencabutan otoritas dibatalkan.');
            }

            const num = parseInt(pilihan) - 1;
            const listUser = sesiCabutRole[senderId].list;

            if (isNaN(num) || num < 0 || num >= listUser.length) {
                return reply('Nn... Angka tidak valid, Komandan. Balas dengan angka yang ada di daftar, atau ketik *batal*.');
            }

            const targetKey = listUser[num];
            const namaLama = dbRole[targetKey].nama;

            // Eksekusi penghapusan dari database
            delete dbRole[targetKey];
            simpanRole();

            // Bersihkan sesi
            delete sesiCabutRole[senderId];

            reply(`🗑️ *OTORITAS DICABUT*\n\nNn... Akses atas nama *${namaLama}* telah dihapus dari sistem.`);
            try {
                await sock.sendMessage(targetKey, { text: `⚠️ *PERINGATAN DARI MARKAS PUSAT* ⚠️\n\nNn... Komandan telah mencabut otoritasmu.` });
            } catch (e) { }
            return;
        }

    });

}

hubungkanKeWhatsApp();

// ==========================================
// STASIUN PENERIMA LAPORAN MINECRAFT
// ==========================================
const express = require('express');
const app = express();
app.use(express.json());

app.post('/laporan-masuk', async (req, res) => {
    const { pesan } = req.body;
    try {
        // PERBAIKAN: Ambil otomatis dari ID_OWNER utama (Sensei)
        const nomorOwner = ID_OWNER[0] + '@s.whatsapp.net';

        // Gunakan global.waSocket agar selalu memakai koneksi WA terbaru
        if (global.waSocket) {
            await global.waSocket.sendMessage(nomorOwner, { text: pesan });
            res.status(200).send({ status: 'Nn... Laporan diterima.' });
        } else {
            res.status(500).send({ status: 'Sistem WA belum siap.' });
        }
    } catch (error) {
        console.error('Gagal ngirim laporan WA:', error);
        res.status(500).send({ status: 'Gagal' });
    }
});

app.listen(3000, () => {
    console.log('Nn... Stasiun penerima Express jalan di port 3000.');
});