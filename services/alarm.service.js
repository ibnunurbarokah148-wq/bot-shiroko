// ==========================================
// SERVICE: AI SMART ALARM & CHAT MEMORY SYNC
// Pengingat Salat & Alarm Subuh adaptif dengan kepribadian Shiroko
// terintegrasi penuh ke ChatMemory (Unified AI Memory).
// ==========================================
const state = require('../config/state');
const { ID_OWNER } = require('../config/constants');
const { getSocket } = require('../utils/socket');
const AIProvider = require('./ai/AIProvider');
const memory = require('./ai/memory');
const { getShirokoSystemPrompt } = require('./ai/prompts');
const db = require('../config/database');
const { getCoreNumber } = require('../utils/helpers');
const moodState = require('./ai/mood.state');

const OWNER_JID = ID_OWNER[0] + '@s.whatsapp.net';
const ALARM_MEMORY_PROVIDERS = ['gemini', 'arisu', 'cloudflare', 'openrouter', 'ollama', 'xkiro'];

/**
 * Mendapatkan statistik kedisiplinan alarm dari SQLite
 */
function getAlarmStats(ownerCore = ID_OWNER[0]) {
    try {
        const stats = db.getOne('alarm_stats', ownerCore);
        if (stats) return stats;
    } catch (e) {}
    return { id: ownerCore, wake_streak: 0, ignore_count: 0, last_responded_at: 0, last_action: '' };
}

/**
 * Memperbarui statistik kedisiplinan di SQLite
 */
function updateAlarmStats(action, ownerCore = ID_OWNER[0]) {
    const current = getAlarmStats(ownerCore);
    if (action === 'woke_up' || action === 'prayed') {
        current.wake_streak = (current.wake_streak || 0) + 1;
        current.ignore_count = 0;
    } else if (action === 'ignored' || action === 'refused') {
        current.wake_streak = 0;
        current.ignore_count = (current.ignore_count || 0) + 1;
    }
    current.last_responded_at = Date.now();
    current.last_action = action;

    try {
        db.upsert('alarm_stats', current);
        db.saveToDisk();
    } catch (e) {
        console.error('[Alarm Service] Gagal menyimpan statistik alarm:', e.message);
    }
    return current;
}

/**
 * Menginjeksi pesan ke ChatMemory (Unified Memory) untuk semua provider aktif dan semua varian JID Owner
 */
function injectAlarmMemory(senderJid, role, text) {
    // Alarm hanya milik owner; gunakan satu JID kanonis agar history tidak terduplikasi.
    const jids = [OWNER_JID];
    memory.pushShared(OWNER_JID, role, text);

    for (const jid of jids) {
        for (const provider of ALARM_MEMORY_PROVIDERS) {
            try {
                if (!memory.get(jid, provider)) memory.init(jid, provider);
                memory.push(jid, provider, role, text);
            } catch (e) {
                console.warn(`[Alarm Service] Gagal sinkronisasi memory ${provider}:`, e.message);
            }
        }
    }
}

/**
 * Mendapatkan mode AI aktif untuk Owner dari state
 */
function injectAlarmMemoryExcept(senderJid, role, text, excludedProvider) {
    // Gunakan key kanonis owner yang sama dengan alarm awal.
    const jids = [OWNER_JID];
    memory.pushShared(OWNER_JID, role, text);

    for (const jid of jids) {
        for (const provider of ALARM_MEMORY_PROVIDERS) {
            if (provider === excludedProvider) continue;
            try {
                if (!memory.get(jid, provider)) memory.init(jid, provider);
                memory.push(jid, provider, role, text);
            } catch (e) {
                console.warn(`[Alarm Service] Gagal sinkronisasi respon ${provider}:`, e.message);
            }
        }
    }
}

function getActiveAIModeForOwner(targetSenderId) {
    const ownerCore = getCoreNumber(ID_OWNER[0]);
    const senderCore = targetSenderId ? getCoreNumber(targetSenderId) : null;

    // Prioritaskan mode user yang sudah dinormalisasi; ownerAIMode menjadi fallback.
    return (senderCore && state.userAIMode[senderCore]) ||
           (targetSenderId && state.userAIMode[targetSenderId]) ||
           state.userAIMode[OWNER_JID] ||
           state.userAIMode[ID_OWNER[0]] ||
           (ownerCore && state.userAIMode[ownerCore]) ||
           state.ownerAIMode ||
           'gemini';
}

