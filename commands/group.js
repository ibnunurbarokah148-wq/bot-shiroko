const groupService = require('../services/group.service');

async function handle(ctx) {
    const { sock, from, senderId, isGroup, isOwner, textClean, textLower, reply, msg } = ctx;
    if (!isGroup) return false;
    const adminOnly = async () => !isOwner && !(await groupService.isAdmin(sock, from, senderId).catch(() => false));

    if (textLower.startsWith('!warn') || textLower.startsWith('!warnings') || textLower.startsWith('!unwarn') || textLower.startsWith('!resetwarn') || textLower.startsWith('!setwarnlimit') || textLower.startsWith('!autokickwarn')) {
        if (await adminOnly()) { await reply('Nn... Perintah ini hanya untuk admin grup.'); return true; }
        const metadata = await groupService.getMetadata(sock, from);
        const target = ctx.mentionedJid?.[0] || metadata.participants.find(participant => [participant.id, participant.jid, participant.lid, participant.phoneNumber].includes(ctx.quotedParticipant))?.id;
        const settings = groupService.getSettings(from);
        if (textLower.startsWith('!setwarnlimit')) {
            const value = Number(textClean.split(/\s+/)[1]);
            if (!Number.isInteger(value) || value < 1 || value > 20) { await reply('Format: !setwarnlimit [1-20]'); return true; }
            groupService.saveSettings(from, { warnLimit: value });
            await reply(`Nn... Batas warning grup diatur menjadi *${value}*.`); return true;
        }
        if (textLower.startsWith('!autokickwarn')) {
            const value = textLower.split(/\s+/)[1];
            if (!['on', 'off'].includes(value)) { await reply(`Status autokick warning: *${settings.autokickWarn ? 'ON' : 'OFF'}*`); return true; }
            groupService.saveSettings(from, { autokickWarn: value === 'on' });
            await reply(`Nn... Autokick warning sekarang *${value.toUpperCase()}*.`); return true;
        }
        if (!target) { await reply('Nn... Mention atau reply pesan user yang dituju.'); return true; }
        if (target === senderId || target === sock.user?.id || (await groupService.isAdmin(sock, from, target).catch(() => false))) { await reply('Nn... Target tidak valid atau merupakan admin grup.'); return true; }
        const current = groupService.getWarning(from, target);
        if (textLower.startsWith('!warnings')) {
            await reply(`@${target.split('@')[0]} memiliki *${current.count}* warning.`, { mentions: [target] }); return true;
        }
        if (textLower.startsWith('!unwarn')) {
            const next = groupService.removeWarning(from, target);
            await reply(`Nn... Satu warning @${target.split('@')[0]} dihapus. Sisa: *${next.count}*`, { mentions: [target] }); return true;
        }
        if (textLower.startsWith('!resetwarn')) {
            groupService.resetWarnings(from, target);
            await reply(`Nn... Semua warning @${target.split('@')[0]} dihapus.`, { mentions: [target] }); return true;
        }
        const reason = textClean.replace(/^!warn\s*/i, '').replace(/^@\S+\s*/, '').trim() || 'Tidak ada alasan';
        const warning = groupService.addWarning(from, target, reason, senderId);
        const limit = settings.warnLimit || 3;
        let action = `Warning *${warning.count}/${limit}* untuk @${target.split('@')[0]}: ${reason}`;
        if (warning.count >= limit && settings.autokickWarn && await groupService.isBotAdmin(sock, from).catch(() => false)) {
            await sock.groupParticipantsUpdate(from, [target], 'remove').catch(() => {});
            action += '\nBatas warning tercapai. User dikeluarkan otomatis.';
            groupService.resetWarnings(from, target);
        }
        await sock.sendMessage(from, { text: action, mentions: [target] }, { quoted: msg }); return true;
    }

    if (textLower.startsWith('!antispam')) {
        if (await adminOnly()) { await reply('Nn... Perintah ini hanya untuk admin grup.'); return true; }
        const args = textClean.split(/\s+/).slice(1);
        const settings = groupService.getSettings(from);
        if (!args.length || args[0] === 'status') { await reply(`Status antispam: *${settings.spamEnabled ? 'ON' : 'OFF'}*\nBatas: *${settings.spamLimit} pesan/${settings.spamWindowSeconds} detik*\nAksi: *${settings.spamAction}*`); return true; }
        if (['on', 'off'].includes(args[0])) groupService.saveSettings(from, { spamEnabled: args[0] === 'on' });
        else if (args[0] === 'limit' && Number.isInteger(Number(args[1])) && Number(args[1]) >= 3 && Number(args[1]) <= 30) groupService.saveSettings(from, { spamLimit: Number(args[1]) });
        else if (args[0] === 'window' && Number.isInteger(Number(args[1])) && Number(args[1]) >= 3 && Number(args[1]) <= 60) groupService.saveSettings(from, { spamWindowSeconds: Number(args[1]) });
        else if (args[0] === 'action' && ['delete', 'warn', 'kick'].includes(args[1])) groupService.saveSettings(from, { spamAction: args[1] });
        else { await reply('Format: !antispam on/off/status, !antispam limit 5, !antispam window 10, !antispam action delete/warn/kick'); return true; }
        await reply('Nn... Konfigurasi antispam grup diperbarui.'); return true;
    }
    if (textLower.startsWith('!antilink whitelist')) {
        if (await adminOnly()) { await reply('Nn... Perintah ini hanya untuk admin grup.'); return true; }
        const args = textClean.split(/\s+/).slice(2);
        const settings = groupService.getSettings(from);
        const whitelist = [...(settings.linkWhitelist || [])];
        if (!args.length || args[0] === 'list') { await reply(whitelist.length ? `Whitelist link:\n${whitelist.map(domain => `- ${domain}`).join('\n')}` : 'Nn... Whitelist link masih kosong.'); return true; }
        const domain = args[1]?.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
        if (!domain || !domain.includes('.')) { await reply('Format: !antilink whitelist add/del domain.com'); return true; }
        if (args[0] === 'add' && !whitelist.includes(domain)) whitelist.push(domain);
        else if (args[0] === 'del') { const index = whitelist.indexOf(domain); if (index >= 0) whitelist.splice(index, 1); }
        else { await reply('Format: !antilink whitelist add/del domain.com'); return true; }
        groupService.saveSettings(from, { linkWhitelist: whitelist }); await reply('Nn... Whitelist link diperbarui.'); return true;
    }
    if (textLower.startsWith('!antilink')) {
        if (await adminOnly()) { await reply('Nn... Perintah ini hanya untuk admin grup.'); return true; }
        const value = textLower.split(/\s+/)[1];
        if (value === 'status' || !value) { await reply(`Status antilink: *${groupService.getSettings(from).antilink ? 'ON' : 'OFF'}*\nWhitelist: *${(groupService.getSettings(from).linkWhitelist || []).length} domain*`); return true; }
        if (!['on', 'off'].includes(value)) { await reply('Format: !antilink on/off/status'); return true; }
        try { await groupService.saveSettings(from, { antilink: value === 'on' }, sock); }
        catch (error) { if (error.message === 'BOT_NOT_ADMIN') { await reply('Nn... Bot harus menjadi admin sebelum antilink diaktifkan.'); return true; } throw error; }
        await reply(`Nn... Antilink grup sekarang *${value.toUpperCase()}*.`);
        return true;
    }
    if (textLower === '!welcome card' || textLower === '!welcome text') {
        if (await adminOnly()) { await reply('Nn... Perintah ini hanya untuk admin grup.'); return true; }
        groupService.saveSettings(from, { welcomeCard: textLower.endsWith('card') });
        await reply(`Nn... Mode welcome sekarang *${textLower.endsWith('card') ? 'CARD' : 'TEXT'}*.`); return true;
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
