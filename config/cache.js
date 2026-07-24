// ==========================================
// CACHE LOKAL (GHOST MODE / SNIPE)
// Menyimpan riwayat pesan per grup secara temporer (RAM)
// ==========================================

const messageCache = {};
const deletedMessages = {}; // groupId -> deletedMsgObj

const MAX_CACHE_PER_GROUP = 50;

function cacheMessage(groupId, msgObj) {
    if (!messageCache[groupId]) {
        messageCache[groupId] = [];
    }
    
    messageCache[groupId].push(msgObj);
    
    // Batasi ukuran cache
    if (messageCache[groupId].length > MAX_CACHE_PER_GROUP) {
        messageCache[groupId].shift();
    }
}

function getMessageFromCache(groupId, messageId) {
    if (!messageCache[groupId]) return null;
    return messageCache[groupId].find(m => m.key.id === messageId);
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
    saveDeletedMessage,
    getLastDeletedMessage
};
