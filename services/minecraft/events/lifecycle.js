const { Movements, goals } = require('mineflayer-pathfinder');
const hawkeye = require('minecrafthawkeye').default;
const { state, clearAllIntervals } = require('../state');
const { CONFIG, hostileMobs, daftarMakanan, kamusBlok, CONFIG_RUMAH, isOwner } = require('../config');
const { mulaiSerang, berhentiSerang, pasangSenjataTerbaik } = require('../actions/combat');
const { amankanBarangKePeti, tebangPohonDanAmbil, mulaiNambang, bergerakAcak, isAreaAman } = require('../actions/work');
const { getSocket } = require('../../../utils/socket');
const { ID_OWNER } = require('../../../config/constants');
const axios = require('axios');

function setupLifecycleEvents(bot, createBotFn) {

    // --- AUTHME AUTO LOGIN / REGISTER ---
    bot.on('windowOpen', (window) => {
        try {
            let title = '';
            if (typeof window.title === 'string') {
                title = window.title.toLowerCase();
            } else if (window.title && typeof window.title === 'object') {
                title = JSON.stringify(window.title).toLowerCase();
            } else if (window.title) {
                title = String(window.title).toLowerCase();
            }

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
        } catch (err) {}
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

        movements.canDig = true;
        movements.canOpenDoors = true;
        movements.allowParkour = true;
        movements.allowSprinting = true;
        movements.allowEntityDetection = true;
        movements.allowFreeMotion = false; // PENTING: harus false agar pathfinder tidak bypass kalkulasi rute & lompatan
        movements.maxDropDown = 4;
        movements.jumpCost = 0;
        movements.scafoldingBlocks = [];

        bot.pathfinder.setMovements(movements);
        state.defaultMovements = movements;
        bot.waktuSpawn = Date.now();

        console.log(`[MC] Bot berhasil spawn di koordinat: ${bot.entity.position}`);
        console.log(`[INFO] Shiroko online di ${CONFIG.host}:${CONFIG.port}`);

        // --- DEBUG: Log pathfinding events ---
        bot.on('path_update', (r) => {
            console.log(`[PATH] status=${r.status} path_length=${r.path.length} ${r.status === 'noPath' ? 'GAGAL CARI JALUR!' : ''}`);
            if (r.path.length > 0) {
                const next = r.path[0];
                console.log(`[PATH] next_node: x=${next.x.toFixed(1)} y=${next.y.toFixed(1)} z=${next.z.toFixed(1)} toBreak=${next.toBreak.length} toPlace=${next.toPlace.length}`);
            }
        });
        bot.on('goal_reached', (goal) => {
            console.log(`[PATH] Goal reached!`);
        });

        // --- AUTO-STEP: Sustained multi-tick jump melewati rintangan 1 blok ---
        // Saat bot melompat, momentum maju (forward + sprint) HARUS dipertahankan di udara selama ~8 tick (400ms)
        // agar bot tidak jatuh kembali di blok yang sama.
        let isJumpingObstacle = false;
        let jumpObstacleTicks = 0;

        bot.on('physicsTick', () => {
            if (!bot.entity) return;

            // Jika sedang dalam fase melompat rintangan, pertahankan momentum maju di udara
            if (isJumpingObstacle) {
                jumpObstacleTicks++;
                bot.setControlState('forward', true);
                bot.setControlState('sprint', true);

                if (jumpObstacleTicks <= 4) {
                    bot.setControlState('jump', true);
                } else {
                    bot.setControlState('jump', false);
                }

                // Selesai jika sudah mendarat kembali di atas tebing atau melewati batas tick
                if ((jumpObstacleTicks > 4 && bot.entity.onGround) || jumpObstacleTicks > 10) {
                    isJumpingObstacle = false;
                    jumpObstacleTicks = 0;
                }
                return;
            }

            // Cek saat bot sedang jalan maju dan berada di tanah
            if (bot.entity.onGround && bot.getControlState('forward')) {
                const yaw = bot.entity.yaw;
                const dx = -Math.sin(yaw);
                const dz = -Math.cos(yaw);
                const feetPos = bot.entity.position;

                // Cek blok tepat di depan kaki (jarak 0.5 - 0.7 blok)
                const checkDistances = [0.5, 0.7];
                for (const dist of checkDistances) {
                    const blockAtFeet = bot.blockAt(feetPos.offset(dx * dist, 0, dz * dist));
                    const blockAboveFeet = bot.blockAt(feetPos.offset(dx * dist, 1, dz * dist));
                    const blockHeadroom = bot.blockAt(feetPos.offset(0, 2, 0));

                    // Ada blok solid di kaki, tapi atasnya kosong (bisa dipanjat) dan kepala aman
                    if (blockAtFeet && blockAtFeet.boundingBox === 'block' &&
                        (!blockAboveFeet || blockAboveFeet.boundingBox !== 'block') &&
                        (!blockHeadroom || blockHeadroom.boundingBox !== 'block')) {
                        isJumpingObstacle = true;
                        jumpObstacleTicks = 0;
                        bot.setControlState('jump', true);
                        bot.setControlState('forward', true);
                        bot.setControlState('sprint', true);
                        break;
                    }
                }
            }
        });
        if (state.unstuckInterval) clearInterval(state.unstuckInterval);
        let lastBotPos = null;
        let stuckCount = 0;

        state.unstuckInterval = setInterval(() => {
            if (!bot.entity || !bot.pathfinder) return;

            if (bot.pathfinder.isMoving() || bot.pathfinder.goal) {
                const currentPos = bot.entity.position;
                if (lastBotPos && currentPos.distanceTo(lastBotPos) < 0.15) {
                    stuckCount++;
                    // Nyangkut >= 3 detik: paksa lompat + maju, lalu recalculate path
                    if (stuckCount >= 3) {
                        console.log(`[MC] Anti-stuck: bot nyangkut di ${currentPos}, mencoba recovery...`);
                        // Simpan goal saat ini sebelum reset
                        const currentGoal = bot.pathfinder.goal;
                        const isDynamic = bot.pathfinder.dynamic;
                        // Reset path dulu agar pathfinder tidak fight dengan kita
                        bot.pathfinder.setGoal(null);
                        // Paksa gerak manual: lompat + maju
                        bot.setControlState('jump', true);
                        bot.setControlState('forward', true);
                        bot.setControlState('sprint', true);
                        setTimeout(() => {
                            bot.setControlState('jump', false);
                            bot.setControlState('forward', false);
                            bot.setControlState('sprint', false);
                            // Re-assign goal setelah gerak manual selesai, agar pathfinder recalculate dari posisi baru
                            if (currentGoal) {
                                bot.pathfinder.setGoal(currentGoal, isDynamic);
                            }
                        }, 600);
                        stuckCount = 0;
                    }
                } else {
                    stuckCount = 0;
                    lastBotPos = currentPos.clone();
                }
            } else {
                stuckCount = 0;
                lastBotPos = null;
            }
        }, 1000);

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
                const isNaughtyPlayer = e.type === 'player' && e.username && !isOwner(e.username);

                return isHostileMob || isNaughtyPlayer;
            });

            if (mobPenyerang) { 
                bot.pathfinder.setGoal(null); 
                mulaiSerang(bot, mobPenyerang); 
            }
        }
        // 2. JIKA SENSEI (OWNER) YANG DISERANG
        else if (entity.type === 'player' && entity.username && isOwner(entity.username)) {
            const pelaku = bot.nearestEntity(e => {
                if (!e.name && !e.username) return false;
                if (e === entity || e === bot.entity) return false; 
                
                const jarakKeSensei = e.position.distanceTo(entity.position);
                if (jarakKeSensei > 10) return false; 

                const isHostileMob = e.name && hostileMobs.includes(e.name.toLowerCase());
                const isNaughtyPlayer = e.type === 'player' && e.username && !isOwner(e.username);

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
                    await bot.pathfinder.goto(new goals.GoalGetToBlock(kasur.position.x, kasur.position.y, kasur.position.z));
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