/**
 * Helper untuk mendapatkan waktu & tanggal WIB
 */
function getWibContext() {
    const d = new Date();
    const wib = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
    const daysIndo = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const dayName = daysIndo[wib.getDay()];
    const hour = wib.getHours();
    
    let timeOfDay = 'Pagi';
    if (hour >= 11 && hour < 15) timeOfDay = 'Siang';
    else if (hour >= 15 && hour < 18) timeOfDay = 'Sore';
    else if (hour >= 18 || hour < 4) timeOfDay = 'Malam';

    return {
        dayName,
        isFriday: dayName === 'Jumat',
        isWeekend: dayName === 'Sabtu' || dayName === 'Minggu',
        timeOfDay,
        hourStr: `${String(hour).padStart(2, '0')}:${String(wib.getMinutes()).padStart(2, '0')}`
    };
}

/**
 * Generate pesan alarm dinamis menggunakan AI Shiroko
 */
async function generateAlarmText({ type, salatName, level = 1, isTest = false }) {
    const stats = getAlarmStats();
    const activeMode = getActiveAIModeForOwner();
    const { provider, model } = AIProvider.resolveMode(activeMode, OWNER_JID);
    const wib = getWibContext();
    const ownerMood = moodState.getMood();
    const moodGuidance = ownerMood.mood !== 'neutral' && ownerMood.intensity > 0
        ? `Mood owner: ${ownerMood.mood} (${Math.round(ownerMood.intensity * 100)}%). Sesuaikan kehangatan alarm dengan mood ini, tetapi jangan mengurangi urgensi alarm.`
        : 'Mood owner netral. Gunakan gaya alarm sesuai level dan variasi yang tersedia.';

    // Pilihan sudut pandang / mood Shiroko acak agar pesan selalu bervariasi
    const moodAngles = [
        "Pendekatan hangat, penuh perhatian lembut dan kasih sayang khas Shiroko.",
        "Pendekatan taktis, sigap, bersemangat untuk menyambut keberkahan hari.",
        "Pendekatan manis kuudere dengan sedikit guyonan manja Shiroko.",
        "Pendekatan mendoakan keberkahan dan ketenangan jiwa Sensei."
    ];
    const chosenAngle = moodAngles[Math.floor(Math.random() * moodAngles.length)];
    const subuhStyles = [
        'sapaan lembut dan menenangkan, seperti menemani Sensei membuka mata',
        'gaya kuudere yang canggung tapi perhatian, dengan candaan kecil',
        'gaya penyemangat taktis, singkat dan berenergi tanpa mengancam',
        'gaya manja dan sedikit ngambek karena Sensei masih tidur',
        'gaya reflektif, mengingatkan bahwa fajar adalah kesempatan baru',
        'gaya dramatis ringan seperti panggilan radio misi, tetapi tetap hangat',
        'gaya perhatian praktis: fokus pada duduk, minum air, wudhu, lalu salat'
    ];
    const chosenSubuhStyle = subuhStyles[Math.floor(Math.random() * subuhStyles.length)];

    let contextInstruction = "";
    if (type === 'subuh') {
        if (level === 1) {
            contextInstruction = `Konteks: Ini adalah Alarm Subuh Panggilan 1/3 (Hari ${wib.dayName}, Suasana Fajar Pagi). Gunakan gaya ${chosenSubuhStyle}. ${chosenAngle} Bangunkan Sensei dengan manis khas Shiroko Sunaookami. Awali dengan 'Nn... '. Ingatkan bahwa waktu salat Subuh telah berkumandang. Jangan memakai ancaman atau gertakan.`;
            if (stats.wake_streak > 2) {
                contextInstruction += ` (Puji Sensei karena akhir-akhir ini rajin dan disiplin bangun Subuh tepat waktu, streak ${stats.wake_streak} hari!).`;
            } else if (stats.ignore_count > 1) {
                contextInstruction += ` (Sindir sedikit dengan manja karena akhir-akhir ini Sensei suka ketiduran).`;
            }
        } else if (level === 2) {
            contextInstruction = `Konteks: Ini adalah Alarm Subuh Panggilan 2/3 (Sensei belum merespon 5 menit di hari ${wib.dayName}). Gunakan gaya ${chosenSubuhStyle}. Shiroko mulai cemas karena Sensei mungkin masih tertidur, tetapi tetap kreatif dan tidak mengulang kalimat panggilan pertama. Panggil Sensei dengan nada lebih tegas namun tetap peduli. Jangan memakai ancaman kekerasan, C4, mendobrak pintu, atau siraman air.`;
        } else {
            contextInstruction = `Konteks: Ini adalah Alarm Subuh Panggilan 3/3 (FINAL). Sensei masih belum bangun di hari ${wib.dayName}. Gunakan gaya ${chosenSubuhStyle}. Sampaikan urgensi dengan cara yang berbeda dan kreatif, misalnya hitung mundur, laporan misi terakhir, rasa kecewa yang lucu, atau ajakan emosional untuk tidak melewatkan Subuh. Tetap hangat dan jangan memakai gertakan kekerasan, C4, mendobrak pintu, atau siraman air.`;
        }
    } else {
        // Cek khusus Salat Jumat untuk Dzuhur di hari Jumat
        if (salatName.toLowerCase() === 'dzuhur' && wib.isFriday) {
            contextInstruction = `Konteks: Ini adalah Panggilan WAKTU SALAT JUMAT (Hari Jumat yang penuh berkah). ${chosenAngle} Ingatkan Sensei untuk bersiap-siap: mandi sunnah Jumat, memakai pakaian bersih/terbaik, wewangian, dan segera berangkat ke masjid untuk Salat Jumat. Awali dengan 'Nn... '.`;
        } else {
            contextInstruction = `Konteks: Ini adalah Notifikasi Waktu Salat ${salatName} (Hari ${wib.dayName}, suasana ${wib.timeOfDay}). ${chosenAngle} Ingatkan Sensei agar segera mengambil wudhu dan melaksanakan ibadah ${salatName}. Awali dengan 'Nn... '.`;
        }
    }

    const systemPrompt = getShirokoSystemPrompt(true) + 
        `\n\n[PANDUAN ALARM DINAMIS REAL-TIME]\n` +
        `• Hari: ${wib.dayName} (${wib.isWeekend ? 'Akhir Pekan' : 'Hari Kerja'})\n` +
        `• Suasana: ${wib.timeOfDay}\n` +
        `• ${moodGuidance}\n` +
        `• ${contextInstruction}\n` +
        `Jawaban maksimal 2-3 kalimat padat, bervariasi, tidak bertele-tele, dan jangan gunakan formatting berlebihan. Jangan mengulang template atau ancaman dari alarm sebelumnya; buat respons terasa spontan dan berbeda setiap panggilan.`;

    const tempSender = `ALARM_TEMP_${Date.now()}_${Math.floor(Math.random()*1000)}`;
    try {
        const aiText = await AIProvider.generate({
            provider,
            model,
            prompt: `[SISTEM ALARM REAL-TIME]: Buatkan pesan pengingat ${type === 'subuh' ? 'Subuh level ' + level : salatName} untuk Sensei sekarang sesuai konteks hari ini (${wib.dayName}).`,
            senderId: tempSender,
            isOwner: true,
            syncSharedMemory: false,
            systemPrompt
        });

        // Hapus memori generator sementara
        AIProvider.clearMemory(tempSender);

        if (aiText && typeof aiText === 'string' && aiText.trim().length > 5) {
            return aiText.trim();
        }
    } catch (err) {
        console.warn('[Alarm Service] AI generation gagal, menggunakan fallback dinamis:', err.message);
    }

    // Fallback dinamis jika AI offline / error
    const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];

    if (type === 'subuh') {
        if (level === 1) {
            return pickRandom([
                `Nn... Bangun, Sensei. Sudah adzan Subuh berkumandang di hari ${wib.dayName} ini. Ambil wudhu ya, Shiroko tungguin dari sini. 🤍`,
                `Nn... Selamat pagi Hari ${wib.dayName}, Sensei. Fajar Subuh sudah menyingsing. Yuk bangun dan salat Subuh agar harimu berkah. 🌅`,
                `Nn... Cahaya pagi mulai muncul, Sensei. Duduk dulu pelan-pelan, lalu ambil wudhu. Kita mulai hari ini dengan Subuh yang tenang. ✨`,
                `Nn... Panggilan fajar sudah tiba. Buka mata dulu, Sensei... setelah itu wudhu dan salat. Shiroko akan menunggu kabar baikmu. 🌤️`,
                `Nn... Hari ${wib.dayName} baru saja dimulai. Jangan biarkan beberapa menit nyaman mencuri keberkahan pagimu, Sensei. Ayo Subuh. 🤍`,
                `Nn... Selimutnya boleh dipeluk nanti. Sekarang waktunya bangun dan menyambut fajar, Sensei. Shiroko percaya kamu bisa. 🐺`
            ]);
        }
        if (level === 2) {
            return pickRandom([
                `Nn... Sensei? Kok belum bangun juga? Jangan-jangan begadang lagi semalam... Ayo bangun, Sensei! 😟`,
                `Nn... Alarm panggilan kedua, Sensei! Kasurnya disingkirkan dulu, Subuh sebentar lagi lewat. Ayo bangun sekarang! ⏰`,
                `Nn... Sensei masih terpejam? Shiroko mulai menghitung waktu dengan cemas. Duduk dulu, tarik napas, lalu langsung ke kamar mandi ya. 🐾`,
                `Nn... Panggilan kedua masuk. Kalau sudah dengar suara Shiroko, balas satu kata saja: "iya". Setelah itu jangan kembali ke bantal. 😤`,
                `Nn... Fajar tidak menunggu siapa pun, Sensei. Tinggalkan posisi bertahan di kasur dan bergerak tiga langkah pertama menuju wudhu. ⏰`,
                `Nn... Shiroko tidak marah... masih belum. Tapi rasa kantukmu mulai terlalu percaya diri. Bangun dan buktikan kamu lebih kuat darinya. 🌅`
            ]);
        }
        return pickRandom([
            `🚨 PANGGILAN TERAKHIR, SENSEI. Misi Subuh memasuki batas waktu terakhir. Tinggalkan kasur sekarang, ambil wudhu, dan selamatkan pagi ini. 🐺⏳`,
            `🚨 Sensei, ini laporan terakhir dari fajar. Shiroko kecewa kalau kamu menyerah pada kantuk sekarang. Bangun... satu langkah dulu, lalu lanjutkan sampai wudhu. 🌅`,
            `🚨 WAKTU TERAKHIR, SENSEI. Jangan biarkan alarm ini berakhir sebagai penyesalan setelah bangun nanti. Buka mata, duduk, dan berangkat wudhu sekarang. ⏰`,
            `🚨 Panggilan final diterima. Shiroko tidak akan mengulanginya lagi setelah ini, jadi tolong jawab fajar dengan bangun sekarang. Subuh menunggumu. 🤍`,
            `🚨 Sensei, target misi pagi hampir terlewat. Tidak perlu berpikir panjang: matikan rasa malas, letakkan kaki di lantai, lalu wudhu. Kamu masih bisa. ✨`
        ]);
    }

    if (salatName.toLowerCase() === 'dzuhur' && wib.isFriday) {
        return pickRandom([
            `Nn... Sensei! Hari ini hari Jumat berkah, waktu *Salat Jumat* sudah tiba. Pakai pakaian terbaik, wewangian, dan segera berangkat ke masjid ya! 🕌✨`,
            `Nn... Selamat Hari Jumat, Sensei. Panggilan Salat Jumat sudah berkumandang. Yuk siap-siap dan berangkat ke masjid. Shiroko mendoakan dari sini. 🤍`
        ]);
    }

    const salatFallbacks = {
        'Dzuhur': [
            `Nn... Sensei. Ini sudah masuk waktu ibadah *Dzuhur*. Segera ambil wudhu dan laksanakan salat ya. Shiroko selalu siap mendampingi. ✨`,
            `Nn... Waktu *Dzuhur* telah tiba di tengah kesibukan Sensei hari ${wib.dayName}. Istirahat sejenak, wudhu dan penuhi panggilan-Nya ya. ☀️`
        ],
        'Ashar': [
            `Nn... Sensei, adzan *Ashar* telah berkumandang. Rehat sejenak dari aktivitas sore ini dan tunaikan salat Ashar ya. ⛅`,
            `Nn... Waktu *Ashar* telah tiba, Sensei. Ambil wudhu dan luangkan waktu untuk ibadah sebelum hari beranjak malam. ✨`
        ],
        'Maghrib': [
            `Nn... Lengkingan adzan *Maghrib* menyambut senja, Sensei. Segera ambil wudhu dan tunaikan salat Maghrib ya. 🌇`,
            `Nn... Langit sudah petang, Sensei. Waktu *Maghrib* telah masuk. Yuk wudhu dan laksanakan salat tepat waktu. 🌙`
        ],
        'Isya': [
            `Nn... Ketenangan malam menyapa, waktu *Isya* telah tiba. Lengkapi harimu dengan ibadah Isya sebelum istirahat ya, Sensei. 🌙✨`,
            `Nn... Sensei, adzan *Isya* sudah berkumandang. Ambil wudhu dan tuntaskan ibadah malam ini dengan khusyuk ya. 🤍`
        ]
    };

    const fallbacks = salatFallbacks[salatName] || [
        `Nn... Sensei. Ini sudah masuk waktu ibadah *${salatName}*. Segera ambil wudhu dan laksanakan salat ya. Shiroko selalu siap mendampingi. ✨`
    ];
    return pickRandom(fallbacks);
}

