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
const minecraft = require('../commands/minecraft');
const group = require('../commands/group');
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

        // Buka wrapper pesan WhatsApp agar audio/image dalam ephemeral/view-once tetap terdeteksi.
        function unwrapMessage(message) {
            let current = message;
            while (current) {
                const wrapper = current.ephemeralMessage || current.viewOnceMessage ||
                    current.viewOnceMessageV2 || current.viewOnceMessageV2Extension;
                if (!wrapper?.message) break;
                current = wrapper.message;
            }
            return current || message;
        }

        const normalizedMessage = unwrapMessage(msg.message);
        const unwrapQuotedMessage = (message) => unwrapMessage(message);
        const msgType = Object.keys(normalizedMessage)[0];

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
        if (normalizedMessage.conversation) textClean = normalizedMessage.conversation;
        else if (normalizedMessage.extendedTextMessage) textClean = normalizedMessage.extendedTextMessage.text;
        else if (normalizedMessage.imageMessage) textClean = normalizedMessage.imageMessage.caption || '';
        else if (normalizedMessage.videoMessage) textClean = normalizedMessage.videoMessage.caption || '';
        else if (normalizedMessage.documentMessage) textClean = normalizedMessage.documentMessage.caption || '';
        else if (normalizedMessage.documentWithCaptionMessage) textClean = normalizedMessage.documentWithCaptionMessage.message?.documentMessage?.caption || '';

        textClean = textClean.trim();
        const textLower = textClean.toLowerCase();

        // Identifikasi pesan yang di-reply (quoted)
        const contextInfo = normalizedMessage?.extendedTextMessage?.contextInfo ||
            normalizedMessage?.imageMessage?.contextInfo ||
            normalizedMessage?.videoMessage?.contextInfo ||
            normalizedMessage?.audioMessage?.contextInfo ||
            normalizedMessage?.documentMessage?.contextInfo ||
            normalizedMessage?.documentWithCaptionMessage?.message?.documentMessage?.contextInfo || null;
        const isQuoted = !!contextInfo?.quotedMessage;
        const quotedMsg = contextInfo?.quotedMessage ? unwrapQuotedMessage(contextInfo.quotedMessage) : null;
        const quotedType = quotedMsg ? Object.keys(quotedMsg)[0] : null;

        let quotedText = '';
        if (quotedMsg) {
            if (quotedMsg.conversation) quotedText = quotedMsg.conversation;
            else if (quotedMsg.extendedTextMessage) quotedText = quotedMsg.extendedTextMessage.text || '';
            else if (quotedMsg.imageMessage) quotedText = quotedMsg.imageMessage.caption || '';
            else if (quotedMsg.videoMessage) quotedText = quotedMsg.videoMessage.caption || '';
            else if (quotedMsg.documentMessage) quotedText = quotedMsg.documentMessage.caption || '';
            else if (quotedMsg.documentWithCaptionMessage) quotedText = quotedMsg.documentWithCaptionMessage.message?.documentMessage?.caption || '';
        }
        const quotedTextLower = quotedText.toLowerCase();
        const mentionedJid = contextInfo?.mentionedJid || [];

        // Cek status Owner
        const coreSender = getCoreNumber(senderId);
        const isOwner = ID_OWNER.some(owner => getCoreNumber(owner) === coreSender);

        // Helper function: download media dari Baileys
        async function downloadMediaBaileys(messageObj, type) {
            const mediaMessage = messageObj?.message || messageObj;
            const payload = mediaMessage?.[`${type}Message`] ? mediaMessage : { [`${type}Message`]: mediaMessage };
            const isQuotedMedia = messageObj === quotedMsg ||
                (quotedMsg && messageObj?.[`${type}Message`] === quotedMsg?.[`${type}Message`]);
            const sourceMessage = isQuotedMedia ? {
                ...msg,
                key: {
                    ...msg.key,
                    remoteJid: contextInfo?.remoteJid || msg.key.remoteJid,
                    participant: contextInfo?.participant || msg.key.participant,
                    id: contextInfo?.stanzaId || msg.key.id
                },
                message: payload
            } : { ...msg, message: payload };
            return downloadMediaMessage(sourceMessage, 'buffer', {});
        }

        // Helper function: reply ke pesan
        const reply = async (teks) => {
            await sock.sendMessage(from, { text: teks }, { quoted: msg });
        };

        // Objek konteks yang dikirim ke semua handler
        const ctx = {
            sock, msg, normalizedMessage, from, senderId, isOwner, isGroup,
            text: textClean, textClean, textLower, msgType,
            isQuoted, quotedMsg, quotedType, quotedText, quotedTextLower,
            quotedStanzaId: contextInfo?.stanzaId || null,
             mentionedJid, reply, downloadMediaBaileys
        };

        // AFK: auto-back saat chat biasa dan notifikasi mention/reply.
        if (isGroup) {
            const afkService = require('../services/afk.service');
            if (!textClean.startsWith('!')) {
                const ownAfk = afkService.get(from, senderId);
                if (ownAfk) {
                    afkService.clear(from, senderId);
                    await sock.sendMessage(from, {
                        text: `Selamat datang kembali @${senderId.split('@')[0]}!\nStatus AFK kamu sudah dinonaktifkan otomatis setelah mengirim pesan.`,
                        mentions: [senderId]
                    }, { quoted: msg });
                }
            }
            const targets = new Set(mentionedJid);
            if (contextInfo?.participant) targets.add(contextInfo.participant);
            for (const target of targets) {
                const afk = afkService.get(from, target);
                if (afk && afkService.canNotify(`${from}:${senderId}:${target}`)) {
                    await sock.sendMessage(from, { text: `Nn... @${target.split('@')[0]} sedang AFK: *${afk.reason}* (${afkService.formatDuration(afk.since)}).`, mentions: [target] }, { quoted: msg });
                }
            }
        }

        // Moderasi antilink: admin dan owner dikecualikan.
        if (isGroup && textClean && !textClean.startsWith('!')) {
            const groupService = require('../services/group.service');
            const settings = groupService.getSettings(from);
            if (settings.antilink && groupService.hasLink(textClean) && !isOwner && !(await groupService.isAdmin(sock, from, senderId).catch(() => false))) {
                if (await groupService.isBotAdmin(sock, from).catch(() => false)) {
                    await sock.sendMessage(from, { delete: msg.key });
                    await reply('Nn... Link tidak diizinkan di grup ini.');
                    return;
                }
            }
        }

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

        // INCREMENT STATS
        const { incrementStat } = require('../config/database');
        incrementStat('totalChat');
        if (textClean.startsWith('!')) {
            incrementStat('commands');
        }

        // Emit status ke Web Dashboard (via Socket.IO) jika aktif
        if (global.io) {
            global.io.emit('bot_status', { isTyping: true, user: msg.pushName || 'Seseorang' });
        }

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
            if (await group.handle(ctx)) return;
            if (await general.handle(ctx)) return;
            if (await akademik.handle(ctx)) return;
            if (await media.handle(ctx)) return;
            if (await data.handle(ctx)) return;
            if (await minecraft.handle(ctx)) return;
            if (await ai.handle(ctx)) return;  // HARUS TERAKHIR — punya catch-all chat
        } catch (error) {
            console.error('🚨 ERROR HANDLER PESAN:', error);
            try { await reply('Nn... Terjadi gangguan saat memproses pesan. Silakan kirim ulang beberapa saat lagi.'); } catch (replyError) {
                console.error('Gagal mengirim fallback error:', replyError.message);
            }
        } finally {
            // Matikan status ngetik setelah selesai memproses (kasih delay sedikit biar natural)
            if (global.io) {
                setTimeout(() => {
                    global.io.emit('bot_status', { isTyping: false });
                }, 1000);
            }
        }
    });
}

module.exports = { registerMessageHandler };
