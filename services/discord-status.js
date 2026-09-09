let discordClient = null;

function setDiscordClient(client) {
    discordClient = client;
}

function isDiscordReady() {
    return Boolean(discordClient?.isReady?.());
}

function getDiscordLatency() {
    const ping = discordClient?.ws?.ping;
    return Number.isFinite(ping) && ping >= 0 ? ping : null;
}

module.exports = { setDiscordClient, isDiscordReady, getDiscordLatency };
