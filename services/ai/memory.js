// ==========================================
// CHAT MEMORY MANAGER — Unified Memory untuk Semua Provider
// Menggantikan 4 objek terpisah (memoriOllama, memoriArisu, dll)
// ==========================================

const TTL = 24 * 60 * 60 * 1000; // 24 jam
const MAX_MESSAGES = 20; // Maks histori per user per provider

class ChatMemory {
    constructor() {
        /** @type {Object<string, Object<string, {messages: Array, lastActive: number}>>} */
        this._store = {};
        // senderId -> { provider -> { messages, lastActive } }

        // Auto-cleanup tiap jam
        this._cleanupTimer = setInterval(() => this._cleanup(), 3600000);
    }

    /**
     * Mendapatkan key gabungan senderId + provider.
     * @param {string} senderId
     * @param {string} provider
     * @returns {string}
     */
    _key(senderId, provider) {
        return `${senderId}::${provider}`;
    }

    /**
     * Mendapatkan data memory untuk user + provider tertentu.
     * @param {string} senderId
     * @param {string} provider
     * @returns {{messages: Array, lastActive: number}|null}
     */
    get(senderId, provider) {
        const key = this._key(senderId, provider);
        return this._store[key] || null;
    }

    /**
     * Menginisialisasi memory baru jika belum ada.
     * @param {string} senderId
     * @param {string} provider
     * @param {Array} initialMessages - (opsional) pesan awal, misal system message untuk Ollama
     * @returns {{messages: Array, lastActive: number}}
     */
    init(senderId, provider, initialMessages = []) {
        const key = this._key(senderId, provider);
        if (!this._store[key]) {
            this._store[key] = {
                messages: [...initialMessages],
                lastActive: Date.now()
            };
        }
        return this._store[key];
    }

    /**
     * Menambahkan pesan ke memory.
     * Otomatis trim jika melebihi MAX_MESSAGES.
     * @param {string} senderId
     * @param {string} provider
     * @param {string} role - 'user' | 'assistant' | 'system'
     * @param {string} content
     * @param {object} [extra] - data tambahan (misal images untuk Ollama)
     */
    push(senderId, provider, role, content, extra = {}) {
        const key = this._key(senderId, provider);
        if (!this._store[key]) {
            this._store[key] = { messages: [], lastActive: Date.now() };
        }

        const entry = { role, content, ...extra };
        this._store[key].messages.push(entry);
        this._store[key].lastActive = Date.now();

        // Trim oldest messages (keep system messages for Ollama)
        const msgs = this._store[key].messages;
        if (msgs.length > MAX_MESSAGES) {
            // Kalau pesan pertama adalah system, jaga dia
            if (msgs[0] && msgs[0].role === 'system') {
                msgs.splice(1, 2); // Hapus 2 pesan setelah system
            } else {
                msgs.splice(0, 2); // Hapus 2 pesan paling lama
            }
        }
    }

    /**
     * Menghapus pesan terakhir (rollback jika error).
     * @param {string} senderId
     * @param {string} provider
     */
    popLast(senderId, provider) {
        const key = this._key(senderId, provider);
        if (this._store[key] && this._store[key].messages.length > 0) {
            this._store[key].messages.pop();
        }
    }

    /**
     * Mendapatkan semua pesan.
     * @param {string} senderId
     * @param {string} provider
     * @returns {Array}
     */
    getMessages(senderId, provider) {
        const key = this._key(senderId, provider);
        if (!this._store[key]) return [];
        return this._store[key].messages;
    }

    /**
     * Menghapus memory untuk satu user di satu provider.
     * @param {string} senderId
     * @param {string} provider
     * @returns {boolean} true jika ada yang dihapus
     */
    clear(senderId, provider) {
        const key = this._key(senderId, provider);
        if (this._store[key]) {
            delete this._store[key];
            return true;
        }
        return false;
    }

    /**
     * Menghapus SEMUA memory untuk satu user (semua provider).
     * Digunakan oleh !lupa.
     * @param {string} senderId
     * @returns {boolean} true jika ada yang dihapus
     */
    clearAll(senderId) {
        let found = false;
        for (const key of Object.keys(this._store)) {
            if (key.startsWith(`${senderId}::`)) {
                delete this._store[key];
                found = true;
            }
        }
        return found;
    }

    /**
     * Pembersihan otomatis memory yang sudah kedaluwarsa (TTL 24 jam).
     */
    _cleanup() {
        const now = Date.now();
        let cleaned = 0;
        for (const key of Object.keys(this._store)) {
            if (now - this._store[key].lastActive > TTL) {
                delete this._store[key];
                cleaned++;
            }
        }
        if (cleaned > 0) {
            console.log(`[SISTEM] Pembersihan memori chat otomatis: ${cleaned} sesi dihapus.`);
        }
    }

    /**
     * Menghentikan timer cleanup (untuk graceful shutdown).
     */
    destroy() {
        if (this._cleanupTimer) {
            clearInterval(this._cleanupTimer);
            this._cleanupTimer = null;
        }
    }
}

// Singleton instance — digunakan oleh semua provider
const chatMemory = new ChatMemory();

module.exports = chatMemory;
