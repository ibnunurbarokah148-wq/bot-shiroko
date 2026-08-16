// ==========================================
// BOT SHIROKO — Entry Point
// Minimal bootstrap: Baileys + Express + Cron
// ==========================================
require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, makeCacheableSignalKeyStore, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const cron = require('node-cron');
const express = require('express');

// Modular imports
const { JATAH_HARIAN, ID_OWNER } = require('./config/constants');
const { dbLimit, simpanDB } = require('./config/db');
const { getAll: getDatabaseRows } = require('./config/database');
const state = require('./config/state');
const { registerMessageHandler } = require('./handlers/message');
const { setSocket, getSocket } = require('./utils/socket');
const jadibotService = require('./services/jadibot.service');
const { initDatabase, migrateFromJSON } = require('./config/database');
const { startAutoCleanup } = require('./utils/cleanup');
const { initPrayerScheduler } = require('./services/prayer.service');

// Services (auto-init saat di-require: Pixiv login, AI memory cleanup)
require('./services/pixiv.service');

// ==========================================
// ERROR BOUNDARY GLOBAL (FIX #13)
// ==========================================
process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err) => {
    console.error('🚨 Uncaught Exception:', err);
});

// ==========================================
// KONEKSI BAILEYS (HANYA KONEKSI WA)
// ==========================================
async function startBot() {
    const { state: authState, saveCreds } = await useMultiFileAuthState('./auth_session');
    
    // Fetch latest WA Web version untuk mencegah error 405 (Method Not Allowed)
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`[WA] Menggunakan WA v${version.join('.')}, isLatest: ${isLatest}`);

    const sock = makeWASocket({
        version,
        auth: {
            creds: authState.creds,
            keys: makeCacheableSignalKeyStore(authState.keys, pino({ level: 'silent' }))
        },
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ['Ubuntu', 'Chrome', '20.0.04']
    });

    // Simpan ke module untuk akses dari services (ComfyUI, cron, express, dll)
    setSocket(sock);

    // Simpan kredensial otomatis
    sock.ev.on('creds.update', saveCreds);

    // ==========================================
    // PAIRING CODE (Tanpa QR) — hanya saat belum terdaftar
    // ==========================================
    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            let nomorTelepon = process.env.WA_PHONE_NUMBER;
            if (!nomorTelepon) {
                console.error('\n🚨 WA_PHONE_NUMBER tidak ditemukan di .env! Bot tidak bisa login tanpa QR. Tambahkan WA_PHONE_NUMBER di .env lalu jalankan ulang.');
                return;
            }

            try {
                const formattedNumber = nomorTelepon.toString().replace(/[^0-9]/g, '');
                const code = await sock.requestPairingCode(formattedNumber);
                console.log(`\n🔗 KODE PAIRING: ${code}\n`);
                console.log('Buka WhatsApp > Perangkat Tertaut > Tautkan Perangkat > Masukkan kode di atas.');
            } catch (err) {
                console.error('\n🚨 Gagal meminta kode pairing. Pastikan nomor benar dan coba lagi:', err.message);
            }
        }, 3000);
    }

    // ==========================================
    // CONNECTION UPDATE & RECONNECT (FIX BUG #9 + #14)
    // ==========================================
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            console.log(`🔌 Koneksi terputus (kode: ${statusCode || 'unknown'}). Reconnect: ${shouldReconnect}`);
            if (shouldReconnect) {
                // Delay reconnect 3 detik untuk menghindari loop terlalu cepat
                setTimeout(() => startBot(), 3000);
            } else {
                console.log('Sesi telah logout. Hapus folder auth_session dan jalankan ulang.');
            }
        } else if (connection === 'open') {
            console.log('✅ Bot Shiroko terhubung ke WhatsApp!');
        }
    });

    // ==========================================
    // REGISTER MESSAGE HANDLER
    // ==========================================
    registerMessageHandler(sock);
}

// ==========================================
// CRON JOB: Reset limit harian (00:00 WIB)
// Dijalankan SEKALI di luar startBot()
// ==========================================
cron.schedule('0 0 * * *', () => {
    const { dbPremium } = require('./config/db');
    for (const { id, amount } of getDatabaseRows('user_limits')) {
        const premiumValue = dbPremium[id];
        const isPremium = premiumValue && (premiumValue === true || premiumValue > Date.now());
        if (isPremium) {
            dbLimit[id] = 1000;
        } else if (amount < JATAH_HARIAN) {
            dbLimit[id] = JATAH_HARIAN;
        }
    }
    simpanDB();
    console.log('🔄 [CRON] Semua limit user telah di-reset (Premium & Topup saldo terlindungi).');
}, { timezone: "Asia/Jakarta" });

