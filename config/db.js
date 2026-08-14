// ==========================================
// DATABASE LAYER — FACADE (Backward Compatible)
// ==========================================
// API tetap sama persis, tapi backend sekarang SQLite.
// Semua consumer (commands, handlers) tidak perlu diubah.
// ==========================================
const { JATAH_HARIAN, ID_OWNER } = require('./constants');
const { getCoreNumber } = require('../utils/helpers');
const sqlite = require('./database');

// ==========================================
// PROXY OBJECTS — Backward Compatible
// ==========================================
// Sebelumnya data disimpan di objek JS biasa (dbLimit, dbRole, dll).
// Sekarang kita buat Proxy agar akses properti langsung ke SQLite.

function createDbProxy(table, valueColumn = 'amount') {
    return new Proxy({}, {
        get(target, prop) {
            if (typeof prop !== 'string') return undefined;
            const row = sqlite.getOne(table, prop);
            if (!row) return undefined;
            return row[valueColumn];
        },
        set(target, prop, value) {
            if (typeof prop !== 'string') return true;
            sqlite.upsert(table, { id: prop, [valueColumn]: value });
            return true;
        },
        deleteProperty(target, prop) {
            sqlite.deleteOne(table, prop);
            return true;
        },
        has(target, prop) {
            return sqlite.getOne(table, prop) !== null;
        },
        ownKeys() {
            return sqlite.getAll(table).map(r => r.id);
        },
        getOwnPropertyDescriptor(target, prop) {
            const row = sqlite.getOne(table, prop);
            if (row) return { configurable: true, enumerable: true, value: row[valueColumn] };
            return undefined;
        }
    });
}

// Proxy khusus untuk tabel dengan kolom 'data' (JSON)
function createJsonProxy(table) {
    return new Proxy({}, {
        get(target, prop) {
            if (typeof prop !== 'string') return undefined;
            const row = sqlite.getOne(table, prop);
            if (!row) return undefined;
            try { return JSON.parse(row.data); } catch { return row.data; }
        },
        set(target, prop, value) {
            if (typeof prop !== 'string') return true;
            sqlite.upsert(table, { id: prop, data: JSON.stringify(value) });
            return true;
        },
        deleteProperty(target, prop) {
            sqlite.deleteOne(table, prop);
            return true;
        },
        has(target, prop) {
            return sqlite.getOne(table, prop) !== null;
        },
        ownKeys() {
            return sqlite.getAll(table).map(r => r.id);
        },
        getOwnPropertyDescriptor(target, prop) {
            const row = sqlite.getOne(table, prop);
            if (row) {
                let val;
                try { val = JSON.parse(row.data); } catch { val = row.data; }
                return { configurable: true, enumerable: true, value: val };
            }
            return undefined;
        }
    });
}

// Proxy khusus untuk premium (kolom 'expires_at')
function createPremiumProxy() {
    return new Proxy({}, {
        get(target, prop) {
            if (typeof prop !== 'string') return undefined;
            const row = sqlite.getOne('user_premium', prop);
            if (!row) return undefined;
            // Kembalikan nilai asli: timestamp atau boolean-like
            return row.expires_at === 9999999999999 ? true : row.expires_at;
        },
        set(target, prop, value) {
            if (typeof prop !== 'string') return true;
            let expiresAt;
            if (typeof value === 'boolean') {
                expiresAt = value ? 9999999999999 : 0;
            } else {
                expiresAt = value;
            }
            sqlite.upsert('user_premium', { id: prop, expires_at: expiresAt });
            return true;
        },
        deleteProperty(target, prop) {
            sqlite.deleteOne('user_premium', prop);
            return true;
        },
        has(target, prop) {
            return sqlite.getOne('user_premium', prop) !== null;
        },
        ownKeys() {
            return sqlite.getAll('user_premium').map(r => r.id);
        },
        getOwnPropertyDescriptor(target, prop) {
            const row = sqlite.getOne('user_premium', prop);
            if (row) {
                const val = row.expires_at === 9999999999999 ? true : row.expires_at;
                return { configurable: true, enumerable: true, value: val };
            }
            return undefined;
        }
    });
}

