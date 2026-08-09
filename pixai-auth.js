// ==========================================
// PIXAI AUTH & TOKEN GENERATOR TOOL
// Tool pembantu untuk memvalidasi, mendekode, dan mendatangkan Token API PixAI.art
// ==========================================
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const axios = require('axios');

/**
 * Mendekode payload JWT tanpa library tambahan
 */
function decodeJwt(token) {
    try {
        const cleanToken = token.replace(/^Bearer\s+/i, '').trim();
        const parts = cleanToken.split('.');
        if (parts.length !== 3) return null;

        // Base64Url decode
        let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        while (base64.length % 4) {
            base64 += '=';
        }

        const jsonStr = Buffer.from(base64, 'base64').toString('utf8');
        return JSON.parse(jsonStr);
    } catch (e) {
        return null;
    }
}

/**
 * Memeriksa status & masa aktif token PixAI saat ini
 */
async function checkTokenStatus(token) {
    if (!token) {
        console.log('❌ [ERROR] PIXAI_TOKEN kosong / tidak ditemukan pada .env!');
        return false;
    }

    const payload = decodeJwt(token);
    if (!payload) {
        console.log('⚠️ [WARNING] Token PixAI bukan dalam format JWT valid.');
    } else {
        console.log('----------------------------------------------------');
        console.log('📌 PIXAI TOKEN DETAILS:');
        console.log(`   • User ID  : ${payload.sub || 'N/A'}`);
        console.log(`   • Issued At: ${payload.iat ? new Date(payload.iat * 1000).toLocaleString('id-ID') : 'N/A'}`);
        if (payload.exp) {
            const expDate = new Date(payload.exp * 1000);
            const now = new Date();
            const diffDays = ((expDate - now) / (1000 * 60 * 60 * 24)).toFixed(1);
            console.log(`   • Expires  : ${expDate.toLocaleString('id-ID')} (${diffDays > 0 ? `${diffDays} Hari Tersisa` : 'KEDALUWARSA 🔴'})`);
        }
        console.log('----------------------------------------------------');
    }

    // Validasi langsung ke Server PixAI
    try {
        const authHeader = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
        console.log('🔍 Memverifikasi token ke Server PixAI.art API...');
        
        const res = await axios.get('https://api.pixai.art/v1/task/2042881824479252719', {
            headers: { 'Authorization': authHeader },
            timeout: 8000
        });

        if (res.status === 200 || res.data) {
            console.log('✅ [SUCCESS] Token PixAI VALID & Aktif! Siap digunakan untuk bot.');
            return true;
        }
    } catch (err) {
        if (err.response?.status === 401 || err.response?.status === 403) {
            console.log('❌ [FAIL] Token PixAI KEDALUWARSA atau DITOLAK oleh server PixAI (401/403).');
        } else {
            console.log(`⚠️ [NOTICE] Verifikasi server: ${err.message}`);
        }
    }
    return false;
}

/**
 * Menyimpan token baru ke file .env
 */
function saveTokenToEnv(newToken) {
    const envPath = path.join(__dirname, '.env');
    const cleanToken = newToken.trim();

    if (!fs.existsSync(envPath)) {
        fs.writeFileSync(envPath, `PIXAI_TOKEN=${cleanToken}\n`);
        console.log('✅ File .env baru berhasil dibuat dengan PIXAI_TOKEN!');
        return;
    }

    let envContent = fs.readFileSync(envPath, 'utf8');

    if (envContent.includes('PIXAI_TOKEN=')) {
        envContent = envContent.replace(/PIXAI_TOKEN=.*/g, `PIXAI_TOKEN=${cleanToken}`);
    } else {
        envContent += `\nPIXAI_TOKEN=${cleanToken}\n`;
    }

    fs.writeFileSync(envPath, envContent);
    console.log('✅ PIXAI_TOKEN berhasil diperbarui pada file .env!');
}

/**
 * Login via Email & Password ke API PixAI
 */
async function loginWithCredentials(email, password) {
    console.log(`\n🔑 Mencoba login ke PixAI API sebagai: ${email}...`);
    try {
        const res = await axios.post('https://api.pixai.art/v1/auth/login', {
            email: email,
            password: password
        }, {
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 12000
        });

        const token = res.data?.token || res.data?.accessToken || res.data?.data?.token;
        if (token) {
            console.log('🎉 [LOGIN SUKSES] Token berhasil didapatkan!');
            return token;
        } else {
            console.log('⚠️ Response server:', JSON.stringify(res.data));
            throw new Error('Server tidak mengembalikan token JWT.');
        }
    } catch (err) {
        const msg = err.response?.data?.message || err.response?.data?.error || err.message;
        throw new Error(`Login Gagal: ${msg}`);
    }
}

/**
 * CLI Menu Interaktif
 */
async function main() {
    console.log(`
==================================================
  🎨 PIXAI.ART AUTH & TOKEN GENERATOR TOOL 🐺
==================================================
`);

    const currentToken = process.env.PIXAI_TOKEN || '';
    if (currentToken) {
        await checkTokenStatus(currentToken);
    } else {
        console.log('ℹ️ Belum ada PIXAI_TOKEN yang terpasang pada .env');
    }

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const ask = (query) => new Promise(resolve => rl.question(query, resolve));

    console.log(`
Pilihan Menu:
1. 🔍 Cek Status Token Saat Ini
2. 🔑 Login & Generate Token Baru (Email & Password)
3. 📝 Tempel Token JWT Manual (Paste Token)
4. 🚪 Keluar
`);

    const choice = await ask('Pilih menu (1-4): ');

    if (choice === '1') {
        await checkTokenStatus(currentToken);
    } else if (choice === '2') {
        const email = await ask('Masukkan Email PixAI: ');
        const password = await ask('Masukkan Password PixAI: ');

        if (!email || !password) {
            console.log('❌ Email dan Password tidak boleh kosong!');
        } else {
            try {
                const token = await loginWithCredentials(email.trim(), password.trim());
                saveTokenToEnv(token);
                await checkTokenStatus(token);
            } catch (err) {
                console.log(`❌ ${err.message}`);
                console.log('\n💡 Tips: Jika login API terhadang Captcha, buka browser DevTools di pixai.art lalu salin JWT token dari LocalStorage / Authorization Header.');
            }
        }
    } else if (choice === '3') {
        const inputToken = await ask('\nTempelkan JWT Token PixAI Anda di sini:\n> ');
        if (!inputToken.trim()) {
            console.log('❌ Token tidak boleh kosong!');
        } else {
            saveTokenToEnv(inputToken.trim());
            await checkTokenStatus(inputToken.trim());
        }
    } else {
        console.log('Sampai jumpa, Sensei! 🐺✨');
    }

    rl.close();
}

if (require.main === module) {
    main();
}

module.exports = {
    decodeJwt,
    checkTokenStatus,
    saveTokenToEnv,
    loginWithCredentials
};
