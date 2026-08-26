const { dbGroupSettings, dbGroupWarnings } = require('../config/db');
const { areJidsSameUser, jidNormalizedUser } = require('@whiskeysockets/baileys');
const sharp = require('sharp');

const metadataCache = new Map();
const spamCache = new Map();
const LINK_PATTERN = /(?:https?:\/\/|www\.|chat\.whatsapp\.com\/|wa\.me\/)[^\s]+/i;

function getSettings(groupJid) {
    return dbGroupSettings[groupJid] || { antilink: false, linkWhitelist: [], welcome: false, goodbye: false, welcomeCard: false, autokickWarn: false, warnLimit: 3, spamEnabled: false, spamLimit: 5, spamWindowSeconds: 10, spamAction: 'warn', welcomeText: 'Selamat datang @user di grup *@group*.', goodbyeText: '@user telah meninggalkan grup.' };
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
function warningKey(groupJid, userJid) { return `${groupJid}:${userJid}`; }
function getWarning(groupJid, userJid) { return dbGroupWarnings[warningKey(groupJid, userJid)] || { count: 0, entries: [] }; }
function addWarning(groupJid, userJid, reason, adminJid) {
    const current = getWarning(groupJid, userJid);
    const entry = { reason: String(reason || 'Tidak ada alasan').slice(0, 300), adminJid, at: Date.now() };
    const next = { count: current.count + 1, entries: [...(current.entries || []).slice(-9), entry] };
    dbGroupWarnings[warningKey(groupJid, userJid)] = next;
    return next;
}
function removeWarning(groupJid, userJid) {
    const current = getWarning(groupJid, userJid);
    if (current.count <= 1) delete dbGroupWarnings[warningKey(groupJid, userJid)];
    else dbGroupWarnings[warningKey(groupJid, userJid)] = { count: current.count - 1, entries: (current.entries || []).slice(0, -1) };
    return getWarning(groupJid, userJid);
}
function resetWarnings(groupJid, userJid) { delete dbGroupWarnings[warningKey(groupJid, userJid)]; }
function extractDomains(text) {
    return [...String(text || '').matchAll(/(?:https?:\/\/|www\.)?([^\s/]+\.[a-z]{2,})(?:\/[^\s]*)?/gi)].map(match => match[1].toLowerCase().replace(/^www\./, ''));
}
function isWhitelistedLink(text, groupJid) {
    const whitelist = getSettings(groupJid).linkWhitelist || [];
    return extractDomains(text).some(domain => whitelist.some(allowed => domain === allowed || domain.endsWith(`.${allowed}`)));
}
function hasLink(text) { return LINK_PATTERN.test(text || ''); }
function recordSpam(groupJid, userJid, fingerprint, settings) {
    const key = `${groupJid}:${userJid}`;
    const now = Date.now();
    const windowMs = (settings.spamWindowSeconds || 10) * 1000;
    const current = spamCache.get(key) || [];
    const recent = current.filter(entry => now - entry.at <= windowMs);
    recent.push({ at: now, fingerprint });
    spamCache.set(key, recent);
    const sameCount = recent.filter(entry => entry.fingerprint === fingerprint).length;
    return { count: recent.length, sameCount, triggered: recent.length >= (settings.spamLimit || 5) || sameCount >= 3 };
}
function clearSpam(groupJid, userJid) { spamCache.delete(`${groupJid}:${userJid}`); }
function renderTemplate(template, userJid, groupName) { return String(template).replace(/@user/g, `@${userJid.split('@')[0]}`).replace(/@group/g, groupName || 'grup'); }
async function handleParticipants(sock, update) {
    const { id: groupJid, participants = [], action } = update;
    if (!['add', 'remove'].includes(action)) return;
    const settings = getSettings(groupJid);
    if (!(action === 'add' ? settings.welcome : settings.goodbye) || !participants.length) return;
    const metadata = await getMetadata(sock, groupJid).catch(() => ({ subject: 'grup', participants: [] }));
    for (const userJid of participants) {
        const template = action === 'add' ? settings.welcomeText : settings.goodbyeText;
        if (settings.welcomeCard && action === 'add') {
            try {
                const avatarUrl = await sock.profilePictureUrl(userJid, 'image').catch(() => null);
                const avatar = avatarUrl ? Buffer.from((await require('axios').get(avatarUrl, { responseType: 'arraybuffer', timeout: 10000 })).data) : null;
                const background = Buffer.from(`<svg width="900" height="500"><rect width="900" height="500" fill="#0d2238"/><text x="450" y="350" text-anchor="middle" fill="white" font-size="42" font-family="sans-serif">${escapeXml(metadata.subject)}</text><text x="450" y="410" text-anchor="middle" fill="#9bdcff" font-size="28" font-family="sans-serif">Selamat datang @${userJid.split('@')[0]}</text></svg>`);
                let image = sharp(background);
                if (avatar) image = image.composite([{ input: await sharp(avatar).resize(220, 220, { fit: 'cover' }).png().toBuffer(), left: 340, top: 55 }]);
                await sock.sendMessage(groupJid, { image: await image.png().toBuffer(), caption: renderTemplate(template, userJid, metadata.subject), mentions: [userJid] });
                continue;
            } catch (error) { console.warn('[GROUP CARD] fallback text:', error.message); }
        }
        await sock.sendMessage(groupJid, { text: renderTemplate(template, userJid, metadata.subject), mentions: [userJid] });
    }
}
function escapeXml(value) { return String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char])); }
module.exports = { getSettings, saveSettings, getMetadata, isAdmin, isBotAdmin, hasLink, extractDomains, isWhitelistedLink, recordSpam, clearSpam, getWarning, addWarning, removeWarning, resetWarnings, handleParticipants };
