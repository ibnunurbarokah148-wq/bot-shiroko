require('dotenv').config();
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const axios = require('axios');
const { Vec3 } = require('vec3');
const { getSocket } = require('./utils/socket');
const { ID_OWNER } = require('./config/constants');

// ============================================================
//  KONFIGURASI (Support Overrides via .env)
// ============================================================
const CONFIG = {
    host: process.env.MC_HOST || 'sgp-1.zknesia.app',
    port: parseInt(process.env.MC_PORT || '25675'),
    username: process.env.MC_USERNAME || 'Ritian223',
    version: process.env.MC_VERSION || '1.20.1',
    auth: process.env.MC_AUTH || 'offline',
    owners: process.env.MC_OWNERS ? process.env.MC_OWNERS.split(',').map(s => s.trim().toLowerCase()) : ['rukaajah'],
    reconnectDelay: 5000,
    aiCooldown: 3000,
    autoAfkInterval: 55000
};

// ============================================================
//  ZONA AMAN RUMAH (ANTI-HANCUR)
// ============================================================
const CONFIG_RUMAH = {
    petiX: 82,
    petiY: 72,
    petiZ: 37,
    radiusAman: 20 // Jarak aman (blok). Shiroko dilarang menambang di radius ini!
};

const kamusBlok = {
    "tanah": "dirt",
    "batu": "stone",
    "cobblestone": "cobblestone",
    "kayu": "oak_log",
    "pasir": "sand",
    "arang": "coal_ore",
    "besi": "iron_ore",
    "emas": "gold_ore",
    "berlian": "diamond_ore"
};

const daftarMakanan = [
    'apple', 'bread', 'cooked_beef', 'cooked_chicken',
    'cooked_porkchop', 'cooked_mutton', 'cooked_rabbit',
    'cooked_salmon', 'carrot', 'baked_potato', 'golden_apple'
];

const hostileMobs = [
    'zombie', 'zombie_villager', 'skeleton', 'creeper', 'spider', 'cave_spider',
    'enderman', 'witch', 'slime', 'phantom', 'drowned', 'husk', 'stray',
    'pillager', 'vindicator', 'evoker'
];

// Fungsi Helper untuk Cek Jarak Aman (Melindungi Rumah)
function isAreaAman(blockPos) {
    const posisiRumah = new Vec3(CONFIG_RUMAH.petiX, CONFIG_RUMAH.petiY, CONFIG_RUMAH.petiZ);
    return blockPos.distanceTo(posisiRumah) > CONFIG_RUMAH.radiusAman;
}

