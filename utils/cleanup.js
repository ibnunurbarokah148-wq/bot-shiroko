// ==========================================
// AUTO DISK CLEANUP UTILITY
// Membersihkan file-file sementara (temp media, sampah konversi)
// secara berkala agar kapasitas penyimpanan VPS tetap optimal.
// ==========================================
const fs = require('fs');
const path = require('path');

const MAX_AGE_MS = 60 * 60 * 1000; // 1 Jam

/**
 * Membersihkan file di folder tertentu jika umurnya melebihi MAX_AGE_MS
 * @param {string} dirPath 
 */
function cleanDirectory(dirPath) {
    if (!fs.existsSync(dirPath)) {
        try {
            fs.mkdirSync(dirPath, { recursive: true });
        } catch (e) {}
        return;
    }

    try {
        const files = fs.readdirSync(dirPath);
        const now = Date.now();
        let deletedCount = 0;

        for (const file of files) {
            const filePath = path.join(dirPath, file);
            try {
                const stat = fs.statSync(filePath);
                if (stat.isFile()) {
                    if (now - stat.mtimeMs > MAX_AGE_MS) {
                        fs.unlinkSync(filePath);
                        deletedCount++;
                    }
                }
            } catch (err) {
                // File mungkin sedang dikunci / digunakan
            }
        }

        if (deletedCount > 0) {
            console.log(`[Auto-Cleanup] Berhasil membersihkan ${deletedCount} file sampah di ${dirPath}`);
        }
    } catch (e) {
        console.error('[Auto-Cleanup Error]:', e.message);
    }
}

/**
 * Menjalankan pembersih otomatis secara berkala
 */
function startAutoCleanup() {
    const targetDirs = [
        path.join(__dirname, '..', 'temp'),
        path.join(__dirname, '..', 'tmp')
    ];

    // Jalankan pembersihan pertama kali saat bot start
    for (const dir of targetDirs) {
        cleanDirectory(dir);
    }

    // Set interval berkala setiap 30 menit
    setInterval(() => {
        for (const dir of targetDirs) {
            cleanDirectory(dir);
        }
    }, 30 * 60 * 1000);

    console.log('[Auto-Cleanup] Sistem pembersih disk otomatis aktif (Interval: 30 menit).');
}

module.exports = {
    cleanDirectory,
    startAutoCleanup
};
