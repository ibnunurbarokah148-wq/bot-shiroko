// ==========================================
// DATABASE JSON & OPERASI FILE
// ==========================================
const fs = require('fs');
const { JATAH_HARIAN, ID_OWNER } = require('./constants');
const { getCoreNumber } = require('../utils/helpers');

// Path file database
const limitFile = './user_limit.json';
const roleFile = './user_roles.json';
const tugasFile = './user_tugas.json';
const panitiaFile = './panitia_agustus.json';
const cobaFile = './user_coba.json';

// Muat database dari file JSON
let dbLimit = fs.existsSync(limitFile) ? JSON.parse(fs.readFileSync(limitFile, 'utf-8')) : {};
let dbRole = fs.existsSync(roleFile) ? JSON.parse(fs.readFileSync(roleFile, 'utf-8')) : {};
let dbTugas = fs.existsSync(tugasFile) ? JSON.parse(fs.readFileSync(tugasFile, 'utf-8')) : {};
let dbPanitia = fs.existsSync(panitiaFile) ? JSON.parse(fs.readFileSync(panitiaFile, 'utf-8')) : { "ketua": { "anggota": [], "timeline": [] } };
let dbCoba = fs.existsSync(cobaFile) ? JSON.parse(fs.readFileSync(cobaFile, 'utf-8')) : {};

// Simpan dengan metode aman (write tmp lalu rename)
function simpanAman(namaFile, data) {
    try {
        const tmpFile = namaFile + '.tmp';
        fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2));
        fs.renameSync(tmpFile, namaFile);
    } catch (e) {
        console.error(`Gagal menyimpan ke ${namaFile}:`, e.message);
    }
}

const simpanDB = () => simpanAman(limitFile, dbLimit);
const simpanRole = () => simpanAman(roleFile, dbRole);
const simpanTugas = () => simpanAman(tugasFile, dbTugas);
const simpanPanitia = () => simpanAman(panitiaFile, dbPanitia);
const simpanCoba = () => simpanAman(cobaFile, dbCoba);

// Cek limit dan potong 1 token (dengan bypass Owner)
function cekDanPotongLimit(targetID, amount = 1) {
    const coreTarget = getCoreNumber(targetID);
    // Owner bypass — unlimited
    if (ID_OWNER.some(owner => getCoreNumber(owner) === coreTarget)) return true;

    if (dbLimit[targetID] === undefined) {
        dbLimit[targetID] = JATAH_HARIAN;
    }
    if (dbLimit[targetID] <= 0) return false;

    dbLimit[targetID] -= amount;
    simpanDB();
    return true;
}

// Kembalikan token if operation fails (default 1)
function kembalikanLimit(targetID, amount = 1) {
    if (dbLimit[targetID] !== undefined) {
        dbLimit[targetID] += amount;
        simpanDB();
    }
}

module.exports = {
    dbLimit, dbRole, dbTugas, dbPanitia, dbCoba,
    simpanDB, simpanRole, simpanTugas, simpanPanitia, simpanCoba,
    getCoreNumber, // Re-export dari utils/helpers untuk kemudahan
    cekDanPotongLimit, kembalikanLimit
};
