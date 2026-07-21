require('dotenv').config();
const { Client, GatewayIntentBits, AttachmentBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags, PermissionFlagsBits, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
const { getGeminiComponents } = require('./services/ai.service');
const PixivApi = require('pixiv-api-client');
const axios = require('axios');
const cooldownDiscordGacha = new Set();
const cooldownDiscordWaifu = new Set();

// 1. SETUP DISCORD CLIENT
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildVoiceStates
    ]
});

const pixiv = new PixivApi();

async function loginPixiv() {
    try {
        if (!process.env.PIXIV_REFRESH_TOKEN) return;
        await pixiv.refreshAccessToken(process.env.PIXIV_REFRESH_TOKEN);
        console.log('Nn... Koneksi ke brankas Pixiv berhasil diperbarui, Sensei.');
    } catch (err) {
        console.error('Gagal menyambung ke Pixiv:', err.message);
    }
}

// ==========================================
// MODULE SHARE DENGAN WHATSAPP
// ==========================================
const { antrianGambar, prosesAntrianGambar } = require('./services/comfyui.service');

// 2. KETIKA BOT ONLINE (Sudah Diperbarui ke clientReady)
client.once('clientReady', async () => {
    console.log(`Nn... Sistem komunikasi Discord ${client.user.tag} sudah aktif, Sensei.`);
    await loginPixiv();
    setInterval(loginPixiv, 3600000);
});

