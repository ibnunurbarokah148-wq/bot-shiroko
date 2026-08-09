// ==========================================
// BOT SHIROKO — Entry Point
// Minimal bootstrap: Baileys + Express + Cron
// ==========================================
require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, makeCacheableSignalKeyStore, Browsers, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const cron = require('node-cron');
const express = require('express');
const readline = require('readline');
const { Boom } = require('@hapi/boom');

// Modular imports
const { JATAH_HARIAN, ID_OWNER } = require('./config/constants');
const { dbLimit, simpanDB } = require('./config/db');
const state = require('./config/state');
const { registerMessageHandler } = require('./handlers/message');
const { getCoreNumber } = require('./utils/helpers');
const { setSocket, getSocket } = require('./utils/socket');
const jadibotService = require('./services/jadibot.service');
const { initDatabase, migrateFromJSON } = require('./config/database');
const { startAutoCleanup } = require('./utils/cleanup');
const alarmService = require('./services/alarm.service');
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
    for (let id in dbLimit) {
        const isPremium = dbPremium[id] && (dbPremium[id] === true || dbPremium[id] > Date.now());
        if (isPremium) {
            dbLimit[id] = 1000;
        } else if (dbLimit[id] < JATAH_HARIAN) {
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
let comfyUIStatus = 'OFFLINE';

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
    comfyUIStatus = (await checkPort(8188, '127.0.0.1')) ? 'ONLINE' : 'OFFLINE';
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
        { name: 'WhatsApp', status: 'ONLINE', icon: 'fab fa-whatsapp' },
        { name: 'Discord', status: 'ONLINE', icon: 'fab fa-discord' },
        { name: 'Minecraft', status: 'ONLINE', icon: 'fas fa-cube' },
        { name: 'Gemini', status: 'ONLINE', icon: 'fas fa-brain' },
        { name: 'Cloudflare', status: 'ONLINE', icon: 'fas fa-cloud' },
        { name: 'OpenRouter', status: 'ONLINE', icon: 'fas fa-network-wired' },
        { name: 'Ollama', status: ollamaStatus, icon: 'fas fa-server' },
        { name: 'ComfyUI', status: comfyUIStatus, icon: 'fas fa-palette' }
    ];

    res.json({ stats, services });
});

// Endpoint untuk Control Panel (Dipanggil oleh Web Dashboard)
app.post('/api/control', express.json(), (req, res) => {
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
app.post('/api/save-pixai-token', async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    const { token } = req.body;
    if (!token || !token.trim()) {
        return res.status(400).json({ status: 'error', message: 'Token tidak boleh kosong.' });
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

app.get('/pixai-auth-helper', (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    const html = `<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>PixAI Web Auth Helper — Bot Shiroko</title>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap" rel="stylesheet">
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Outfit', sans-serif; }
        body { background: #0f172a; color: #f8fafc; display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 20px; }
        .card { background: #1e293b; border: 1px solid #334155; border-radius: 20px; padding: 35px; width: 100%; max-width: 550px; box-shadow: 0 20px 40px rgba(0,0,0,0.4); text-align: center; }
        .logo { font-size: 50px; margin-bottom: 10px; }
        h1 { font-size: 24px; color: #38bdf8; font-weight: 700; margin-bottom: 8px; }
        p { font-size: 14px; color: #94a3b8; line-height: 1.6; margin-bottom: 25px; }
        .step-box { background: #0f172a; border-radius: 12px; padding: 20px; text-align: left; margin-bottom: 20px; border: 1px solid #1e293b; }
        .step-title { font-weight: 600; color: #f1f5f9; font-size: 15px; margin-bottom: 10px; display: flex; align-items: center; gap: 8px; }
        .btn-bookmark { display: inline-block; background: linear-gradient(135deg, #0284c7, #2563eb); color: #fff; text-decoration: none; padding: 14px 24px; border-radius: 12px; font-weight: 600; font-size: 15px; box-shadow: 0 4px 15px rgba(37,99,235,0.4); margin: 10px 0; cursor: move; }
        input[type="text"] { width: 100%; background: #0f172a; border: 1px solid #334155; color: #f8fafc; padding: 14px; border-radius: 10px; font-size: 14px; margin-bottom: 12px; outline: none; }
        input[type="text"]:focus { border-color: #38bdf8; }
        button.btn-send { width: 100%; background: #10b981; color: #fff; border: none; padding: 14px; border-radius: 10px; font-size: 15px; font-weight: 600; cursor: pointer; transition: 0.2s; }
        button.btn-send:hover { background: #059669; }
        .alert { display: none; padding: 14px; border-radius: 10px; margin-top: 15px; font-size: 14px; text-align: left; }
        .alert-success { background: #064e3b; color: #6ee7b7; border: 1px solid #047857; }
        .alert-error { background: #7f1d1d; color: #fca5a5; border: 1px solid #b91c1c; }
    </style>
</head>
<body>
    <div class="card">
        <div class="logo">🎨 🐺</div>
        <h1>PixAI Web Auth Helper</h1>
        <p>Hubungkan Akun PixAI.art ke Server Bot Shiroko secara otomatis tanpa periksa DevTools manual.</p>

        <div class="step-box">
            <div class="step-title">✨ Opsi A: 1-Click Auto Auth (Kirim Otomatis)</div>
            <p style="font-size:13px; margin-bottom:10px;">Salin/buka kode bookmark ini saat membuka tab web <b style="color:#38bdf8">pixai.art</b> untuk mengirim token secara otomatis:</p>
            <textarea readonly onclick="this.select()" style="width:100%; height:75px; background:#1e293b; color:#38bdf8; border:1px solid #334155; border-radius:8px; padding:8px; font-size:12px; resize:none;">javascript:(function(){let t=localStorage.getItem('token')||document.cookie;fetch('${req.protocol}://${req.get('host')}/api/save-pixai-token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:t})}).then(r=>r.json()).then(d=>alert(d.message||'Token PixAI Terkirim!')).catch(e=>alert('Gagal: '+e.message))})()</textarea>
        </div>

        <div class="step-box">
            <div class="step-title">📝 Opsi B: Tempel String Token Manual</div>
            <input type="text" id="tokenInput" placeholder="Tempelkan JWT Token (eyJhbG...) di sini">
            <button class="btn-send" onclick="sendToken()">Hubungkan ke Bot Shiroko</button>
            <div id="alertBox" class="alert"></div>
        </div>
    </div>

    <script>
        async function sendToken() {
            const token = document.getElementById('tokenInput').value.trim();
            const alertBox = document.getElementById('alertBox');
            alertBox.style.display = 'none';

            if (!token) {
                alertBox.className = 'alert alert-error';
                alertBox.innerText = '❌ Harap tempelkan string token terlebih dahulu.';
                alertBox.style.display = 'block';
                return;
            }

            try {
                const res = await fetch('/api/save-pixai-token', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token })
                });
                const data = await res.json();

                if (res.ok && data.status === 'ok') {
                    alertBox.className = 'alert alert-success';
                    alertBox.innerText = data.message;
                    document.getElementById('tokenInput').value = '';
                } else {
                    alertBox.className = 'alert alert-error';
                    alertBox.innerText = '❌ Gagal: ' + (data.message || 'Error tidak diketahui');
                }
            } catch (err) {
                alertBox.className = 'alert alert-error';
                alertBox.innerText = '❌ Error koneksi ke server bot: ' + err.message;
            }
            alertBox.style.display = 'block';
        }
    </script>
</body>
</html>`;
    res.send(html);
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
// require('./minecraft.js'); // Dihapus karena sudah pindah ke services/minecraft/