// ==========================================
// SOCKET UTILS — Global WhatsApp Connection
// ==========================================

let waSocket = null;

function setSocket(sock) {
    waSocket = sock;
}

function getSocket() {
    return waSocket;
}

module.exports = {
    setSocket,
    getSocket
};
