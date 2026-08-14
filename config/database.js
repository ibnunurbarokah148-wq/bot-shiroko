// ==========================================
// DATABASE SQLITE — Persistence Layer
// Menggunakan sql.js (SQLite murni JavaScript, tidak butuh C++ compiler)
// ==========================================
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DB_DIR, 'bot.db');

let db = null;
let _saveTimer = null;

/**
 * Inisialisasi database SQLite.
 * Harus dipanggil sekali saat bot startup (async).
 * @returns {Promise<void>}
 */
async function initDatabase() {
    // Pastikan folder data/ ada
    if (!fs.existsSync(DB_DIR)) {
        fs.mkdirSync(DB_DIR, { recursive: true });
    }

    const SQL = await initSqlJs();

    // Load file database jika sudah ada
    if (fs.existsSync(DB_PATH)) {
        const fileBuffer = fs.readFileSync(DB_PATH);
        db = new SQL.Database(fileBuffer);
        console.log('[DATABASE] SQLite database dimuat dari file.');
    } else {
        db = new SQL.Database();
        console.log('[DATABASE] SQLite database baru dibuat.');
    }

    // Buat tabel jika belum ada
    db.run(`
        CREATE TABLE IF NOT EXISTS user_limits (
            id TEXT PRIMARY KEY,
            amount INTEGER DEFAULT 20
        )
    `);
    db.run(`
        CREATE TABLE IF NOT EXISTS user_roles (
            id TEXT PRIMARY KEY,
            role TEXT
        )
    `);
    db.run(`
        CREATE TABLE IF NOT EXISTS user_tugas (
            id TEXT PRIMARY KEY,
            data TEXT
        )
    `);
    db.run(`
        CREATE TABLE IF NOT EXISTS user_premium (
            id TEXT PRIMARY KEY,
            expires_at INTEGER DEFAULT 0
        )
    `);
    db.run(`
        CREATE TABLE IF NOT EXISTS user_coba (
            id TEXT PRIMARY KEY,
            data TEXT
        )
    `);
    db.run(`
        CREATE TABLE IF NOT EXISTS user_jadibot (
            id TEXT PRIMARY KEY,
            data TEXT
        )
    `);
    db.run(`
        CREATE TABLE IF NOT EXISTS panitia (
            key TEXT PRIMARY KEY,
            data TEXT
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS statistics (
            id TEXT PRIMARY KEY,
            value INTEGER DEFAULT 0
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS alarm_stats (
            id TEXT PRIMARY KEY,
            wake_streak INTEGER DEFAULT 0,
            ignore_count INTEGER DEFAULT 0,
            last_responded_at INTEGER DEFAULT 0,
            last_action TEXT DEFAULT ''
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS bot_settings (
            id TEXT PRIMARY KEY,
            value TEXT
        )
    `);
    db.run(`
        CREATE TABLE IF NOT EXISTS user_outfits (
            id TEXT PRIMARY KEY,
            data TEXT
        )
    `);

    // Migrasi jika tabel lama terlanjur dibuat dengan kolom 'key'
    try {
        db.run(`ALTER TABLE statistics RENAME COLUMN key TO id`);
    } catch (e) {
        // Abaikan jika error (kolom sudah id, atau tabel baru dibuat benar)
    }

    // Muat konfigurasi tersimpan ke memory state
    try {
        const state = require('./state');
        const rows = getAll('bot_settings');
        for (const row of rows) {
            try {
                let parsed = JSON.parse(row.value);
                if (row.id === 'ownerAIMode') state.ownerAIMode = parsed;
                else if (row.id === 'ownerOpenRouterModel') state.ownerOpenRouterModel = parsed;
                else if (row.id === 'ownerCloudflareModel') state.ownerCloudflareModel = parsed;
                 else if (row.id === 'ownerOllamaModel') state.ownerOllamaModel = parsed;
                 else if (row.id === 'ownerXKiroModel') state.ownerXKiroModel = parsed;
                 else if (row.id === 'ownerMood' && parsed && typeof parsed === 'object') state.ownerMood = parsed;
                else if (row.id === 'userAIMode' && typeof parsed === 'object') state.userAIMode = { ...state.userAIMode, ...parsed };
                else if (row.id === 'userOpenRouterModel' && typeof parsed === 'object') state.userOpenRouterModel = { ...state.userOpenRouterModel, ...parsed };
                else if (row.id === 'userCloudflareModel' && typeof parsed === 'object') state.userCloudflareModel = { ...state.userCloudflareModel, ...parsed };
                else if (row.id === 'userOllamaModel' && typeof parsed === 'object') state.userOllamaModel = { ...state.userOllamaModel, ...parsed };
                else if (row.id === 'userXKiroModel' && typeof parsed === 'object') state.userXKiroModel = { ...state.userXKiroModel, ...parsed };
            } catch (err) {
                if (row.id === 'ownerAIMode') state.ownerAIMode = row.value;
            }
        }
    } catch (e) {
        console.warn('[DATABASE] Warning muat bot_settings ke state:', e.message);
    }

    // Simpan ke disk setelah init
    saveToDisk();

    console.log('[DATABASE] Tabel SQLite siap digunakan.');
}

/**
 * Simpan database ke disk (file).
 * sql.js menyimpan database di memory, jadi harus di-export ke file secara periodik.
 */
function saveToDisk() {
    if (!db) return;
    try {
        const data = db.export();
        const buffer = Buffer.from(data);
        // Atomic write: tulis ke tmp lalu rename
        const tmpPath = DB_PATH + '.tmp';
        fs.writeFileSync(tmpPath, buffer);
        fs.renameSync(tmpPath, DB_PATH);
    } catch (e) {
        console.error('[DATABASE] Gagal menyimpan ke disk:', e.message);
    }
}

