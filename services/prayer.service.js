// ==========================================
// SERVICE: DYNAMIC PRAYER SCHEDULE & SCHEDULER
// Lokasi Presisi: Kp. Cibuntu, Kec. Cibitung, Kab. Bekasi, Jawa Barat
// Koordinat: Lat -6.2625, Long 107.0984 | Metode 11 (Kemenag RI)
// ==========================================
const axios = require('axios');
const cron = require('node-cron');
const state = require('../config/state');
const alarmService = require('./alarm.service');

const LOCATION_NAME = 'Kp. Cibuntu, Kec. Cibitung, Kab. Bekasi';
const LAT = -6.2625;
const LNG = 107.0984;

// Cache jadwal harian
let cachedSchedule = null;
let lastFetchDate = null;
const triggeredToday = new Set(); // Mencegah duplikasi trigger di menit yang sama

/**
 * Format tanggal hari ini (YYYY-MM-DD) zona WIB
 */
function getTodayDateWib() {
    const d = new Date();
    const wib = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
    const yyyy = wib.getFullYear();
    const mm = String(wib.getMonth() + 1).padStart(2, '0');
    const dd = String(wib.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

/**
 * Mengambil jadwal salat hari ini dari Aladhan API (Metode Kemenag RI)
 */
async function fetchTodayPrayerTimes() {
    const today = getTodayDateWib();
    if (cachedSchedule && lastFetchDate === today) {
        return cachedSchedule;
    }

    try {
        const url = `https://api.aladhan.com/v1/timings?latitude=${LAT}&longitude=${LNG}&method=11`;
        const res = await axios.get(url, { timeout: 8000 });
        const timings = res.data.data.timings;

        cachedSchedule = {
            date: today,
            lokasi: LOCATION_NAME,
            Imsak: timings.Imsak ? timings.Imsak.substring(0, 5) : '04:32',
            Subuh: timings.Fajr ? timings.Fajr.substring(0, 5) : '04:42',
            Terbit: timings.Sunrise ? timings.Sunrise.substring(0, 5) : '06:03',
            Dzuhur: timings.Dhuhr ? timings.Dhuhr.substring(0, 5) : '11:58',
            Ashar: timings.Asr ? timings.Asr.substring(0, 5) : '15:19',
            Maghrib: timings.Maghrib ? timings.Maghrib.substring(0, 5) : '17:53',
            Isya: timings.Isha ? timings.Isha.substring(0, 5) : '19:06'
        };
        lastFetchDate = today;
        triggeredToday.clear(); // Reset trigger harian
        console.log(`[Prayer Service] Jadwal salat untuk ${LOCATION_NAME} berhasil diperbarui (${today}).`);
        return cachedSchedule;
    } catch (err) {
        console.warn('[Prayer Service] Gagal fetch Aladhan API, menggunakan fallback Kemenag Bekasi:', err.message);
        if (cachedSchedule) return cachedSchedule;

        // Fallback default Bekasi
        return {
            date: today,
            lokasi: LOCATION_NAME,
            Imsak: '04:32',
            Subuh: '04:42',
            Terbit: '06:03',
            Dzuhur: '11:58',
            Ashar: '15:19',
            Maghrib: '17:53',
            Isya: '19:06'
        };
    }
}

/**
 * Format pesan jadwal salat untuk dikirim ke user
 */
async function getFormattedPrayerSchedule() {
    const times = await fetchTodayPrayerTimes();
    const d = new Date();
    const wib = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const tanggalIndo = wib.toLocaleDateString('id-ID', options);

    return `🕌 *JADWAL SALAT & IMSAKIYAH* 🕌\n` +
           `📍 \`\`\`Wilayah: ${times.lokasi}\`\`\`\n` +
           `📅 \`\`\`Hari   : ${tanggalIndo}\`\`\`\n` +
           `⏱️ \`\`\`Zona   : WIB (UTC+7)\`\`\`\n\n` +
           `┌─「 *WAKTU IBADAH* 」\n` +
           `│ ⏳ *Imsak*   : ${times.Imsak} WIB\n` +
           `│ 🌅 *Subuh*   : ${times.Subuh} WIB\n` +
           `│ ☀️ *Terbit*  : ${times.Terbit} WIB\n` +
           `│ ☀️ *Dzuhur*  : ${times.Dzuhur} WIB\n` +
           `│ ⛅ *Ashar*   : ${times.Ashar} WIB\n` +
           `│ 🌇 *Maghrib* : ${times.Maghrib} WIB\n` +
           `│ 🌙 *Isya*    : ${times.Isya} WIB\n` +
           `└───────────────────\n\n` +
           `_Nn... Jadwal otomatis sinkron dengan hisab Kemenag RI untuk Cibitung & sekitarnya. Jangan lupa salat tepat waktu ya, Sensei! 🐺✨_`;
}

/**
 * Inisialisasi dynamic prayer scheduler (cek setiap menit)
 */
function initPrayerScheduler() {
    // Ambil jadwal pertama kali saat bot start
    fetchTodayPrayerTimes();

    // Reset dan fetch ulang jadwal tiap tengah malam 00:01 WIB
    cron.schedule('1 0 * * *', () => {
        fetchTodayPrayerTimes();
    }, { timezone: "Asia/Jakarta" });

    // Checker tiap menit
    cron.schedule('* * * * *', async () => {
        if (!state.alarmSalatAktif) return;

        const d = new Date();
        const wib = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
        const currentHourMin = `${String(wib.getHours()).padStart(2, '0')}:${String(wib.getMinutes()).padStart(2, '0')}`;
        const todayStr = getTodayDateWib();

        const schedule = await fetchTodayPrayerTimes();
        const prayers = [
            { name: 'Subuh', time: schedule.Subuh },
            { name: 'Dzuhur', time: schedule.Dzuhur },
            { name: 'Ashar', time: schedule.Ashar },
            { name: 'Maghrib', time: schedule.Maghrib },
            { name: 'Isya', time: schedule.Isya },
        ];

        for (const p of prayers) {
            const triggerKey = `${todayStr}::${p.name}::${p.time}`;
            if (p.time === currentHourMin && !triggeredToday.has(triggerKey)) {
                triggeredToday.add(triggerKey);
                console.log(`[Prayer Scheduler] Waktu ${p.name} (${p.time} WIB) telah tiba untuk ${LOCATION_NAME}!`);

                if (p.name === 'Subuh') {
                    await alarmService.triggerSubuhAlarm();
                } else {
                    await alarmService.triggerSalatAlarm(p.name, p.time);
                }
            }
        }
    }, { timezone: "Asia/Jakarta" });

    console.log(`[Prayer Scheduler] Pengingat salat otomatis presisi aktif untuk ${LOCATION_NAME}.`);
}

module.exports = {
    fetchTodayPrayerTimes,
    getFormattedPrayerSchedule,
    initPrayerScheduler,
    LOCATION_NAME
};
