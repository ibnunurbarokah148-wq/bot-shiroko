// ==========================================
// COMMAND: ALARM & PENGINGAT IBADAH
// Handler: alarm subuh, sesi salat, !testsalat, !testsubuh, !maafshiroko
// ==========================================
const state = require('../config/state');
const { getCoreNumber } = require('../utils/helpers');

async function handle(ctx) {
    const { sock, senderId, isOwner, textLower, reply } = ctx;

    // ==========================================
    // SENSOR BANGUN SUBUH
    // ==========================================
    if (isOwner && state.alarmSubuhState.aktif) {
        if (textLower === 'iya') {
            if (state.alarmSubuhState.timer) clearInterval(state.alarmSubuhState.timer);
            state.alarmSubuhState.aktif = false;
            state.alarmSubuhState.count = 0;
            state.alarmSubuhState.timer = null;
            await reply(`Nn... *(Mengusap keringat di dahi)*. Kerja bagus karena sudah bangun tepat waktu, Sensei. Shiroko senang sekali. Cepat ambil wudhu dan salat ya, Shiroko tungguin dari sini. ✨`);
            return true;
        }
    }

    // ==========================================
    // HANDLER SESI SALAT
    // ==========================================
    const coreSender = getCoreNumber(senderId);
    if (state.sesiSalat[coreSender] && isOwner) {
        if (textLower === 'laksanakan') {
            delete state.sesiSalat[coreSender];
            await reply(`Nn... Alhamdulillah. Cepat laksanakan ibadahnya, Sensei. Shiroko jaga markas di sini. 🤍`);
            return true;
        } else if (textLower === 'abaikan') {
            delete state.sesiSalat[coreSender];
            await reply(`Nn... *(Menatap tajam)*... Sensei, ibadah itu wajib. Jangan ditunda-tunda. 💢`);
            return true;
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
