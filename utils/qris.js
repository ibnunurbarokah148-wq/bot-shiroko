// ==========================================
// UTILITY: QRIS DYNAMIC GENERATOR (EMVCo)
// Mengubah QRIS Statis menjadi Dinamis
// ==========================================

function calcCrc16(str) {
    let crc = 0xFFFF;
    for (let c = 0; c < str.length; c++) {
        let code = str.charCodeAt(c);
        crc ^= (code << 8);
        for (let i = 0; i < 8; i++) {
            if (crc & 0x8000) {
                crc = (crc << 1) ^ 0x1021;
            } else {
                crc = crc << 1;
            }
        }
    }
    crc = (crc & 0xFFFF).toString(16).toUpperCase();
    return crc.padStart(4, '0');
}

/**
 * Mengubah QRIS Statis DANA/Lainnya menjadi QRIS Dinamis dengan nominal tertentu.
 * @param {string} staticQris - Teks QRIS statis asli (diawali 000201...)
 * @param {number} amount - Nominal nominal pembayaran (misal: 15000)
 * @returns {string} - Hasil QRIS dinamis yang siap di-generate jadi QR Code
 */
function makeDynamicQris(staticQris, amount) {
    if (!staticQris) return '';

    // 1. Potong tag CRC16 di akhir (tag 63 dan nilainya, total 8 karakter di akhir)
    let qrisWithoutCrc = staticQris.slice(0, -4);
    if (qrisWithoutCrc.endsWith('6304')) {
        qrisWithoutCrc = qrisWithoutCrc.slice(0, -4);
    } else {
        const idx = qrisWithoutCrc.lastIndexOf('6304');
        if (idx !== -1) {
            qrisWithoutCrc = qrisWithoutCrc.slice(0, idx);
        }
    }

    // 2. Parse EMVCo tags
    const tags = {};
    let i = 0;
    while (i < qrisWithoutCrc.length) {
        const tag = qrisWithoutCrc.slice(i, i + 2);
        const len = parseInt(qrisWithoutCrc.slice(i + 2, i + 4), 10);
        const val = qrisWithoutCrc.slice(i + 4, i + 4 + len);
        
        if (tag && !isNaN(len)) {
            tags[tag] = val;
        }
        i += 4 + len;
    }

    // 3. Ubah Point of Initiation Method ke Dinamis (Tag 01 = '12')
    tags['01'] = '12';

    // 4. Set nominal pembayaran (Tag 54)
    tags['54'] = amount.toFixed(0);

    // 5. Rekonstruksi string dan urutkan tag secara alfabetis (standar EMVCo)
    let reconstructed = '';
    const sortedKeys = Object.keys(tags).sort();
    for (const key of sortedKeys) {
        const val = tags[key];
        const len = val.length.toString().padStart(2, '0');
        reconstructed += key + len + val;
    }

    // 6. Tambah tag 6304 dan kalkulasi CRC16 baru
    reconstructed += '6304';
    const crc = calcCrc16(reconstructed);

    return reconstructed + crc;
}

module.exports = {
    calcCrc16,
    makeDynamicQris
};
