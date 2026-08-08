const { antrianGambar } = require('../services/comfyui.service');
const { antrianPixAI } = require('../services/pixai.service');

module.exports = {
    handle: async (message) => {
        const comfyCount = antrianGambar.length;
        const pixaiCount = antrianPixAI.length;

        if (comfyCount === 0 && pixaiCount === 0) {
            return message.reply('Nn... Semua mesin GPU sedang nganggur. Tidak ada antrean sama sekali. ✨');
        }

        let msgText = '📊 **STATUS ANTREAN SERVER**\n\n';
        msgText += `🎨 **PixAI.art:** ${pixaiCount > 0 ? `**${pixaiCount}** pesanan dalam antrean ⏳` : 'Kosong (Siap digunakan) 🟢'}\n`;
        msgText += `💻 **ComfyUI GPU:** ${comfyCount > 0 ? `**${comfyCount}** pesanan dalam antrean ⏳` : 'Kosong (Siap digunakan) 🟢'}\n\n`;
        msgText += '_Antrean saling terhubung secara real-time antara WhatsApp & Discord._ 🐺☕';

        return message.reply(msgText);
    }
};
