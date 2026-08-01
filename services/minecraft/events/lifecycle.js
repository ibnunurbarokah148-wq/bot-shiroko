const { Movements, goals } = require('mineflayer-pathfinder');
const hawkeye = require('minecrafthawkeye').default;
const { state, clearAllIntervals } = require('../state');
const { CONFIG, hostileMobs, daftarMakanan, kamusBlok, CONFIG_RUMAH } = require('../config');
const { mulaiSerang, berhentiSerang, pasangSenjataTerbaik } = require('../actions/combat');
const { amankanBarangKePeti, tebangPohonDanAmbil, mulaiNambang, bergerakAcak, isAreaAman } = require('../actions/work');
const { getSocket } = require('../../../utils/socket');
const { ID_OWNER } = require('../../../config/constants');
const axios = require('axios');

function setupLifecycleEvents(bot, createBotFn) {

    // --- AUTHME AUTO LOGIN / REGISTER ---
    bot.on('windowOpen', (window) => {
        const title = window.title ? window.title.toLowerCase() : '';
        if (title.includes('login') || title.includes('register') || title.includes('pin') || title.includes('auth')) {
            setTimeout(() => {
                try { bot.closeWindow(window); } catch(e){}
            }, 5000);
        } else {
            if (!bot.waktuSpawn) bot.waktuSpawn = Date.now();
            if (Date.now() - bot.waktuSpawn < 10000) {
                setTimeout(() => { try { bot.closeWindow(window); } catch(e){} }, 2000);
            }
        }
    });

    bot.on('message', (jsonMsg) => {
        const text = jsonMsg.toString().toLowerCase();
        const password = process.env.MC_AUTHME_PASSWORD;
        
        if (password) {
            if (text.includes('/reg ') || text.includes('/register') || text.includes('register')) {
                if (text.includes('password') || text.includes('pin') || text.includes('/reg')) {
                    setTimeout(() => { bot.chat(`/reg ${password} ${password}`); }, 1000);
                }
            } else if (text.includes('/login ') || text.includes('login')) {
                if (text.includes('password') || text.includes('pin') || text.includes('/login')) {
                    setTimeout(() => { bot.chat(`/login ${password}`); }, 1000);
                }
            }
        }

        // Cek hasil eksekusi perintah /locate (Pencarian Bangunan)
        if (state.sedangMencariLokasi && (text.includes('is at') || text.includes('ada di') || text.match(/\[-?\d+,\s*(?:~|-?\d+),\s*-?\d+\]/))) {
            const regex = /\[(-?\d+),\s*(~|-?\d+),\s*(-?\d+)\]/;
            const match = text.match(regex);
            
            if (match) {
                state.sedangMencariLokasi = false; 
                const x = parseInt(match[1]);
                const yRaw = match[2];
                const z = parseInt(match[3]);
                
                bot.chat(`Nn. Titik koordinat dikonfirmasi di X: ${x}, Z: ${z}. Bergerak menuju lokasi...`);
                state.modeMandiri = false;
                state.sedangKerja = false;
                
                try {
                    bot.pathfinder.setGoal(null);
                    if (yRaw === '~') {
                        bot.pathfinder.setGoal(new goals.GoalXZ(x, z));
                    } else {
                        const y = parseInt(yRaw);
                        bot.pathfinder.setGoal(new goals.GoalNear(x, y, z, 5));
                    }
                } catch (e) {}
            }
        }
    });

    bot.on('spawn', () => {
        bot.loadPlugin(hawkeye);
        const mcData = require('minecraft-data')(bot.version);
        const movements = new Movements(bot, mcData);

        movements.canDig = false;
        movements.canOpenDoors = true;

        if (mcData.itemsByName['dirt']) {
            movements.scafoldingBlocks = [mcData.itemsByName['dirt'].id];
        }

        bot.pathfinder.setMovements(movements);
        bot.waktuSpawn = Date.now();

        console.log(`[MC] Bot berhasil spawn di koordinat: ${bot.entity.position}`);
        console.log(`[INFO] Shiroko online di ${CONFIG.host}:${CONFIG.port}`);

        // --- RADAR AUTO-ATTACK ---
        if (state.radarInterval) clearInterval(state.radarInterval); 
        state.radarInterval = setInterval(() => {
            if (state.targetSerangan) return; 
            const musuhMendekat = bot.nearestEntity(e =>
                e.name && hostileMobs.includes(e.name.toLowerCase()) && e.position.distanceTo(bot.entity.position) < 8 
            );
            if (musuhMendekat) mulaiSerang(bot, musuhMendekat);
        }, 1000);

        // --- SISTEM OTAK MODE MANDIRI (AUTONOMOUS WORKER & PATROL) ---
        if (state.mandiriInterval) clearInterval(state.mandiriInterval); 
        state.mandiriInterval = setInterval(async () => {
            if (!state.modeMandiri || state.sedangKerja || state.targetSerangan || bot.isSleeping || state.sedangMencariKasur) return;

            // 1. Cek Tas Penuh -> Paksa Pulang
            if (bot.inventory.emptySlotCount() === 0) {
                await amankanBarangKePeti(bot);
                return;
            }

            // 2. Tentukan Aksi Berdasarkan Target
            if (state.fokusMandiri === 'bebas') {
                bergerakAcak(bot);
            } else if (state.fokusMandiri === 'kayu') {
                const pohon = bot.findBlock({
                    matching: b => b !== null && b.name && b.name.includes('log') && isAreaAman(b.position),
                    maxDistance: 32,
                    useExtraInfo: true 
                });
                if (pohon) {
                    state.sedangKerja = true;
                    tebangPohonDanAmbil(bot, pohon);
                } else {
                    bergerakAcak(bot);
                }
            } else {
                const dataBlok = mcData.blocksByName[kamusBlok[state.fokusMandiri]];
                if (dataBlok) {
                    const block = bot.findBlock({
                        matching: b => b !== null && b.type === dataBlok.id && isAreaAman(b.position),
                        maxDistance: 32,
                        useExtraInfo: true 
                    });
                    if (block) {
                        state.sedangKerja = true;
                        mulaiNambang(bot, dataBlok.id, kamusBlok[state.fokusMandiri]);
                    } else {
                        bergerakAcak(bot);
                    }
                }
            }
        }, 4000);

        if (state.afkInterval) clearInterval(state.afkInterval);
        state.afkInterval = setInterval(() => {
            if (!bot.pathfinder.isMoving() && !state.modeMandiri && !state.sedangKerja) {
                bot.setControlState('jump', true);
                setTimeout(() => bot.setControlState('jump', false), 200);
            }
        }, CONFIG.autoAfkInterval);
    });

    bot.on('entityHurt', (entity) => {
        // 1. JIKA BOT YANG DISERANG
        if (entity === bot.entity) {
            const mobPenyerang = bot.nearestEntity(e => {
                if (!e.name && !e.username) return false;
                const distance = e.position.distanceTo(bot.entity.position);
                if (distance > 16) return false;

                const isHostileMob = e.name && hostileMobs.includes(e.name.toLowerCase());
                const isNaughtyPlayer = e.type === 'player' && e.username && !CONFIG.owners.includes(e.username.toLowerCase());

                return isHostileMob || isNaughtyPlayer;
            });

            if (mobPenyerang) { 
                bot.pathfinder.setGoal(null); 
                mulaiSerang(bot, mobPenyerang); 
            }
        }
        // 2. JIKA SENSEI (OWNER) YANG DISERANG
        else if (entity.type === 'player' && entity.username && CONFIG.owners.includes(entity.username.toLowerCase())) {
            const pelaku = bot.nearestEntity(e => {
                if (!e.name && !e.username) return false;
                if (e === entity || e === bot.entity) return false; 
                
                const jarakKeSensei = e.position.distanceTo(entity.position);
                if (jarakKeSensei > 10) return false; 

                const isHostileMob = e.name && hostileMobs.includes(e.name.toLowerCase());
                const isNaughtyPlayer = e.type === 'player' && e.username && !CONFIG.owners.includes(e.username.toLowerCase());

                return isHostileMob || isNaughtyPlayer;
            });

            if (pelaku && state.targetSerangan !== pelaku) {
                bot.chat(`Nn. Beraninya kau melukai Sensei...`);
                bot.pathfinder.setGoal(null);
                mulaiSerang(bot, pelaku);
            }
        }
    });

    bot.on('health', async () => {
        if (bot.food >= 18 || state.sedangMakan) return;
        const makanan = bot.inventory.items().find(i => daftarMakanan.includes(i.name));
        if (!makanan) return;
        state.sedangMakan = true;
        try {
            const itemSebelumnya = bot.inventory.slots[bot.getEquipmentDestSlot('hand')];
            await bot.equip(makanan, 'hand');
            await bot.consume();
            if (itemSebelumnya) await bot.equip(itemSebelumnya, 'hand');
        } catch (err) { }
        state.sedangMakan = false;
    });

    bot.on('death', () => {
        console.log("[WARN] Shiroko gugur di Minecraft. Memproses respawn...");
        state.modeMandiri = false;
        state.sedangKerja = false;
        berhentiSerang(bot);

        try {
            const sock = getSocket();
            const idOwnerJid = ID_OWNER[0] + '@s.whatsapp.net';
            if (sock) {
                sock.sendMessage(idOwnerJid, {
                    text: `🚨 *LAPORAN MINECRAFT* 🚨\n\nNn... Shiroko gugur di medan perang (Minecraft). Otomatis melakukan respawn di titik awal.`
                }).catch(() => {});
            }
        } catch (e) {}

        setTimeout(() => {
            try {
                bot.respawn();
                bot.chat("Nn... Shiroko kembali dari titik respawn, Sensei.");
            } catch (err) {}
        }, 2500);
    });

    bot.on('error', err => console.error("[ERROR] Bot:", err.message));
    bot.on('kicked', reason => console.log("[WARN] Bot di-kick:", reason));
    
    bot.on('end', reason => {
        console.log(`[INFO] Koneksi terputus. Reconnect: ${state.autoReconnect}`);
        clearAllIntervals();
        
        if (state.autoReconnect) {
            setTimeout(() => {
                if (state.autoReconnect) {
                    // Start bot logic again
                    createBotFn();
                }
            }, CONFIG.reconnectDelay);
        }
    });

    let lastTimeCheck = 0;
    bot.on('time', async () => {
        const sekarangMS = Date.now();
        if (sekarangMS - lastTimeCheck < 5000) return;
        lastTimeCheck = sekarangMS;

        const waktu = bot.time.timeOfDay;
        const sudahMalam = waktu >= 12541 && waktu <= 23458;
        if (sudahMalam && !bot.isSleeping && !state.sedangMencariKasur) {
            state.modeMandiri = false;
            state.sedangKerja = false;
            try { bot.stopDigging(); } catch (e) { }
            state.sedangMencariKasur = true;
            const kasur = bot.findBlock({ matching: b => b.name.includes('bed'), maxDistance: 32 });
            if (kasur) {
                try {
                    bot.pathfinder.setGoal(null);
                    await bot.pathfinder.goto(new goals.GoalNear(kasur.position.x, kasur.position.y, kasur.position.z, 2));
                    await bot.sleep(kasur);
                    bot.chat("Nn. Sudah malam. Aku tidur dulu, Sensei.");
                } catch (err) { }
            } else {
                try {
                    bot.chat("Nn. Hari sudah malam dan banyak monster. Pulang ke rumah aman.");
                    bot.pathfinder.setGoal(new goals.GoalNear(CONFIG_RUMAH.petiX, CONFIG_RUMAH.petiY, CONFIG_RUMAH.petiZ, 3));
                } catch (e) {}
            }
            setTimeout(() => { state.sedangMencariKasur = false; }, 15000);
        }
    });

    bot.on('wake', () => { bot.chat("Nn. Pagi. Siap bekerja lagi."); });
}

module.exports = {
    setupLifecycleEvents
};
