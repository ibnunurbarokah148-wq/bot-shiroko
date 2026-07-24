require('dotenv').config();
const { Client, GatewayIntentBits, AttachmentBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags, PermissionFlagsBits, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
const { getGeminiComponents } = require('./services/ai.service');
const PixivApi = require('pixiv-api-client');
const axios = require('axios');
const cmdGacha = require('./commands-dc/gacha');
const cmdMybini = require('./commands-dc/mybini');
const cmdWaifu = require('./commands-dc/waifu');
const cmdGambar = require('./commands-dc/gambar');
const cmdAntrian = require('./commands-dc/antrian');

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

    const lower = message.content.toLowerCase();

    if (lower === '!gacha') return cmdGacha.handle(message, { pixiv });
    if (lower === '!mybini') return cmdMybini.handle(message, { client });
    if (lower.startsWith('!waifu')) return cmdWaifu.handle(message, { pixiv });
    if (lower.startsWith('!gambar ') || lower.startsWith('!bikin ')) return cmdGambar.handle(message);
    if (lower === '!antrian') return cmdAntrian.handle(message);
});

client.login(process.env.DISCORD_TOKEN);

