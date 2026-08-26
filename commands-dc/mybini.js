const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, PermissionFlagsBits, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { getGeminiComponents } = require('../services/ai/providers/gemini');
const AIProvider = require('../services/ai/AIProvider');
const { fetchModels: fetchOpenRouterModels } = require('../services/ai/providers/openrouter');
const { fetchModels: fetchCloudflareModels } = require('../services/ai/providers/cloudflare');
const { fetchModels: fetchXKiroModels } = require('../services/ai/providers/xkiro');
const { WAIFU_CHARACTERS } = require('../config/waifu.characters');
const axios = require('axios');

async function chooseModelPaginated(promptMsg, models, prefix, label, userId) {
    let page = 0;
    const pageSize = 25;
    const totalPages = Math.max(1, Math.ceil(models.length / pageSize));

    while (true) {
        const pageModels = models.slice(page * pageSize, (page + 1) * pageSize);
        const options = pageModels.map(model => new StringSelectMenuOptionBuilder()
            .setLabel(String(model.name || model.id).substring(0, 100))
            .setValue(String(model.id)));
        const select = new StringSelectMenuBuilder()
            .setCustomId(`${prefix}_select_${page}`)
            .setPlaceholder(`${label} — halaman ${page + 1}/${totalPages}`)
            .addOptions(options);
        const nav = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`${prefix}_prev`).setLabel('Sebelumnya').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
            new ButtonBuilder().setCustomId(`${prefix}_next`).setLabel('Berikutnya').setStyle(ButtonStyle.Primary).setDisabled(page >= totalPages - 1),
            new ButtonBuilder().setCustomId(`${prefix}_search`).setLabel('Cari model').setStyle(ButtonStyle.Success)
        );
        const rows = [new ActionRowBuilder().addComponents(select), nav];
        await promptMsg.edit({ content: `${label}\nHalaman **${page + 1}/${totalPages}** — total **${models.length}** model:`, components: rows });
        const interaction = await promptMsg.awaitMessageComponent({
            filter: component => component.user.id === userId && (component.customId.startsWith(`${prefix}_select_`) || component.customId === `${prefix}_prev` || component.customId === `${prefix}_next` || component.customId === `${prefix}_search`),
            time: 60000
        });
        if (interaction.customId === `${prefix}_prev`) {
            await interaction.deferUpdate().catch(() => {});
            page--;
            continue;
        }
        if (interaction.customId === `${prefix}_next`) {
            await interaction.deferUpdate().catch(() => {});
            page++;
            continue;
        }
        if (interaction.customId === `${prefix}_search`) {
            const modal = new ModalBuilder().setCustomId(`${prefix}_search_modal`).setTitle(`Cari ${label}`);
            const input = new TextInputBuilder().setCustomId(`${prefix}_query`).setLabel('Nama atau ID model').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100);
            modal.addComponents(new ActionRowBuilder().addComponents(input));
            await interaction.showModal(modal);
            const submitted = await interaction.awaitModalSubmit({ filter: modalInteraction => modalInteraction.user.id === userId && modalInteraction.customId === `${prefix}_search_modal`, time: 60000 });
            const query = submitted.fields.getTextInputValue(`${prefix}_query`).toLowerCase().trim();
            const matches = models.filter(model => `${model.name || ''} ${model.id || ''}`.toLowerCase().includes(query));
            await submitted.reply({ content: matches.length ? `Ditemukan **${matches.length}** model. Daftar pencarian diperbarui.` : 'Model tidak ditemukan.', ephemeral: true });
            if (!matches.length) continue;
            models = matches;
            page = 0;
            continue;
        }
        const value = interaction.values[0];
        await interaction.deferUpdate().catch(() => {});
        return value;
    }
}

