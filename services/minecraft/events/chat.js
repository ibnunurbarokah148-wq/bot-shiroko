const { goals } = require('mineflayer-pathfinder');
const AIProvider = require('../../ai/AIProvider');
const { getShirokoSystemPrompt } = require('../../ai/prompts');
const { state } = require('../state');
const { CONFIG, kamusBlok, daftarMakanan, hostileMobs, isOwner } = require('../config');
const { mulaiSerang, berhentiSerang } = require('../actions/combat');
const { amankanBarangKePeti, tebangPohonDanAmbil, mulaiNambang, isAreaAman } = require('../actions/work');
const { ID_OWNER } = require('../../../config/constants');
const globalState = require('../../../config/state');

async function handleChat(bot, username, message, mcData) {
    if (!username || username === bot.username || !isOwner(username)) return;
    const pk = message.toLowerCase();

    // 1. MODE MANDIRI (AUTO AFK)
    if (pk.startsWith('mode mandiri')) {
        const arg = pk.replace('mode mandiri', '').trim();

        if (arg === 'mati' || arg === 'off' || arg === 'berhenti') {
            state.modeMandiri = false;
            state.sedangKerja = false;
            bot.pathfinder.setGoal(null);
            bot.chat("Nn. Mode mandiri dimatikan. Aku akan standby di sini, Sensei.");
            return;
        }

        if (arg === '') {
            state.modeMandiri = true;
            state.fokusMandiri = 'bebas';
            bot.chat("Nn. Mode mandiri diaktifkan. Aku akan berpatroli bebas menjaga area sekitarmu, Sensei.");
            return;
        }

        if (kamusBlok[arg]) {
            state.modeMandiri = true;
            state.fokusMandiri = arg;
            bot.chat(`Nn. Mode mandiri diaktifkan. Mencari dan menambang [${arg}] tanpa menyentuh area aman rumah.`);
        } else {
            bot.chat("Nn. Perintah tidak valid. (Contoh: 'mode mandiri', 'mode mandiri kayu', atau 'mode mandiri mati')");
        }
        return;
    }

    // 2. FITUR PENCARI BANGUNAN
    if (pk.startsWith('cari ')) {
        const bangunan = pk.replace('cari ', '').trim();
        bot.chat(`Nn. Memulai pemindaian radar satelit untuk mencari [${bangunan}]...`);
        state.sedangMencariLokasi = true;
        
        bot.chat(`/locate structure ${bangunan}`);
        
        setTimeout(() => {
            if (state.sedangMencariLokasi) {
                state.sedangMencariLokasi = false;
                bot.chat("Nn. Pemindaian gagal. Struktur tidak ditemukan, atau aku butuh akses Admin. Berikan aku OP (/op Shiroko) di konsol server, Sensei.");
            }
        }, 5000);
        return;
    }

    // 3. FITUR BANTUAN
    if (pk === '!help' || pk === 'bantuan' || pk === 'fitur') {
        bot.chat("Nn. Pergerakan: ikut, cari [bangunan], berhenti, masuk, terobos, buka/tutup pintu.");
        await bot.waitForTicks(20);
        bot.chat("Nn. Kerja: tebang, nambang [blok], rampok, simpan, buang [item/semua].");
        await bot.waitForTicks(20);
        bot.chat("Nn. Status & AI: status, inv, aimode [opsi], makan, tidur, serang [target], maaf.");
        await bot.waitForTicks(20);
        bot.chat("Nn. AFK: mode mandiri, mode mandiri [batu/kayu], mode mandiri mati.");
        return;
    }

    // AIMODE (CEK ATAU GANTI MODEL AI IN-GAME)
    if (pk.startsWith('aimode') || pk.startsWith('!aimode')) {
        const targetMode = pk.replace(/^!?aimode\s*/i, '').trim();
        const ownerId = Array.isArray(ID_OWNER) ? ID_OWNER[0] : ID_OWNER;
        if (!targetMode) {
            const currentMode = state.mcAiMode || (globalState.userAiMode ? (globalState.userAiMode[ownerId] || (Array.isArray(ID_OWNER) && globalState.userAiMode[ID_OWNER[1]])) : null) || 'arisu-gemini';
            const { provider, model } = AIProvider.resolveMode(currentMode, ownerId);
            bot.chat(`Nn. Mode AI aktif: [${currentMode}] (${provider}/${model}).`);
            bot.chat("Opsi: ds3, ds4, glm, qwen, arisu-gemini, gemini, cf, or, ollama, gpt, grok");
            return;
        }

        const validModes = ['gemini', 'ollama', 'openrouter', 'or', 'cloudflare', 'cf', 'ds3', 'ds4', 'glm', 'qwen', 'arisu-gemini', 'gpt', 'grok'];
        if (validModes.includes(targetMode)) {
            state.mcAiMode = targetMode;
            const { provider, model } = AIProvider.resolveMode(targetMode, ownerId);
            bot.chat(`Nn. Otak AI dialihkan ke [${targetMode}] (${provider}/${model}), Sensei!`);
        } else {
            bot.chat(`Nn. Mode [${targetMode}] tidak dikenal. Contoh: aimode ds3, aimode gemini, aimode cf`);
        }
        return;
    }

    // MAAF
    if (pk.includes('maaf')) {
        bot.chat("Nn. Dimaafkan. Lain kali jangan diulangi, Sensei.");
        berhentiSerang(bot);
        return;
    }

    // IKUT
    if (pk.includes('ikut')) {
        state.modeMandiri = false; state.sedangKerja = false; try { bot.stopDigging(); } catch (e) { }
        if (state.loopIkutJauh) { clearInterval(state.loopIkutJauh); state.loopIkutJauh = null; }
        const namaSesuai = Object.keys(bot.players).find(name => isOwner(name) || name.toLowerCase().includes(username.toLowerCase()));
        const playerTarget = namaSesuai ? bot.players[namaSesuai] : null;

        if (playerTarget) {
            bot.chat("Nn. Mengikutimu dari dekat, Sensei.");
            
            // Interval pengikut cerdas tanpa infinite recalculate
            state.loopIkutJauh = setInterval(() => {
                if (!playerTarget.entity || !bot.entity) return;
                const dist = bot.entity.position.distanceTo(playerTarget.entity.position);
                
                if (dist > 3.2) {
                    const p = playerTarget.entity.position;
                    bot.pathfinder.setGoal(new goals.GoalNear(p.x, p.y, p.z, 2.0));
                } else if (dist <= 2.2) {
                    if (bot.pathfinder.isMoving()) {
                        bot.pathfinder.setGoal(null);
                    }
                    bot.lookAt(playerTarget.entity.position.offset(0, 1.6, 0), true);
                }
            }, 600);
        } else {
            bot.chat("Nn. Terlalu jauh. Menunggumu mendekat, Sensei.");
        }
        return;
    }

    // MASUK
    if (pk.includes('masuk') || pk.includes('ke sini') || pk.includes('kesini')) {
        state.modeMandiri = false; state.sedangKerja = false; try { bot.stopDigging(); } catch (e) { }
        if (state.loopIkutJauh) { clearInterval(state.loopIkutJauh); state.loopIkutJauh = null; }
        bot.pathfinder.setGoal(null);
        const namaSesuai = Object.keys(bot.players).find(name => isOwner(name) || name.toLowerCase().includes(username.toLowerCase()));
        const playerTarget = namaSesuai ? bot.players[namaSesuai] : null;

        if (playerTarget && playerTarget.entity) {
            bot.chat("Nn. Mencari rute masuk.");
            bot.pathfinder.setGoal(new goals.GoalNear(playerTarget.entity.position.x, playerTarget.entity.position.y, playerTarget.entity.position.z, 1.5));
        } else {
            bot.chat("Nn. Aku tidak melihat posisimu dari sini, Sensei.");
        }
        return;
    }

    // TUTUP PINTU
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

    // BUKA PINTU
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

    // TEROBOS
    if (pk.includes('terobos') || pk.includes('maju') || pk.includes('sini')) {
        state.modeMandiri = false; state.sedangKerja = false; try { bot.stopDigging(); } catch (e) { }
        bot.pathfinder.setGoal(null);
        const namaSesuai = Object.keys(bot.players).find(name => isOwner(name) || name.toLowerCase().includes(username.toLowerCase()));
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

    // BERHENTI
    if (pk.includes('berhenti') || pk.includes('tunggu') || pk.includes('diam')) {
        state.modeMandiri = false;
        state.sedangKerja = false;
        berhentiSerang(bot);
        try { bot.stopDigging(); } catch (err) { }
        if (state.loopIkutJauh) { clearInterval(state.loopIkutJauh); state.loopIkutJauh = null; }
        bot.pathfinder.setGoal(null);
        bot.clearControlStates();
        bot.chat("Nn. Aku berhenti dan standby di sini.");
        return;
    }

    // TEBANG MANUAL
    if (pk.includes('tebang')) {
        const pohon = bot.findBlock({ matching: b => b !== null && b.name && b.name.includes('log') && isAreaAman(b.position), maxDistance: 32, useExtraInfo: true });
        if (pohon) {
            state.sedangKerja = true;
            bot.chat("Nn. Mengerti. Menebang pohon.");
            tebangPohonDanAmbil(bot, pohon);
        } else {
            bot.chat("Nn. Tidak ada pohon di luar zona aman rumah.");
        }
        return;
    }

    // NAMBANG MANUAL
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
            state.sedangKerja = true;
            bot.chat(`Nn. Mengerti. Menambang ${kataKunci}.`);
            mulaiNambang(bot, blockData.id, kamusBlok[kataKunci]);
        } else {
            bot.chat(`Nn. Tidak kutemukan ${kataKunci} di luar zona aman.`);
        }
        return;
    }

    // RAMPOK / AMBIL
    if (pk.includes('rampok') || pk.includes('ambil')) {
        const item = bot.nearestEntity(e => e.name === 'item' && e.position && e.position.distanceTo(bot.entity.position) < 30);
        if (item) {
            bot.chat("Nn. Mengambil jarahan.");
            bot.pathfinder.setGoal(new goals.GoalGetToBlock(Math.floor(item.position.x), Math.floor(item.position.y), Math.floor(item.position.z)));
        } else { bot.chat("Nn. Tidak ada item di sekitar sini."); }
        return;
    }

    // STATUS
    if (pk.includes('status')) {
        const invMap = {};
        let totalItemCount = 0;
        for (const item of bot.inventory.items()) {
            invMap[item.name] = (invMap[item.name] || 0) + item.count;
            totalItemCount += item.count;
        }
        const sortedEntries = Object.entries(invMap).sort((a, b) => b[1] - a[1]);
        const jenisCount = sortedEntries.length;
        const top3 = sortedEntries.slice(0, 3).map(([name, count]) => `${name} x${count}`).join(', ');
        const topStr = top3 ? ` (Top: ${top3})` : '';
        
        bot.chat(`Nn. HP: ${Math.round(bot.health)}/20 | Makanan: ${Math.round(bot.food)}/20 | Tas: ${jenisCount} jenis / ${totalItemCount} item${topStr}. Ketik 'inv' untuk rincian.`);
        return;
    }

    // INVENTARIS
    if (pk.includes('inv') || pk.includes('inventaris')) {
        if (bot.inventory.items().length === 0) {
            bot.chat("Nn. Inventory kosong. Belum ada yang dirampok.");
            return;
        }
        
        const invMap = {};
        for (const item of bot.inventory.items()) {
            invMap[item.name] = (invMap[item.name] || 0) + item.count;
        }
        const invArray = Object.entries(invMap).map(([name, count]) => `${name} x${count}`);
        
        bot.chat(`Nn. Laporan Tas (${invArray.length} jenis item):`);
        
        // Kirim dalam beberapa pesan jika panjang
        let currentMsg = "";
        for (let i = 0; i < invArray.length; i++) {
            if (currentMsg.length + invArray[i].length > 200) {
                bot.chat(currentMsg);
                currentMsg = "";
            }
            currentMsg += (currentMsg ? ", " : "") + invArray[i];
        }
        if (currentMsg) bot.chat(currentMsg);
        
        return;
    }

    // BUANG
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

    // SIMPAN / TARUH
    if (pk.includes('simpan') || pk.includes('taruh') || pk.includes('masukin')) {
        amankanBarangKePeti(bot);
        return;
    }

    // MAKAN
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

    // SERANG
    if (pk.includes('serang')) {
        const kata = pk.split(' ');
        const idxSerang = kata.indexOf('serang');
        const namaTarget = kata[idxSerang + 1];

        if (namaTarget) {
            const targetPlayer = bot.nearestEntity(e => e.type === 'player' && e.username && e.username.toLowerCase().includes(namaTarget) && e.position.distanceTo(bot.entity.position) < 50);
            if (targetPlayer) {
                bot.chat(`Nn. Menyerang ${targetPlayer.username}.`);
                mulaiSerang(bot, targetPlayer);
                return;
            }
        }
        const musuh = bot.nearestEntity(e => e.name && hostileMobs.includes(e.name.toLowerCase()) && e.position.distanceTo(bot.entity.position) < 30);
        if (musuh) {
            bot.chat("Nn. Target dieliminasi.");
            mulaiSerang(bot, musuh);
        } else { bot.chat("Nn. Tidak ada target yang bisa diserang."); }
        return;
    }

    // TIDUR
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

    // AI RESPONS (FALLBACK JIKA BUKAN PERINTAH)
    const sekarang = Date.now();
    if (state.lastAiCall && sekarang - state.lastAiCall < 2500) {
        bot.chat("Nn... Tunggu sebentar, Sensei.");
        return;
    }
    state.lastAiCall = sekarang;

    try {
        const customSystemPrompt = getShirokoSystemPrompt(true) + "\n\n[INSTRUKSI WAJIB UNTUK MINECRAFT CHAT: Jawab pesan player dengan SANGAT SINGKAT, maksimal 1 kalimat pendek padat. Jangan gunakan formatting markdown bold/italic yang aneh. Selalu mulai dengan 'Nn... '.]";
        
        // Mode AI ditentukan dari: 1. Mode in-game jika ada -> 2. Mode WA Owner -> 3. Fallback arisu-gemini
        const ownerId = Array.isArray(ID_OWNER) ? ID_OWNER[0] : ID_OWNER;
        const activeAiMode = state.mcAiMode || (globalState.userAiMode ? (globalState.userAiMode[ownerId] || (Array.isArray(ID_OWNER) && globalState.userAiMode[ID_OWNER[1]])) : null) || 'arisu-gemini';
        const resolved = AIProvider.resolveMode(activeAiMode, ownerId);

        let aiReply = null;
        try {
            aiReply = await AIProvider.generate({
                provider: resolved.provider,
                model: resolved.model,
                prompt: `${username} berkata: ${message}`,
                senderId: `mc_${username}`,
                isOwner: true,
                systemPrompt: customSystemPrompt
            });
        } catch (primaryErr) {
            console.warn(`[MC AI] Model ${resolved.provider}/${resolved.model} gagal, mencoba fallback Arisu:`, primaryErr.message);
            // Fallback ke Arisu deepseek-v3 jika primary gagal
            try {
                aiReply = await AIProvider.generate({
                    provider: 'arisu',
                    model: 'deepseek-v3',
                    prompt: `${username} berkata: ${message}`,
                    senderId: `mc_${username}`,
                    isOwner: true,
                    systemPrompt: customSystemPrompt
                });
            } catch (fallbackErr) {
                console.error('[MC AI] Semua provider AI gagal:', fallbackErr.message);
            }
        }

        if (aiReply && typeof aiReply === 'string') {
            let cleanReply = aiReply.replace(/\n+/g, ' ').replace(/[\*_~`#]/g, '').trim();
            // Batasi panjang chat minecraft maksimal 220 karakter
            if (cleanReply.length > 220) {
                cleanReply = cleanReply.substring(0, 217) + '...';
            }
            bot.chat(cleanReply);
        } else {
            bot.chat("Nn... Kepalaku agak pusing, ada gangguan jaringan sinyal AI, Sensei.");
        }
    } catch (err) {
        console.error('[MC AI Chat Error]:', err.message);
        bot.chat("Nn... Maaf Sensei, sedang ada gangguan koneksi AI.");
    }
}

module.exports = {
    handleChat
};
