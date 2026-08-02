// ==========================================
// COMMAND: ALARM & PENGINGAT IBADAH (AI-POWERED)
// Handler: respon alarm adaptif, !testsalat, !testsubuh, !alarmstatus, !maafshiroko
// ==========================================
const state = require('../config/state');
const alarmService = require('../services/alarm.service');

async function handle(ctx) {
    const { sock, senderId, isOwner, textLower, text, reply } = ctx;

    // 1. CEK COMMAND MANAGEMENT ALARM
    if (textLower === '!alarmstatus' || textLower === '!statusalarm') {
        if (!isOwner) return false;
        const stats = alarmService.getAlarmStats();
        const activeSess = state.activeAlarmSession;
        
        let statusMsg = `📊 *STATUS AI SMART ALARM SHIROKO* 📊\n\n`;
        statusMsg += `• Status Sistem: ${state.alarmSalatAktif ? '🟢 Aktif' : '🔴 Nonaktif'}\n`;
        statusMsg += `• Sesi Sedang Berjalan: ${activeSess ? `🚨 ${activeSess.salatName} (Panggilan ${activeSess.level}/3)` : '⚪ Tidak ada'}\n`;
        statusMsg += `• Streak Bangun Tepat Waktu: 🔥 ${stats.wake_streak || 0} hari\n`;
        statusMsg += `• Total Mengabaikan Alarm: ⚠️ ${stats.ignore_count || 0} kali\n`;
        statusMsg += `• Aktivitas Terakhir: ${stats.last_action || 'Belum ada'}\n\n`;
        statusMsg += `_Ketik !testsubuh atau !testsalat untuk menguji coba._`;
        
        await reply(statusMsg);
        return true;
    }

    if (textLower.startsWith('!testsalat')) {
        if (!isOwner) return false;
        const args = text.trim().split(/\s+/).slice(1);
        const salatName = args[0] ? args[0].charAt(0).toUpperCase() + args[0].slice(1) : 'Zuhur';
        
        await reply(`Nn... Memulai simulasi AI Alarm Salat *${salatName}*...`);
        await alarmService.triggerSalatAlarm(salatName, '12:05', true);
        return true;
    }

    if (textLower === '!testsubuh') {
        if (!isOwner) return false;
        await reply('Nn... Memulai simulasi AI Smart Alarm Subuh (Interval cepat 20 detik/level)...');
        await alarmService.triggerSubuhAlarm(true);
        return true;
    }

    if (textLower === '!maafshiroko' || textLower === '!aktifkanalarm') {
        if (!isOwner) return false;
        state.alarmSalatAktif = true;
        await reply('Nn... Sistem AI Smart Alarm dan pengingat ibadah telah diaktifkan kembali. Shiroko siap siaga. 🐺✨');
        return true;
    }

    if (textLower === '!matikanalarm') {
        if (!isOwner) return false;
        state.alarmSalatAktif = false;
        alarmService.stopActiveAlarm();
        await reply('Nn... Sistem pengingat ibadah dinonaktifkan sementara. Ketik !aktifkanalarm untuk menyalakannya lagi.');
        return true;
    }

    // 2. CEK APAKAH USER MERESPONS ALARM (ACTIVE ALARM / QUOTE)
    const handledResponse = await alarmService.handleAlarmResponse(ctx);
    if (handledResponse) return true;

    return false;
}

module.exports = { handle };
