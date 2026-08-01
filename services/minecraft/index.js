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

    // Setup chat event
    bot.on('chat', async (username, message) => {
        const mcData = require('minecraft-data')(bot.version);
        await handleChat(bot, username, message, mcData);
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
