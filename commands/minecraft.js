// ==========================================
// COMMAND: MINECRAFT BOT CONTROL
// Handler: !mc start, !mc stop, !mc status, !mc chat
// Khusus Owner
// ==========================================
const { startMcBot, stopMcBot, getMinecraftStatus, getMinecraftBot } = require('../minecraft');

async function handle(ctx) {
    const { sock, from, senderId, isOwner, textClean, textLower, reply } = ctx;

    if (!textLower.startsWith('!mc')) return false;

    // HANYA OWNER YANG BISA MENGAKSES COMMAND INI
    if (!isOwner) {
        await reply('Nn... Akses ditolak. Command ini hanya untuk Owner.');
        return true;
    }

    const args = textClean.split(' ');
    const cmd = args[1] ? args[1].toLowerCase() : '';

    if (cmd === 'start') {
        const success = startMcBot();
        if (success) {
            await reply('🎮 *MINECRAFT BOT* 🎮\n\nNn... Bot Minecraft mulai dihidupkan dan mencoba terhubung ke server.');
        } else {
            await reply('Nn... Bot Minecraft sudah dalam keadaan menyala.');
        }
        return true;
    }

    if (cmd === 'stop') {
        const success = stopMcBot();
        if (success) {
            await reply('🛑 *MINECRAFT BOT* 🛑\n\nNn... Bot Minecraft berhasil dimatikan secara paksa. Bot tidak akan auto-reconnect.');
        } else {
            await reply('Nn... Bot Minecraft sudah dalam keadaan mati.');
        }
        return true;
    }

    if (cmd === 'status') {
        const status = getMinecraftStatus();
        if (!status.online) {
            await reply('📡 *STATUS MINECRAFT* 📡\n\nNn... Bot sedang offline atau mati.');
            return true;
        }

        const teks = `📡 *STATUS MINECRAFT* 📡\n\n` +
            `*Username:* ${status.username}\n` +
            `*Health:* ❤️ ${status.health}/20\n` +
            `*Food:* 🍖 ${status.food}/20\n` +
            `*Lokasi:* X: ${status.position.x}, Y: ${status.position.y}, Z: ${status.position.z}\n\n` +
            `*Inventory:*\n${status.inventory}`;
            
        await reply(teks);
        return true;
    }

    if (cmd === 'chat') {
        const pesan = args.slice(2).join(' ');
        if (!pesan) {
            await reply('Nn... Masukkan pesan yang ingin dikirim ke chat in-game.\nContoh: *!mc chat halo semuanya*');
            return true;
        }

        const bot = getMinecraftBot();
        if (!bot) {
            await reply('Nn... Bot Minecraft sedang mati. Tidak bisa kirim pesan.');
            return true;
        }

        try {
            bot.chat(pesan);
            await reply(`💬 *PESAN TERKIRIM*\n\n"${pesan}"`);
        } catch (e) {
            await reply('Nn... Gagal mengirim pesan. Mungkin bot belum masuk sempurna.');
        }
        return true;
    }

    // Jika !mc tapi command tidak dikenali
    await reply('Nn... Perintah Minecraft tidak dikenali.\n\nGunakan:\n- *!mc start* (Nyalakan bot)\n- *!mc stop* (Matikan bot)\n- *!mc status* (Cek status bot)\n- *!mc chat <teks>* (Kirim chat ke game)');
    return true;
}

module.exports = { handle };
