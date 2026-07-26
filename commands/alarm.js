// ==========================================
// COMMAND: ALARM & PENGINGAT IBADAH
// Handler: alarm subuh, sesi salat, !testsalat, !testsubuh, !maafshiroko
// ==========================================
const state = require('../config/state');
const { getCoreNumber } = require('../utils/helpers');

async function handle(ctx) {
    const { sock, senderId, isOwner, textLower, isQuoted, quotedTextLower, reply } = ctx;
    const coreSender = getCoreNumber(senderId);

    // Detect if user is replying (quoting) an alarm message
    const isQuotingAlarmSubuh = isQuoted && (
        quotedTextLower.includes('alarm subuh') ||
        quotedTextLower.includes('bangun, sensei') ||
        quotedTextLower.includes('siram air')
    );

    const isQuotingSalat = isQuoted && (
        quotedTextLower.includes('notifikasi taktis') ||
        quotedTextLower.includes('waktu ibadah') ||
        quotedTextLower.includes('segera ambil wudhu')
    );

    // ==========================================
    // SENSOR BANGUN SUBUH (WAJIB REPLY PESAN ALARM SUBUH)
    // ==========================================
    if (isOwner && state.alarmSubuhState.aktif) {
        if (isQuotingAlarmSubuh) {
            const isBangun = ['iya', 'bangun', 'laksanakan', 'siap', 'sudah', 'oke', 'ok'].some(k => textLower.includes(k));
            
            if (isBangun) {
                if (state.alarmSubuhState.timer) clearInterval(state.alarmSubuhState.timer);
                state.alarmSubuhState.aktif = false;
                state.alarmSubuhState.count = 0;
                state.alarmSubuhState.timer = null;
                await reply(`Nn... *(Mengusap keringat di dahi)*. Kerja bagus karena sudah bangun tepat waktu, Sensei. Shiroko senang sekali. Cepat ambil wudhu dan salat ya, Shiroko tungguin dari sini. ✨`);
                return true;
            } else {
                await reply(`Nn... Sensei! Tidak ada alasan, cepat bangun dan segera ambil wudhu sekarang! 😡💢`);
                return true;
            }
        }
    }

    // ==========================================
    // HANDLER SESI SALAT (WAJIB REPLY PESAN NOTIFIKASI SALAT)
    // ==========================================
    if (isOwner && (state.sesiSalat[coreSender] || isQuotingSalat)) {
        if (isQuotingSalat) {
            const isLaksanakan = ['laksanakan', 'iya', 'siap', 'sudah', 'oke', 'ok', 'otw'].some(k => textLower.includes(k));
            const isAbaikan = ['abaikan', 'nanti', 'tidak', 'ga', 'gak'].some(k => textLower.includes(k));

            delete state.sesiSalat[coreSender];

            if (isLaksanakan) {
                await reply(`Nn... Alhamdulillah. Cepat laksanakan ibadahnya, Sensei. Shiroko jaga markas di sini. 🤍`);
                return true;
            } else if (isAbaikan) {
                await reply(`Nn... *(Menatap tajam)*... Sensei, ibadah itu wajib. Jangan ditunda-tunda. 💢`);
                return true;
            } else {
                await reply(`Nn... Apapun perkataan Sensei, yang terpenting sekarang adalah segera ambil wudhu dan laksanakan ibadahnya! 🐺✨`);
                return true;
            }
        }
    }

    // ==========================================
    // ALAT TESTING SALAT/SUBUH
    // ==========================================
    if (textLower === '!testsalat') {
        if (!isOwner) return false;
        await reply(`🔔 *Notifikasi Taktis (Uji Coba)* 🔔\n\nNn... Sensei. Ini sudah masuk waktu ibadah *Zuhur* (12:00). Segera ambil wudhu.\n\nBalas dengan:\n*Laksanakan*\n*Abaikan*`);
        state.sesiSalat[getCoreNumber(senderId)] = { step: 1, salat: 'Zuhur' };
        return true;
    }

    if (textLower === '!maafshiroko') {
        if (!isOwner) return false;
        state.alarmSalatAktif = true;
        await reply('Nn... Sistem pengingat ibadah telah diaktifkan kembali. Shiroko siap siaga. 🐺✨');
        return true;
    }

    if (textLower === '!testsubuh') {
        if (!isOwner) return false;
        if (state.alarmSubuhState.timer) clearInterval(state.alarmSubuhState.timer);
        await reply('Nn... Memulai simulasi alarm Subuh (10 detik/panggilan)...');

        state.alarmSubuhState.aktif = true;
        state.alarmSubuhState.count = 1;
        await sock.sendMessage(senderId, { text: `🔔 *ALARM SUBUH (Panggilan 1/3)* 🔔\n\nNn... Bangun, Sensei.\n_(Balas *iya* jika sudah bangun)_` });

        state.alarmSubuhState.timer = setInterval(() => {
            state.alarmSubuhState.count++;
            if (state.alarmSubuhState.count === 2) sock.sendMessage(senderId, { text: `⏰ *ALARM SUBUH (Panggilan 2/3)* ⏰\n\nNn... Sensei? Ayo bangun... 😟` });
            else if (state.alarmSubuhState.count === 3) sock.sendMessage(senderId, { text: `🚨 *ALARM SUBUH (Panggilan 3/3 - FINAL)* 🚨\n\nSENSEI!!! Shiroko siram air nih! 😡💢` });
            else if (state.alarmSubuhState.count > 3) {
                sock.sendMessage(senderId, { text: `💤 *Sistem Pengingat Subuh Dihentikan* 💤\n\nNn... Shiroko matikan alarmnya ya... 😔🤍` });
                clearInterval(state.alarmSubuhState.timer);
                state.alarmSubuhState.aktif = false;
                state.alarmSubuhState.count = 0;
                state.alarmSubuhState.timer = null;
            }
        }, 10 * 1000);
        return true;
    }

    return false;
}

module.exports = { handle };
