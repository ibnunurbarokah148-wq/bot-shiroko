const { AttachmentBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags } = require('discord.js');
const axios = require('axios');
const cooldownDiscordWaifu = new Set();

module.exports = {
    handle: async (message, { pixiv }) => {
        if (cooldownDiscordWaifu.has(message.author.id)) return message.reply('Nn... Mesin pencari sedang mendinginkan diri. Tunggu 7 detik.');
        const query = message.content.substring(6).trim();
        if (!query) return message.reply('Nn... Siapa target yang ingin dicari?');

        cooldownDiscordWaifu.add(message.author.id);
        setTimeout(() => cooldownDiscordWaifu.delete(message.author.id), 7000);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('waifu_sfw').setLabel('SFW').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('waifu_nsfw').setLabel('NSFW').setStyle(ButtonStyle.Danger)
        );

        const promptMsg = await message.reply({ content: `Nn... Target pencarian: **${query}**. Pilih mode:`, components: [row] });
        const collectorTombol = promptMsg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 15000 });
        let isProcessingWaifu = false;

        collectorTombol.on('collect', async interaction => {
            if (interaction.user.id !== message.author.id) return interaction.reply({ content: 'Nn... Ini bukan sesimu.', flags: MessageFlags.Ephemeral });
            if (isProcessingWaifu) return;
            isProcessingWaifu = true;

            const isNsfw = interaction.customId === 'waifu_nsfw';
            if (isNsfw && !message.channel.nsfw) {
                isProcessingWaifu = false;
                return interaction.reply({ content: 'Nn... Peringatan sistem. Mode NSFW butuh channel ber-tag NSFW.', flags: MessageFlags.Ephemeral });
            }

            await interaction.update({ content: `Nn... Mengamankan data **${query}**...`, components: [] }).catch(() => { });

            try {
                let queryDewa = query + (query.toLowerCase().includes('users') ? '' : ' 1000users入り');
                let searchResult = await pixiv.searchIllust(queryDewa);
                let illusts = searchResult?.illusts || [];
                if (illusts.length === 0) {
                    searchResult = await pixiv.searchIllust(query);
                    illusts = searchResult?.illusts || [];
                }

                if (isNsfw) illusts = illusts.filter(img => img && (img.x_restrict > 0 || (img.tags && img.tags.some(t => t.name && t.name.toLowerCase().includes('r-18')))));
                else illusts = illusts.filter(img => img && img.x_restrict === 0 && (!img.tags || !img.tags.some(t => t.name && t.name.toLowerCase().includes('r-18'))));

                if (!illusts || illusts.length === 0) return promptMsg.edit(`Nn... Data kosong.`).catch(() => { });

                illusts = illusts.sort(() => Math.random() - 0.5);
                let currentIndex = 0;

                const buildWaifuMessage = async () => {
                    const targetIllust = illusts[currentIndex];
                    const imageUrl = targetIllust?.image_urls?.large || targetIllust?.image_urls?.medium;
                    const artist = targetIllust?.user?.name || 'Unknown Artist';
                    const title = targetIllust?.title || 'Unknown Character';

                    const imageResponse = await axios.get(imageUrl, {
                        responseType: 'arraybuffer',
                        headers: { 'Referer': 'https://app-api.pixiv.net/', 'User-Agent': 'PixivIOSApp/7.13.3 (iOS 14.6; iPhone13,2)' }
                    });

                    const buffer = Buffer.from(imageResponse.data, 'binary');
                    const fileName = `waifu_${targetIllust.id}.jpg`;
                    const attachment = new AttachmentBuilder(buffer, { name: fileName });

                    const waifuEmbed = new EmbedBuilder().setTitle(title).setColor(isNsfw ? '#ff0000' : '#00ffff').setImage(`attachment://${fileName}`).addFields(
                        { name: 'Target', value: query, inline: true }, { name: 'Artist', value: artist, inline: true }, { name: 'Mode', value: isNsfw ? 'NSFW 🔴' : 'SFW 🟢', inline: true }, { name: 'Halaman', value: `${currentIndex + 1} / ${illusts.length}`, inline: true }
                    );

                    const nextRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('waifu_next').setLabel('Next ⏭️').setStyle(ButtonStyle.Primary).setDisabled(illusts.length <= 1));
                    return { embeds: [waifuEmbed], files: [attachment], components: [nextRow] };
                };

                const payload = await buildWaifuMessage();
                await promptMsg.delete().catch(() => { });
                const sentMessage = await message.channel.send(payload);

                const collectorNext = sentMessage.createMessageComponentCollector({ componentType: ComponentType.Button, time: 60000 });
                collectorNext.on('collect', async btnInteraction => {
                    if (btnInteraction.user.id !== message.author.id) return btnInteraction.reply({ content: 'Nn... Cari targetmu sendiri.', flags: MessageFlags.Ephemeral });
                    await btnInteraction.deferUpdate().catch(() => { });
                    try {
                        currentIndex++;
                        if (currentIndex >= illusts.length) { illusts = illusts.sort(() => Math.random() - 0.5); currentIndex = 0; }
                        const nextPayload = await buildWaifuMessage();
                        await sentMessage.edit(nextPayload).catch(() => { });
                        collectorNext.resetTimer();
                    } catch (err) { }
                });

                collectorNext.on('end', () => sentMessage.edit({ components: [] }).catch(() => { }));

            } catch (error) { promptMsg.edit({ content: 'Nn... Gagal menembus pertahanan Pixiv.', components: [] }).catch(() => { }); }
        });

        collectorTombol.on('end', collected => { if (collected.size === 0) promptMsg.edit({ content: 'Nn... Waktu memilih habis. Operasi dibatalkan.', components: [] }).catch(() => { }); });
    }
};
