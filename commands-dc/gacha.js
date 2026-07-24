const { AttachmentBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags } = require('discord.js');
const axios = require('axios');
const cooldownDiscordGacha = new Set();

module.exports = {
    handle: async (message, { pixiv }) => {
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('gacha_sfw').setLabel('SFW 🟢').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('gacha_nsfw').setLabel('NSFW 🔴').setStyle(ButtonStyle.Danger)
        );

        if (cooldownDiscordGacha.has(message.author.id)) return message.reply('Nn... Jangan terburu-buru, Sensei. Tunggu beberapa detik.');
        cooldownDiscordGacha.add(message.author.id);
        setTimeout(() => cooldownDiscordGacha.delete(message.author.id), 7000);

        const promptMsg = await message.reply({ content: 'Nn... Pilih mode target gacha, Sensei:', components: [row] });
        const collectorTombol = promptMsg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 15000 });
        let isProcessingGacha = false;

        collectorTombol.on('collect', async interaction => {
            if (interaction.user.id !== message.author.id) return interaction.reply({ content: 'Nn... Ini bukan sesi gacha milikmu.', flags: MessageFlags.Ephemeral });
            if (isProcessingGacha) return;
            isProcessingGacha = true;

            const isNsfw = interaction.customId === 'gacha_nsfw';
            if (isNsfw && !message.channel.nsfw) {
                isProcessingGacha = false;
                return interaction.reply({ content: 'Nn... Peringatan sistem. Mode NSFW hanya bisa diaktifkan di channel ber-tag NSFW.', flags: MessageFlags.Ephemeral });
            }

            await interaction.update({ content: `Nn... Mengalihkan mesin gacha ke server Pixiv (${isNsfw ? 'NSFW' : 'SFW'}). Tunggu sebentar...`, components: [] }).catch(() => { });

            try {
                const gachaTags = ['オリジナル', '猫耳', 'メイド', '制服', '女の子', 'ゲーム', 'ブルーアーカイブ'];
                const tagPilihan = gachaTags[Math.floor(Math.random() * gachaTags.length)];
                let searchResult = await pixiv.searchIllust(`${tagPilihan} 1000users入り`);

                if (!searchResult || !searchResult.illusts || searchResult.illusts.length === 0) searchResult = await pixiv.searchIllust(tagPilihan);
                let illusts = searchResult?.illusts || [];
                if (illusts.length === 0) return promptMsg.edit(`Nn... Data kosong dari server Pixiv.`).catch(() => { });

                if (isNsfw) illusts = illusts.filter(img => img && (img.x_restrict > 0 || (img.tags && img.tags.some(t => t.name && t.name.toLowerCase().includes('r-18')))));
                else illusts = illusts.filter(img => img && img.x_restrict === 0 && (!img.tags || !img.tags.some(t => t.name && t.name.toLowerCase().includes('r-18'))));

                if (illusts.length === 0) return promptMsg.edit(`Nn... Data kosong setelah filter.`).catch(() => { });
                const randomIllust = illusts[Math.floor(Math.random() * illusts.length)];
                if (!randomIllust) return promptMsg.edit('Nn... Gagal mengundi gambar.').catch(() => { });

                const imageUrl = randomIllust.image_urls?.large || randomIllust.image_urls?.medium;
                const artist = randomIllust.user?.name || 'Unknown Artist';
                const title = randomIllust.title || 'Unknown Character';

                if (!imageUrl) return promptMsg.edit('Nn... Gambar rusak dari server Pixiv.').catch(() => { });

                const imageResponse = await axios.get(imageUrl, {
                    responseType: 'arraybuffer',
                    headers: { 'Referer': 'https://app-api.pixiv.net/', 'User-Agent': 'PixivIOSApp/7.13.3 (iOS 14.6; iPhone13,2)' },
                    timeout: 10000
                });

                const buffer = Buffer.from(imageResponse.data, 'binary');
                const fileName = `gacha_${randomIllust.id}.jpg`;
                const attachment = new AttachmentBuilder(buffer, { name: fileName });

                const gachaEmbed = new EmbedBuilder()
                    .setTitle(title)
                    .setDescription('React with any emoji to claim!')
                    .setColor(isNsfw ? '#ff0000' : '#ff4da6')
                    .setImage(`attachment://${fileName}`)
                    .addFields({ name: 'Artist', value: artist, inline: true }, { name: 'Theme', value: tagPilihan, inline: true }, { name: 'Mode', value: isNsfw ? 'NSFW 🔴' : 'SFW 🟢', inline: true });

                await promptMsg.delete().catch(() => { });
                const sentMessage = await message.channel.send({ embeds: [gachaEmbed], files: [attachment] });
                await sentMessage.react('💖');

                const filter = (reaction, user) => !user.bot;
                const collectorReact = sentMessage.createReactionCollector({ filter, max: 1, time: 60000 });

                collectorReact.on('collect', (reaction, user) => {
                    const claimedEmbed = EmbedBuilder.from(gachaEmbed).setDescription('**Claimed!**').setColor('#ffcc00').setFooter({ text: `Belongs to ${user.username}`, iconURL: user.displayAvatarURL() });
                    sentMessage.edit({ embeds: [claimedEmbed], files: [attachment] }).catch(() => { });
                    message.channel.send(`💖 **${user.username}** and **${title}** are now married! 💖`);
                });

                collectorReact.on('end', collected => {
                    if (collected.size === 0) {
                        const expiredEmbed = EmbedBuilder.from(gachaEmbed).setDescription('*(Expired)* Nobody claimed this waifu in time.').setColor('#808080');
                        sentMessage.edit({ embeds: [expiredEmbed], files: [attachment] }).catch(() => { });
                    }
                });

            } catch (error) { promptMsg.edit({ content: 'Nn... Mesin gacha Pixiv sedang sibuk.', components: [] }).catch(() => { }); }
        });
    }
};
