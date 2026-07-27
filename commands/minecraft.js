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

    if (cmd === 'server') {
        await reply('Nn... Memeriksa panel hosting dan status in-game...');

        const pteroUrl = process.env.PTERODACTYL_URL;
        const pteroId = process.env.PTERODACTYL_SERVER_ID;
        const pteroKey = process.env.PTERODACTYL_API_KEY;
        const mcHost = process.env.MC_HOST;
        const mcPort = process.env.MC_PORT;

        let panelInfo = '';
        let gameInfo = '';
        const axios = require('axios');

        try {
            // 1. Get RAM & CPU dari Pterodactyl
            if (pteroUrl && pteroId && pteroKey) {
                try {
                    const url = `${pteroUrl}/api/client/servers/${pteroId}/resources`;
                    const res = await axios.get(url, {
                        headers: {
                            'Authorization': `Bearer ${pteroKey}`,
                            'Accept': 'application/json'
                        },
                        timeout: 5000
                    });

                    const data = res.data.attributes;
                    const state = data.current_state; 
                    const ramMB = (data.resources.memory_bytes / 1024 / 1024).toFixed(2);
                    const cpu = data.resources.cpu_absolute.toFixed(2);

                    const statusEmoji = state === 'running' ? '🟢' : state === 'offline' ? '🔴' : '🟡';
                    panelInfo = `🖥️ *PANEL HOSTING (Zknesia)*\n` +
                                `Status: ${statusEmoji} ${state.toUpperCase()}\n` +
                                `RAM: 🧠 ${ramMB} MB\n` +
                                `CPU: ⚙️ ${cpu} %\n\n`;
                } catch (e) {
                    panelInfo = `🖥️ *PANEL HOSTING*\n(Gagal menghubungi panel Zknesia. Cek API Key!)\n\n`;
                }
            } else {
                panelInfo = `🖥️ *PANEL HOSTING*\n(API Key belum dikonfigurasi di .env)\n\n`;
            }

            // 2. Get Player List dari mcsrvstat.us
            try {
                const mcRes = await axios.get(`https://api.mcsrvstat.us/3/${mcHost}:${mcPort}`, { timeout: 5000 });
                const mcData = mcRes.data;

                if (mcData.online) {
                    const players = mcData.players;
                    const playerNames = players.list ? players.list.map(p => p.name).join(', ') : '-';
                    
                    gameInfo = `🎮 *IN-GAME STATUS*\n` +
                               `Pemain: 👥 ${players.online} / ${players.max}\n` +
                               `Daftar: ${playerNames}\n` +
                               `Versi: 🏷️ ${mcData.version}`;
                } else {
                    gameInfo = `🎮 *IN-GAME STATUS*\nServer sedang offline atau belum selesai booting.`;
                }
            } catch (e) {
                gameInfo = `🎮 *IN-GAME STATUS*\nGagal ping ke server Minecraft.`;
            }

            await reply(`📡 *MONITORING SERVER* 📡\n\n${panelInfo}${gameInfo}`);
        } catch (err) {
            await reply(`Nn... Terjadi kesalahan sistem saat memantau server.`);
        }
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
    await reply('Nn... Perintah Minecraft tidak dikenali.\n\nGunakan:\n- *!mc start* (Nyalakan bot)\n- *!mc stop* (Matikan bot)\n- *!mc status* (Cek status bot)\n- *!mc server* (Monitor RAM & Player)\n- *!mc chat <teks>* (Kirim chat ke game)');
    return true;
}

module.exports = { handle };
