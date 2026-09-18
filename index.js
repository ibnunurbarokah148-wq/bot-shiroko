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
const { initDatabase, migrateFromJSON, flushPendingSave } = require('./config/database');
const { startAutoCleanup } = require('./utils/cleanup');
const { initPrayerScheduler } = require('./services/prayer.service');

// Services (auto-init saat di-require: Pixiv login, AI memory cleanup)
require('./services/pixiv.service');
const { createCallAIBridge } = require('./services/call-ai-bridge.service');
const { recordActivity, getRecentActivity, getActivitySeries } = require('./services/activity.service');
const { isDiscordReady, getDiscordLatency } = require('./services/discord-status');
const { getMinecraftStatus } = require('./services/minecraft');
const { getServerStatus, startServerStatusMonitor } = require('./services/minecraft-server-status');

startServerStatusMonitor();

let activeSocket = null;
let startInProgress = false;
let reconnectTimer = null;
let whatsappConnectionStatus = 'OFFLINE';
let whatsappHeartbeatAt = 0;

function emitServiceStatus() {
    if (global.io) global.io.emit('service_status', { generatedAt: new Date().toISOString() });
}

// ==========================================
// ERROR BOUNDARY GLOBAL (FIX #13)
// ==========================================
process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err) => {
    console.error('🚨 Uncaught Exception:', err);
    // Exception tak tertangani dapat meninggalkan socket/database dalam state
    // tidak konsisten. Supervisor seperti PM2 akan menyalakan ulang process.
    gracefulShutdown('uncaughtException').catch(() => process.exit(1));
});

// ==========================================
// KONEKSI BAILEYS (HANYA KONEKSI WA)
// ==========================================
async function startBot() {
    if (startInProgress || activeSocket) return;
    startInProgress = true;
    try {
        const { state: authState, saveCreds } = await useMultiFileAuthState('./auth_session');

        // Fetch latest WA Web version untuk mencegah error 405 (Method Not Allowed).
        // Jangan biarkan request versi menahan startup WhatsApp tanpa batas.
        const fallbackVersion = [2, 3000, 1043857760];
        let version = fallbackVersion;
        let isLatest = false;
        try {
            const versionResult = await Promise.race([
                fetchLatestBaileysVersion(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('timeout 10 detik')), 10000))
            ]);
            version = versionResult.version;
            isLatest = versionResult.isLatest;
        } catch (error) {
            console.warn(`[WA] Gagal mengambil versi terbaru (${error.message}), menggunakan fallback v${fallbackVersion.join('.')}.`);
        }
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
        activeSocket = sock;
        whatsappConnectionStatus = 'CONNECTING';
        whatsappHeartbeatAt = Date.now();
        recordActivity({ platform: 'whatsapp', type: 'connection', message: 'WhatsApp Bot mencoba terhubung.' });
        emitServiceStatus();

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
            if (activeSocket !== sock) return;
            activeSocket = null;
            whatsappConnectionStatus = 'OFFLINE';
            whatsappHeartbeatAt = Date.now();
            recordActivity({ platform: 'whatsapp', type: 'connection', message: 'Koneksi WhatsApp terputus.' });
            emitServiceStatus();
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            console.log(`🔌 Koneksi terputus (kode: ${statusCode || 'unknown'}). Reconnect: ${shouldReconnect}`);
            if (shouldReconnect) {
                // Delay reconnect 3 detik untuk menghindari loop terlalu cepat
                if (!reconnectTimer) {
                    reconnectTimer = setTimeout(() => {
                        reconnectTimer = null;
                        startBot().catch(error => console.error('[WA] Gagal reconnect:', error));
                    }, 3000);
                }
            } else {
                console.log('Sesi telah logout. Hapus folder auth_session dan jalankan ulang.');
            }
        } else if (connection === 'open') {
            whatsappConnectionStatus = 'ONLINE';
            whatsappHeartbeatAt = Date.now();
            recordActivity({ platform: 'whatsapp', type: 'connection', message: 'WhatsApp Bot berhasil terhubung.' });
            emitServiceStatus();
            console.log('✅ Bot Shiroko terhubung ke WhatsApp!');
        }
    });

    // ==========================================
    // GROUP PARTICIPANT EVENTS (WELCOME / GOODBYE)
    // ==========================================
    sock.ev.on('group-participants.update', update => {
        require('./services/group.service').handleParticipants(sock, update).catch(error => console.error('[GROUP EVENT] Gagal diproses:', error.message));
    });

    // ==========================================
    // REGISTER MESSAGE HANDLER
    // ==========================================
    registerMessageHandler(sock);
    } finally {
        startInProgress = false;
    }
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
            if (amount < 300) dbLimit[id] = 300;
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
// Jangan biarkan satu request besar menghabiskan memory process gabungan.
app.use(express.json({ limit: process.env.API_JSON_LIMIT || '256kb' }));