// Proxy khusus untuk panitia (key-based instead of id)
function createPanitiaProxy() {
    return new Proxy({}, {
        get(target, prop) {
            if (typeof prop !== 'string') return undefined;
            // Gunakan query langsung karena panitia pakai kolom 'key' bukan 'id'
            const db = sqlite.getDb();
            if (!db) return undefined;
            const stmt = db.prepare('SELECT * FROM panitia WHERE key = ?');
            stmt.bind([prop]);
            if (stmt.step()) {
                const row = stmt.getAsObject();
                stmt.free();
                try { return JSON.parse(row.data); } catch { return row.data; }
            }
            stmt.free();
            return undefined;
        },
        set(target, prop, value) {
            if (typeof prop !== 'string') return true;
            const db = sqlite.getDb();
            if (!db) return true;
            db.run('INSERT OR REPLACE INTO panitia (key, data) VALUES (?, ?)', [prop, JSON.stringify(value)]);
            sqlite.saveToDisk();
            return true;
        },
        deleteProperty(target, prop) {
            const db = sqlite.getDb();
            if (!db) return true;
            db.run('DELETE FROM panitia WHERE key = ?', [prop]);
            sqlite.saveToDisk();
            return true;
        },
        has(target, prop) {
            const db = sqlite.getDb();
            if (!db) return false;
            const stmt = db.prepare('SELECT 1 FROM panitia WHERE key = ?');
            stmt.bind([prop]);
            const found = stmt.step();
            stmt.free();
            return found;
        },
        ownKeys() {
            return sqlite.getAll('panitia').map(r => r.key);
        },
        getOwnPropertyDescriptor(target, prop) {
            const db = sqlite.getDb();
            if (!db) return undefined;
            const stmt = db.prepare('SELECT * FROM panitia WHERE key = ?');
            stmt.bind([prop]);
            if (stmt.step()) {
                const row = stmt.getAsObject();
                stmt.free();
                let val;
                try { val = JSON.parse(row.data); } catch { val = row.data; }
                return { configurable: true, enumerable: true, value: val };
            }
            stmt.free();
            return undefined;
        }
    });
}

// ==========================================
// PROXY INSTANCES
// ==========================================
const dbLimit = createDbProxy('user_limits', 'amount');
const dbRole = createJsonProxy('user_roles');
const dbTugas = createJsonProxy('user_tugas');
const dbCoba = createJsonProxy('user_coba');
const dbJadibot = createJsonProxy('user_jadibot');
const dbOutfit = createJsonProxy('user_outfits');
const dbPremium = createPremiumProxy();
const dbPanitia = createPanitiaProxy();

// ==========================================
// SIMPAN FUNCTIONS — No-op (SQLite auto-persist)
// Tetap di-export untuk backward compatibility.
// ==========================================
const simpanDB = () => {};
const simpanRole = () => {};
const simpanTugas = () => {};
const simpanPanitia = () => {};
const simpanCoba = () => {};
const simpanJadibot = () => {};
const simpanPremium = () => {};

// ==========================================
// LIMIT FUNCTIONS
// ==========================================

function cekDanPotongLimit(targetID, amount = 1) {
    const coreTarget = getCoreNumber(targetID);
    // Owner bypass — unlimited
    if (ID_OWNER.some(owner => getCoreNumber(owner) === coreTarget)) return true;

    // Cek apakah user adalah Premium
    const premiumVal = dbPremium[targetID];
    const isPremium = premiumVal && (premiumVal === true || premiumVal > Date.now());
    const dailyJatah = isPremium ? 1000 : JATAH_HARIAN;

    let currentLimit = dbLimit[targetID];

    if (currentLimit === undefined) {
        // User baru, set limit awal
        dbLimit[targetID] = dailyJatah;
        currentLimit = dailyJatah;
    } else if (isPremium && currentLimit < 1000) {
        // Premium tapi limit masih rendah, naikkan
        dbLimit[targetID] = 1000;
        currentLimit = 1000;
    }

    if (currentLimit < amount) return false;

    dbLimit[targetID] = currentLimit - amount;
    return true;
}

function kembalikanLimit(targetID, amount = 1) {
    const currentLimit = dbLimit[targetID];
    if (currentLimit !== undefined) {
        dbLimit[targetID] = currentLimit + amount;
    }
}

// ==========================================
// EXPORT (API TETAP SAMA PERSIS)
// ==========================================
module.exports = {
    dbLimit, dbRole, dbTugas, dbPanitia, dbCoba, dbJadibot, dbPremium, dbOutfit,
    simpanDB, simpanRole, simpanTugas, simpanPanitia, simpanCoba, simpanJadibot, simpanPremium,
    getCoreNumber, // Re-export dari utils/helpers untuk kemudahan
    cekDanPotongLimit, kembalikanLimit
};
