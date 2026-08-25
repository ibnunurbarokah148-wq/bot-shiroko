// ==========================================
// STATE GLOBAL & SESI INTERAKTIF
// Semua variabel state di sini di-share lintas modul
// via referensi objek module.exports
// ==========================================

module.exports = {
    // Mode AI per user
    userAIMode: {},
    userRole: {},
    userSystemPrompt: {},
    waifuState: {},
    afkStatus: {},
    groupSettings: {},
    mentionCooldowns: new Map(),
    groupChatCooldown: new Map(),
    userOllamaModel: {},
    userArisuModel: {},
    ownerArisuModel: null,
    ownerMood: null,

    // Status ComfyUI
    comfyUIEnabled: true,

    // Alarm & pengingat ibadah
    alarmSubuhState: { aktif: false, count: 0, timer: null },
    alarmSalatAktif: true,

    // Sesi interaktif per-user (objek = shared by reference)
    sesiKaryaIlmiah: {},
    sesiWaifu: {},
    sesiPixiv: {},
    sesiTikTok: {},
    sesiUjian: {},
    sesiMeme: {},
    sesiTopup: {},
    sesiPremium: {},
    sesiJadibot: {},
    sesiOllamaMode: {},
    sesiArisuMode: {},
    sesiOpenRouterMode: {},
    sesiCloudflareMode: {},
    sesiXKiroMode: {},
    sesiCabutRole: {},
    sesiModelGambar: {},
    sesiArisu: {},
    sesiTTS: {},

    // Model AI Pilihan User
    userOpenRouterModel: {},
    userCloudflareModel: {},
    userXKiroModel: {},
    userXKiroCost: {},

    // Cooldown anti-spam
    cooldownGacha: new Set(),
};
