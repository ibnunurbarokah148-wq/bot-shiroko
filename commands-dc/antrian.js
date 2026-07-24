const { antrianGambar } = require('../services/comfyui.service');

module.exports = {
    handle: async (message) => {
        if (antrianGambar.length === 0) {
            return message.reply('Nn... Mesin GPU sedang nganggur. Tidak ada antrean sama sekali. ✨');
        }
        return message.reply(`Nn... Saat ini ada **${antrianGambar.length}** pesanan dalam antrean ComfyUI. 🐺☕`);
    }
};
