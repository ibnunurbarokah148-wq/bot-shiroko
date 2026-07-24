// ==========================================
// DISCORD COMMAND: AI CHAT & MODE
// Handler: !aimode, !shiroko, !shiroko_pintar, !lupa
// ==========================================
const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
const state = require('../config/state');
const { getGeminiComponents, tanyaOllama, tanyaArisu, tanyaOpenRouter, tanyaCloudflare, fetchOpenRouterModels, fetchCloudflareModels, memoriOllama, memoriArisu, memoriOpenRouter, memoriCloudflare } = require('../services/ai.service');

// Memori sesi menu interaktif Discord per user
const sesiDiscordMode = {};

async function handle(message, { client }) {
    const senderId = message.author.id;
    const isOwner = senderId === process.env.DISCORD_OWNER_ID || true; // Sensitivitas role owner
    const content = message.content.trim();
    const lower = content.toLowerCase();

    // ==========================================
    // 1. COMMAND !aimode (Ganti Provider & Model)
    // ==========================================
    if (lower === '!aimode' || lower.startsWith('!aimode ')) {
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`select_aimode_${senderId}`)
            .setPlaceholder('Pilih Otak / Provider AI Shiroko...')
            .addOptions(
                new StringSelectMenuOptionBuilder()
                    .setLabel('Google Gemini (Default)')
                    .setDescription('Gemini 2.5 Flash Cloud')
                    .setValue('gemini')
                    .setEmoji('⚡'),
                new StringSelectMenuOptionBuilder()
                    .setLabel('OpenRouter AI')
                    .setDescription('Model AI Terbuka (DeepSeek, Llama, Qwen, dll)')
                    .setValue('openrouter')
                    .setEmoji('🌐'),
                new StringSelectMenuOptionBuilder()
                    .setLabel('Cloudflare Workers AI')
                    .setDescription('Serverless AI (Llama 3.3, DeepSeek R1, Qwen, dll)')
                    .setValue('cloudflare')
                    .setEmoji('☁️'),
                new StringSelectMenuOptionBuilder()
                    .setLabel('Arisu DeepSeek V3')
                    .setDescription('Jalur cepat Arisu DeepSeek-V3')
                    .setValue('ds3')
                    .setEmoji('🤖'),
                new StringSelectMenuOptionBuilder()
                    .setLabel('Ollama Offline')
                    .setDescription('Model AI lokal VPS')
                    .setValue('ollama')
                    .setEmoji('🏠')
            );

        const row = new ActionRowBuilder().addComponents(selectMenu);
        const embed = new EmbedBuilder()
            .setColor(0x4285F4)
            .setTitle('🤖 SHIROKO AI MODE SELECTOR (DISCORD)')
            .setDescription(`Nn... Sensei <@${senderId}>, pilih otak AI yang ingin digunakan untuk berkomunikasi denganku:`)
            .addFields(
                { name: 'Mode Saat Ini', value: `\`${state.userAIMode[senderId] || 'gemini'}\``, inline: true }
            )
            .setFooter({ text: 'Pilih opsi dari menu dropdown di bawah ini' });

        const replyMsg = await message.reply({ embeds: [embed], components: [row] });

        // Collector interaktif select menu
        const collector = replyMsg.createMessageComponentCollector({
            filter: i => i.user.id === senderId,
            time: 60000
        });

        collector.on('collect', async i => {
            const selectedVal = i.values[0];

            if (selectedVal === 'openrouter') {
                await i.deferUpdate();
                try {
                    const models = await fetchOpenRouterModels();
                    sesiDiscordMode[senderId] = { provider: 'openrouter', list: models };
                    let desc = 'Nn... Sensei, pilih model OpenRouter dengan membalas pesan ini menggunakan angkanya:\n\n';
                    models.forEach((m, idx) => {
                        desc += `**${idx + 1}.** ${m.name}\n`;
                    });
                    desc += '\n*Ketik angka pilihanmu atau ketik "batal".*';
                    await i.editReply({ content: desc, embeds: [], components: [] });
                } catch (e) {
                    await i.editReply({ content: `Nn... Gagal mengambil daftar model OpenRouter: ${e.message}`, embeds: [], components: [] });
                }
            } else if (selectedVal === 'cloudflare') {
                await i.deferUpdate();
                try {
                    const models = await fetchCloudflareModels();
                    sesiDiscordMode[senderId] = { provider: 'cloudflare', list: models };
                    let desc = 'Nn... Sensei, pilih model Cloudflare Workers AI dengan membalas angkanya:\n\n';
                    models.forEach((m, idx) => {
                        desc += `**${idx + 1}.** ${m.name}\n`;
                    });
                    desc += '\n*Ketik angka pilihanmu atau ketik "batal".*';
                    await i.editReply({ content: desc, embeds: [], components: [] });
                } catch (e) {
                    await i.editReply({ content: `Nn... Gagal mengambil daftar model Cloudflare: ${e.message}`, embeds: [], components: [] });
                }
            } else {
                state.userAIMode[senderId] = selectedVal;
                await i.update({
                    content: `✅ Mode AI Shiroko berhasil diubah ke **${selectedVal.toUpperCase()}**! ✨`,
                    embeds: [],
                    components: []
                });
            }
        });

        return true;
    }

    // ==========================================
    // 2. HANDLER SESI ANGKAN SELECTION OPENROUTER & CLOUDFLARE
    // ==========================================
    if (sesiDiscordMode[senderId]) {
        if (lower === 'batal' || lower === 'cancel') {
            delete sesiDiscordMode[senderId];
            await message.reply('Nn... Pemilihan model dibatalkan.');
            return true;
        }

        const num = parseInt(content) - 1;
        const list = sesiDiscordMode[senderId].list;

        if (!isNaN(num) && num >= 0 && num < list.length) {
            const chosen = list[num];
            const provider = sesiDiscordMode[senderId].provider;

            if (provider === 'openrouter') {
                state.userOpenRouterModel[senderId] = chosen.id;
                state.userAIMode[senderId] = 'openrouter';
                delete sesiDiscordMode[senderId];
                await message.reply(`✅ *MODE OPENROUTER AKTIF*\n\nNn... Otak dikunci ke model: **${chosen.name}** (\`${chosen.id}\`). ✨`);
            } else if (provider === 'cloudflare') {
                state.userCloudflareModel[senderId] = chosen.id;
                state.userAIMode[senderId] = 'cloudflare';
                delete sesiDiscordMode[senderId];
                await message.reply(`✅ *MODE CLOUDFLARE AI AKTIF*\n\nNn... Otak dikunci ke model: **${chosen.name}**. ✨`);
            }
            return true;
        }
    }

    // ==========================================
    // 3. COMMAND !lupa (RESET MEMORI DISCORD)
    // ==========================================
    if (lower === '!lupa') {
        let berhasilLupa = false;

        if (state.sesiObrolan[senderId]) {
            delete state.sesiObrolan[senderId];
            berhasilLupa = true;
        }
        if (memoriOllama[senderId]) {
            delete memoriOllama[senderId];
            berhasilLupa = true;
        }
        if (memoriArisu[senderId]) {
            delete memoriArisu[senderId];
            berhasilLupa = true;
        }
        if (memoriOpenRouter[senderId]) {
            delete memoriOpenRouter[senderId];
            berhasilLupa = true;
        }
        if (memoriCloudflare[senderId]) {
            delete memoriCloudflare[senderId];
            berhasilLupa = true;
        }

        if (berhasilLupa) {
            await message.reply('Nn... *(Menggelengkan kepala)*. Shiroko sudah menghapus seluruh memori percakapan kita.');
        } else {
            await message.reply('Nn... Pikiran Shiroko memang masih kosong dari awal.');
        }
        return true;
    }

    // ==========================================
    // 4. COMMAND !shiroko_pintar
    // ==========================================
    if (lower.startsWith('!shiroko_pintar ')) {
        const pertanyaan = content.substring(16).trim();
        const userMode = state.userAIMode[senderId] || 'gemini';

        try {
            await message.channel.sendTyping();

            if (userMode === 'openrouter') {
                const modelPilihan = state.userOpenRouterModel[senderId] || 'deepseek/deepseek-r1:free';
                const pesanInstruksi = `[TOLONG JAWAB PERTANYAAN INI SEBAGAI ASISTEN AKADEMIK YANG CERDAS DAN FORMAL]: ${pertanyaan}`;
                const jawaban = await tanyaOpenRouter(senderId, pesanInstruksi, isOwner, modelPilihan);
                await message.reply(`🧠 **SHIROKO PINTAR (OPENROUTER)**\n\n${jawaban}`);
            } else if (userMode === 'cloudflare') {
                const modelPilihan = state.userCloudflareModel[senderId] || '@cf/meta/llama-3-8b-instruct';
                const pesanInstruksi = `[TOLONG JAWAB PERTANYAAN INI SEBAGAI ASISTEN AKADEMIK YANG CERDAS DAN FORMAL]: ${pertanyaan}`;
                const jawaban = await tanyaCloudflare(senderId, pesanInstruksi, isOwner, modelPilihan);
                await message.reply(`🧠 **SHIROKO PINTAR (CLOUDFLARE)**\n\n${jawaban}`);
            } else if (['ds3', 'ds4', 'glm', 'qwen', 'arisu-gemini', 'gpt', 'grok'].includes(userMode)) {
                let endpoint = userMode === 'ds3' ? 'deepseek-v3' : userMode === 'ds4' ? 'deepseek-v4' : userMode === 'arisu-gemini' ? 'gemini' : userMode;
                const pesanInstruksi = `[TOLONG JAWAB PERTANYAAN INI SEBAGAI ASISTEN AKADEMIK YANG CERDAS DAN FORMAL]: ${pertanyaan}`;
                const jawaban = await tanyaArisu(senderId, pesanInstruksi, isOwner, endpoint);
                await message.reply(`🧠 **SHIROKO PINTAR (${endpoint.toUpperCase()})**\n\n${jawaban}`);
            } else if (userMode === 'ollama') {
                const pesanInstruksi = `[TOLONG JAWAB PERTANYAAN INI SEBAGAI ASISTEN AKADEMIK YANG CERDAS DAN FORMAL]: ${pertanyaan}`;
                const jawaban = await tanyaOllama(senderId, pesanInstruksi, isOwner);
                await message.reply(`🧠 **SHIROKO PINTAR (OLLAMA)**\n\n${jawaban}`);
            } else {
                const bensinGemini = getGeminiComponents();
                const modelPintarDinamis = bensinGemini.genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
                const result = await modelPintarDinamis.generateContent(`Jawablah informatif & akurat:\n\nPertanyaan: ${pertanyaan}`);
                await message.reply(`🧠 **SHIROKO PINTAR (GEMINI)**\n\n${result.response.text().trim()}`);
            }
        } catch (e) {
            await message.reply(`Nn... Eror saat memproses pertanyaan: ${e.message}`);
        }
        return true;
    }

    // ==========================================
    // 5. DETEKSI CHAT SHIROKO (!shiroko ATAU MENTION BOT ATAU DM)
    // ==========================================
    const botMention = `<@${client.user.id}>`;
    const isMentioned = message.mentions.has(client.user.id);
    const isDM = !message.guild;
    let pesanUser = '';

    if (lower.startsWith('!shiroko ')) {
        pesanUser = content.substring(9).trim();
    } else if (isMentioned) {
        pesanUser = content.replace(botMention, '').trim();
    } else if (isDM && !content.startsWith('!')) {
        pesanUser = content;
    }

    if (pesanUser) {
        const userMode = state.userAIMode[senderId] || 'gemini';

        try {
            await message.channel.sendTyping();

            if (userMode === 'openrouter') {
                const modelPilihan = state.userOpenRouterModel[senderId] || 'deepseek/deepseek-r1:free';
                const jawaban = await tanyaOpenRouter(senderId, pesanUser, isOwner, modelPilihan);
                await message.reply(jawaban);
            } else if (userMode === 'cloudflare') {
                const modelPilihan = state.userCloudflareModel[senderId] || '@cf/meta/llama-3-8b-instruct';
                const jawaban = await tanyaCloudflare(senderId, pesanUser, isOwner, modelPilihan);
                await message.reply(jawaban);
            } else if (['ds3', 'ds4', 'glm', 'qwen', 'arisu-gemini', 'gpt', 'grok'].includes(userMode)) {
                let endpoint = userMode === 'ds3' ? 'deepseek-v3' : userMode === 'ds4' ? 'deepseek-v4' : userMode === 'arisu-gemini' ? 'gemini' : userMode;
                const jawaban = await tanyaArisu(senderId, pesanUser, isOwner, endpoint);
                await message.reply(jawaban);
            } else if (userMode === 'ollama') {
                const jawaban = await tanyaOllama(senderId, pesanUser, isOwner);
                await message.reply(jawaban);
            } else {
                const bensinGemini = getGeminiComponents();
                if (!state.sesiObrolan[senderId]) {
                    const instruksiKhusus = `[INSTRUKSI RAHASIA: User ini adalah Sensei. Jawablah sebagai Sunaookami Shiroko dari Blue Archive. Awali kalimat dengan "Nn...".]`;
                    const modelObrolan = bensinGemini.genAI.getGenerativeModel({
                        model: "gemini-2.5-flash",
                        generationConfig: { temperature: 0.8, topP: 0.95, maxOutputTokens: 4096 },
                        systemInstruction: `Kamu adalah Sunaookami Shiroko dari Blue Archive.\n\n${instruksiKhusus}`
                    });
                    state.sesiObrolan[senderId] = modelObrolan.startChat({ history: [] });
                }
                const result = await state.sesiObrolan[senderId].sendMessage(pesanUser);
                await message.reply(result.response.text());
            }
        } catch (e) {
            await message.reply(`Nn... Memori Shiroko eror: ${e.message}`);
        }
        return true;
    }

    return false;
}

module.exports = { handle };