module.exports = {
    handle: async (message, { client }) => {
        const discordWaifuIds = ['shiroko', 'yae', 'furina', 'columbina', 'sandrone', 'miwa', 'kafka', 'hutao', 'cantarella', 'janedoe'];
        const optionsWaifu = WAIFU_CHARACTERS.map((character, index) => new StringSelectMenuOptionBuilder()
            .setLabel(`${character.name} (${character.franchise})`)
            .setValue(`bini_${discordWaifuIds[index]}`));

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
            

            // Gunakan prompt registry WA sebagai sumber utama agar Discord dan WA konsisten.
            const discordCharacterIds = { bini_shiroko: 'shiroko', bini_yae: 'yae_miko', bini_furina: 'furina', bini_columbina: 'columbina', bini_sandrone: 'sandrone', bini_miwa: 'miwa', bini_kafka: 'kafka', bini_hutao: 'hu_tao', bini_cantarella: 'cantarella', bini_janedoe: 'jane_doe' };
            const registryCharacter = WAIFU_CHARACTERS.find(character => character.id === discordCharacterIds[chosenWaifu]);
            if (registryCharacter) { characterName = registryCharacter.name; systemInstruction = registryCharacter.prompt; }

            // Tahap 2: Pilih Provider / Model AI
            const optionsModel = [
                new StringSelectMenuOptionBuilder().setLabel('xKiro Multi-Model Gateway 🚀').setValue('xkiro'),
                new StringSelectMenuOptionBuilder().setLabel('Gemini (Cloud)').setValue('gemini'),
                new StringSelectMenuOptionBuilder().setLabel('OpenRouter AI (Cloud)').setValue('openrouter'),
                new StringSelectMenuOptionBuilder().setLabel('Cloudflare Workers AI').setValue('cloudflare'),
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
            let openrouterModelName = 'deepseek/deepseek-r1:free';
            let cloudflareModelName = '@cf/meta/llama-3-8b-instruct';
            let xkiroModelName = 'openai/gpt-4o';

            // Tahap 2.5: Pilih Spesifik Model (Ollama / OpenRouter / Cloudflare)
            if (chosenModel === 'ollama') {
                await interactionModel.update({ content: 'Nn... Sedang mendeteksi daftar model lokal di perangkatmu...', components: [] }).catch(()=>{});
                try {
                    const resTags = await axios.get('http://localhost:11434/api/tags');
                    const models = resTags.data.models;
                    
                    if (!models || models.length === 0) {
                        return promptMsg.edit({ content: 'Nn... Tidak ada model Ollama yang terinstall di laptop lokal. Pembuatan ruangan dibatalkan.' });
                    }
                    
                    const result = await chooseModelPaginated(
                        promptMsg,
                        models.map(model => ({ id: model.name, name: model.name })),
                        'ollama',
                        'Pilih model Ollama',
                        message.author.id
                    );
                    ollamaModelName = result;
                    await promptMsg.edit({ content: `Nn... Menyiapkan ruangan rahasia untukmu dan ${characterName} dengan otak **${ollamaModelName}**...`, components: [] }).catch(()=>{});
                } catch (e) {
                    return promptMsg.edit({ content: 'Nn... Gagal nyambung ke Ollama. Pastikan aplikasi Ollama di laptop udah nyala. Dibatalkan.', components: [] });
                }
            } else if (chosenModel === 'openrouter') {
                await interactionModel.update({ content: 'Nn... Sedang mengambil daftar model OpenRouter...', components: [] }).catch(()=>{});
                try {
                    const models = await fetchOpenRouterModels();
                    if (!models || models.length === 0) {
                        return promptMsg.edit({ content: 'Nn... Tidak ada model OpenRouter yang tersedia. Pembuatan ruangan dibatalkan.' });
                    }
                    const result = await chooseModelPaginated(promptMsg, models, 'openrouter', 'Pilih model OpenRouter (filter FREE tetap aktif)', message.author.id);
                    openrouterModelName = result;
                    await promptMsg.edit({ content: `Nn... Menyiapkan ruangan rahasia untukmu dan ${characterName} dengan OpenRouter (**${openrouterModelName}**)...`, components: [] }).catch(()=>{});
                } catch (e) {
                    return promptMsg.edit({ content: `Nn... Gagal mengambil model OpenRouter: ${e.message}`, components: [] });
                }
            } else if (chosenModel === 'xkiro') {
                await interactionModel.update({ content: 'Nn... Sedang mengambil daftar model xKiro Gateway...', components: [] }).catch(()=>{});
                try {
                    const models = await fetchXKiroModels();
                    if (!models || models.length === 0) {
                        return promptMsg.edit({ content: 'Nn... Tidak ada model xKiro yang tersedia. Pembuatan ruangan dibatalkan.' });
                    }
                    const result = await chooseModelPaginated(promptMsg, models, 'xkiro', 'Pilih model xKiro (semua model tersedia gratis di Discord)', message.author.id);
                    xkiroModelName = result;
                    await promptMsg.edit({ content: `Nn... Menyiapkan ruangan rahasia untukmu dan ${characterName} dengan xKiro Gateway (**${xkiroModelName}**)...`, components: [] }).catch(()=>{});
                } catch (e) {
                    return promptMsg.edit({ content: `Nn... Gagal mengambil model xKiro: ${e.message}`, components: [] });
                }
            } else if (chosenModel === 'cloudflare') {
                await interactionModel.update({ content: 'Nn... Sedang mengambil daftar model Cloudflare Workers AI...', components: [] }).catch(()=>{});
                try {
                    const models = await fetchCloudflareModels();
                    if (!models || models.length === 0) {
                        return promptMsg.edit({ content: 'Nn... Tidak ada model Cloudflare yang tersedia. Pembuatan ruangan dibatalkan.' });
                    }
                    const result = await chooseModelPaginated(promptMsg, models, 'cloudflare', 'Pilih model Cloudflare (filter Text Generation tetap aktif)', message.author.id);
                    cloudflareModelName = result;
                    await promptMsg.edit({ content: `Nn... Menyiapkan ruangan rahasia untukmu dan ${characterName} dengan Cloudflare (**${cloudflareModelName}**)...`, components: [] }).catch(()=>{});
                } catch (e) {
                    return promptMsg.edit({ content: `Nn... Gagal mengambil model Cloudflare: ${e.message}`, components: [] });
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
                else if (chosenModel === 'xkiro') noteModel = `Jalur xKiro Gateway (${xkiroModelName})`;
                else if (chosenModel === 'openrouter') noteModel = `Jalur OpenRouter (${openrouterModelName})`;
                else if (chosenModel === 'cloudflare') noteModel = `Jalur Cloudflare AI (${cloudflareModelName})`;
                else if (chosenModel === 'ollama') noteModel = `Jalur Lokal Ollama (${ollamaModelName})`;
                else noteModel = `Jalur Arisu API (${chosenModel})`;

                await privateChannel.send(`*${characterName.replace('-', ' ')} telah memasuki ruangan...*\n\n_(Catatan: Ruangan ini menggunakan **${noteModel}**. Otomatis hangus jika AFK 3 menit)_`);

                const chatCollector = privateChannel.createMessageCollector({
                    filter: m => m.author.id === message.author.id,
                    idle: 180000
                });

                chatCollector.on('collect', async m => {
                    const { incrementStat } = require('../config/database');
                    incrementStat('aiRequests');
                    incrementStat('totalChat');

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

                        } else if (chosenModel === 'xkiro') {
                            balasanAI = await AIProvider.generate({
                                provider: 'xkiro',
                                model: xkiroModelName,
                                prompt: m.content,
                                senderId: message.author.id,
                                isOwner: true,
                                systemPrompt: systemInstruction
                            });
                        } else if (chosenModel === 'openrouter') {
                            balasanAI = await AIProvider.generate({
                                provider: 'openrouter',
                                model: openrouterModelName,
                                prompt: m.content,
                                senderId: message.author.id,
                                isOwner: true,
                                systemPrompt: systemInstruction
                            });
                        } else if (chosenModel === 'cloudflare') {
                            balasanAI = await AIProvider.generate({
                                provider: 'cloudflare',
                                model: cloudflareModelName,
                                prompt: m.content,
                                senderId: message.author.id,
                                isOwner: true,
                                systemPrompt: systemInstruction
                            });
                        } else if (chosenModel === 'ollama') {
                            chatHistoryOllama.push({ role: 'user', content: m.content });
                            if (chatHistoryOllama.length > 11) chatHistoryOllama.splice(1, 2);

                            const response = await axios.post('http://localhost:11434/api/chat', {
                                model: ollamaModelName,
                                messages: chatHistoryOllama,
                                stream: false
                            });
                            balasanAI = response.data.message.content;
                            chatHistoryOllama.push({ role: 'assistant', content: balasanAI });
                        } else {
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

                            const apiKey = process.env.ARISU_API_KEY;

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
                        try { await privateChannel.delete('Dihapus karena AFK selama 180 detik'); } catch (e) { }
                    }
                });

            } catch (error) {
                promptMsg.edit({ content: 'Nn... Gagal membuat ruangan private. Pastikan bot memiliki izin Manage Channels.', components: [] }).catch(()=>{});
            }
            
        } catch (e) {
            promptMsg.edit({ content: 'Nn... Waktu interaksi habis atau dibatalkan.', components: [] }).catch(()=>{});
        }
    }
};