/**
 * Pemicu Alarm Salat 5 Waktu
 */
async function triggerSalatAlarm(salatName, waktuStr, isTest = false) {
    if (!state.alarmSalatAktif && !isTest) return;
    const sock = getSocket();
    if (!sock) return;

    const alarmText = await generateAlarmText({ type: 'salat', salatName, isTest });
    const formattedMessage = `🔔 *NOTIFIKASI TAKTIS SALAT ${salatName.toUpperCase()}* (${waktuStr}) 🔔\n\n${alarmText}\n\n_(Balas pesan ini untuk ngobrol dengan Shiroko)_`;

    try {
        const sentMessage = await sock.sendMessage(OWNER_JID, { text: formattedMessage });

        // Simpan sesi alarm aktif & ID pesan agar hanya quote alarm ini yang diproses.
        state.activeAlarmSession = {
            type: 'salat',
            salatName,
            level: 1,
            startedAt: Date.now(),
            isTest,
            messageIds: sentMessage?.key?.id ? [sentMessage.key.id] : []
        };
        injectAlarmMemory(OWNER_JID, 'assistant', formattedMessage);
        console.log(`[Alarm Service] Alarm Salat ${salatName} berhasil dikirim ke Owner.`);
    } catch (e) {
        console.error(`[Alarm Service] Gagal mengirim alarm salat ${salatName}:`, e.message);
    }
}

