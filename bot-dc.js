require('dotenv').config();
const { Client, Events, GatewayIntentBits, AttachmentBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags, PermissionFlagsBits, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
const { getGeminiComponents } = require('./services/ai/providers/gemini');
const axios = require('axios');
const cmdGacha = require('./commands-dc/gacha');
const cmdMybini = require('./commands-dc/mybini');
const cmdWaifu = require('./commands-dc/waifu');
const cmdGambar = require('./commands-dc/gambar');
const cmdAntrian = require('./commands-dc/antrian');
const cmdPixai = require('./commands-dc/pixai');

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

// ==========================================
// MODULE SHARE DENGAN WHATSAPP
// ==========================================
const { pixiv } = require('./services/pixiv.service');
const { antrianGambar, prosesAntrianGambar } = require('./services/comfyui.service');
const { upsert, incrementStat } = require('./config/database');

// 2. KETIKA BOT ONLINE
client.once(Events.ClientReady, async () => {
    console.log(`Nn... Sistem komunikasi Discord ${client.user.tag} sudah aktif, Sensei.`);
    
    const updateDiscordUsersCount = () => {
        let count = 0;
        client.guilds.cache.forEach(guild => {
            count += guild.memberCount;
        });
        upsert('statistics', { id: 'discordUsers', value: count });
    };

    updateDiscordUsersCount(); // Run once at startup
    setInterval(updateDiscordUsersCount, 60000); // And every minute
});

// 3. DETEKSI PESAN DARI USER
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const lower = message.content.toLowerCase();

    // Deteksi command
    if (lower === '!gacha' || lower === '!mybini' || lower.startsWith('!waifu') || lower.startsWith('!gambar ') || lower.startsWith('!bikin ') || lower.startsWith('!pixai') || lower === '!antrian') {
        incrementStat('commands');
        
        // Command yang memanggil AI secara langsung
        if (lower.startsWith('!gambar ') || lower.startsWith('!bikin ') || lower.startsWith('!pixai')) {
            incrementStat('aiRequests');
        }
    }

    if (lower === '!gacha') return cmdGacha.handle(message, { pixiv });
    if (lower === '!mybini') return cmdMybini.handle(message, { client });
    if (lower.startsWith('!waifu')) return cmdWaifu.handle(message, { pixiv });
    if (lower.startsWith('!gambar ') || lower.startsWith('!bikin ')) return cmdGambar.handle(message);
    if (lower.startsWith('!pixai')) return cmdPixai.handle(message);
    if (lower === '!antrian') return cmdAntrian.handle(message);
});

if (process.env.DISCORD_TOKEN && process.env.DISCORD_TOKEN.trim() && !process.env.DISCORD_TOKEN.includes('masukkan')) {
    client.login(process.env.DISCORD_TOKEN).catch(err => {
        console.warn('⚠️ [DISCORD] Gagal terhubung ke Discord:', err.message);
    });
} else {
    console.log('ℹ️ [DISCORD] DISCORD_TOKEN tidak terpasang di .env. Fitur Discord nonaktif.');
}