function createBot() {
    const bot = mineflayer.createBot({
        host: CONFIG.host,
        port: CONFIG.port,
        username: CONFIG.username,
        version: CONFIG.version,
        auth: CONFIG.auth
    });

    bot.loadPlugin(pathfinder);

    // --- State internal bot ---
    let mcData = null;
    let targetSerangan = null;
    let loopSerangan = null;
    let loopIkutJauh = null;
    let afkInterval = null;
    let radarInterval = null;
    let mandiriInterval = null;
    let modeMenghukum = false;
    let sudahChatHukum = false;
    let sedangMakan = false;
    let lastAiCall = 0;
    let sedangKerja = false;
    let sedangMencariKasur = false;

    // --- STATE MODE MANDIRI (AUTONOMOUS AFK) ---
    let modeMandiri = false;
    let fokusMandiri = null;

    bot.on('spawn', () => {
        mcData = require('minecraft-data')(bot.version);
        const movements = new Movements(bot, mcData);

        movements.canDig = false;
        movements.canOpenDoors = true;

        if (mcData.itemsByName['dirt']) {
            movements.scafoldingBlocks = [mcData.itemsByName['dirt'].id];
        }

        bot.pathfinder.setMovements(movements);
        console.log(`[INFO] Shiroko online di ${CONFIG.host}:${CONFIG.port}`);

        // --- RADAR AUTO-ATTACK ---
        if (radarInterval) clearInterval(radarInterval); // Hapus otak lama jika ada
        radarInterval = setInterval(() => {
            if (targetSerangan) return; 
            const musuhMendekat = bot.nearestEntity(e =>
                e.name && hostileMobs.includes(e.name.toLowerCase()) && e.position.distanceTo(bot.entity.position) < 8 
            );
            if (musuhMendekat) mulaiSerang(musuhMendekat);
        }, 1000);

        // --- SISTEM OTAK MODE MANDIRI (AUTONOMOUS WORKER & PATROL) ---
        if (mandiriInterval) clearInterval(mandiriInterval); // Hapus otak lama jika ada
        mandiriInterval = setInterval(async () => {
            if (!modeMandiri || sedangKerja || targetSerangan || bot.isSleeping || sedangMencariKasur) return;

            // 1. Cek Tas Penuh -> Paksa Pulang
            if (bot.inventory.emptySlotCount() === 0) {
                await amankanBarangKePeti();
                return;
            }

            // 2. Tentukan Aksi Berdasarkan Target
            if (fokusMandiri === 'bebas') {
                // Mode Bebas: Hanya jalan-jalan patroli, bunuh monster, dll.
                bergerakAcak();
            } else if (fokusMandiri === 'kayu') {
                // Cari kayu dengan filter Zona Aman
                const pohon = bot.findBlock({
                    matching: b => b !== null && b.name && b.name.includes('log') && isAreaAman(b.position),
                    maxDistance: 32,
                    useExtraInfo: true // Minta data lokasi lengkap
                });
                if (pohon) {
                    sedangKerja = true;
                    tebangPohonDanAmbil(pohon);
                } else {
                    bergerakAcak();
                }
            } else {
                // Cari batu/besi dengan filter Zona Aman
                const dataBlok = mcData.blocksByName[kamusBlok[fokusMandiri]];
                if (dataBlok) {
                    const block = bot.findBlock({
                        matching: b => b !== null && b.type === dataBlok.id && isAreaAman(b.position),
                        maxDistance: 32,
                        useExtraInfo: true // Minta data lokasi lengkap
                    });
                    if (block) {
                        sedangKerja = true;
                        mulaiNambang(dataBlok.id, kamusBlok[fokusMandiri]);
                    } else {
                        bergerakAcak();
                    }
                }
            }
        }, 4000);

        if (afkInterval) clearInterval(afkInterval);
        afkInterval = setInterval(() => {
            if (!bot.pathfinder.isMoving() && !modeMandiri && !sedangKerja) {
                bot.setControlState('jump', true);
                setTimeout(() => bot.setControlState('jump', false), 200);
            }
        }, CONFIG.autoAfkInterval);
    });

    bot.on('chat', async (username, message) => {
        if (username === bot.username || !CONFIG.owners.includes(username)) return;
        const pk = message.toLowerCase();

        // ----------------------------------------------------------
        //  1. MODE MANDIRI (AUTO AFK)
        // ----------------------------------------------------------
        if (pk.startsWith('mode mandiri')) {
            const arg = pk.replace('mode mandiri', '').trim();

            if (arg === 'mati' || arg === 'off' || arg === 'berhenti') {
                modeMandiri = false;
                sedangKerja = false;
                bot.pathfinder.setGoal(null);
                bot.chat("Nn. Mode mandiri dimatikan. Aku akan standby di sini, Sensei.");
                return;
            }

            if (arg === '') {
                modeMandiri = true;
                fokusMandiri = 'bebas';
                bot.chat("Nn. Mode mandiri diaktifkan. Aku akan berpatroli bebas menjaga area sekitarmu, Sensei.");
                return;
            }

            if (kamusBlok[arg]) {
                modeMandiri = true;
                fokusMandiri = arg;
                bot.chat(`Nn. Mode mandiri diaktifkan. Mencari dan menambang [${arg}] tanpa menyentuh area aman rumah.`);
            } else {
                bot.chat("Nn. Perintah tidak valid. (Contoh: 'mode mandiri', 'mode mandiri kayu', atau 'mode mandiri mati')");
            }
            return;
        }

        // ----------------------------------------------------------
        //  2. FITUR BANTUAN (!help)
        // ----------------------------------------------------------
        if (pk === '!help' || pk === 'bantuan' || pk === 'fitur') {
            bot.chat("Nn. Pergerakan: ikut, berhenti, masuk, terobos, buka/tutup pintu.");
            await bot.waitForTicks(20);
            bot.chat("Nn. Kerja Manual: tebang, nambang [blok], rampok, simpan, buang [item/semua].");
            await bot.waitForTicks(20);
            bot.chat("Nn. Status & Combat: status, inv, makan, tidur, serang [target], maaf.");
            await bot.waitForTicks(20);
            bot.chat("Nn. AFK: mode mandiri, mode mandiri [batu/kayu], mode mandiri mati.");
            return;
        }

        // ----------------------------------------------------------
        //  3. MAAF
        // ----------------------------------------------------------
        if (pk.includes('maaf')) {
            bot.chat("Nn. Dimaafkan. Lain kali jangan diulangi, Sensei.");
            berhentiSerang();
            return;
        }

        // ----------------------------------------------------------
        //  4. IKUT
        // ----------------------------------------------------------
        if (pk.includes('ikut')) {
            modeMandiri = false; sedangKerja = false; try { bot.stopDigging(); } catch (e) { }
            if (loopIkutJauh) { clearInterval(loopIkutJauh); loopIkutJauh = null; }
            const namaSesuai = Object.keys(bot.players).find(name => name.toLowerCase().includes(username.toLowerCase()));
            const playerTarget = namaSesuai ? bot.players[namaSesuai] : null;

            if (playerTarget && playerTarget.entity) {
                bot.chat("Nn. Mengikutimu, Sensei.");
                bot.pathfinder.setGoal(new goals.GoalFollow(playerTarget.entity, 2), true);
            } else {
                bot.chat("Nn. Terlalu jauh. Menunggumu mendekat, Sensei.");
            }
            return;
        }

        // ----------------------------------------------------------
        //  5. MASUK / KE SINI
        // ----------------------------------------------------------
        if (pk.includes('masuk') || pk.includes('ke sini') || pk.includes('kesini')) {
            modeMandiri = false; sedangKerja = false; try { bot.stopDigging(); } catch (e) { }
            if (loopIkutJauh) { clearInterval(loopIkutJauh); loopIkutJauh = null; }
            bot.pathfinder.setGoal(null);
            const namaSesuai = Object.keys(bot.players).find(name => name.toLowerCase().includes(username.toLowerCase()));
            const playerTarget = namaSesuai ? bot.players[namaSesuai] : null;

            if (playerTarget && playerTarget.entity) {
                bot.chat("Nn. Mencari rute masuk.");
                bot.pathfinder.setGoal(new goals.GoalNear(playerTarget.entity.position.x, playerTarget.entity.position.y, playerTarget.entity.position.z, 1));
            } else {
                bot.chat("Nn. Aku tidak melihat posisimu dari sini, Sensei.");
            }
            return;
        }

        // ----------------------------------------------------------
        //  6. TUTUP PINTU
        // ----------------------------------------------------------
        if (pk.includes('tutup pintu')) {
            const pintu = bot.findBlock({ matching: b => b.name.includes('door') || b.name.includes('gate'), maxDistance: 4 });
            if (pintu) {
                try {
                    await bot.activateBlock(pintu);
                    bot.chat("Nn. Pintu sudah kututup.");
                } catch (err) { bot.chat("Nn. Aku tidak bisa menjangkau pintunya."); }
            } else { bot.chat("Nn. Tidak ada pintu di dekatku."); }
            return;
        }

        // ----------------------------------------------------------
        //  7. BUKA PINTU
        // ----------------------------------------------------------
        if (pk.includes('buka pintu')) {
            const pintu = bot.findBlock({ matching: b => b.name.includes('door') || b.name.includes('gate'), maxDistance: 4 });
            if (pintu) {
                try {
                    await bot.activateBlock(pintu);
                    bot.chat("Nn. Pintu kubuka.");
                } catch (err) { bot.chat("Nn. Pintunya tidak terjangkau."); }
            } else { bot.chat("Nn. Tidak ada pintu di dekatku."); }
            return;
        }

        // ----------------------------------------------------------
        //  8. TEROBOS
        // ----------------------------------------------------------
        if (pk.includes('terobos') || pk.includes('maju') || pk.includes('sini')) {
            modeMandiri = false; sedangKerja = false; try { bot.stopDigging(); } catch (e) { }
            bot.pathfinder.setGoal(null);
            const namaSesuai = Object.keys(bot.players).find(name => name.toLowerCase().includes(username.toLowerCase()));
            const playerTarget = namaSesuai ? bot.players[namaSesuai] : null;

            if (playerTarget && playerTarget.entity) {
                bot.chat("Nn. Siap untuk memeluk... maksudku menuju kamu.");
                bot.lookAt(playerTarget.entity.position.offset(0, 1.6, 0), true);
            } else {
                bot.chat("Nn. Menerobos lurus.");
            }
            bot.setControlState('forward', true);
            setTimeout(() => {
                bot.setControlState('forward', false);
                bot.chat("Nn. Area aman.");
            }, 1500);
            return;
        }

        // ----------------------------------------------------------
        //  9. BERHENTI
        // ----------------------------------------------------------
        if (pk.includes('berhenti') || pk.includes('tunggu')) {
            modeMandiri = false;
            sedangKerja = false;
            berhentiSerang();
            try { bot.stopDigging(); } catch (err) { }
            if (loopIkutJauh) { clearInterval(loopIkutJauh); loopIkutJauh = null; }
            bot.pathfinder.setGoal(null);
            bot.chat("Nn. Aku berhenti.");
            return;
        }

        // ----------------------------------------------------------
        //  10. TEBANG MANUAL
        // ----------------------------------------------------------
        if (pk.includes('tebang')) {
            const pohon = bot.findBlock({ matching: b => b !== null && b.name && b.name.includes('log') && isAreaAman(b.position), maxDistance: 32, useExtraInfo: true });
            if (pohon) {
                sedangKerja = true;
                bot.chat("Nn. Mengerti. Menebang pohon.");
                tebangPohonDanAmbil(pohon);
            } else {
                bot.chat("Nn. Tidak ada pohon di luar zona aman rumah.");
            }
            return;
        }

        // ----------------------------------------------------------
        //  11. NAMBANG MANUAL
        // ----------------------------------------------------------
        if (pk.includes('nambang') || pk.includes('hancurkan') || pk.includes('tambang')) {
            const kataKunci = Object.keys(kamusBlok).find(k => pk.includes(k));
            if (!kataKunci) {
                bot.chat("Nn. Mau tambang apa, Sensei? (contoh: 'tambang batu')");
                return;
            }
            const blockData = mcData.blocksByName[kamusBlok[kataKunci]];
            if (!blockData) return;

            const blockToMine = bot.findBlock({ matching: b => b !== null && b.type === blockData.id && isAreaAman(b.position), maxDistance: 32, useExtraInfo: true });
            if (blockToMine) {
                sedangKerja = true;
                bot.chat(`Nn. Mengerti. Menambang ${kataKunci}.`);
                mulaiNambang(blockData.id, kamusBlok[kataKunci]);
            } else {
                bot.chat(`Nn. Tidak kutemukan ${kataKunci} di luar zona aman.`);
            }
            return;
        }

        // ----------------------------------------------------------
        //  12. RAMPOK / AMBIL
        // ----------------------------------------------------------
        if (pk.includes('rampok') || pk.includes('ambil')) {
            const item = bot.nearestEntity(e => e.name === 'item' && e.position && e.position.distanceTo(bot.entity.position) < 30);
            if (item) {
                bot.chat("Nn. Mengambil jarahan.");
                bot.pathfinder.setGoal(new goals.GoalGetToBlock(Math.floor(item.position.x), Math.floor(item.position.y), Math.floor(item.position.z)));
            } else { bot.chat("Nn. Tidak ada item di sekitar sini."); }
            return;
        }

        // ----------------------------------------------------------
        //  13. STATUS
        // ----------------------------------------------------------
        if (pk.includes('status')) {
            const items = bot.inventory.items().map(i => `${i.name}x${i.count}`).join(', ') || 'kosong';
            bot.chat(`Nn. HP: ${Math.round(bot.health)}. Inv: ${items}`);
            return;
        }

        // ----------------------------------------------------------
        //  14. INVENTARIS
        // ----------------------------------------------------------
        if (pk.includes('inv') || pk.includes('inventaris')) {
            const items = bot.inventory.items();
            if (items.length === 0) {
                bot.chat("Nn. Inventory kosong. Belum ada yang dirampok.");
            } else {
                bot.chat(`Nn. Jarahan: ${items.map(i => `${i.name}x${i.count}`).join(', ')}`);
            }
            return;
        }

        // ----------------------------------------------------------
        //  15. BUANG
        // ----------------------------------------------------------
        if (pk.includes('buang')) {
            const argumen = pk.replace('buang', '').trim();
            if (argumen === '') {
                bot.chat("Nn. Mau buang apa, Sensei? (contoh: 'buang kayu' atau 'buang semua')");
                return;
            }
            if (argumen === 'semua') {
                const isiInv = bot.inventory.items();
                if (isiInv.length === 0) { bot.chat("Nn. Inventoryku sudah kosong."); return; }
                bot.chat("Nn. Membuang semua barang...");
                for (const item of isiInv) {
                    try { await bot.tossStack(item); await bot.waitForTicks(5); } catch (e) { }
                }
                bot.chat("Nn. Inventory bersih.");
                return;
            }
            const kamusBuang = { "kayu": "log", "pedang": "sword", "batu": "cobblestone", "tanah": "dirt", "pasir": "sand", "daging": "beef", "ayam": "chicken", "roti": "bread", "apel": "apple" };
            const kataPencarian = kamusBuang[argumen] || argumen;
            const itemDitemukan = bot.inventory.items().find(i => i.name.toLowerCase().includes(kataPencarian.toLowerCase()));
            if (itemDitemukan) {
                try {
                    await bot.tossStack(itemDitemukan);
                    bot.chat(`Nn. Sudah kubuang ${itemDitemukan.name}.`);
                } catch (err) { bot.chat("Nn. Gagal membuang item."); }
            } else { bot.chat(`Nn. Tidak ada '${argumen}' di inventoryku, Sensei.`); }
            return;
        }

        // ----------------------------------------------------------
        //  16. SIMPAN / TARUH
        // ----------------------------------------------------------
        if (pk.includes('simpan') || pk.includes('taruh') || pk.includes('masukin')) {
            amankanBarangKePeti();
            return;
        }

        // ----------------------------------------------------------
        //  17. MAKAN
        // ----------------------------------------------------------
        if (pk.includes('makan')) {
            const makanan = bot.inventory.items().find(i => daftarMakanan.includes(i.name));
            if (makanan) {
                try {
                    await bot.equip(makanan, 'hand');
                    await bot.consume();
                    bot.chat("Nn. Makan.");
                } catch (err) { bot.chat("Nn. Tidak bisa makan sekarang."); }
            } else { bot.chat("Nn. Tidak ada makanan di inventoryku."); }
            return;
        }

        // ----------------------------------------------------------
        //  18. SERANG
        // ----------------------------------------------------------
        if (pk.includes('serang')) {
            const kata = pk.split(' ');
            const idxSerang = kata.indexOf('serang');
            const namaTarget = kata[idxSerang + 1];

            if (namaTarget) {
                const targetPlayer = bot.nearestEntity(e => e.type === 'player' && e.username && e.username.toLowerCase().includes(namaTarget) && e.position.distanceTo(bot.entity.position) < 50);
                if (targetPlayer) {
                    bot.chat(`Nn. Menyerang ${targetPlayer.username}.`);
                    mulaiSerang(targetPlayer);
                    return;
                }
            }
            const musuh = bot.nearestEntity(e => e.name && hostileMobs.includes(e.name.toLowerCase()) && e.position.distanceTo(bot.entity.position) < 30);
            if (musuh) {
                bot.chat("Nn. Target dieliminasi.");
                mulaiSerang(musuh);
            } else { bot.chat("Nn. Tidak ada target yang bisa diserang."); }
            return;
        }

        // ----------------------------------------------------------
        //  19. TIDUR
        // ----------------------------------------------------------
        if (pk.includes('tidur')) {
            const kasur = bot.findBlock({ matching: b => b.name.includes('bed'), maxDistance: 32 });
            if (kasur) {
                bot.chat("Nn. Menuju kasur.");
                try {
                    bot.pathfinder.setGoal(null);
                    await bot.pathfinder.goto(new goals.GoalGetToBlock(kasur.position.x, kasur.position.y, kasur.position.z));
                    await bot.sleep(kasur);
                } catch (e) { bot.chat("Nn. Tidak bisa tidur sekarang. Kasur terhalang atau ini masih siang."); }
            } else { bot.chat("Nn. Tidak ada kasur di sekitarku, Sensei."); }
            return;
        }

        // ==========================================================
        //  AI RESPONS (FALLBACK JIKA BUKAN PERINTAH) - ARISUSOFT DEEPSEEK V3
        // ==========================================================
        const sekarang = Date.now();
        if (sekarang - lastAiCall < CONFIG.aiCooldown) return;
        lastAiCall = sekarang;

        try {
            const arisuKey = process.env.ARISU_API_KEY;
            if (!arisuKey) return;

            const res = await axios.post('https://api.arisusoft.com/api/v2/llm/deepseek-v3', {
                message: message,
                system_prompt: "Kamu adalah Sunaookami Shiroko dari Blue Archive. Tenang, datar, analitis, suka merampok. Panggil pemain 'Sensei'. Jawab sangat singkat 1 kalimat saja."
            }, {
                headers: {
                    'Authorization': `Bearer ${arisuKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            });

            if (res.data && res.data.success && res.data.data?.message) {
                const aiReply = res.data.data.message.trim();
                if (aiReply) bot.chat(aiReply);
            }
        } catch (err) {
            // Error diabaikan agar bot Minecraft tetap berjalan tanpa gangguan
        }
    });

    bot.on('entityHurt', (entity) => {
        if (entity !== bot.entity) return;
        const mobPenyerang = bot.nearestEntity(e => e.name && hostileMobs.includes(e.name.toLowerCase()) && e.position.distanceTo(bot.entity.position) < 16);
        if (mobPenyerang) { bot.pathfinder.setGoal(null); mulaiSerang(mobPenyerang); }
    });

    const urutanPedang = [
        'netherite_sword', 'diamond_sword', 'iron_sword', 
        'golden_sword', 'stone_sword', 'wooden_sword',
        'netherite_axe', 'diamond_axe', 'iron_axe', 'stone_axe'
    ];

    async function pasangSenjataTerbaik() {
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

    function mulaiSerang(target) {
        targetSerangan = target;
        if (loopSerangan) clearInterval(loopSerangan);

        pasangSenjataTerbaik();

        loopSerangan = setInterval(async () => {
            if (!targetSerangan || !targetSerangan.isValid || (targetSerangan.health && targetSerangan.health <= 0)) {
                bot.chat("Nn. Ancaman berhasil dieliminasi.");
                return berhentiSerang();
            }

            const targetName = (targetSerangan.name || '').toLowerCase();
            const jarak = bot.entity.position.distanceTo(targetSerangan.position);

            // TAKTIK KHUSUS CREEPER: HIT & RUN (Mundur agar tidak meledak di muka Shiroko)
            if (targetName === 'creeper') {
                if (jarak < 3.2) {
                    bot.lookAt(targetSerangan.position.offset(0, targetSerangan.height ?? 1, 0));
                    bot.attack(targetSerangan);

                    // Mundur 4 blok ke belakang setelah memukul creeper
                    try {
                        const vectorMundur = bot.entity.position.minus(targetSerangan.position).normalize().scaled(4);
                        const posMundur = bot.entity.position.plus(vectorMundur);
                        bot.pathfinder.setGoal(new goals.GoalNear(posMundur.x, posMundur.y, posMundur.z, 1));
                    } catch (e) {}
                } else {
                    bot.pathfinder.setGoal(new goals.GoalFollow(targetSerangan, 2.5), true);
                }
                return;
            }

            // MOB LAIN (Zombie, Skeleton, Spider, dll)
            bot.pathfinder.setGoal(new goals.GoalFollow(targetSerangan, 2), true);

            if (jarak < 3.5) {
                bot.lookAt(targetSerangan.position.offset(0, targetSerangan.height ?? 1, 0));
                bot.attack(targetSerangan);
            }

            // Cek Darah Darurat saat Combat
            if (bot.health < 10 && !sedangMakan) {
                const makanan = bot.inventory.items().find(i => daftarMakanan.includes(i.name));
                if (makanan) {
                    sedangMakan = true;
                    try {
                        await bot.equip(makanan, 'hand');
                        await bot.consume();
                        await pasangSenjataTerbaik();
                    } catch (e) {}
                    sedangMakan = false;
                }
            }
        }, 625); // Interval 625ms sesuai Cooldown Ayunan Pedang Minecraft 1.9+
    }

    function berhentiSerang() {
        if (loopSerangan) clearInterval(loopSerangan);
        loopSerangan = null; targetSerangan = null; bot.pathfinder.setGoal(null);
    }

    bot.on('health', async () => {
        if (bot.food >= 18 || sedangMakan) return;
        const makanan = bot.inventory.items().find(i => daftarMakanan.includes(i.name));
        if (!makanan) return;
        sedangMakan = true;
        try {
            const itemSebelumnya = bot.inventory.slots[bot.getEquipmentDestSlot('hand')];
            await bot.equip(makanan, 'hand');
            await bot.consume();
            if (itemSebelumnya) await bot.equip(itemSebelumnya, 'hand');
        } catch (err) { }
        sedangMakan = false;
    });

    async function amankanBarangKePeti() {
        if (!sedangKerja) sedangKerja = true;
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
        sedangKerja = false;
    }

    async function bergerakAcak() {
        sedangKerja = true;
        try {
            const x = bot.entity.position.x + (Math.random() * 20 - 10);
            const z = bot.entity.position.z + (Math.random() * 20 - 10);
            bot.pathfinder.setGoal(new goals.GoalNear(x, bot.entity.position.y, z, 2));
            await bot.waitForTicks(60);
        } catch (e) { }
        sedangKerja = false;
    }

    async function tebangPohonDanAmbil(blockAwal) {
        try {
            let pohon = blockAwal;
            while (pohon && sedangKerja) {
                if (bot.inventory.emptySlotCount() === 0) break;

                // 1. JALAN DULU (Gunakan GoalNear agar bot tidak memanjat pohon)
                await bot.pathfinder.goto(new goals.GoalNear(pohon.position.x, pohon.position.y, pohon.position.z, 1.5));
                if (!sedangKerja) break;

                // 2. SETELAH SAMPAI, BARU PEGANG KAPAK (Mencegah nebang pakai tanah)
                const itemDiTangan = bot.inventory.slots[bot.getEquipmentDestSlot('hand')];
                if (!itemDiTangan || !itemDiTangan.name.includes('axe')) {
                    const kapak = bot.inventory.items().find(i => i.name.includes('axe'));
                    if (kapak) await bot.equip(kapak, 'hand');
                }

                // 3. TEBANG
                await bot.dig(pohon);
                await bot.waitForTicks(5);

                pohon = bot.findBlock({
                    matching: b => b !== null && b.name && b.name.includes('log') && isAreaAman(b.position),
                    maxDistance: 12,
                    useExtraInfo: true
                });
            }
            sedangKerja = false;
        } catch (err) {
            sedangKerja = false;
        }
    }

    async function mulaiNambang(blockId, namaBlok) {
        try {
            const urutanPickaxe = ['netherite_pickaxe', 'diamond_pickaxe', 'iron_pickaxe', 'golden_pickaxe', 'stone_pickaxe', 'wooden_pickaxe'];
            let block = bot.findBlock({
                matching: b => b !== null && b.type === blockId && isAreaAman(b.position),
                maxDistance: 32,
                useExtraInfo: true
            });

            while (block && sedangKerja) {
                if (bot.inventory.emptySlotCount() === 0) break;

                // 1. JALAN DULU (Mendekat saja ke target)
                await bot.pathfinder.goto(new goals.GoalNear(block.position.x, block.position.y, block.position.z, 1.5));
                if (!sedangKerja) break;

                // 2. SETELAH SAMPAI, BARU PEGANG BELIUNG
                const itemDiTangan = bot.inventory.slots[bot.getEquipmentDestSlot('hand')];
                if (!itemDiTangan || !itemDiTangan.name.includes('pickaxe')) {
                    let adaPickaxe = false;
                    for (const namaPickaxe of urutanPickaxe) {
                        const pickaxe = bot.inventory.items().find(i => i.name === namaPickaxe);
                        if (pickaxe) { await bot.equip(pickaxe, 'hand'); adaPickaxe = true; break; }
                    }
                    if (!adaPickaxe) {
                        bot.chat("Nn. Beliungku habis atau hancur. Menghentikan aktivitas tambang.");
                        modeMandiri = false;
                        break;
                    }
                }

                // 3. HANCURKAN BLOK
                await bot.dig(block);
                await bot.waitForTicks(5);

                block = bot.findBlock({
                    matching: b => b !== null && b.type === blockId && isAreaAman(b.position),
                    maxDistance: 32,
                    useExtraInfo: true
                });
            }
            sedangKerja = false;
        } catch (err) {
            sedangKerja = false;
        }
    }

    // ----------------------------------------------------------
    // EVENT: MATI (AUTO RESPAWN & NOTIFIKASI WA OWNER)
    // ----------------------------------------------------------
    bot.on('death', () => {
        console.log("[WARN] Shiroko gugur di Minecraft. Memproses respawn...");
        modeMandiri = false;
        sedangKerja = false;
        berhentiSerang();

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
        console.log(`[INFO] Koneksi terputus. Reconnect...`);
        if (afkInterval) clearInterval(afkInterval);
        if (radarInterval) clearInterval(radarInterval);
        if (mandiriInterval) clearInterval(mandiriInterval);
        if (loopSerangan) clearInterval(loopSerangan);
        
        setTimeout(createBot, CONFIG.reconnectDelay);
    });

    let lastTimeCheck = 0;

    bot.on('time', async () => {
        const sekarangMS = Date.now();
        if (sekarangMS - lastTimeCheck < 5000) return;
        lastTimeCheck = sekarangMS;

        const waktu = bot.time.timeOfDay;
        const sudahMalam = waktu >= 12541 && waktu <= 23458;
        if (sudahMalam && !bot.isSleeping && !sedangMencariKasur) {
            modeMandiri = false;
            sedangKerja = false;
            try { bot.stopDigging(); } catch (e) { }
            sedangMencariKasur = true;
            const kasur = bot.findBlock({ matching: b => b.name.includes('bed'), maxDistance: 32 });
            if (kasur) {
                try {
                    bot.pathfinder.setGoal(null);
                    await bot.pathfinder.goto(new goals.GoalGetToBlock(kasur.position.x, kasur.position.y, kasur.position.z));
                    await bot.sleep(kasur);
                    bot.chat("Nn. Sudah malam. Aku tidur dulu, Sensei.");
                } catch (err) { }
            } else {
                // Jika tidak ada kasur terdekat, pulang ke zona aman rumah
                try {
                    bot.chat("Nn. Hari sudah malam dan banyak monster. Pulang ke rumah aman.");
                    bot.pathfinder.setGoal(new goals.GoalNear(CONFIG_RUMAH.petiX, CONFIG_RUMAH.petiY, CONFIG_RUMAH.petiZ, 3));
                } catch (e) {}
            }
            setTimeout(() => { sedangMencariKasur = false; }, 15000);
        }
    });

    bot.on('wake', () => { bot.chat("Nn. Pagi. Siap bekerja lagi."); });
    return bot;
}

let activeMcBot = createBot();

function getMinecraftBot() {
    return activeMcBot;
}

function getMinecraftStatus() {
    if (!activeMcBot || !activeMcBot.entity) {
        return { online: false };
    }
    const pos = activeMcBot.entity.position;
    const items = activeMcBot.inventory.items().map(i => `${i.name} x${i.count}`).join(', ') || 'Kosong';
    return {
        online: true,
        username: activeMcBot.username,
        health: Math.round(activeMcBot.health),
        food: Math.round(activeMcBot.food),
        position: { x: Math.round(pos.x), y: Math.round(pos.y), z: Math.round(pos.z) },
        inventory: items
    };
}

module.exports = {
    createBot,
    getMinecraftBot,
    getMinecraftStatus
};