// ==========================================
// CRON JOB: AI Dynamic Prayer Scheduler (Presisi Cibuntu, Cibitung, Kab. Bekasi)
// Dijalankan SEKALI di luar startBot()
// ==========================================
initPrayerScheduler();

// ==========================================
// EXPRESS API (Laporan Minecraft / Webhook)
// Dijalankan SEKALI di luar startBot()
// ==========================================
const app = express();
app.use(express.json());

app.get('/', (req, res) => {
    res.send('🐺 Bot Shiroko aktif.');
});

app.post('/laporan-masuk', async (req, res) => {
    // 🛡️ Keamanan: Hanya terima request jika API Key cocok
    const apiKey = req.headers['x-api-key'];
    if (apiKey !== process.env.WEB_SECRET_KEY) {
        return res.status(401).json({ status: 'error', message: 'Unauthorized. Invalid API Key.' });
    }

    const { pesan } = req.body;
    if (!pesan) return res.status(400).json({ status: 'error', message: 'Field "pesan" wajib diisi.' });

    try {
        const sock = getSocket(); // Selalu ambil koneksi terbaru
        if (!sock) return res.status(503).json({ status: 'error', message: 'Bot WhatsApp belum terhubung.' });
        const targetOwner = Array.isArray(ID_OWNER) ? ID_OWNER[0] : ID_OWNER;
        const idOwnerJid = targetOwner ? `${targetOwner}@s.whatsapp.net` : null;
        if (!idOwnerJid) return res.status(500).json({ status: 'error', message: 'ID_OWNER belum dikonfigurasi.' });
        await sock.sendMessage(idOwnerJid, { text: `🚨 *LAPORAN MASUK DARI SERVER* 🚨\n\n${pesan}` });
        res.json({ status: 'ok', message: 'Laporan terkirim ke WhatsApp Owner.' });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});
// ==========================================
// PORT CHECKER UNTUK STATUS AI LOKAL
// ==========================================
const net = require('net');
let ollamaStatus = 'OFFLINE';
function checkPort(port, host) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(1000);
        socket.on('connect', () => { socket.destroy(); resolve(true); });
        socket.on('timeout', () => { socket.destroy(); resolve(false); });
        socket.on('error', () => { resolve(false); });
        socket.connect(port, host);
    });
}

// Cek status secara otomatis setiap 2 detik di background
setInterval(async () => {
    ollamaStatus = (await checkPort(11434, '127.0.0.1')) ? 'ONLINE' : 'OFFLINE';
}, 2000);

// Endpoint API Dashboard Web Shiroko
app.get('/api/dashboard', (req, res) => {
    // Memberikan izin CORS agar web eksternal bisa mengakses
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    let whatsappUsers = 0;
    let totalChat = 0;
    let imageGenerated = 0;
    let aiRequests = 0;
    let commandsCount = 0;
    let discordUsers = 0;

    try {
        // Tarik data asli dari SQLite bot
        const { getAll, getOne } = require('./config/database');
        const users = getAll('user_limits');
        whatsappUsers = users.length;

        const statTotalChat = getOne('statistics', 'totalChat');
        const statImageGen = getOne('statistics', 'imageGenerated');
        const statAiReq = getOne('statistics', 'aiRequests');
        const statCommands = getOne('statistics', 'commands');
        const statDiscord = getOne('statistics', 'discordUsers');

        if (statTotalChat) totalChat = statTotalChat.value;
        if (statImageGen) imageGenerated = statImageGen.value;
        if (statAiReq) aiRequests = statAiReq.value;
        if (statCommands) commandsCount = statCommands.value;
        if (statDiscord) discordUsers = statDiscord.value;

    } catch(e) {
        console.error('Gagal membaca SQLite untuk API Dashboard:', e);
    }
    
    // Data statistik (Kini murni real-time dari database)
    const stats = {
        totalChat: totalChat,
        imageGenerated: imageGenerated,
        discordUsers: discordUsers,
        whatsappUsers: whatsappUsers,
        aiRequests: aiRequests,
        commands: commandsCount
    };
    
    const services = [
        { name: 'WhatsApp Bot', status: 'ONLINE', icon: 'fab fa-whatsapp' },
        { name: 'Discord Bot', status: process.env.DISCORD_TOKEN ? 'ONLINE' : 'OFFLINE', icon: 'fab fa-discord' },
        { name: 'Google Gemini', status: process.env.GEMINI_API_KEY ? 'ONLINE' : 'OFFLINE', icon: 'fas fa-brain' },
        { name: 'OpenRouter AI', status: process.env.OPENROUTER_API_KEY ? 'ONLINE' : 'OFFLINE', icon: 'fas fa-network-wired' },
        { name: 'Cloudflare AI', status: process.env.CLOUDFLARE_API_TOKEN ? 'ONLINE' : 'OFFLINE', icon: 'fas fa-cloud' },
        { name: 'ArisuSoft AI', status: process.env.ARISU_API_KEY ? 'ONLINE' : 'OFFLINE', icon: 'fas fa-robot' },
        { name: 'PixAI Engine', status: process.env.PIXAI_TOKEN ? 'ONLINE' : 'OFFLINE', icon: 'fas fa-palette' },
        { name: 'Server Minecraft', status: 'ONLINE', icon: 'fas fa-cube' },
        { name: 'Local AI (Ollama)', status: ollamaStatus || 'STANDBY', icon: 'fas fa-server' }
    ];

    res.json({ stats, services });
});

