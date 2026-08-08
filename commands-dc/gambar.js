const { AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags } = require('discord.js');
const { antrianGambar, prosesAntrianGambar, isComfyUIActive } = require('../services/comfyui.service');
const { tambahAntrianPixAI, antrianPixAI } = require('../services/pixai.service');
const axios = require('axios');

module.exports = {
    handle: async (message) => {
        const promptMentah = message.content.substring(message.content.indexOf(' ') + 1).trim();
        if (!promptMentah) return message.reply('Nn... Masukkan deskripsi gambarnya.');

        const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('img_pixai').setLabel('PixAI.art ✨').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('img_comfyui_sfw').setLabel('ComfyUI 🟢').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('img_comfyui').setLabel('ComfyUI 🔞').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('img_sdxl').setLabel('Arisu SDXL').setStyle(ButtonStyle.Secondary)
        );

        const row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('img_agnes').setLabel('Agnes 2.0').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('img_agnes_2_1').setLabel('Agnes 2.1').setStyle(ButtonStyle.Secondary)
        );

        const promptMsg = await message.reply({ 
            content: `Nn... Pilih mesin render untuk: **${promptMentah}**\n*(Catatan: Mode Discord 100% gratis tanpa potong limit)*`, 
            components: [row1, row2] 
        });

        const collector = promptMsg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 30000 });
        let isProcessing = false;

        collector.on('collect', async interaction => {
            if (interaction.user.id !== message.author.id) return interaction.reply({ content: 'Nn... Ini bukan pesananmu.', flags: MessageFlags.Ephemeral });
            if (isProcessing) return;
            isProcessing = true;

            await interaction.update({ content: 'Nn... Memproses pilihanmu...', components: [] }).catch(() => { });

            if (interaction.customId === 'img_pixai') {
                const pos = tambahAntrianPixAI({
                    prompt: promptMentah,
                    isDiscord: true,
                    reply: async (text) => message.reply(text),
                    sendImage: async (imgBuffer, caption) => {
                        const attachment = new AttachmentBuilder(imgBuffer, { name: 'hasil_pixai.png' });
                        await message.reply({ content: caption, files: [attachment] });
                    }
                });

                message.reply(`Nn... Pesanan PixAI.art diterima! Posisi antreanmu saat ini: **${pos}**.\nMohon bersabar ya, Sensei. 🐺✨`);

            } else if (interaction.customId === 'img_comfyui' || interaction.customId === 'img_comfyui_sfw') {
                if (!isComfyUIActive()) {
                    await message.reply('❌ Nn... Mohon maaf, mesin Render GPU ComfyUI sedang *DIMATIKAN*. (Jam Operasional otomatis: 07:00 - 23:00 WIB). Silakan pilih opsi rendering lain seperti PixAI atau ArisuSoft.');
                    return;
                }

                let finalPrompt = promptMentah;
                if (interaction.customId === 'img_comfyui_sfw') {
                    finalPrompt += ", safe, fully clothed, no nsfw";
                }
                
                // Push ke shared antrianGambar
                antrianGambar.push({
                    promptMentah: finalPrompt,
                    isDiscord: true,
                    reply: async (text) => message.reply(text),
                    sendImage: async (imgBuffer, caption) => {
                        const attachment = new AttachmentBuilder(imgBuffer, { name: 'hasil_comfy.jpg' });
                        await message.reply({ content: caption, files: [attachment] });
                    }
                });
                
                message.reply(`Nn... Pesanan ComfyUI diterima. Posisi antreanmu saat ini: **${antrianGambar.length}**.\nMohon bersabar, ya. 🐺☕`);
                prosesAntrianGambar();
            } else {
                // Proses ArisuSoft secara langsung
                let endpoint = 'agnes-2.0';
                let namaModel = 'Agnes 2.0';
                if (interaction.customId === 'img_sdxl') { endpoint = 'sdxl-turbo'; namaModel = 'SDXL Turbo'; }
                else if (interaction.customId === 'img_agnes_2_1') { endpoint = 'agnes-2.1'; namaModel = 'Agnes 2.1'; }
                
                try {
                    await message.reply(`Nn... Mengalihkan ke server ArisuSoft (${namaModel}). Mohon tunggu...`);
                    const arisuKey = process.env.ARISU_API_KEY;
                    const response = await axios.post(`https://api.arisusoft.com/api/v2/image/${endpoint}`, {
                        prompt: promptMentah
                    }, {
                        headers: { "Authorization": `Bearer ${arisuKey}`, "Content-Type": "application/json" }
                    });

                    const data = response.data;
                    let imageUrl = data.url || (data.data && data.data.url) || data.image || data.imageUrl || (data.data && typeof data.data === 'string' && data.data.startsWith('http') ? data.data : null); 
                    let base64 = data.base64 || (data.data && data.base64) || (data.data && typeof data.data === 'string' && !data.data.startsWith('http') ? data.data : null);

                    let buffer;
                    if (imageUrl) {
                        const imgRes = await axios.get(imageUrl, { responseType: 'arraybuffer' });
                        buffer = Buffer.from(imgRes.data, 'binary');
                    } else if (base64) {
                        buffer = Buffer.from(base64, 'base64');
                    } else {
                        throw new Error("Format JSON Arisu tidak dikenali.");
                    }

                    const attachment = new AttachmentBuilder(buffer, { name: 'hasil_arisu.jpg' });
                    await message.reply({
                        content: `🎨 **Ide:** ${promptMentah}\n☁️ **Mesin:** ArisuSoft (${namaModel})\n\nNn... Render dari satelit selesai! 🐺✨`,
                        files: [attachment]
                    });
                } catch (error) {
                    console.error("🚨 ERROR ARISUSOFT DISCORD:", error.message);
                    await message.reply(`Nn... Gagal membuat gambar via ArisuSoft.\n*Laporan:* ${error.message}`);
                }
            }
        });

        collector.on('end', collected => {
            if (collected.size === 0) promptMsg.edit({ content: 'Nn... Waktu memilih habis. Dibatalkan.', components: [] }).catch(() => { });
        });
    }
};
