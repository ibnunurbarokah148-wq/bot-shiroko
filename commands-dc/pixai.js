const { AttachmentBuilder } = require('discord.js');
const { tambahAntrianPixAI } = require('../services/pixai.service');

module.exports = {
    handle: async (message) => {
        const promptMentah = message.content.substring(message.content.indexOf(' ') + 1).trim();
        if (!promptMentah || message.content.trim() === '!pixai') {
            return message.reply('Nn... Masukkan prompt setelah perintah **!pixai**.\nContoh: `!pixai 1girl, white hair, blue archive shiroko`');
        }

        const pos = tambahAntrianPixAI({
            prompt: promptMentah,
            isDiscord: true,
            reply: async (text) => message.reply(text),
            sendImage: async (imgBuffer, caption) => {
                const attachment = new AttachmentBuilder(imgBuffer, { name: 'hasil_pixai.png' });
                await message.reply({ content: caption, files: [attachment] });
            }
        });

        return message.reply(`🎨 **[ PIXAI.ART ANIME GENERATOR ]**\n\nNn... Pesanan diterima! Posisi antreanmu saat ini: **${pos}**.\nMohon bersabar ya, Sensei. 🐺✨`);
    }
};
