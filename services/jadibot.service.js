const { default: makeWASocket, useMultiFileAuthState, Browsers, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const { getSocket } = require('../utils/socket');
const { dbJadibot, getCoreNumber } = require('../config/db');

const jadibotSockets = new Map();

function toWhatsAppJid(identifier) {
    const value = String(identifier || '').trim();
    return value.includes('@') ? value : `${value}@s.whatsapp.net`;
}

async function startJadibot(sessionName, phoneNumber, replyFn) {
    const { registerMessageHandler } = require('../handlers/message');
    if (jadibotSockets.has(sessionName)) {
        if (replyFn) await replyFn('Nn... Bot-mu sudah aktif, Sensei.');
        return;
    }

    const sessionDir = path.join(__dirname, `../session_${sessionName}`);
    if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
        markOnlineOnConnect: true
    });

    jadibotSockets.set(sessionName, sock);
    registerMessageHandler(sock, true);

    sock.ev.on('creds.update', saveCreds);

    if (!sock.authState.creds.registered) {
        if (phoneNumber) {
            setTimeout(async () => {
                try {
                    const formattedNumber = phoneNumber.replace(/[^0-9]/g, '');
                    const code = await sock.requestPairingCode(formattedNumber);
                    if (replyFn) {
                        await replyFn(`🔗 *KODE PAIRING JADIBOT*\n\nNn... Ini kodemu: *${code}*\n\nBuka WhatsApp > Perangkat Tertaut > Tautkan Perangkat > Masukkan kode di atas.`);
                    }
                } catch (err) {
                    console.error('Jadibot Pairing Error:', err);
                    if (replyFn) await replyFn('Nn... Gagal meminta kode pairing. Pastikan nomor benar.');
                    await sock.end(undefined);
                    jadibotSockets.delete(sessionName);
                }
            }, 3000);
        } else {
            sock.end(undefined);
            jadibotSockets.delete(sessionName);
        }
    } else {
        if (replyFn) await replyFn('Nn... Sesi ditemukan. Mencoba terhubung...');
    }

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            jadibotSockets.delete(sessionName);
            
            if (shouldReconnect) {
                setTimeout(() => startJadibot(sessionName), 5000);
            } else {
                if (fs.existsSync(sessionDir)) {
                    fs.rmSync(sessionDir, { recursive: true, force: true });
                }
                const mainSock = getSocket();
                if (mainSock) {
                    mainSock.sendMessage(toWhatsAppJid(sessionName), { text: 'Nn... Sesi Jadibot-mu telah berakhir atau dilogout.' }).catch(()=>{});
                }
            }
        } else if (connection === 'open') {
            console.log(`Jadibot ${sessionName} connected!`);
            const mainSock = getSocket();
            if (mainSock) {
                mainSock.sendMessage(toWhatsAppJid(sessionName), { text: 'Nn... Jadibot berhasil terhubung dan siap digunakan! ✨' }).catch(()=>{});
            }
        }
    });
}

function stopJadibot(sessionName) {
    if (jadibotSockets.has(sessionName)) {
        const sock = jadibotSockets.get(sessionName);
        sock.logout();
        jadibotSockets.delete(sessionName);
        return true;
    }
    return false;
}

function resumeAllJadibots() {
    for (const targetNomor in dbJadibot) {
        const dbEntry = dbJadibot[targetNomor];
        const isPremium = dbEntry && (typeof dbEntry === 'boolean' || dbEntry > Date.now());
        
        if (isPremium) {
            const sessionDir = path.join(__dirname, `../session_${getCoreNumber(targetNomor)}`);
            if (fs.existsSync(sessionDir)) {
                console.log(`Resuming Jadibot for ${targetNomor}...`);
                startJadibot(getCoreNumber(targetNomor));
            }
        } else if (dbEntry) {
            console.log(`Jadibot expired for ${targetNomor}. Not resuming.`);
        }
    }
}

module.exports = {
    startJadibot,
    stopJadibot,
    resumeAllJadibots
};
