// ==========================================
// BOT SHIROKO — Entry Point
// Minimal bootstrap: Baileys + Express + Cron
// ==========================================
require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, makeCacheableSignalKeyStore, Browsers } = require('@whiskeysockets/baileys');
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

    const sock = makeWASocket({
        auth: {
            creds: authState.creds,
            keys: makeCacheableSignalKeyStore(authState.keys, pino({ level: 'silent' }))
        },
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: Browsers.ubuntu('Chrome')
    });

    // Simpan ke global untuk akses dari services (ComfyUI, cron, express, dll)
    global.waSocket = sock;

    // Simpan kredensial otomatis
    sock.ev.on('creds.update', saveCreds);

    // ==========================================
    // PAIRING CODE (Tanpa QR) — hanya saat belum terdaftar
    // ==========================================
    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
            const nomorTelepon = await new Promise(resolve => rl.question('Masukkan nomor telepon (contoh: 6281234567890): ', resolve));
            rl.close();

            try {
                const formattedNumber = nomorTelepon.replace(/[^0-9]/g, '');
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
    for (let id in dbLimit) {
        dbLimit[id] = JATAH_HARIAN;
    }
    simpanDB();
    console.log('🔄 [CRON] Semua limit user telah di-reset.');
}, { timezone: "Asia/Jakarta" });

// ==========================================
// CRON JOB: Alarm Salat (5 waktu)
// Dijalankan SEKALI di luar startBot()
// Menggunakan global.waSocket agar selalu merujuk koneksi terbaru
// ==========================================
const jadwalSalat = [
    { jam: '0 4 * * *', nama: 'Subuh', waktu: '04:00' },
    { jam: '5 12 * * *', nama: 'Zuhur', waktu: '12:05' },
    { jam: '20 15 * * *', nama: 'Ashar', waktu: '15:20' },
    { jam: '15 18 * * *', nama: 'Maghrib', waktu: '18:15' },
    { jam: '30 19 * * *', nama: 'Isya', waktu: '19:30' },
];

const idOwnerJid = ID_OWNER[0] + '@s.whatsapp.net';

jadwalSalat.forEach(({ jam, nama, waktu }) => {
    cron.schedule(jam, async () => {
        if (!state.alarmSalatAktif) return;
        const sock = global.waSocket; // Selalu ambil koneksi terbaru
        if (!sock) return;

        if (nama === 'Subuh') {
            if (state.alarmSubuhState.timer) clearInterval(state.alarmSubuhState.timer);
            state.alarmSubuhState.aktif = true;
            state.alarmSubuhState.count = 1;

            try {
                await sock.sendMessage(idOwnerJid, { text: `🔔 *ALARM SUBUH (Panggilan 1/3)* 🔔\n\nNn... Bangun, Sensei.\n_(Balas *iya* jika sudah bangun)_` });
            } catch (e) { }

            state.alarmSubuhState.timer = setInterval(async () => {
                const s = global.waSocket; // Ambil koneksi terbaru di setiap interval
                if (!s) return;
                state.alarmSubuhState.count++;
                try {
                    if (state.alarmSubuhState.count === 2) await s.sendMessage(idOwnerJid, { text: `⏰ *ALARM SUBUH (Panggilan 2/3)* ⏰\n\nNn... Sensei? Ayo bangun... 😟` });
                    else if (state.alarmSubuhState.count === 3) await s.sendMessage(idOwnerJid, { text: `🚨 *ALARM SUBUH (Panggilan 3/3 - FINAL)* 🚨\n\nSENSEI!!! Shiroko siram air nih! 😡💢` });
                    else if (state.alarmSubuhState.count > 3) {
                        await s.sendMessage(idOwnerJid, { text: `💤 *Sistem Pengingat Subuh Dihentikan* 💤\n\nNn... Shiroko matikan alarmnya ya... 😔🤍` });
                        clearInterval(state.alarmSubuhState.timer);
                        state.alarmSubuhState.aktif = false;
                        state.alarmSubuhState.count = 0;
                        state.alarmSubuhState.timer = null;
                    }
                } catch (e) { }
            }, 5 * 60 * 1000);
        } else {
            try {
                await sock.sendMessage(idOwnerJid, {
                    text: `🔔 *Notifikasi Taktis* 🔔\n\nNn... Sensei. Ini sudah masuk waktu ibadah *${nama}* (${waktu}). Segera ambil wudhu.\n\nBalas dengan:\n*Laksanakan*\n*Abaikan*`
                });
                state.sesiSalat[getCoreNumber(idOwnerJid)] = { step: 1, salat: nama };
            } catch (e) { }
        }
    }, { timezone: "Asia/Jakarta" });
});

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
    const { pesan } = req.body;
    if (!pesan) return res.status(400).json({ status: 'error', message: 'Field "pesan" wajib diisi.' });

    try {
        const sock = global.waSocket; // Selalu ambil koneksi terbaru
        if (!sock) return res.status(503).json({ status: 'error', message: 'Bot WhatsApp belum terhubung.' });
        await sock.sendMessage(idOwnerJid, { text: `🚨 *LAPORAN MASUK DARI SERVER* 🚨\n\n${pesan}` });
        res.json({ status: 'ok', message: 'Laporan terkirim ke WhatsApp Owner.' });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

app.listen(3000, () => {
    console.log('🌐 Express server berjalan di port 3000');
});

// ==========================================
// MULAI BOT WHATSAPP
// ==========================================
startBot();

// ==========================================
// MULAI BOT DISCORD (SHARED MEMORY)
// ==========================================
require('./bot-dc.js');