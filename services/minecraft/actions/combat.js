const { goals } = require('mineflayer-pathfinder');
const { state } = require('../state');
const { daftarMakanan, hostileMobs } = require('../config');

const urutanPedang = [
    'netherite_sword', 'diamond_sword', 'iron_sword', 
    'golden_sword', 'stone_sword', 'wooden_sword',
    'netherite_axe', 'diamond_axe', 'iron_axe', 'stone_axe'
];

async function pasangSenjataTerbaik(bot) {
    try {
        const itemDiTangan = bot.inventory.slots[bot.getEquipmentDestSlot('hand')];
        if (!itemDiTangan || (!itemDiTangan.name.includes('sword') && !itemDiTangan.name.includes('axe'))) {
            for (const namaPedang of urutanPedang) {
                const senjata = bot.inventory.items().find(i => i.name === namaPedang);
                if (senjata) {
                    await bot.equip(senjata, 'hand');
                    break;
                }
            }
        }
        // Pasang Perisai di tangan kiri (off-hand) jika ada di inventory
        const perisai = bot.inventory.items().find(i => i.name === 'shield');
        if (perisai) {
            await bot.equip(perisai, 'off-hand');
        }
    } catch (e) {}
}

function berhentiSerang(bot) {
    if (state.loopSerangan) clearInterval(state.loopSerangan);
    if (bot.hawkEye) bot.hawkEye.stop();
    state.loopSerangan = null; 
    state.targetSerangan = null; 
    bot.pathfinder.setGoal(null);
}

function mulaiSerang(bot, target) {
    state.targetSerangan = target;
    if (state.loopSerangan) clearInterval(state.loopSerangan);
    if (bot.hawkEye) bot.hawkEye.stop();
    state.modeRanged = false;

    pasangSenjataTerbaik(bot);

    state.loopSerangan = setInterval(async () => {
        if (!state.targetSerangan || !state.targetSerangan.isValid || (state.targetSerangan.health && state.targetSerangan.health <= 0)) {
            bot.chat("Nn. Ancaman berhasil dieliminasi.");
            return berhentiSerang(bot);
        }

        const targetName = (state.targetSerangan.name || '').toLowerCase();
        const jarak = bot.entity.position.distanceTo(state.targetSerangan.position);

        const adaPanah = bot.inventory.items().find(i => i.name === 'bow') && bot.inventory.items().find(i => i.name === 'arrow');

        // MODE SNIPER (PANAH) JIKA JARAK > 6
        if (jarak > 6 && adaPanah && targetName !== 'enderman') { 
            if (!state.modeRanged) {
                state.modeRanged = true;
                bot.pathfinder.setGoal(null); // Berhenti lari
                bot.hawkEye.autoAttack(state.targetSerangan, 'bow');
            }
            return; 
        } else {
            // KEMBALI KE MODE MELEE
            if (state.modeRanged) {
                state.modeRanged = false;
                bot.hawkEye.stop();
                pasangSenjataTerbaik(bot); 
            }
        }

        // TAKTIK KHUSUS CREEPER: HIT & RUN
        if (targetName === 'creeper') {
            if (jarak < 3.2) {
                bot.lookAt(state.targetSerangan.position.offset(0, state.targetSerangan.height ?? 1, 0));
                
                bot.setControlState('jump', true);
                bot.setControlState('jump', false);
                setTimeout(() => {
                    if (state.targetSerangan && state.targetSerangan.isValid) bot.attack(state.targetSerangan);
                }, 300);

                try {
                    const vectorMundur = bot.entity.position.minus(state.targetSerangan.position).normalize().scaled(4);
                    const posMundur = bot.entity.position.plus(vectorMundur);
                    bot.pathfinder.setGoal(new goals.GoalNear(posMundur.x, posMundur.y, posMundur.z, 1));
                } catch (e) {}
            } else {
                bot.pathfinder.setGoal(new goals.GoalFollow(state.targetSerangan, 2.5), true);
            }
            return;
        }

        // MOB LAIN
        bot.pathfinder.setGoal(new goals.GoalFollow(state.targetSerangan, 2), true);

        if (jarak < 3.5) {
            bot.lookAt(state.targetSerangan.position.offset(0, state.targetSerangan.height ?? 1, 0));
            
            bot.setControlState('jump', true);
            bot.setControlState('jump', false);
            setTimeout(() => {
                if (state.targetSerangan && state.targetSerangan.isValid) bot.attack(state.targetSerangan);
            }, 300);
        }

        // Cek Darah Darurat saat Combat
        if (bot.health < 10 && !state.sedangMakan) {
            const makanan = bot.inventory.items().find(i => daftarMakanan.includes(i.name));
            if (makanan) {
                state.sedangMakan = true;
                try {
                    await bot.equip(makanan, 'hand');
                    await bot.consume();
                    await pasangSenjataTerbaik(bot);
                } catch (e) {}
                state.sedangMakan = false;
            }
        }
    }, 625); 
}

module.exports = {
    pasangSenjataTerbaik,
    mulaiSerang,
    berhentiSerang
};
