// ==========================================
// MESSAGE HANDLER — Routing Pesan ke Command Modules
// ==========================================
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { ID_OWNER } = require('../config/constants');
const { getCoreNumber } = require('../config/db');
const { cacheMessage, saveDeletedMessage, getLastDeletedMessage } = require('../config/cache');

// Command modules (urutan penting — AI harus terakhir karena punya catch-all chat)
const alarm = require('../commands/alarm');
const lms = require('../commands/lms');
const tugas = require('../commands/tugas');
const topup = require('../commands/topup');
const premium = require('../commands/premium');
const jadibot = require('../commands/jadibot');
const panitia = require('../commands/panitia');
const general = require('../commands/general');
const akademik = require('../commands/akademik');
const media = require('../commands/media');
const data = require('../commands/data');
const ai = require('../commands/ai');

function registerMessageHandler(sock, isJadibot = false) {
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        const msg = messages[0];
        if (!msg || !msg.message) return;
        if (msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const isGroup = from.endsWith('@g.us');

        // Sub-bot (Jadibot) khusus untuk penggunaan Personal (PM/Japri), abaikan chat grup
        if (isJadibot && isGroup) return;
        const senderId = isGroup ? msg.key.participant : from;

        // Identifikasi tipe pesan
        const msgType = Object.keys(msg.message)[0];

        // LOGIKA CACHE & GHOST MODE (REVOKE)
        if (msgType === 'protocolMessage') {
            const protoMsg = msg.message.protocolMessage;
            if (protoMsg.type === 14 || protoMsg.type === 'REVOKE') {
                saveDeletedMessage(from, protoMsg.key.id);
            }
        } else {
            cacheMessage(from, msg);
        }

        // Ekstrak teks dari berbagai tipe pesan
        let textClean = '';
        if (msg.message.conversation) textClean = msg.message.conversation;
        else if (msg.message.extendedTextMessage) textClean = msg.message.extendedTextMessage.text;
        else if (msg.message.imageMessage) textClean = msg.message.imageMessage.caption || '';
        else if (msg.message.videoMessage) textClean = msg.message.videoMessage.caption || '';
        else if (msg.message.documentWithCaptionMessage) textClean = msg.message.documentWithCaptionMessage.message?.documentMessage?.caption || '';

        textClean = textClean.trim();
        const textLower = textClean.toLowerCase();

        // Identifikasi pesan yang di-reply (quoted)
        const contextInfo = msg.message?.extendedTextMessage?.contextInfo ||
            msg.message?.imageMessage?.contextInfo ||
            msg.message?.videoMessage?.contextInfo ||
            msg.message?.documentMessage?.contextInfo || null;
        const isQuoted = !!contextInfo?.quotedMessage;
        const quotedMsg = contextInfo?.quotedMessage || null;
        const quotedType = quotedMsg ? Object.keys(quotedMsg)[0] : null;

        let quotedText = '';
        if (quotedMsg) {
            if (quotedMsg.conversation) quotedText = quotedMsg.conversation;
            else if (quotedMsg.extendedTextMessage) quotedText = quotedMsg.extendedTextMessage.text || '';
            else if (quotedMsg.imageMessage) quotedText = quotedMsg.imageMessage.caption || '';
            else if (quotedMsg.videoMessage) quotedText = quotedMsg.videoMessage.caption || '';
        }
        const quotedTextLower = quotedText.toLowerCase();

        // Cek status Owner
        const coreSender = getCoreNumber(senderId);
        const isOwner = ID_OWNER.some(owner => getCoreNumber(owner) === coreSender);

        // Helper function: download media dari Baileys
        async function downloadMediaBaileys(messageObj, type) {
            const stream = await downloadMediaMessage(
                { message: { [`${type}Message`]: messageObj } },
                'buffer',
                {}
            );
            return stream;
        }

        // Helper function: reply ke pesan
        const reply = async (teks) => {
            await sock.sendMessage(from, { text: teks }, { quoted: msg });
        };

        // Objek konteks yang dikirim ke semua handler
        const ctx = {
            sock, msg, from, senderId, isOwner, isGroup,
            textClean, textLower, msgType,
            isQuoted, quotedMsg, quotedType, quotedText, quotedTextLower,
            reply, downloadMediaBaileys
        };

        // ==========================================
        // HANDLER KHUSUS GHOST MODE (!kepo)
        // ==========================================
        if (textLower === '!kepo' || textLower === '!snipe') {
            const { dbPremium } = require('../config/db');
            const dbEntry = dbPremium[senderId];
            const isPremium = dbEntry && (typeof dbEntry === 'boolean' || dbEntry > Date.now());
            
            if (!isPremium && !isOwner) {
                await reply('❌ Nn... Fitur *!kepo* (Ghost Mode) dikunci secara eksklusif untuk pengguna VIP Premium.\n\nKetik *!premium* untuk berlangganan.');
                return;
            }

            const deletedMsg = getLastDeletedMessage(from);
            if (!deletedMsg) {
                await reply('Nn... Tidak ada jejak pesan yang dihapus baru-baru ini di markas ini.');
                return;
            }

            await reply('Nn... Data berhasil diendus. Pesan yang dihapus sedang dikirim ke Japri (DM) Sensei secara rahasia... 🤫');
            
            try {
                const textOriginal = deletedMsg.message.conversation || deletedMsg.message.extendedTextMessage?.text;
                if (textOriginal) {
                    await sock.sendMessage(senderId, { text: `👻 *SISTEM GHOST MODE (!kepo)*\n\n*Sumber:* ${isGroup ? 'Grup' : 'Japri'}\n*Pengirim:* ${deletedMsg.key.participant || deletedMsg.key.remoteJid}\n\n*Pesan Asli:*\n${textOriginal}` });
                } else {
                    await sock.sendMessage(senderId, { text: `👻 *SISTEM GHOST MODE (!kepo)*\n\n*Sumber:* ${isGroup ? 'Grup' : 'Japri'}\n*Pengirim:* ${deletedMsg.key.participant || deletedMsg.key.remoteJid}\n\nNn... Berikut adalah media yang dihapusnya:` });
                    await sock.sendMessage(senderId, { forward: deletedMsg });
                }
            } catch (err) {
                console.error('ERROR KEPO:', err);
                await sock.sendMessage(senderId, { text: 'Nn... Gagal meneruskan pesan yang dihapus (mungkin file aslinya sudah tidak tersedia di server WhatsApp).' });
            }
            return;
        }

        // Skip jika tidak ada teks dan bukan media yang bisa diproses
        if (!textClean && msgType !== 'imageMessage' && msgType !== 'audioMessage' &&
            msgType !== 'stickerMessage' && msgType !== 'documentMessage' &&
            msgType !== 'documentWithCaptionMessage') return;

        try {
            // Routing ke command modules — urutan sesuai arsitektur asli
            // Session handlers dicek di dalam masing-masing module
            if (await alarm.handle(ctx)) return;
            if (await lms.handle(ctx)) return;
            if (await tugas.handle(ctx)) return;
            if (await jadibot.handle(ctx)) return;
            if (await premium.handle(ctx)) return;
            if (await topup.handle(ctx)) return;
            if (await panitia.handle(ctx)) return;
            if (await general.handle(ctx)) return;
            if (await akademik.handle(ctx)) return;
            if (await media.handle(ctx)) return;
            if (await data.handle(ctx)) return;
            if (await ai.handle(ctx)) return;  // HARUS TERAKHIR — punya catch-all chat
        } catch (error) {
            console.error('🚨 ERROR HANDLER PESAN:', error);
        }
    });
}

module.exports = { registerMessageHandler };