const crypto = require('crypto');
function isValidApiKey(providedKey) {
    const secret = process.env.WEB_SECRET_KEY;
    if (!secret || !providedKey) return false;
    const secretBuf = Buffer.from(String(secret));
    const providedBuf = Buffer.from(String(providedKey));
    if (secretBuf.length !== providedBuf.length) return false;
    return crypto.timingSafeEqual(secretBuf, providedBuf);
}

function requireApiKey(req, res) {
    if (!isValidApiKey(req.headers['x-api-key'])) {
        res.status(401).json({ status: 'error', message: 'Unauthorized.' });
        return false;
    }
    return true;
}

app.get('/', (req, res) => {
    res.send('🐺 Bot Shiroko aktif.');
});

app.post('/laporan-masuk', async (req, res) => {
    // 🛡️ Keamanan: Hanya terima request jika API Key cocok
    const apiKey = req.headers['x-api-key'];
    if (!isValidApiKey(apiKey)) {
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
    // Dashboard berisi metadata internal; CORS bukan pengganti autentikasi.
    if (!requireApiKey(req, res)) return;
    const requestStartedAt = Date.now();
    const dashboardOrigin = (process.env.WEB_SHIROKO_URL || 'https://shiroko-project.com').split(',')[0].trim();
    res.setHeader('Access-Control-Allow-Origin', dashboardOrigin);
    res.setHeader('Vary', 'Origin');
    
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
    
    const minecraftStatus = getMinecraftStatus();
    const minecraftServer = getServerStatus();
    const discordOnline = isDiscordReady();
    const whatsappOnline = whatsappConnectionStatus === 'ONLINE' && Boolean(activeSocket);
    const services = [
        { id: 'whatsapp', name: 'WhatsApp Bot', status: whatsappOnline ? 'ONLINE' : whatsappConnectionStatus, icon: 'fab fa-whatsapp', latency: whatsappOnline ? Date.now() - whatsappHeartbeatAt : null, heartbeatAt: whatsappHeartbeatAt || null },
        { id: 'discord', name: 'Discord Bot', status: discordOnline ? 'ONLINE' : 'OFFLINE', icon: 'fab fa-discord', latency: getDiscordLatency() },
        { id: 'minecraft-bot', name: 'Minecraft Bot', status: minecraftStatus.status || 'OFFLINE', icon: 'fas fa-robot', latency: minecraftStatus.online && minecraftStatus.heartbeatAt ? Date.now() - minecraftStatus.heartbeatAt : null, heartbeatAt: minecraftStatus.heartbeatAt || null },
        {
            id: 'minecraft-server',
            name: 'Server Minecraft',
            status: minecraftServer.status || 'UNKNOWN',
            icon: 'fas fa-cube',
            latency: minecraftServer.latencyMs ?? null,
            heartbeatAt: minecraftServer.checkedAt || null,
            detail: minecraftServer.online && minecraftServer.players !== null
                ? `${minecraftServer.players}/${minecraftServer.maxPlayers} pemain`
                : null,
            host: minecraftServer.host,
            port: minecraftServer.port,
            players: minecraftServer.players,
            maxPlayers: minecraftServer.maxPlayers,
            version: minecraftServer.version
        },
        { name: 'Google Gemini', status: process.env.GEMINI_API_KEY ? 'ONLINE' : 'OFFLINE', icon: 'fas fa-brain' },
        { name: 'OpenRouter AI', status: process.env.OPENROUTER_API_KEY ? 'ONLINE' : 'OFFLINE', icon: 'fas fa-network-wired' },
        { name: 'Cloudflare AI', status: process.env.CLOUDFLARE_API_TOKEN ? 'ONLINE' : 'OFFLINE', icon: 'fas fa-cloud' },
        { name: 'ArisuSoft AI', status: process.env.ARISU_API_KEY ? 'ONLINE' : 'OFFLINE', icon: 'fas fa-robot' },
        { name: 'PixAI Engine', status: process.env.PIXAI_TOKEN ? 'ONLINE' : 'OFFLINE', icon: 'fas fa-palette' },
        { name: 'Local AI (Ollama)', status: ollamaStatus || 'STANDBY', icon: 'fas fa-server' }
    ];

    const generatedAt = new Date().toISOString();
    res.json({
        stats,
        services,
        activity: getRecentActivity(6),
        activitySeries: getActivitySeries(),
        dataSource: 'live',
        generatedAt,
        updatedAt: generatedAt,
        health: {
            latency: Date.now() - requestStartedAt,
            heartbeat: true,
            whatsapp: whatsappOnline,
            discord: discordOnline,
            minecraftBot: minecraftStatus.online,
            minecraftServer: minecraftServer.online
        }
    });
});

// Endpoint untuk Control Panel (Dipanggil oleh Web Dashboard)
app.post('/api/control', (req, res) => {
    const apiKey = req.headers['x-api-key'];
    if (!isValidApiKey(apiKey)) {
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
// PIXAI WEB AUTH HELPER (HARDENED)
// ==========================================
const pixaiWebAuth = require('./services/pixai-web-auth.service');

const PIXAI_ALLOWED_ORIGINS = (process.env.PIXAI_ALLOWED_ORIGINS || 'https://pixai.art,https://www.pixai.art')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

function applyPixaiCors(req, res) {
    const origin = req.headers.origin;
    if (origin && PIXAI_ALLOWED_ORIGINS.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function clientKeyOf(req) {
    // X-Forwarded-For hanya dipercaya bila aplikasi memang dikonfigurasi di
    // belakang proxy tepercaya. Default-nya gunakan alamat socket langsung.
    if (process.env.TRUST_PROXY === 'true') {
        return String(req.headers['x-forwarded-for'] || req.ip || 'unknown').split(',')[0].trim();
    }
    return String(req.socket?.remoteAddress || req.ip || 'unknown');
}

app.options('/api/save-pixai-token', (req, res) => {
    applyPixaiCors(req, res);
    res.status(204).end();
});

app.post('/api/save-pixai-token', async (req, res) => {
    applyPixaiCors(req, res);

    const { token, nonce } = req.body || {};
    if (!token || typeof token !== 'string' || !token.trim()) {
        return res.status(400).json({ status: 'error', message: 'Token tidak boleh kosong.' });
    }
    if (!nonce || typeof nonce !== 'string') {
        return res.status(400).json({ status: 'error', message: 'Kode keamanan (Nonce) tidak ditemukan. Harap generate ulang Bookmarklet.' });
    }

    const verdict = pixaiWebAuth.consumeNonce(nonce, clientKeyOf(req));
    if (!verdict.ok) {
        const message = verdict.reason === 'RATE_LIMITED'
            ? 'Terlalu banyak percobaan gagal. Coba lagi beberapa menit lagi.'
            : 'Sesi kode kedaluwarsa atau sudah terpakai. Harap generate ulang Bookmarklet di Web Shiroko.';
        return res.status(verdict.reason === 'RATE_LIMITED' ? 429 : 403).json({ status: 'error', message });
    }

    try {
        const pixaiAuth = require('./pixai-auth');
        const cleanToken = token.trim();

        const payload = pixaiAuth.decodeJwt(cleanToken);
        if (!payload || !(payload.sub || payload.user_id)) {
            return res.status(400).json({ status: 'error', message: 'Token bukan JWT PixAI yang valid.' });
        }
        if (payload.exp && payload.exp * 1000 <= Date.now()) {
            return res.status(400).json({ status: 'error', message: 'Token sudah kedaluwarsa.' });
        }

        const verified = await pixaiAuth.verifyTokenWithPixai(cleanToken);
        if (!verified) {
            return res.status(400).json({ status: 'error', message: 'Token ditolak oleh API PixAI atau tidak aktif.' });
        }
        pixaiAuth.addTokenToEnv(cleanToken);

        const diffDays = payload.exp
            ? ((new Date(payload.exp * 1000) - new Date()) / (1000 * 60 * 60 * 24)).toFixed(1)
            : 'N/A';

        // Kirim notifikasi ke pemilik OTP (bukan broadcast ke owner saja)
        try {
            const sock = getSocket();
            const targetOwner = Array.isArray(ID_OWNER) ? ID_OWNER[0] : ID_OWNER;
            const targetJid = verdict.session.ownerJid || (targetOwner ? `${targetOwner}@s.whatsapp.net` : null);
            if (sock && targetJid) {
                await sock.sendMessage(targetJid, {
                    text: `🎉 *[ TOKEN PIXAI BARU TERHUBUNG ]*\n\nNn... Token PixAI dari Web Auth Helper berhasil terhubung!\n\n📌 *User ID:* \`${payload.sub || payload.user_id}\`\n⏳ *Masa Aktif:* *${diffDays} Hari Tersisa* 🟢\n✅ *Status:* PIXAI_TOKEN pool di server bot berhasil diperbarui!`
                });
            }
        } catch (eWa) { }

        recordActivity({ platform: 'system', type: 'pixai', message: 'Token PixAI baru berhasil didaftarkan melalui Web Auth.' });

        res.json({
            status: 'ok',
            message: `Token PixAI berhasil terhubung ke server bot Shiroko. Sisa masa aktif: ${diffDays} hari.`,
            diffDays
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: 'Gagal menyimpan token.' });
    }
});

app.options('/api/generate-bookmarklet', (req, res) => {
    applyPixaiCors(req, res);
    res.status(204).end();
});

app.post('/api/generate-bookmarklet', (req, res) => {
    applyPixaiCors(req, res);

    const { otp } = req.body || {};
    if (!otp || typeof otp !== 'string') {
        return res.status(400).json({ status: 'error', message: 'Kode OTP tidak boleh kosong.' });
    }

    const verdict = pixaiWebAuth.consumeOtp(otp, clientKeyOf(req));
    if (!verdict.ok) {
        if (verdict.reason === 'RATE_LIMITED') {
            return res.status(429).json({ status: 'error', message: 'Terlalu banyak percobaan OTP. Coba lagi beberapa menit lagi.' });
        }
        return res.status(403).json({ status: 'error', message: 'Kode OTP tidak valid atau sudah kedaluwarsa (maksimal 5 menit).' });
    }

    const nonce = pixaiWebAuth.createNonce(verdict.session);

    const botUrl = process.env.WEB_SHIROKO_URL || 'https://shiroko-project.com';
    
    function toHex(str) { return str.split('').map(c => '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''); }
    const errPrompt = toHex('Koneksi otomatis gagal. Salin Kode ini lalu paste di Opsi B Web Auth:');
    const errAlert = toHex('Token tidak ditemukan. Pastikan Anda sudah login di pixai.art');

    const bookmarkletPayload = `javascript:(function(){let _t=null;const _r=new RegExp(atob('ZXlKW2EtekEtWjAtOV8tXStcLlthLXpBLVowLTlfLV0rXC5bYS16QS1aMC05Xy1dKw=='),'g');try{for(let _v of Object['${toHex('values')}'](window['${toHex('localStorage')}'])){if(typeof _v==='string'){let _m=_v['${toHex('match')}'](_r);if(_m){for(let _k of _m){try{let b=_k['${toHex('split')}']('.')[1]['${toHex('replace')}'](/-/g,'+')['${toHex('replace')}'](/_/g,'/');while(b.length%4)b+='=';let p=JSON['${toHex('parse')}'](atob(b));if(p.sub||p.user_id){_t=_k;break;}}catch(e){}}if(_t)break;}}}}catch(err){}if(!_t){let _m=document['${toHex('cookie')}']['${toHex('match')}'](/token=([^;]+)/);if(_m){let _cm=_m[1]['${toHex('match')}'](_r);if(_cm)_t=_cm[0];}}if(!_t){let _l=window['${toHex('localStorage')}']['${toHex('getItem')}']('token');if(_l){let _lm=_l['${toHex('match')}'](_r);if(_lm)_t=_lm[0];}}if(_t){window['${toHex('fetch')}']('${botUrl}/api/save-pixai-token',{method:'${toHex('POST')}',headers:{'${toHex('Content-Type')}':'${toHex('application/json')}'},body:JSON['${toHex('stringify')}']({token:_t,nonce:'${nonce}'})})['${toHex('then')}'](r=>r['${toHex('json')}']())['${toHex('then')}'](d=>{window['${toHex('alert')}'](d.message);})['${toHex('catch')}'](e=>{window['${toHex('prompt')}']('${errPrompt}',_t+'|${nonce}');});}else{window['${toHex('alert')}']('${errAlert}');}})()`;

    res.json({ status: 'ok', payload: bookmarkletPayload });
});

const http = require('http');
const server = http.createServer(app);
const { Server } = require('socket.io');
const dashboardOrigins = (process.env.WEB_SHIROKO_URL || 'https://shiroko-project.com')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
const io = new Server(server, {
    cors: { origin: dashboardOrigins }
});
global.io = io; // Jadikan global agar bisa diakses handler
createCallAIBridge();

io.on('connection', (socket) => {
    console.log('[WEBSOCKET] Client Web Dashboard terhubung:', socket.id);
    socket.on('disconnect', () => {
        console.log('[WEBSOCKET] Client Web terputus:', socket.id);
    });
});

server.listen(3000, () => {
    console.log('🌐 Express & Socket.IO server berjalan di port 3000');
});

let shuttingDown = false;
async function gracefulShutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[SHUTDOWN] Menerima ${signal}, menyimpan database dan menutup koneksi...`);
    try { flushPendingSave(); } catch (error) { console.error('[SHUTDOWN] Gagal menyimpan database:', error.message); }
    try { if (activeSocket) activeSocket.end(undefined); } catch (_) { }
    try { if (global.discordClient?.destroy) global.discordClient.destroy(); } catch (_) { }
    await new Promise(resolve => server.close(() => resolve()));
    process.exit(0);
}
process.once('SIGINT', () => { gracefulShutdown('SIGINT'); });
process.once('SIGTERM', () => { gracefulShutdown('SIGTERM'); });

// ==========================================
// MULAI BOT: INIT DATABASE → WHATSAPP → JADIBOT
// ==========================================
initDatabase().then(async () => {
    console.log('[STARTUP] Database SQLite berhasil diinisialisasi.');

    // Koneksi WhatsApp diprioritaskan; pekerjaan pemeliharaan dijalankan paralel
    // agar migrasi/cleanup tidak menahan proses pairing atau reconnect WA.
    setImmediate(() => {
        try {
            migrateFromJSON();
            startAutoCleanup();
        } catch (error) {
            console.error('[STARTUP] Gagal menjalankan migrasi/cleanup:', error);
        }
    });

    await startBot();
}).then(() => {
    if (jadibotService.resumeAllJadibots) jadibotService.resumeAllJadibots();
}).catch((error) => {
    console.error('[STARTUP] Gagal memulai WhatsApp/database:', error);
    // Jangan biarkan process terlihat sehat ketika bootstrap gagal.
    setTimeout(() => process.exit(1), 100);
});

// ==========================================
// MULAI BOT DISCORD & MINECRAFT (SHARED MEMORY)
// ==========================================
require('./bot-dc.js');
