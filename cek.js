// File: cek.js
// Script untuk mengecek daftar model Gemini yang tersedia untuk SELURUH API Key di .env

require('dotenv').config();

const rawKeys = process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.split(',').map(k => k.trim()).filter(Boolean) : [];

function maskKey(key) {
    if (!key) return '';
    if (key.length <= 10) return key.slice(0, 3) + '***';
    return key.slice(0, 6) + '...' + key.slice(-4);
}

async function cekModel() {
    console.log("⏳ Nn... Sedang menyusup ke database Markas Pusat Google...");

    if (rawKeys.length === 0) {
        console.log("❌ Nn... GEMINI_API_KEY tidak ditemukan di file .env Sensei!");
        return;
    }

    console.log(`🔑 Ditemukan ${rawKeys.length} API Key di file .env.`);

    for (let i = 0; i < rawKeys.length; i++) {
        const key = rawKeys[i];
        const masked = maskKey(key);
        console.log(`\n==================================================`);
        console.log(`🔑 API Key #${i + 1} (${masked})`);
        console.log(`==================================================`);

        try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
            const data = await response.json();

            if (data.models) {
                console.log(`🏫 === DAFTAR MODEL UNTUK KEY #${i + 1} ===\n`);
                data.models.forEach(model => {
                    if (model.supportedGenerationMethods && model.supportedGenerationMethods.includes("generateContent")) {
                        const namaBersih = model.name.replace('models/', '');
                        console.log(`✅ Nama Model : ${namaBersih}`);
                        if (model.displayName) console.log(`   Display    : ${model.displayName}`);
                        if (model.description) console.log(`   Deskripsi  : ${model.description}`);
                        if (model.inputTokenLimit) console.log(`   Input Limit: ${model.inputTokenLimit} tokens`);
                        console.log("--------------------------------------------------");
                    }
                });
            } else if (data.error) {
                console.log(`❌ Key #${i + 1} Error (${data.error.code || 'API Error'}): ${data.error.message}`);
            } else {
                console.log(`❌ Gagal mengambil data dari server untuk Key #${i + 1}:`, data);
            }
        } catch (error) {
            console.error(`❌ Error saat menghubungi server untuk Key #${i + 1}:`, error.message);
        }
    }

    console.log("\nNn... Pencarian selesai untuk semua API Key, Sensei.");
}

cekModel();