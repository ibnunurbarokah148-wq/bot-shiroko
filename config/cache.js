// ==========================================
// CACHE LOKAL (GHOST MODE / SNIPE)
// Menyimpan riwayat pesan per grup secara temporer (RAM)
// ==========================================

const messageCache = {};
const deletedMessages = {}; // groupId -> deletedMsgObj

const MAX_CACHE_PER_GROUP = 50;
const ALBUM_CACHE_TTL = 10 * 60 * 1000;

function getAlbumParentId(message) {
    const visited = new Set();
    const stack = [message?.message || message];

    while (stack.length) {
        const current = stack.pop();
        if (!current || typeof current !== 'object' || visited.has(current)) continue;
        visited.add(current);

        const association = current.messageContextInfo?.messageAssociation || current.messageAssociation;
        const parentKey = association?.parentMessageKey;
        const parentId = parentKey?.id || parentKey?.keyId || parentKey?.messageId;
        if (parentId) return parentId;

        for (const key of ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension', 'imageMessage', 'videoMessage']) {
            if (current[key]) stack.push(current[key]);
        }
    }
    return null;
}

function cacheMessage(groupId, msgObj) {
    if (!messageCache[groupId]) {
        messageCache[groupId] = [];
    }
    
    messageCache[groupId] = messageCache[groupId].filter(message =>
        !message.cachedAt || Date.now() - message.cachedAt < ALBUM_CACHE_TTL
    );
    const cachedMessage = { ...msgObj, cachedAt: Date.now() };
    if (!messageCache[groupId].some(message => message.key?.id === msgObj.key?.id)) {
        messageCache[groupId].push(cachedMessage);
    }
    
    // Batasi ukuran cache
    if (messageCache[groupId].length > MAX_CACHE_PER_GROUP) {
        messageCache[groupId].shift();
    }
}

function getMessageFromCache(groupId, messageId) {
    if (!messageCache[groupId]) return null;
    return messageCache[groupId].find(m => m.key.id === messageId);
}

function getAlbumMessages(groupId, parentMessageId) {
    if (!messageCache[groupId] || !parentMessageId) return [];
    return messageCache[groupId].filter(message => {
        return message.key?.id === parentMessageId || getAlbumParentId(message) === parentMessageId;
    });
}

function getImageMessage(message) {
    const visited = new Set();
    const stack = [message?.message || message];
    while (stack.length) {
        const current = stack.pop();
        if (!current || typeof current !== 'object' || visited.has(current)) continue;
        visited.add(current);
        if (current.imageMessage) return current.imageMessage;
        for (const key of ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension']) {
            if (current[key]) stack.push(current[key]);
        }
    }
    return null;
}

function saveDeletedMessage(groupId, messageId) {
    const msg = getMessageFromCache(groupId, messageId);
    if (msg) {
        // Simpan pesan terakhir yang dihapus per grup
        deletedMessages[groupId] = msg;
        return true;
    }
    return false;
}

function getLastDeletedMessage(groupId) {
    return deletedMessages[groupId];
}

module.exports = {
    cacheMessage,
    getAlbumParentId,
    getMessageFromCache,
    getImageMessage,
    getAlbumMessages,
    saveDeletedMessage,
    getLastDeletedMessage
};