// Endpoint untuk Control Panel (Dipanggil oleh Web Dashboard)
app.post('/api/control', (req, res) => {
    const apiKey = req.headers['x-api-key'];
    if (apiKey !== process.env.WEB_SECRET_KEY) {
        return res.status(401).json({ status: 'error', message: 'Unauthorized. Invalid API Key.' });
    }

    const { action } = req.body;
    
    if (action === 'toggle_comfyui') {
        state.comfyUIEnabled = !state.comfyUIEnabled;
        console.log(`[CONTROL] Mesin ComfyUI sekarang: ${state.comfyUIEnabled ? 'ONLINE' : 'OFFLINE'}`);
        res.json({ status: 'ok', message: `Mesin ComfyUI berhasil ${state.comfyUIEnabled ? 'diaktifkan' : 'dimatikan'}.` });
    } 
    else if (action === 'restart') {
        console.log(`[CONTROL] Menerima perintah RESTART dari Web Dashboard.`);
        res.json({ status: 'ok', message: 'Bot sedang dimuat ulang (PM2 akan otomatis menghidupkan).' });
        setTimeout(() => {
            process.exit(1);
        }, 1000);
    } 
    else {
        res.status(400).json({ status: 'error', message: 'Action tidak dikenali.' });
    }
});

// ==========================================
// PIXAI WEB AUTH HELPER (PIXIV-AUTH STYLE)
// ==========================================
global.authNonces = new Set(); // Simpan nonce aktif

