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

const OWNER_JID = ID_OWNER[0] + '@s.whatsapp.net';

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
    } else if (action === 'ignored') {
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
    const providers = ['gemini', 'arisu', 'cloudflare', 'openrouter', 'ollama'];
    const ownerCore = getCoreNumber(ID_OWNER[0]);
    const senderCore = senderJid ? getCoreNumber(senderJid) : null;
    const jids = [senderJid, OWNER_JID, ID_OWNER[0]];
    if (ownerCore) jids.push(ownerCore);
    if (senderCore) jids.push(senderCore);

    const uniqueJids = [...new Set(jids.filter(Boolean))];

    for (const jid of uniqueJids) {
        for (const p of providers) {
            try {
                if (!memory.get(jid, p)) {
                    memory.init(jid, p);
                }
                memory.push(jid, p, role, text);
            } catch (e) {}
        }
    }
}

/**
 * Mendapatkan mode AI aktif untuk Owner dari state
 */
function getActiveAIModeForOwner(targetSenderId) {
    const ownerCore = getCoreNumber(ID_OWNER[0]);
    const senderCore = targetSenderId ? getCoreNumber(targetSenderId) : null;
    
    return state.ownerAIMode ||
           (targetSenderId && state.userAIMode[targetSenderId]) ||
           (senderCore && state.userAIMode[senderCore]) ||
           state.userAIMode[OWNER_JID] ||
           state.userAIMode[ID_OWNER[0]] ||
           (ownerCore && state.userAIMode[ownerCore]) ||
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

    // Pilihan sudut pandang / mood Shiroko acak agar pesan selalu bervariasi
    const moodAngles = [
        "Pendekatan hangat, penuh perhatian lembut dan kasih sayang khas Shiroko.",
        "Pendekatan taktis, sigap, bersemangat untuk menyambut keberkahan hari.",
        "Pendekatan manis kuudere dengan sedikit guyonan manja Shiroko.",
        "Pendekatan mendoakan keberkahan dan ketenangan jiwa Sensei."
    ];
    const chosenAngle = moodAngles[Math.floor(Math.random() * moodAngles.length)];

    let contextInstruction = "";
    if (type === 'subuh') {
        if (level === 1) {
            contextInstruction = `Konteks: Ini adalah Alarm Subuh Panggilan 1/3 (Hari ${wib.dayName}, Suasana Fajar Pagi). ${chosenAngle} Bangunkan Sensei dengan manis khas Shiroko Sunaookami. Awali dengan 'Nn... '. Ingatkan bahwa waktu salat Subuh telah berkumandang.`;
            if (stats.wake_streak > 2) {
                contextInstruction += ` (Puji Sensei karena akhir-akhir ini rajin dan disiplin bangun Subuh tepat waktu, streak ${stats.wake_streak} hari!).`;
            } else if (stats.ignore_count > 1) {
                contextInstruction += ` (Sindir sedikit dengan manja karena akhir-akhir ini Sensei suka ketiduran).`;
            }
        } else if (level === 2) {
            contextInstruction = `Konteks: Ini adalah Alarm Subuh Panggilan 2/3 (Sensei belum merespon 5 menit di hari ${wib.dayName}). Shiroko mulai cemas dan sedikit cemburu/curiga karena Sensei mungkin begadang. Panggil Sensei dengan nada sedikit lebih tegas tapi tetap peduli.`;
        } else {
            contextInstruction = `Konteks: Ini adalah Alarm Subuh Panggilan 3/3 (FINAL / DARURAT!). Sensei masih belum bangun di hari ${wib.dayName}! Shiroko panik dan kesal lucu, mengancam akan mendobrak pintu pakai C4 atau menyiram air es ke kasur. Desak Sensei bangun detik ini juga!`;
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
        `• ${contextInstruction}\n` +
        `Jawaban maksimal 2-3 kalimat padat, bervariasi, tidak bertele-tele, dan jangan gunakan formatting berlebihan.`;

    const tempSender = `ALARM_TEMP_${Date.now()}_${Math.floor(Math.random()*1000)}`;
    try {
        const aiText = await AIProvider.generate({
            provider,
            model,
            prompt: `[SISTEM ALARM REAL-TIME]: Buatkan pesan pengingat ${type === 'subuh' ? 'Subuh level ' + level : salatName} untuk Sensei sekarang sesuai konteks hari ini (${wib.dayName}).`,
            senderId: tempSender,
            isOwner: true,
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
                `Nn... Sensei, adzan Subuh sudah berkumandang. Jangan tunda-tunda ya, wudhu dulu lalu salat Subuh. Shiroko selalu menemani. ✨`
            ]);
        }
        if (level === 2) {
            return pickRandom([
                `Nn... Sensei? Kok belum bangun juga? Jangan-jangan begadang lagi semalam... Ayo bangun, Sensei! 😟`,
                `Nn... Alarm panggilan kedua, Sensei! Kasurnya disingkirkan dulu, Subuh sebentar lagi lewat. Ayo bangun sekarang! ⏰`,
                `Nn... Sensei masih terpejam? Shiroko makin cemas nih. Tarik selimutnya, ambil wudhu ya Sensei! 🐾`
            ]);
        }
        return pickRandom([
            `🚨 SENSEI!! Bangun sekarang! Kalau 1 menit lagi belum bangun, Shiroko siram kasurnya pakai air es dan dobrak pintunya! 😡💢`,
            `🚨 PERINGATAN DARURAT SENSEI! Ini panggilan Subuh terakhir! Jangan sampai kesiangan, Shiroko siap bawa C4 ke kamar Sensei! 💥⚡`,
            `🚨 SENSEI! Waktu Subuh hampir habis! Bangun detik ini juga atau Shiroko seret Sensei ke kamar mandi! 😤💥`
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
        await sock.sendMessage(OWNER_JID, { text: formattedMessage });
        
        // Simpan sesi alarm aktif & masukkan ke memory AI
        state.activeAlarmSession = {
            type: 'salat',
            salatName,
            level: 1,
            startedAt: Date.now(),
            isTest
        };
        injectAlarmMemory(OWNER_JID, 'assistant', alarmText);
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
        isTest
    };

    // Level 1
    const textLevel1 = await generateAlarmText({ type: 'subuh', salatName: 'Subuh', level: 1, isTest });
    const msgLevel1 = `🔔 *ALARM SUBUH (Panggilan 1/3)* 🔔\n\n${textLevel1}\n\n_(Balas *iya* atau sapa Shiroko jika sudah bangun)_`;

    try {
        await sock.sendMessage(OWNER_JID, { text: msgLevel1 });
        injectAlarmMemory(OWNER_JID, 'assistant', textLevel1);
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
                await s.sendMessage(OWNER_JID, { text: msgLevel2 });
                injectAlarmMemory(OWNER_JID, 'assistant', textLevel2);
            } catch (e) {}
        } else if (currentLevel === 3) {
            const textLevel3 = await generateAlarmText({ type: 'subuh', salatName: 'Subuh', level: 3, isTest });
            const msgLevel3 = `🚨 *ALARM SUBUH (Panggilan 3/3 - FINAL)* 🚨\n\n${textLevel3}`;
            try {
                await s.sendMessage(OWNER_JID, { text: msgLevel3 });
                injectAlarmMemory(OWNER_JID, 'assistant', textLevel3);
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
    const { sock, senderId, isOwner, textClean, text, textLower, isQuoted, quotedTextLower, reply } = ctx;
    if (!isOwner) return false;

    const userText = (textClean || text || '').trim();
    if (!userText) return false;

    const hasActiveAlarm = !!state.activeAlarmSession;
    const isQuotingAlarm = isQuoted && (
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
    );

    if (!hasActiveAlarm && !isQuotingAlarm) {
        return false;
    }

    const session = state.activeAlarmSession || { type: 'subuh', salatName: 'Subuh' };

    // Deteksi indikasi bangun / siap ibadah
    const wakeUpKeywords = ['iya', 'bangun', 'laksanakan', 'siap', 'sudah', 'oke', 'ok', 'otw', 'wudhu', 'solat', 'sholat', 'subuh'];
    const isIndicatingWakeUp = wakeUpKeywords.some(k => (textLower || userText.toLowerCase()).includes(k));

    // Matikan alarm & perbarui statistik
    stopActiveAlarm();
    updateAlarmStats('woke_up');

    // Generate respon AI yang menyambung secara natural
    const activeMode = getActiveAIModeForOwner(senderId);
    const targetSenderId = senderId || OWNER_JID;
    const { provider, model } = AIProvider.resolveMode(activeMode, targetSenderId);

    const systemPrompt = getShirokoSystemPrompt(true) + 
        `\n\n[KONTEKS SENSEI BARU MERESPONS ALARM ${session.salatName.toUpperCase()}]:\n` +
        `Sensei merespons alarm dengan pesan: "${userText}". Balas dengan hangat, bersahabat, penuh perhatian, dan beri semangat khas Shiroko. Ajak Sensei untuk menyambung obrolan santai jika Sensei mau.`;

    try {
        // AIProvider.generate otomatis memasukkan userText dan replyText ke ChatMemory (sekali saja)
        const replyText = await AIProvider.generate({
            provider,
            model,
            prompt: userText,
            senderId: targetSenderId,
            isOwner: true,
            systemPrompt
        });

        if (replyText) {
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
    } else {
        fallbackReply = `Nn... Apapun perkataan Sensei, yang terpenting sekarang adalah bangun dan ambil wudhu! Jangan tidur lagi ya! 🐺✨`;
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