/**
 * Minta simpan ke disk dengan debounce (2 detik delay).
 */
function scheduleSave() {
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
        saveToDisk();
        _saveTimer = null;
    }, 2000);
}

// ==========================================
// OPERASI CRUD GENERIK
// ==========================================

/**
 * Get satu baris dari tabel berdasarkan id.
 * @param {string} table
 * @param {string} id
 * @returns {object|null}
 */
function getOne(table, id) {
    if (!db) return null;
    const stmt = db.prepare(`SELECT * FROM ${table} WHERE id = ?`);
    stmt.bind([id]);
    if (stmt.step()) {
        const row = stmt.getAsObject();
        stmt.free();
        return row;
    }
    stmt.free();
    return null;
}

/**
 * Get semua baris dari tabel.
 * @param {string} table
 * @returns {Array<object>}
 */
function getAll(table) {
    if (!db) return [];
    const results = [];
    const stmt = db.prepare(`SELECT * FROM ${table}`);
    while (stmt.step()) {
        results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
}

/**
 * Upsert (insert or replace) satu baris.
 * @param {string} table
 * @param {object} data - { id: '...', kolom: value, ... }
 */
function upsert(table, data) {
    if (!db) return;
    const keys = Object.keys(data);
    const placeholders = keys.map(() => '?').join(', ');
    const values = keys.map(k => data[k]);
    db.run(`INSERT OR REPLACE INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`, values);
    scheduleSave();
}

/**
 * Delete satu baris berdasarkan id.
 * @param {string} table
 * @param {string} id
 */
function deleteOne(table, id) {
    if (!db) return;
    db.run(`DELETE FROM ${table} WHERE id = ?`, [id]);
    scheduleSave();
}

/**
 * Increment statistik global di tabel statistics.
 * @param {string} key
 */
function incrementStat(key) {
    if (!db) return;
    const existing = getOne('statistics', key);
    const currentVal = existing ? existing.value : 0;
    upsert('statistics', { id: key, value: currentVal + 1 });
}

// ==========================================
// MIGRASI JSON → SQLITE
// ==========================================

/**
 * Migrasi data dari file JSON lama ke SQLite.
 * Hanya berjalan sekali — setelah migrasi, file JSON di-rename ke .bak
 */
function migrateFromJSON() {
    const rootDir = path.join(__dirname, '..');

    // Helper: cek dan migrasikan satu file JSON
    function migrateFile(jsonFile, table, mapper) {
        const filePath = path.join(rootDir, jsonFile);
        if (!fs.existsSync(filePath)) return;

        try {
            const raw = fs.readFileSync(filePath, 'utf-8');
            const data = JSON.parse(raw);

            if (typeof data === 'object' && data !== null) {
                const entries = mapper(data);
                for (const entry of entries) {
                    upsert(table, entry);
                }
                console.log(`[MIGRASI] ${jsonFile} → ${table}: ${entries.length} entri berhasil dimigrasikan.`);
            }

            // Rename ke .bak
            fs.renameSync(filePath, filePath + '.bak');
            console.log(`[MIGRASI] ${jsonFile} di-rename ke ${jsonFile}.bak`);
        } catch (e) {
            console.error(`[MIGRASI] Gagal migrasi ${jsonFile}:`, e.message);
        }
    }

    // user_limit.json → user_limits
    migrateFile('user_limit.json', 'user_limits', (data) =>
        Object.entries(data).map(([id, amount]) => ({ id, amount }))
    );

    // user_roles.json → user_roles
    migrateFile('user_roles.json', 'user_roles', (data) =>
        Object.entries(data).map(([id, role]) => ({ id, role: typeof role === 'object' ? JSON.stringify(role) : role }))
    );

    // user_tugas.json → user_tugas
    migrateFile('user_tugas.json', 'user_tugas', (data) =>
        Object.entries(data).map(([id, d]) => ({ id, data: JSON.stringify(d) }))
    );

    // user_premium.json → user_premium (jika ada)
    migrateFile('user_premium.json', 'user_premium', (data) =>
        Object.entries(data).map(([id, val]) => ({
            id,
            expires_at: typeof val === 'boolean' ? (val ? 9999999999999 : 0) : (typeof val === 'number' ? val : 0)
        }))
    );

    // user_coba.json → user_coba
    migrateFile('user_coba.json', 'user_coba', (data) =>
        Object.entries(data).map(([id, d]) => ({ id, data: JSON.stringify(d) }))
    );

    // user_jadibot.json (jika ada)
    migrateFile('user_jadibot.json', 'user_jadibot', (data) =>
        Object.entries(data).map(([id, d]) => ({ id, data: JSON.stringify(d) }))
    );

    // panitia_agustus.json → panitia
    migrateFile('panitia_agustus.json', 'panitia', (data) =>
        Object.entries(data).map(([key, d]) => ({ key: key, data: JSON.stringify(d) }))
    );

    // Force save setelah migrasi
    saveToDisk();
}

function setSetting(key, value) {
    upsert('bot_settings', {
        id: key,
        value: typeof value === 'object' ? JSON.stringify(value) : String(value)
    });
}

// ==========================================
// EXPORT
// ==========================================

module.exports = {
    initDatabase,
    saveToDisk,
    getOne,
    getAll,
    upsert,
    deleteOne,
    incrementStat,
    migrateFromJSON,
    setSetting,
    getDb: () => db
};
