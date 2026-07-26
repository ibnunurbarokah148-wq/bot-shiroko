// ID_OWNER dari .env (comma-separated), fallback ke hardcoded
const ID_OWNER = process.env.ID_OWNER
    ? process.env.ID_OWNER.split(',').map(s => s.trim())
    : ['6281298793016', '181488624615651'];
const JATAH_HARIAN = 20;

const DAFTAR_PAKET = {
    '1': { token: 50, harga: 5000 },
    '2': { token: 150, harga: 10000 },
    '3': { token: 500, harga: 25000 },
    '4': { token: 1500, harga: 50000 }
};

module.exports = {
    ID_OWNER,
    JATAH_HARIAN,
    DAFTAR_PAKET
};
