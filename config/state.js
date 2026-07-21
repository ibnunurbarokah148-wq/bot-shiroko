// ==========================================
// STATE GLOBAL & SESI INTERAKTIF
// Semua variabel state di sini di-share lintas modul
// via referensi objek module.exports
// ==========================================

module.exports = {
    // Mode AI per user
    userAIMode: {},
    userOllamaModel: {},

    // Model gambar aktif
    currentImageModel: 'cagliostrolab/animagine-xl-3.1',

    // Alarm & pengingat ibadah
    alarmSubuhState: { aktif: false, count: 0, timer: null },
    alarmSalatAktif: true,

    // Sesi interaktif per-user (objek = shared by reference)
    sesiKaryaIlmiah: {},
    sesiSalat: {},
    sesiWaifu: {},
    sesiPixiv: {},
    sesiTikTok: {},
    sesiUjian: {},
    sesiObrolan: {},
    sesiMeme: {},
    sesiTopup: {},
    sesiOllamaMode: {},
    sesiCabutRole: {},
    sesiModelGambar: {},
    sesiArisu: {},

    // Cooldown anti-spam
    cooldownGacha: new Set(),
};
