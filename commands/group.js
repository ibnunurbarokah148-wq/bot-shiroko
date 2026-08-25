const groupService = require('../services/group.service');

async function handle(ctx) {
    const { sock, from, senderId, isGroup, isOwner, textClean, textLower, reply, msg } = ctx;
    if (!isGroup) return false;
    const adminOnly = async () => !isOwner && !(await groupService.isAdmin(sock, from, senderId).catch(() => false));

    if (textLower.startsWith('!antilink')) {
        if (await adminOnly()) { await reply('Nn... Perintah ini hanya untuk admin grup.'); return true; }
        const value = textLower.split(/\s+/)[1];
        if (!['on', 'off'].includes(value)) { await reply(`Status antilink: *${groupService.getSettings(from).antilink ? 'ON' : 'OFF'}*\nFormat: !antilink on/off`); return true; }
        try { await groupService.saveSettings(from, { antilink: value === 'on' }, sock); }
        catch (error) { if (error.message === 'BOT_NOT_ADMIN') { await reply('Nn... Bot harus menjadi admin sebelum antilink diaktifkan.'); return true; } throw error; }
        await reply(`Nn... Antilink grup sekarang *${value.toUpperCase()}*.`);
        return true;
    }
    if (textLower.startsWith('!welcome') || textLower.startsWith('!goodbye') || textLower.startsWith('!setwelcome') || textLower.startsWith('!setgoodbye')) {
        if (await adminOnly()) { await reply('Nn... Perintah ini hanya untuk admin grup.'); return true; }
        const isWelcome = textLower.startsWith('!welcome') || textLower.startsWith('!setwelcome');
        const type = isWelcome ? 'welcome' : 'goodbye';
        const isSet = textLower.startsWith('!setwelcome') || textLower.startsWith('!setgoodbye');
        const parts = textClean.split(/\s+/);
        const arg = parts[1]?.toLowerCase();
        if (!isSet && (arg === 'on' || arg === 'off')) groupService.saveSettings(from, { [type]: arg === 'on' });
        else if (isSet && parts.length > 1) groupService.saveSettings(from, { [isWelcome ? 'welcomeText' : 'goodbyeText']: parts.slice(1).join(' ') });
        else { await reply(isSet ? `Format: *${isWelcome ? '!setwelcome' : '!setgoodbye'} teks @user @group*` : `Status ${type}: *${groupService.getSettings(from)[type] ? 'ON' : 'OFF'}*`); return true; }
        await reply(`Nn... Konfigurasi ${type} grup diperbarui.`);
        return true;
    }
    if (textLower === '!infogc' || textLower === '!listadmin') {
        const metadata = await groupService.getMetadata(sock, from);
        const admins = metadata.participants.filter(p => p.admin).map(p => `@${p.id.split('@')[0]}`);
        if (textLower === '!listadmin') { await sock.sendMessage(from, { text: `*DAFTAR ADMIN*\n\n${admins.join('\n')}`, mentions: metadata.participants.filter(p => p.admin).map(p => p.id) }, { quoted: msg }); return true; }
        await reply(`*INFO GRUP*\n\nNama: *${metadata.subject}*\nAnggota: *${metadata.participants.length}*\nAdmin: *${admins.length}*`);
        return true;
    }
    if (textLower.startsWith('!tagall') || textLower.startsWith('!hidetag')) {
        if (await adminOnly()) { await reply('Nn... Perintah ini hanya untuk admin grup.'); return true; }
        const metadata = await groupService.getMetadata(sock, from);
        const mentions = metadata.participants.map(p => p.id);
        const isHideTag = textLower.startsWith('!hidetag');
        const body = textClean.split(/\s+/).slice(1).join(' ') || 'Panggilan seluruh anggota grup.';
        const messageText = isHideTag ? body : `${body}\n\n${mentions.map(jid => `@${jid.split('@')[0]}`).join(' ')}`;
        await sock.sendMessage(from, { text: messageText, mentions }, { quoted: msg });
        return true;
    }
    if (textLower === '!closegc' || textLower === '!opengc') {
        if (await adminOnly()) { await reply('Nn... Perintah ini hanya untuk admin grup.'); return true; }
        if (!(await groupService.isBotAdmin(sock, from).catch(() => false))) { await reply('Nn... Bot harus menjadi admin grup.'); return true; }
        await sock.groupSettingUpdate(from, textLower === '!closegc' ? 'announcement' : 'not_announcement');
        await reply(`Nn... Grup berhasil ${textLower === '!closegc' ? 'ditutup untuk anggota' : 'dibuka untuk semua anggota'}.`);
        return true;
    }
    return false;
}
module.exports = { handle };