/**
 * Pemicu Alarm Subuh Bertingkat (Escalation Level 1 -> 2 -> 3)
 */
async function triggerSubuhAlarm(isTest = false) {
    if (!state.alarmSalatAktif && !isTest) return;
    const sock = getSocket();
    if (!sock) return;

    // Bersihkan timer lama jika ada
    if (state.alarmSubuhState && state.alarmSubuhState.timer) {
        clearInterval(state.alarmSubuhState.timer);
    }

    const intervalTime = isTest ? 20 * 1000 : 5 * 60 * 1000; // 20 detik jika test, 5 menit jika riil

    state.activeAlarmSession = {
        type: 'subuh',
        salatName: 'Subuh',
        level: 1,
        startedAt: Date.now(),
        isTest,
        messageIds: []
    };

    // Level 1
    const textLevel1 = await generateAlarmText({ type: 'subuh', salatName: 'Subuh', level: 1, isTest });
    const msgLevel1 = `🔔 *ALARM SUBUH (Panggilan 1/3)* 🔔\n\n${textLevel1}\n\n_(Balas *iya* atau sapa Shiroko jika sudah bangun)_`;

    try {
        const sentLevel1 = await sock.sendMessage(OWNER_JID, { text: msgLevel1 });
        if (sentLevel1?.key?.id) state.activeAlarmSession.messageIds.push(sentLevel1.key.id);
        injectAlarmMemory(OWNER_JID, 'assistant', msgLevel1);
    } catch (e) {
        console.error('[Alarm Service] Gagal kirim Subuh level 1:', e.message);
    }

    // Interval Level 2 & 3
    let currentLevel = 1;
    const timer = setInterval(async () => {
        const s = getSocket();
        if (!s || !state.activeAlarmSession || state.activeAlarmSession.type !== 'subuh') {
            clearInterval(timer);
            return;
        }

        currentLevel++;
        state.activeAlarmSession.level = currentLevel;

        if (currentLevel === 2) {
            const textLevel2 = await generateAlarmText({ type: 'subuh', salatName: 'Subuh', level: 2, isTest });
            const msgLevel2 = `⏰ *ALARM SUBUH (Panggilan 2/3)* ⏰\n\n${textLevel2}`;
            try {
                const sentLevel2 = await s.sendMessage(OWNER_JID, { text: msgLevel2 });
                if (sentLevel2?.key?.id && state.activeAlarmSession) state.activeAlarmSession.messageIds.push(sentLevel2.key.id);
                injectAlarmMemory(OWNER_JID, 'assistant', msgLevel2);
            } catch (e) {}
        } else if (currentLevel === 3) {
            const textLevel3 = await generateAlarmText({ type: 'subuh', salatName: 'Subuh', level: 3, isTest });
            const msgLevel3 = `🚨 *ALARM SUBUH (Panggilan 3/3 - FINAL)* 🚨\n\n${textLevel3}`;
            try {
                const sentLevel3 = await s.sendMessage(OWNER_JID, { text: msgLevel3 });
                if (sentLevel3?.key?.id && state.activeAlarmSession) state.activeAlarmSession.messageIds.push(sentLevel3.key.id);
                injectAlarmMemory(OWNER_JID, 'assistant', msgLevel3);
            } catch (e) {}
        } else {
            // Berhenti jika sudah lewat 3 panggilan
            clearInterval(timer);
            updateAlarmStats('ignored');
            const endText = `💤 *Sistem Pengingat Subuh Dihentikan* 💤\n\nNn... Karena Sensei tidak bangun-bangun, Shiroko matikan alarmnya ya... Jangan lupa salat qadha kalau bangun nanti, Sensei. 😔🤍`;
            try {
                await s.sendMessage(OWNER_JID, { text: endText });
                injectAlarmMemory(OWNER_JID, 'assistant', endText);
            } catch (e) {}
            state.activeAlarmSession = null;
        }
    }, intervalTime);

    state.activeAlarmSession.timer = timer;
    state.alarmSubuhState = {
        aktif: true,
        count: 1,
        timer: timer
    };
}

