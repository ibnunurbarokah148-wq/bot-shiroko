// ==========================================
// SERVICES/MINECRAFT/INDEX.JS (STANDALONE MODE)
// Bot Minecraft saat ini berjalan secara mandiri (Standalone)
// Jalankan melalui terminal: python3 services/minecraft/bot.py
// ==========================================

function startMcBot() {
    console.log('[MC Standalone] Bot Minecraft saat ini berjalan secara mandiri.');
    console.log('[MC Standalone] Silakan jalankan via terminal: python3 services/minecraft/bot.py');
    return false;
}

function stopMcBot() {
    return false;
}

function getMinecraftBot() {
    return null;
}

function getMinecraftStatus() {
    return {
        online: false,
        username: 'Ritian223',
        health: 20,
        food: 20,
        position: { x: 0, y: 0, z: 0 },
        inventory: 'Bot berjalan dalam mode standalone terminal (python3 services/minecraft/bot.py).'
    };
}

module.exports = {
    startMcBot,
    stopMcBot,
    getMinecraftBot,
    getMinecraftStatus
};
