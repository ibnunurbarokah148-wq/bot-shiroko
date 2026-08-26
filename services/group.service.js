const { dbGroupSettings } = require('../config/db');
const { areJidsSameUser, jidNormalizedUser } = require('@whiskeysockets/baileys');

const metadataCache = new Map();
const LINK_PATTERN = /(?:https?:\/\/|www\.|chat\.whatsapp\.com\/|wa\.me\/)[^\s]+/i;

function getSettings(groupJid) {
    return dbGroupSettings[groupJid] || { antilink: false, welcome: false, goodbye: false, welcomeText: 'Selamat datang @user di grup *@group*.', goodbyeText: '@user telah meninggalkan grup.' };
}
async function saveSettings(groupJid, patch, sock) {
    if (sock && patch.antilink === true && !(await isBotAdmin(sock, groupJid).catch(() => false))) throw new Error('BOT_NOT_ADMIN');
    dbGroupSettings[groupJid] = { ...getSettings(groupJid), ...patch };
    return getSettings(groupJid);
}
async function getMetadata(sock, groupJid, forceRefresh = false) {
    const cached = metadataCache.get(groupJid);
    if (!forceRefresh && cached && cached.expires > Date.now()) return cached.data;
    const data = await sock.groupMetadata(groupJid);
    metadataCache.set(groupJid, { data, expires: Date.now() + 60000 });
    return data;
}

function sameJid(left, right) {
    if (!left || !right) return false;
    try { return areJidsSameUser(left, right); } catch { return jidNormalizedUser(left) === jidNormalizedUser(right); }
}

function getBotJids(sock) {
    const candidates = [
        sock.user?.id,
        sock.user?.jid,
        sock.user?.lid,
        sock.authState?.creds?.me?.id,
        sock.authState?.creds?.me?.lid
    ].filter(Boolean);
    return [...new Set(candidates.flatMap(jid => [jid, jid.includes('@') ? jid : `${jid}@s.whatsapp.net`]))];
}

async function isAdmin(sock, groupJid, userJid, forceRefresh = false) {
    const check = async (refresh) => {
        const metadata = await getMetadata(sock, groupJid, refresh);
        const participant = metadata.participants.find(item => [item.id, item.jid, item.lid, item.phoneNumber].some(candidate => sameJid(candidate, userJid)));
        return !!participant?.admin;
    };
    if (await check(forceRefresh)) return true;
    return forceRefresh ? false : check(true);
}
async function isBotAdmin(sock, groupJid) {
    const check = async (forceRefresh) => {
        const metadata = await getMetadata(sock, groupJid, forceRefresh);
        return metadata.participants.some(participant => {
            if (!participant?.admin) return false;
            const participantJids = [participant.id, participant.jid, participant.lid, participant.phoneNumber];
            return getBotJids(sock).some(botJid => participantJids.some(candidate => sameJid(candidate, botJid)));
        });
    };
    if (await check(false)) return true;
    return check(true);
}
function hasLink(text) { return LINK_PATTERN.test(text || ''); }
function renderTemplate(template, userJid, groupName) { return String(template).replace(/@user/g, `@${userJid.split('@')[0]}`).replace(/@group/g, groupName || 'grup'); }
async function handleParticipants(sock, update) {
    const { id: groupJid, participants = [], action } = update;
    if (!['add', 'remove'].includes(action)) return;
    const settings = getSettings(groupJid);
    if (!(action === 'add' ? settings.welcome : settings.goodbye) || !participants.length) return;
    const metadata = await getMetadata(sock, groupJid).catch(() => ({ subject: 'grup' }));
    for (const userJid of participants) {
        const template = action === 'add' ? settings.welcomeText : settings.goodbyeText;
        await sock.sendMessage(groupJid, { text: renderTemplate(template, userJid, metadata.subject), mentions: [userJid] });
    }
}
module.exports = { getSettings, saveSettings, getMetadata, isAdmin, isBotAdmin, hasLink, handleParticipants };
