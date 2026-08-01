const { goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { state } = require('../state');
const { CONFIG_RUMAH, daftarMakanan } = require('../config');
const axios = require('axios');
const { getSocket } = require('../../../utils/socket'); // Adjusted path assuming it's in the root utils
const { ID_OWNER } = require('../../../config/constants'); // Adjusted path

function isAreaAman(blockPos) {
    const posisiRumah = new Vec3(CONFIG_RUMAH.petiX, CONFIG_RUMAH.petiY, CONFIG_RUMAH.petiZ);
    return blockPos.distanceTo(posisiRumah) > CONFIG_RUMAH.radiusAman;
}

async function amankanBarangKePeti(bot) {
    if (!state.sedangKerja) state.sedangKerja = true;
    bot.chat("Nn. Tas penuh. Pulang sebentar mengamankan barang.");
    try {
        bot.pathfinder.setGoal(null);
        await bot.pathfinder.goto(new goals.GoalGetToBlock(CONFIG_RUMAH.petiX, CONFIG_RUMAH.petiY, CONFIG_RUMAH.petiZ));
        const blokPeti = bot.blockAt(new Vec3(CONFIG_RUMAH.petiX, CONFIG_RUMAH.petiY, CONFIG_RUMAH.petiZ));

        if (blokPeti && blokPeti.name.includes('chest')) {
            const chest = await bot.openChest(blokPeti);
            const isiTas = bot.inventory.items();
            let diamankan = false;

            for (const item of isiTas) {
                const isTool = ['pickaxe', 'axe', 'sword', 'shovel', 'bed', 'dirt'].some(k => item.name.includes(k));
                const isFood = daftarMakanan.includes(item.name);

                if (!isTool && !isFood) {
                    try {
                        await chest.deposit(item.type, undefined, item.count);
                        diamankan = true;
                        await bot.waitForTicks(3);
                    } catch (e) {
                        bot.chat("Nn. Peti sudah penuh, Sensei.");
                        break;
                    }
                }
            }
            chest.close();

            if (diamankan) {
                bot.chat("Nn. Selesai memindahkan barang. Kembali bekerja.");
                try {
                    const sock = getSocket();
                    const idOwnerJid = ID_OWNER[0] + '@s.whatsapp.net';
                    if (sock) {
                        sock.sendMessage(idOwnerJid, {
                            text: `🚨 *LAPORAN AFK MINECRAFT* 🚨\n\nNn... Shiroko baru saja mengamankan hasil kerja AFK (penambangan/penebangan) ke peti rumah.`
                        }).catch(() => {});
                    } else {
                        axios.post('http://localhost:3000/laporan-masuk', {
                            pesan: `Nn... Laporan dari Mode Mandiri, Sensei. Shiroko baru saja mengamankan hasil kerja AFK ke peti rumah.`
                        }, { timeout: 3000 }).catch(() => { });
                    }
                } catch (err) { }
            }
        } else {
            bot.chat("Nn. Aku sudah di koordinat rumah, tapi petinya tidak ada atau terhalang.");
        }
    } catch (err) {
        bot.chat("Nn. Aku tersesat saat perjalanan pulang ke rumah.");
    }
    state.sedangKerja = false;
}

async function bergerakAcak(bot) {
    state.sedangKerja = true;
    try {
        const x = bot.entity.position.x + (Math.random() * 20 - 10);
        const z = bot.entity.position.z + (Math.random() * 20 - 10);
        bot.pathfinder.setGoal(new goals.GoalNear(x, bot.entity.position.y, z, 2));
        await bot.waitForTicks(60);
    } catch (e) { }
    state.sedangKerja = false;
}

async function tebangPohonDanAmbil(bot, blockAwal) {
    try {
        let pohon = blockAwal;
        while (pohon && state.sedangKerja) {
            if (bot.inventory.emptySlotCount() === 0) break;

            await bot.pathfinder.goto(new goals.GoalNear(pohon.position.x, pohon.position.y, pohon.position.z, 1.5));
            if (!state.sedangKerja) break;

            const itemDiTangan = bot.inventory.slots[bot.getEquipmentDestSlot('hand')];
            if (!itemDiTangan || !itemDiTangan.name.includes('axe')) {
                const kapak = bot.inventory.items().find(i => i.name.includes('axe'));
                if (kapak) await bot.equip(kapak, 'hand');
            }

            await bot.dig(pohon);
            await bot.waitForTicks(5);

            pohon = bot.findBlock({
                matching: b => b !== null && b.name && b.name.includes('log') && isAreaAman(b.position),
                maxDistance: 12,
                useExtraInfo: true
            });
        }
        state.sedangKerja = false;
    } catch (err) {
        state.sedangKerja = false;
    }
}

async function mulaiNambang(bot, blockId, namaBlok) {
    try {
        const urutanPickaxe = ['netherite_pickaxe', 'diamond_pickaxe', 'iron_pickaxe', 'golden_pickaxe', 'stone_pickaxe', 'wooden_pickaxe'];
        let block = bot.findBlock({
            matching: b => b !== null && b.type === blockId && isAreaAman(b.position),
            maxDistance: 32,
            useExtraInfo: true
        });

        while (block && state.sedangKerja) {
            if (bot.inventory.emptySlotCount() === 0) break;

            await bot.pathfinder.goto(new goals.GoalNear(block.position.x, block.position.y, block.position.z, 1.5));
            if (!state.sedangKerja) break;

            const itemDiTangan = bot.inventory.slots[bot.getEquipmentDestSlot('hand')];
            if (!itemDiTangan || !itemDiTangan.name.includes('pickaxe')) {
                let adaPickaxe = false;
                for (const namaPickaxe of urutanPickaxe) {
                    const pickaxe = bot.inventory.items().find(i => i.name === namaPickaxe);
                    if (pickaxe) { await bot.equip(pickaxe, 'hand'); adaPickaxe = true; break; }
                }
                if (!adaPickaxe) {
                    bot.chat("Nn. Beliungku habis atau hancur. Menghentikan aktivitas tambang.");
                    state.modeMandiri = false;
                    break;
                }
            }

            await bot.dig(block);
            await bot.waitForTicks(5);

            block = bot.findBlock({
                matching: b => b !== null && b.type === blockId && isAreaAman(b.position),
                maxDistance: 32,
                useExtraInfo: true
            });
        }
        state.sedangKerja = false;
    } catch (err) {
        state.sedangKerja = false;
    }
}

module.exports = {
    isAreaAman,
    amankanBarangKePeti,
    bergerakAcak,
    tebangPohonDanAmbil,
    mulaiNambang
};