app.post('/api/save-pixai-token', async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    const { token, nonce } = req.body;
    if (!token || !token.trim()) {
        return res.status(400).json({ status: 'error', message: 'Token tidak boleh kosong.' });
    }

    // Validasi Nonce (Wajib ada untuk mencegah sharing bookmarklet)
    if (!nonce) {
        return res.status(400).json({ status: 'error', message: '❌ Kode keamanan (Nonce) tidak ditemukan. Harap generate ulang Bookmarklet.' });
    }

    if (global.authNonces) {
        if (!global.authNonces.has(nonce)) {
            return res.status(403).json({ status: 'error', message: '❌ Sesi Kode Kadaluarsa atau Sudah Terpakai! Harap generate ulang Bookmarklet di Web Shiroko.' });
        }
        // Hapus nonce agar hanya bisa 1x pakai
        global.authNonces.delete(nonce);
    }

    try {
        const pixaiAuth = require('./pixai-auth');
        const cleanToken = token.trim();
        pixaiAuth.addTokenToEnv(cleanToken);

        const payload = pixaiAuth.decodeJwt(cleanToken);
        let diffDays = 'N/A';
        if (payload?.exp) {
            diffDays = ((new Date(payload.exp * 1000) - new Date()) / (1000 * 60 * 60 * 24)).toFixed(1);
        }

        // Kirim notifikasi ke WA Owner
        try {
            const sock = getSocket();
            const targetOwner = Array.isArray(ID_OWNER) ? ID_OWNER[0] : ID_OWNER;
            if (sock && targetOwner) {
                await sock.sendMessage(`${targetOwner}@s.whatsapp.net`, {
                    text: `🎉 *[ TOKEN PIXAI BARU TERHUBUNG ]*\n\nNn... Token PixAI dari Web Auth Helper berhasil terhubung!\n\n📌 *User ID:* \`${payload?.sub || 'N/A'}\`\n⏳ *Masa Aktif:* *${diffDays} Hari Tersisa* 🟢\n✅ *Status:* PIXAI_TOKEN pool di server bot berhasil diperbarui!`
                });
            }
        } catch (eWa) { }

        res.json({
            status: 'ok',
            message: `🎉 Token PixAI berhasil terhubung ke server bot Shiroko! (Sisa Masa Aktif: ${diffDays} Hari)`,
            userId: payload?.sub || 'N/A',
            diffDays: diffDays
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

app.post('/api/generate-bookmarklet', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    const { otp } = req.body;
    if (!otp) {
        return res.status(400).json({ status: 'error', message: 'Kode OTP tidak boleh kosong.' });
    }

    if (!global.webAuthSessions || !global.webAuthSessions.has(otp)) {
        return res.status(403).json({ status: 'error', message: '❌ Kode OTP tidak valid atau sudah kedaluwarsa (Max 5 Menit).' });
    }

    // OTP Valid! Hapus dari memori agar hanya bisa dipakai sekali generate (jika perlu)
    // Atau biarkan sampai expired. Mari kita hapus agar aman (Single Use Generate).
    global.webAuthSessions.delete(otp);

    // ==========================================
    // POLYMORPHIC OBFUSCATION + SINGLE-USE NONCE
    // ==========================================
    const nonce = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    global.authNonces.add(nonce);
    
    // Hapus nonce otomatis jika tidak terpakai dalam 5 menit
    setTimeout(() => { global.authNonces.delete(nonce); }, 5 * 60 * 1000);

    const botUrl = process.env.WEB_SHIROKO_URL || 'https://shiroko-project.my.id';
    
    function toHex(str) { return str.split('').map(c => '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''); }
    const errPrompt = toHex('Koneksi otomatis gagal. Salin Kode ini lalu paste di Opsi B Web Auth:');
    const errAlert = toHex('Token tidak ditemukan. Pastikan Anda sudah login di pixai.art');

    const bookmarkletPayload = `javascript:(function(){let _t=null;const _r=new RegExp(atob('ZXlKW2EtekEtWjAtOV8tXStcLlthLXpBLVowLTlfLV0rXC5bYS16QS1aMC05Xy1dKw=='),'g');try{for(let _v of Object['${toHex('values')}'](window['${toHex('localStorage')}'])){if(typeof _v==='string'){let _m=_v['${toHex('match')}'](_r);if(_m){for(let _k of _m){try{let b=_k['${toHex('split')}']('.')[1]['${toHex('replace')}'](/-/g,'+')['${toHex('replace')}'](/_/g,'/');while(b.length%4)b+='=';let p=JSON['${toHex('parse')}'](atob(b));if(p.sub||p.user_id){_t=_k;break;}}catch(e){}}if(_t)break;}}}}catch(err){}if(!_t){let _m=document['${toHex('cookie')}']['${toHex('match')}'](/token=([^;]+)/);if(_m){let _cm=_m[1]['${toHex('match')}'](_r);if(_cm)_t=_cm[0];}}if(!_t){let _l=window['${toHex('localStorage')}']['${toHex('getItem')}']('token');if(_l){let _lm=_l['${toHex('match')}'](_r);if(_lm)_t=_lm[0];}}if(_t){window['${toHex('fetch')}']('${botUrl}/api/save-pixai-token',{method:'${toHex('POST')}',headers:{'${toHex('Content-Type')}':'${toHex('application/json')}'},body:JSON['${toHex('stringify')}']({token:_t,nonce:'${nonce}'})})['${toHex('then')}'](r=>r['${toHex('json')}']())['${toHex('then')}'](d=>{window['${toHex('alert')}'](d.message);})['${toHex('catch')}'](e=>{window['${toHex('prompt')}']('${errPrompt}',_t+'|${nonce}');});}else{window['${toHex('alert')}']('${errAlert}');}})()`;

    res.json({ status: 'ok', payload: bookmarkletPayload });
});

const http = require('http');
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server, {
    cors: { origin: '*' }
});
global.io = io; // Jadikan global agar bisa diakses handler

io.on('connection', (socket) => {
    console.log('[WEBSOCKET] Client Web Dashboard terhubung:', socket.id);
    socket.on('disconnect', () => {
        console.log('[WEBSOCKET] Client Web terputus:', socket.id);
    });
});

server.listen(3000, () => {
    console.log('🌐 Express & Socket.IO server berjalan di port 3000');
});

// ==========================================
// MULAI BOT: INIT DATABASE → WHATSAPP → JADIBOT
// ==========================================
initDatabase().then(() => {
    console.log('[STARTUP] Database SQLite berhasil diinisialisasi.');
    // Migrasi data JSON lama (hanya berjalan sekali)
    migrateFromJSON();
    startAutoCleanup();
    return startBot();
}).then(() => {
    if (jadibotService.resumeAllJadibots) jadibotService.resumeAllJadibots();
}).catch(console.error);

// ==========================================
// MULAI BOT DISCORD & MINECRAFT (SHARED MEMORY)
// ==========================================
require('./bot-dc.js');