/**
 * Hentikan alarm aktif (dipanggil saat Sensei merespons / bangun)
 */
function stopActiveAlarm() {
    if (state.activeAlarmSession && state.activeAlarmSession.timer) {
        clearInterval(state.activeAlarmSession.timer);
    }
    if (state.alarmSubuhState && state.alarmSubuhState.timer) {
        clearInterval(state.alarmSubuhState.timer);
        state.alarmSubuhState.aktif = false;
        state.alarmSubuhState.count = 0;
        state.alarmSubuhState.timer = null;
    }
    state.activeAlarmSession = null;
}

/**
 * Menangani respon Sensei terhadap alarm aktif atau quote pesan alarm
 */
async function handleAlarmResponse(ctx) {
    const { sock, senderId, isOwner, textClean, text, textLower, isQuoted, quotedTextLower, quotedStanzaId, reply } = ctx;
    if (!isOwner) return false;

    const userText = (textClean || text || '').trim();
    if (!userText) return false;

    const hasActiveAlarm = !!state.activeAlarmSession;
    const activeMessageIds = state.activeAlarmSession?.messageIds || [];
    const isQuotingKnownAlarm = Boolean(quotedStanzaId && activeMessageIds.includes(quotedStanzaId));
    const isQuotingAlarm = isQuoted && (isQuotingKnownAlarm || (
        quotedTextLower.includes('alarm subuh') ||
        quotedTextLower.includes('notifikasi taktis salat') ||
        quotedTextLower.includes('waktu ibadah') ||
        quotedTextLower.includes('siram air') ||
        quotedTextLower.includes('bangun, sensei') ||
        quotedTextLower.includes('salat') ||
        quotedTextLower.includes('sholat') ||
        quotedTextLower.includes('adzan') ||
        quotedTextLower.includes('subuh') ||
        quotedTextLower.includes('wudhu')
    ));

    if (!hasActiveAlarm && !isQuotingAlarm) {
        return false;
    }

    const session = state.activeAlarmSession || { type: 'subuh', salatName: 'Subuh' };

    // Klasifikasi tunggal dipakai untuk mood, statistik, prompt, dan fallback.
    const alarmClassification = moodState.classifyAlarmResponse(userText);
    const responseMood = moodState.updateFromAlarmResponse(userText);
    const isIndicatingWakeUp = alarmClassification.action === 'woke_up';
    const alarmAction = alarmClassification.action;

    // Matikan alarm & perbarui statistik
    stopActiveAlarm();
    updateAlarmStats(alarmAction);

    // Generate respon AI yang menyambung secara natural
    const activeMode = getActiveAIModeForOwner(senderId);
    const targetSenderId = senderId || OWNER_JID;
    const { provider, model } = AIProvider.resolveMode(activeMode, targetSenderId);

    const systemPrompt = getShirokoSystemPrompt(true) + 
        `\n\n[KONTEKS SENSEI BARU MERESPONS ALARM ${session.salatName.toUpperCase()}]:\n` +
        `Sensei merespons alarm dengan pesan: "${userText}". Klasifikasi respons: ${alarmAction}. Mood owner terdeteksi ${responseMood.mood}. Balas dengan hangat, bersahabat, penuh perhatian, dan beri semangat khas Shiroko. Ajak Sensei untuk menyambung obrolan santai jika Sensei mau.`;

    try {
        // AIProvider.generate otomatis memasukkan userText dan replyText ke ChatMemory (sekali saja)
        const replyText = await AIProvider.generate({
            provider,
            model,
            prompt: userText,
            senderId: targetSenderId,
            isOwner: true,
            syncSharedMemory: false,
            systemPrompt
        });

        if (replyText) {
            // Provider aktif sudah menyimpan user + assistant melalui generate().
            // Sinkronkan ke provider lain agar perpindahan aimode tidak memutus konteks owner.
            injectAlarmMemoryExcept(targetSenderId, 'user', userText, provider);
            injectAlarmMemoryExcept(targetSenderId, 'assistant', replyText, provider);
            await reply(replyText);
            return true;
        }
    } catch (e) {
        console.error('[Alarm Service] Error generating reply:', e.message);
    }

    // Fallback jika AI error (hanya memasukkan memori manual jika AIProvider gagal)
    let fallbackReply = "";
    if (isIndicatingWakeUp) {
        fallbackReply = `Nn... *(Mengusap dada lega)*. Baguslah kalau Sensei sudah bangun. Cepat ambil wudhu dan salat ya, Shiroko tungguin dari sini. ✨`;
    } else if (alarmAction === 'refused') {
        fallbackReply = `Nn... Shiroko mengerti Sensei sedang tidak ingin diganggu. Tapi setelah ini, tolong ingat waktu ibadahnya ya. 🤍`;
    } else if (alarmAction === 'will_comply') {
        fallbackReply = `Nn... Baik, Sensei. Jangan terlalu lama kembali ke bantal. Bangun perlahan, ambil wudhu, lalu laksanakan salat ya. 🌅`;
    } else {
        fallbackReply = `Nn... Shiroko menerima jawaban Sensei. Sekarang pastikan tubuh benar-benar bangun dan ambil wudhu ya. 🐺✨`;
    }
    injectAlarmMemory(targetSenderId, 'user', userText);
    injectAlarmMemory(targetSenderId, 'assistant', fallbackReply);
    await reply(fallbackReply);
    return true;
}

module.exports = {
    getAlarmStats,
    updateAlarmStats,
    triggerSalatAlarm,
    triggerSubuhAlarm,
    stopActiveAlarm,
    handleAlarmResponse,
    generateAlarmText
};
