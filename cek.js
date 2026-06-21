// File: cek.js
// Script untuk mengecek daftar model Gemini yang tersedia

require('dotenv').config(); // Narik data dari .env

// Sesuaikan nama variabel 'GEMINI_API_KEY' dengan yang ada di file .env lu
const API_KEY = process.env.GEMINI_API_KEY; 

async function cekModel() {
    console.log("⏳ Nn... Sedang menyusup ke database Markas Pusat Google...");
    
    if (!API_KEY) {
        console.log("❌ Nn... API Key tidak ditemukan di file .env Sensei!");
        return;
    }

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`);
        const data = await response.json();

        if (data.models) {
            console.log("\n🏫 === DAFTAR MODEL YANG BISA SENSEI PAKAI === 🏫\n");
            
            data.models.forEach(model => {
                // Kita cuma filter model yang bisa dipakai buat chat/generate teks
                if (model.supportedGenerationMethods.includes("generateContent")) {
                    const namaBersih = model.name.replace('models/', ''); 
                    
                    console.log(`✅ Nama Model : ${namaBersih}`);
                    console.log(`   Deskripsi  : ${model.description}`);
                    console.log(`   Input Limit: ${model.inputTokenLimit} tokens`);
                    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
                }
            });
            console.log("\nNn... Pencarian selesai. Silakan pilih salah satu 'Nama Model' di atas untuk dimasukkan ke index.js.");
        } else {
            console.log("❌ Gagal mengambil data dari server:", data);
        }
    } catch (error) {
        console.error("❌ Error saat menghubungi server:", error);
    }
}

cekModel();