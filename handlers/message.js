// ==========================================
// MESSAGE HANDLER — Routing Pesan ke Command Modules
// ==========================================
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { ID_OWNER } = require('../config/constants');
const { getCoreNumber } = require('../config/db');

// Command modules (urutan penting — AI harus terakhir karena punya catch-all chat)
const alarm = require('../commands/alarm');
const lms = require('../commands/lms');
const tugas = require('../commands/tugas');
const topup = require('../commands/topup');
const panitia = require('../commands/panitia');
const general = require('../commands/general');
const akademik = require('../commands/akademik');
const media = require('../commands/media');
const data = require('../commands/data');
const ai = require('../commands/ai');

function registerMessageHandler(sock) {
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        const msg = messages[0];
        if (!msg || !msg.message) return;
        if (msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const isGroup = from.endsWith('@g.us');
        const senderId = isGroup ? msg.key.participant : from;

        // Identifikasi tipe pesan
        const msgType = Object.keys(msg.message)[0];

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
            isQuoted, quotedMsg, quotedType,
            reply, downloadMediaBaileys
        };

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
