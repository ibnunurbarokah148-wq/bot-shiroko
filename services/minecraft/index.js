require('dotenv').config();
const mineflayer = require('mineflayer');
const { pathfinder } = require('mineflayer-pathfinder');
const { CONFIG } = require('./config');
const { state, clearAllIntervals } = require('./state');
const { setupLifecycleEvents } = require('./events/lifecycle');
const { handleChat } = require('./events/chat');

function createBot() {
    state.autoReconnect = true;
    const bot = mineflayer.createBot({
        host: CONFIG.host,
        port: CONFIG.port,
        username: CONFIG.username,
        version: CONFIG.version,
        auth: CONFIG.auth
    });

    bot.loadPlugin(pathfinder);

    // Setup lifecycle events (spawn, death, error, health, dll)
    setupLifecycleEvents(bot, createBot);

    // Setup Universal Chat Parser (Menangkap 'chat' standar + 'messagestr' untuk format kustom / versi baru 1.20+ / 1.21)
    const handledMsgTimestamps = new Map();

    async function processIncomingChat(username, message) {
        if (!username || !message) return;
        const msgKey = `${username.toLowerCase()}:::${message.trim().toLowerCase()}`;
        const now = Date.now();
        if (handledMsgTimestamps.has(msgKey) && now - handledMsgTimestamps.get(msgKey) < 1500) {
            return; // Anti-duplicate debounce
        }
        handledMsgTimestamps.set(msgKey, now);

        if (handledMsgTimestamps.size > 50) {
            for (const [k, t] of handledMsgTimestamps.entries()) {
                if (now - t > 5000) handledMsgTimestamps.delete(k);
            }
        }

        try {
            console.log(`[MC IN-GAME] ${username}: "${message}"`);
            const mcData = require('minecraft-data')(bot.version || '1.21.1');
            await handleChat(bot, username, message, mcData);
        } catch (err) {
            console.error('[MC Chat Process Error]:', err.message);
        }
    }

    bot.on('chat', (username, message) => {
        processIncomingChat(username, message);
    });

    bot.on('messagestr', (messageStr) => {
        if (!messageStr || typeof messageStr !== 'string') return;
        for (const ownerName of CONFIG.owners) {
            const cleanOwner = ownerName.replace(/^[.*_]/, '');
            const regex = new RegExp(`(?:^|[^a-zA-Z0-9_])[.*_]?${cleanOwner}(?:[^a-zA-Z0-9_]*[:>»\\]]+|\\s+)(.+)`, 'i');
            const match = messageStr.match(regex);
            if (match) {
                const extractedMsg = match[1].trim();
                if (extractedMsg) {
                    processIncomingChat(ownerName, extractedMsg);
                    return;
                }
            }
        }
    });

    return bot;
}

function startMcBot() {
    if (state.activeMcBot) return false; // Sudah nyala
    state.activeMcBot = createBot();
    return true;
}

function stopMcBot() {
    if (!state.activeMcBot) return false; // Sudah mati
    state.autoReconnect = false;
    clearAllIntervals();
    try {
        state.activeMcBot.quit();
    } catch(e) {}
    state.activeMcBot = null;
    return true;
}

function getMinecraftBot() {
    return state.activeMcBot;
}

function getMinecraftStatus() {
    if (!state.activeMcBot || !state.activeMcBot.entity) {
        return { online: false };
    }
    const pos = state.activeMcBot.entity.position;
    
    const invMap = {};
    for (const item of state.activeMcBot.inventory.items()) {
        invMap[item.name] = (invMap[item.name] || 0) + item.count;
    }
    const items = Object.entries(invMap).map(([name, count]) => `${name} x${count}`).join(', ') || 'Kosong';
    
    return {
        online: true,
        username: state.activeMcBot.username,
        health: Math.round(state.activeMcBot.health),
        food: Math.round(state.activeMcBot.food),
        position: { x: Math.round(pos.x), y: Math.round(pos.y), z: Math.round(pos.z) },
        inventory: items
    };
}

module.exports = {
    startMcBot,
    stopMcBot,
    getMinecraftBot,
    getMinecraftStatus
};