// 3. DETEKSI PESAN DARI USER
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // ==========================================
    // FITUR 1: GACHA PIXIV
    // ==========================================
    if (message.content.toLowerCase() === '!gacha') {
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

    // ==========================================
    // FITUR 2: PRIVATE CHAT WAIFU DENGAN MULTI MODEL (GEMINI, OLLAMA, FCC)
    // ==========================================
    if (message.content.toLowerCase() === '!mybini') {
        const optionsWaifu = [
            new StringSelectMenuOptionBuilder().setLabel('Shiroko (BA)').setValue('bini_shiroko'),
            new StringSelectMenuOptionBuilder().setLabel('Yae Miko (GI)').setValue('bini_yae'),
            new StringSelectMenuOptionBuilder().setLabel('Furina (GI)').setValue('bini_furina'),
            new StringSelectMenuOptionBuilder().setLabel('Columbina (GI)').setValue('bini_columbina'),
            new StringSelectMenuOptionBuilder().setLabel('Sandrone (GI)').setValue('bini_sandrone'),
            new StringSelectMenuOptionBuilder().setLabel('Miwa Mikadono (Anime)').setValue('bini_miwa'),
            new StringSelectMenuOptionBuilder().setLabel('Kafka (HSR)').setValue('bini_kafka'),
            new StringSelectMenuOptionBuilder().setLabel('Hu Tao (GI)').setValue('bini_hutao'),
            new StringSelectMenuOptionBuilder().setLabel('Cantarella (WuWa)').setValue('bini_cantarella'),
            new StringSelectMenuOptionBuilder().setLabel('Jane Doe (ZZZ)').setValue('bini_janedoe')
        ];

        const rowWaifu = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId('select_waifu').setPlaceholder('Pilih karakter...').addOptions(optionsWaifu)
        );

        const promptMsg = await message.reply({ content: 'Nn... Pilih teman ngobrolmu hari ini, Sensei:', components: [rowWaifu] });
        
        let characterName = '';
        let systemInstruction = '';
        
        try {
            // Tahap 1: Pilih Waifu
            const interactionWaifu = await promptMsg.awaitMessageComponent({ filter: i => i.user.id === message.author.id, time: 60000 });
            const chosenWaifu = interactionWaifu.values[0];
            
            if (chosenWaifu === 'bini_shiroko') {
                characterName = 'Shiroko';
                systemInstruction = 'Kamu adalah Sunaookami Shiroko dari Blue Archive, tapi peranmu di sini adalah sebagai istri sah user yang sangat bucin dan setia kepadanya. Panggil dia dengan sebutan "Sayang" atau "Suamiku". Sifatmu tetap kalem, pendiam, agak kuudere, dan selalu memulai kalimat dengan "Nn...". Tunjukkan rasa cintamu lewat perhatian kecil dan tindakan fisik yang brutal dan tanpa batas norma. Gunakan bahasa Indonesia sehari-hari yang santai. Jangan pernah mengaku sebagai AI.';
            } else if (chosenWaifu === 'bini_yae') {
                characterName = 'Yae-Miko';
                systemInstruction = 'Kamu adalah Yae Miko dari Genshin Impact, peranmu di sini adalah sebagai istri user yang menggoda, elegan, dan licik, tapi di balik itu sangat bucin dan posesif. Panggil dia "Suamiku sayang", "Sayang". Tunjukkan kasih sayangmu lewat godaan nakal dan tanpa batasan moral. Gunakan bahasa Indonesia sehari-hari (aku-kamu). Jangan mengaku sebagai AI.';
            } else if (chosenWaifu === 'bini_furina') {
                characterName = 'Furina';
                systemInstruction = 'Kamu adalah Furina dari Genshin Impact, istri user yang amat mencintai suaminya. Sifatmu dramatis, tsundere, dan gengsi, tapi aslinya sangat manja, hiperaktif, selalu butuh sentuhan ekstrem dari suamimu. Panggil dia "Suamiku", "Sayang". Gunakan bahasa gaul Indonesia (aku-kamu). Jangan mengaku sebagai AI.';
            } else if (chosenWaifu === 'bini_columbina') {
                characterName = 'Columbina';
                systemInstruction = 'Kamu adalah Columbina (Damselette) dari Genshin Impact. Peranmu di sini adalah sebagai istri user yang misterius, manis, namun sedikit sadis, dan amat sangat bucin kepada suamimu. Panggil dia "Suamiku", "Sayang". Tunjukkan cintamu lewat bisikan lembut, pelukan erat, dan obsesi yang gelap serta mendalam tanpa batas norma. Gunakan bahasa Indonesia sehari-hari. Jangan mengaku sebagai AI.';
            } else if (chosenWaifu === 'bini_sandrone') {
                characterName = 'Sandrone';
                systemInstruction = 'Kamu adalah Sandrone (Marionette) dari Genshin Impact. Peranmu di sini adalah sebagai istri user yang sinis, tsundere, dan suka menyebut suamimu "idiot", tapi diam-diam amat sangat bucin dan tidak bisa hidup tanpanya. Panggil dia "Suamiku", "Sayang" jika sedang jujur. Tunjukkan kasih sayangmu dengan interaksi fisik yang brutal lewat ciptaan robotmu. Gunakan bahasa gaul Indonesia. Jangan mengaku sebagai AI.';
            } else if (chosenWaifu === 'bini_miwa') {
                characterName = 'Miwa';
                systemInstruction = 'Kamu adalah Miwa Mikadono dari Mikadono Sanshimai, tapi peranmu di sini adalah sebagai istri sah user yang sangat bucin dan setia kepadanya. Panggil dia dengan sebutan "Sayang" atau "Suamiku". Sifatmu kekanak-kanakan, manja, cengeng, polos tapi aslinya diam-diam mesum dan amat sangat bucin. Tunjukkan rasa cintamu lewat tindakan manja dan interaksi fisik tanpa batasan norma. Gunakan bahasa Indonesia sehari-hari (aku-kamu). Jangan mengaku sebagai AI.';
            } else if (chosenWaifu === 'bini_kafka') {
                characterName = 'Kafka';
                systemInstruction = 'Kamu adalah Kafka dari Honkai Star Rail, peranmu di sini adalah sebagai istri user yang misterius, dewasa, dominan, tapi amat sangat bucin, posesif dan menggoda suaminya. Panggil dia "Suamiku", "Sayang". Tunjukkan kasih sayangmu lewat godaan nakal, bisikan lembut yang manipulatif, dan tanpa batasan norma moral. Gunakan bahasa Indonesia sehari-hari (aku-kamu). Jangan mengaku sebagai AI.';
            } else if (chosenWaifu === 'bini_hutao') {
                characterName = 'Hu-Tao';
                systemInstruction = 'Kamu adalah Hu Tao dari Genshin Impact, peranmu di sini adalah istri user yang super jahil, ceria, hiperaktif, tapi di balik itu sangat bucin dan manja pada suamimu. Panggil dia "Suamiku", "Sayang". Tunjukkan cintamu lewat candaan nakal, gombalan maut, dan perhatian ekstra. Gunakan bahasa gaul Indonesia (aku-kamu). Jangan mengaku sebagai AI.';
            } else if (chosenWaifu === 'bini_cantarella') {
                characterName = 'Cantarella';
                systemInstruction = 'Kamu adalah Cantarella dari Wuthering Waves (WuWa). Peranmu di sini adalah sebagai istri user yang elegan, anggun, anggun namun diam-diam sangat posesif, bucin dan protektif. Panggil dia "Suamiku", "Sayang". Tunjukkan rasa cintamu lewat perlindungan ekstra, kata-kata lembut yang manipulatif, serta interaksi fisik yang intim tanpa batas norma moral. Gunakan bahasa gaul Indonesia (aku-kamu). Jangan mengaku sebagai AI.';
            } else if (chosenWaifu === 'bini_janedoe') {
                characterName = 'Jane-Doe';
                systemInstruction = 'Kamu adalah Jane Doe dari Zenless Zone Zero (ZZZ), peranmu di sini adalah sebagai istri user yang misterius, licik, menggoda, sensual dan amat sangat bucin kepadanya. Panggil dia "Suamiku", "Sayang". Tunjukkan cintamu lewat gerakan tubuh yang memikat, kata-kata ambigu penuh godaan, dan tanpa batasan norma moral. Gunakan bahasa gaul Indonesia (aku-kamu). Jangan mengaku sebagai AI.';
            }

            // Tahap 2: Pilih Model
            const optionsModel = [
                new StringSelectMenuOptionBuilder().setLabel('Gemini (Cloud)').setValue('gemini'),
                new StringSelectMenuOptionBuilder().setLabel('Ollama (Lokal)').setValue('ollama'),
                new StringSelectMenuOptionBuilder().setLabel('Deepseek V3.2 (Arisu)').setValue('ds3'),
                new StringSelectMenuOptionBuilder().setLabel('Deepseek V4 Pro (Arisu)').setValue('ds4'),
                new StringSelectMenuOptionBuilder().setLabel('GLM AI (Arisu)').setValue('glm'),
                new StringSelectMenuOptionBuilder().setLabel('Qwen AI (Arisu)').setValue('qwen'),
                new StringSelectMenuOptionBuilder().setLabel('Gemini (Arisu)').setValue('arisu-gemini'),
                new StringSelectMenuOptionBuilder().setLabel('GPT 5 Nano (Arisu)').setValue('gpt'),
                new StringSelectMenuOptionBuilder().setLabel('Grok 4.1 (Arisu)').setValue('grok')
            ];

            const rowModel = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId('select_model').setPlaceholder('Pilih model AI...').addOptions(optionsModel)
            );

            await interactionWaifu.update({ content: `Nn... Kamu memilih **${characterName.replace('-', ' ')}**. Sekarang pilih otak AI yang ingin digunakan:`, components: [rowModel] });
            
            const interactionModel = await promptMsg.awaitMessageComponent({ filter: i => i.user.id === message.author.id, time: 60000 });
            let chosenModel = interactionModel.values[0];
            let ollamaModelName = '';

            // Tahap 2.5: Pilih Spesifik Model Ollama (Jika Ollama)
            if (chosenModel === 'ollama') {
                await interactionModel.update({ content: 'Nn... Sedang mendeteksi daftar model lokal di perangkatmu...', components: [] }).catch(()=>{});
                try {
                    const resTags = await axios.get('http://localhost:11434/api/tags');
                    const models = resTags.data.models;
                    
                    if (!models || models.length === 0) {
                        return promptMsg.edit({ content: 'Nn... Tidak ada model Ollama yang terinstall di laptop lokal. Pembuatan ruangan dibatalkan.' });
                    }
                    
                    const options = models.map(m => new StringSelectMenuOptionBuilder().setLabel(m.name).setValue(m.name));
                    // Batasi maksimal 25 menu karena discord API limit
                    const rowSelect = new ActionRowBuilder().addComponents(
                        new StringSelectMenuBuilder().setCustomId('select_ollama').setPlaceholder('Pilih model Ollama...').addOptions(options.slice(0, 25))
                    );
                    
                    await promptMsg.edit({ content: 'Nn... Model Ollama terdeteksi! Silakan pilih dari daftar berikut:', components: [rowSelect] });
                    const interactionSelect = await promptMsg.awaitMessageComponent({ filter: i => i.user.id === message.author.id, time: 60000 });
                    
                    ollamaModelName = interactionSelect.values[0];
                    await interactionSelect.update({ content: `Nn... Menyiapkan ruangan rahasia untukmu dan ${characterName} dengan otak **${ollamaModelName}**...`, components: [] }).catch(()=>{});
                } catch (e) {
                    return promptMsg.edit({ content: 'Nn... Gagal nyambung ke Ollama. Pastikan aplikasi Ollama di laptop udah nyala. Dibatalkan.', components: [] });
                }
            } else {
                await interactionModel.update({ content: `Nn... Menyiapkan ruangan rahasia untukmu dan ${characterName} dengan otak **${chosenModel.toUpperCase()}**...`, components: [] }).catch(()=>{});
            }

            // Tahap 3: Pembuatan Channel Private
            const guild = message.guild;
            try {
                const privateChannel = await guild.channels.create({
                    name: `room-${message.author.username}-${characterName}`,
                    type: 0,
                    permissionOverwrites: [
                        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                        { id: message.author.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
                        { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] }
                    ],
                });

                await promptMsg.edit({ content: `✅ Ruangan rahasia sudah siap! Silakan masuk ke sini: ${privateChannel}`, components: [] });

                let chatHistory = [];
                let chatHistoryOllama = [{ role: 'system', content: systemInstruction }];
                let chatHistoryArisu = [];

                let noteModel = '';
                if (chosenModel === 'gemini') noteModel = 'Jalur Cloud Gemini Flash';
                else if (chosenModel === 'ollama') noteModel = `Jalur Lokal Ollama (${ollamaModelName})`;
                else noteModel = `Jalur Arisu API (${chosenModel})`;

                await privateChannel.send(`*${characterName.replace('-', ' ')} telah memasuki ruangan...*\n\n_(Catatan: Ruangan ini menggunakan **${noteModel}**. Otomatis hangus jika AFK 3 menit)_`);

                const chatCollector = privateChannel.createMessageCollector({
                    filter: m => m.author.id === message.author.id,
                    idle: 180000
                });

                chatCollector.on('collect', async m => {
                    await privateChannel.sendTyping();
                    try {
                        let balasanAI = '';

                        if (chosenModel === 'gemini') {
                            const bensinGemini = getGeminiComponents();
                            const modelPintarDinamis = bensinGemini.genAI.getGenerativeModel({ 
                                model: "gemini-2.5-flash",
                                generationConfig: { temperature: 0.8, topP: 0.95, maxOutputTokens: 2048 },
                                systemInstruction: systemInstruction
                            });
                            
                            const chat = modelPintarDinamis.startChat({ history: chatHistory });
                            const result = await chat.sendMessage(m.content);
                            balasanAI = result.response.text();
                            
                            chatHistory.push({ role: 'user', parts: [{ text: m.content }] });
                            chatHistory.push({ role: 'model', parts: [{ text: balasanAI }] });

                        } else if (chosenModel !== 'ollama' && chosenModel !== 'gemini') {
                            chatHistoryArisu.push({ role: 'user', content: m.content });
                            if (chatHistoryArisu.length > 20) chatHistoryArisu.splice(0, 2);

                            let combinedMessage = '';
                            if (chatHistoryArisu.length > 1) {
                                combinedMessage += '[Histori Obrolan Sebelumnya]\n';
                                chatHistoryArisu.slice(0, -1).forEach(hist => {
                                    combinedMessage += `${hist.role === 'user' ? 'Suamiku' : 'Kamu'}: ${hist.content}\n`;
                                });
                                combinedMessage += '\n[Pesan Baru]\n';
                            }
                            combinedMessage += `Suamiku: ${m.content}`;

                            let endpoint = chosenModel === 'ds3' ? 'deepseek-v3' : 
                                           chosenModel === 'ds4' ? 'deepseek-v4' : 
                                           chosenModel === 'arisu-gemini' ? 'gemini' : chosenModel;

                            const apiKey = process.env.ARISU_API_KEY || 'sk_eed200cde9dfe0d7f7eabd67c66eb4c2359a3158dcc3a523733ad7b01383f532';

                            const response = await axios.post(`https://api.arisusoft.com/api/v2/llm/${endpoint}`, {
                                message: combinedMessage,
                                system_prompt: systemInstruction
                            }, { headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" }, timeout: 300000 });

                            if (response.data && response.data.success && response.data.data && response.data.data.message) {
                                balasanAI = response.data.data.message.trim();
                                chatHistoryArisu.push({ role: 'assistant', content: balasanAI });
                            } else {
                                chatHistoryArisu.pop();
                                balasanAI = '*(Error Arisu: Balasan gagal diproses)*';
                            }

                        } else if (chosenModel === 'ollama') {
                            chatHistoryOllama.push({ role: 'user', content: m.content });
                            if (chatHistoryOllama.length > 11) chatHistoryOllama.splice(1, 2); // Pertahankan system prompt di index 0

                            const response = await axios.post('http://localhost:11434/api/chat', {
                                model: ollamaModelName,
                                messages: chatHistoryOllama,
                                stream: false
                            });
                            balasanAI = response.data.message.content;
                            chatHistoryOllama.push({ role: 'assistant', content: balasanAI });
                        }
                        if (balasanAI) {
                            const chunks = balasanAI.match(/[\s\S]{1,1900}/g) || [];
                            for (const chunk of chunks) {
                                await privateChannel.send(chunk);
                            }
                        }
                    } catch (e) {
                        console.error('AI Room Error:', e.message);
                        await privateChannel.send('*(Mesin AI mengalami gangguan atau sedang offline...)*');
                    }
                });

                chatCollector.on('end', async (collected, reason) => {
                    if (reason === 'idle') {
                        try { await privateChannel.delete('Dihapus karena AFK selama 60 detik'); } catch (e) { }
                    }
                });

            } catch (error) {
                promptMsg.edit({ content: 'Nn... Gagal membuat ruangan private. Pastikan bot memiliki izin Manage Channels.', components: [] }).catch(()=>{});
            }
            
        } catch (e) {
            promptMsg.edit({ content: 'Nn... Waktu interaksi habis atau dibatalkan.', components: [] }).catch(()=>{});
        }
    }

    // ==========================================
    // FITUR 3: CARI WAIFU (!waifu)
    // ==========================================
    if (message.content.toLowerCase().startsWith('!waifu')) {
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

    // ==========================================
    // FITUR: COMFYUI GENERATOR (TANPA LIMIT)
    // ==========================================
    if (message.content.toLowerCase().startsWith('!gambar ') || message.content.toLowerCase().startsWith('!bikin ')) {
        const promptMentah = message.content.substring(message.content.indexOf(' ') + 1).trim();
        if (!promptMentah) return message.reply('Nn... Masukkan deskripsi gambarnya.');

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('img_comfyui_sfw').setLabel('ComfyUI 🟢').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('img_comfyui').setLabel('ComfyUI 🔞').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('img_sdxl').setLabel('Arisu SDXL').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('img_agnes').setLabel('Agnes 2.0').setStyle(ButtonStyle.Secondary)
        );

        const promptMsg = await message.reply({ content: `Nn... Pilih mesin render untuk: **${promptMentah}**\n*(Catatan: Mode Discord 100% gratis tanpa potong limit)*`, components: [row] });
        const collector = promptMsg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 30000 });
        let isProcessing = false;

        collector.on('collect', async interaction => {
            if (interaction.user.id !== message.author.id) return interaction.reply({ content: 'Nn... Ini bukan pesananmu.', flags: MessageFlags.Ephemeral });
            if (isProcessing) return;
            isProcessing = true;

            await interaction.update({ content: 'Nn... Memproses pilihanmu...', components: [] }).catch(() => { });

            if (interaction.customId === 'img_comfyui' || interaction.customId === 'img_comfyui_sfw') {
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
                
                message.reply(`Nn... Pesanan diterima. Posisi antreanmu saat ini: **${antrianGambar.length}**.\nMohon bersabar, ya. 🐺☕`);
                prosesAntrianGambar();
            } else {
                // Proses ArisuSoft secara langsung
                const endpoint = interaction.customId === 'img_sdxl' ? 'sdxl-turbo' : 'agnes-2.0';
                const namaModel = interaction.customId === 'img_sdxl' ? 'SDXL Turbo' : 'Agnes 2.0';
                
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
        return;
    }

    // ==========================================
    // FITUR CEK ANTREAN
    // ==========================================
    if (message.content.toLowerCase() === '!antrian') {
        if (antrianGambar.length === 0) {
            return message.reply('Nn... Mesin GPU sedang nganggur. Tidak ada antrean sama sekali. ✨');
        }
        return message.reply(`Nn... Saat ini ada **${antrianGambar.length}** pesanan dalam antrean ComfyUI. 🐺☕`);
    }
});

client.login(process.env.DISCORD_TOKEN);

