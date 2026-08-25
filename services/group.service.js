const { dbGroupSettings } = require('../config/db');

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
async function getMetadata(sock, groupJid) {
    const cached = metadataCache.get(groupJid);
    if (cached && cached.expires > Date.now()) return cached.data;
    const data = await sock.groupMetadata(groupJid);
    metadataCache.set(groupJid, { data, expires: Date.now() + 60000 });
    return data;
}
async function isAdmin(sock, groupJid, userJid) {
    const metadata = await getMetadata(sock, groupJid);
    const participant = metadata.participants.find(item => item.id === userJid);
    return !!participant?.admin;
}
async function isBotAdmin(sock, groupJid) {
    const botJid = sock.user?.id?.split(':')[0] + '@s.whatsapp.net';
    return isAdmin(sock, groupJid, botJid);
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
