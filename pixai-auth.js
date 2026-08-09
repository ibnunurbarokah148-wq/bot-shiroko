// ==========================================
// PIXAI AUTH & MULTI-TOKEN POOL MANAGER
// Tool pembantu untuk memvalidasi, auto-refresh, dan mengelola Multi-Token API PixAI.art
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
 * Pangkas token yang kedaluwarsa dari pool secara otomatis
 * @returns {string[]} Array token aktif yang valid
 */
function pruneExpiredTokens() {
    const raw = process.env.PIXAI_TOKEN || process.env.PIXAI_API_KEY || '';
    const currentTokens = raw.split(',').map(t => t.trim()).filter(Boolean);
    const now = Math.floor(Date.now() / 1000);

    const validTokens = currentTokens.filter(token => {
        const payload = decodeJwt(token);
        if (!payload || !payload.exp) return true; // Pertahankan token tanpa JWT standard
        return payload.exp > (now + 60); // Hapus token yang sudah / akan kedaluwarsa dalam 1 menit
    });

    if (validTokens.length !== currentTokens.length) {
        console.log(`🧹 [TOKEN CLEANUP] Menghapus ${currentTokens.length - validTokens.length} token PixAI yang kedaluwarsa dari pool.`);
        saveTokenPoolToEnv(validTokens);
    }
    return validTokens;
}

/**
 * Menghapus token spesifik dari .env pool jika terdeteksi 401 / Invalid dari API
 * @param {string} badToken
 */
function removeTokenFromEnv(badToken) {
    if (!badToken) return;
    const cleanBad = badToken.trim().replace(/^Bearer\s+/i, '');
    const raw = process.env.PIXAI_TOKEN || process.env.PIXAI_API_KEY || '';
    const currentTokens = raw.split(',').map(t => t.trim()).filter(Boolean);
    const filtered = currentTokens.filter(t => t.trim().replace(/^Bearer\s+/i, '') !== cleanBad);

    if (filtered.length !== currentTokens.length) {
        console.log(`🗑️ [TOKEN PRUNED] Token (401 Unauthorized) berhasil dihapus dari .env pool.`);
        saveTokenPoolToEnv(filtered);
    }
}

/**
 * Mendapatkan seluruh daftar token PixAI dari .env (Multi-Token Pool)
 * @returns {string[]} Array token
 */
function getAllTokens() {
    return pruneExpiredTokens();
}

/**
 * Menyimpan array token ke file .env dan memori runtime
 * @param {string[]} tokens
 */
function saveTokenPoolToEnv(tokens) {
    const envPath = path.join(__dirname, '.env');
    const uniqueTokens = [...new Set(tokens.map(t => t.trim()).filter(Boolean))];
    const joinedStr = uniqueTokens.join(',');

    process.env.PIXAI_TOKEN = joinedStr; // Update runtime memory!

    if (!fs.existsSync(envPath)) {
        fs.writeFileSync(envPath, `PIXAI_TOKEN=${joinedStr}\n`);
        console.log('✅ File .env baru berhasil dibuat dengan PIXAI_TOKEN pool!');
        return;
    }

    let envContent = fs.readFileSync(envPath, 'utf8');

    if (envContent.includes('PIXAI_TOKEN=')) {
        envContent = envContent.replace(/PIXAI_TOKEN=.*/g, `PIXAI_TOKEN=${joinedStr}`);
    } else {
        envContent += `\nPIXAI_TOKEN=${joinedStr}\n`;
    }

    fs.writeFileSync(envPath, envContent);
    console.log(`✅ PIXAI_TOKEN pool (${uniqueTokens.length} token) berhasil disimpan ke .env!`);
}

/**
 * Menambahkan token baru ke pool di .env
 * @param {string} newToken
 */
function addTokenToEnv(newToken) {
    const currentTokens = getAllTokens();
    const cleanToken = newToken.trim();
    if (!cleanToken) return;

    if (!currentTokens.includes(cleanToken)) {
        currentTokens.push(cleanToken);
        saveTokenPoolToEnv(currentTokens);
    } else {
        console.log('ℹ️ Token ini sudah ada di dalam pool.');
    }
}

/**
 * Memeriksa sisa Credit/Poin akun PixAI dari Token
 * @param {string} token
 * @returns {Promise<string>} Jumlah credit atau status
 */
async function getUserCredits(token) {
    if (!token) return 'N/A';
    const authHeader = token.startsWith('Bearer ') ? token : `Bearer ${token}`;

    const gqlQueries = [
        `query { me { id username credit } }`,
        `query { me { id username points } }`,
        `query { me { id username credits } }`
    ];

    for (const query of gqlQueries) {
        try {
            const res = await axios.post('https://api.pixai.art/graphql', { query }, {
                headers: {
                    'Authorization': authHeader,
                    'Content-Type': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                timeout: 6000,
                validateStatus: () => true
            });

            const me = res.data?.data?.me;
            if (me) {
                const val = me.credit ?? me.credits ?? me.points;
                if (val !== undefined && val !== null) {
                    return Number(val).toLocaleString('id-ID');
                }
            }
        } catch (e) {}
    }

    return 'Tersedia 🟢';
}

/**
 * Memeriksa status & masa aktif token PixAI
 */
async function checkTokenStatus(token) {
    if (!token) {
        console.log('❌ [ERROR] Token kosong / tidak valid!');
        return false;
    }

    const payload = decodeJwt(token);
    if (payload) {
        console.log('----------------------------------------------------');
        console.log('📌 PIXAI TOKEN DETAILS:');
        console.log(`   • User ID  : ${payload.sub || 'N/A'}`);
        console.log(`   • Issued At: ${payload.iat ? new Date(payload.iat * 1000).toLocaleString('id-ID') : 'N/A'}`);
        if (payload.exp) {
            const expDate = new Date(payload.exp * 1000);
            const now = new Date();
            const diffDays = ((expDate - now) / (1000 * 60 * 60 * 24)).toFixed(1);
            console.log(`   • Expires  : ${expDate.toLocaleString('id-ID')} (${diffDays > 0 ? `${diffDays} Hari Tersisa 🟢` : 'KEDALUWARSA 🔴'})`);
        }
        console.log('----------------------------------------------------');
    }

    try {
        const authHeader = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
        const res = await axios.get('https://api.pixai.art/v1/task/2042881824479252719', {
            headers: { 'Authorization': authHeader },
            timeout: 8000
        });

        if (res.status === 200 || res.data) {
            console.log('✅ [SUCCESS] Token PixAI VALID & Aktif!');
            return true;
        }
    } catch (err) {
        if (err.response?.status === 401 || err.response?.status === 403) {
            console.log('❌ [FAIL] Token PixAI KEDALUWARSA atau DITOLAK (401/403).');
        } else {
            console.log(`⚠️ [NOTICE] Status server: ${err.message}`);
        }
    }
    return false;
}

/**
 * Login via Email & Password ke API PixAI
 */
async function loginWithCredentials(email, password) {
    console.log(`🔑 Login ke PixAI API sebagai: ${email}...`);
    try {
        const query = `
            mutation login($input: RegisterOrLoginInput!) {
                login(input: $input) {
                    id
                    email
                }
            }
        `;
        const res = await axios.post('https://api.pixai.art/graphql', {
            query,
            variables: {
                input: { email, password }
            }
        }, {
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 12000
        });

        if (res.data?.errors) {
            const errCode = res.data.errors[0]?.message;
            if (errCode && errCode.includes('recaptcha')) {
                throw new Error('PixAI memerlukan verifikasi reCAPTCHA. Gunakan !setpixai [JWT_TOKEN] dari DevTools browser.');
            }
            throw new Error(errCode || 'Login Gagal');
        }

        const token = res.headers['authorization'] || res.data?.data?.login?.token;
        if (token) {
            console.log(`🎉 [LOGIN SUKSES] Token didapatkan untuk ${email}!`);
            return token;
        } else {
            throw new Error('Server PixAI membutuhkan token reCAPTCHA.');
        }
    } catch (err) {
        const msg = err.response?.data?.errors?.[0]?.message || err.message;
        throw new Error(`Login ${email} Gagal: ${msg}`);
    }
}

/**
 * Auto-Refresh seluruh akun dari PIXAI_CREDENTIALS di .env
 * Format PIXAI_CREDENTIALS: "email1:pass1,email2:pass2"
 */
async function refreshAllCredentials() {
    const rawCreds = process.env.PIXAI_CREDENTIALS || '';
    if (!rawCreds.trim()) {
        console.log('ℹ️ PIXAI_CREDENTIALS tidak diatur pada file .env (Format: "email1:pass1,email2:pass2")');
        return false;
    }

    const credList = rawCreds.split(',').map(c => c.trim()).filter(Boolean);
    console.log(`🔄 Memulai Auto-Refresh untuk ${credList.length} akun PixAI...`);

    const newTokens = [];
    for (const cred of credList) {
        const [email, password] = cred.split(':');
        if (email && password) {
            try {
                const token = await loginWithCredentials(email.trim(), password.trim());
                newTokens.push(token);
            } catch (err) {
                console.error(`❌ Gagal refresh akun ${email}:`, err.message);
            }
        }
    }

    if (newTokens.length > 0) {
        saveTokenPoolToEnv(newTokens);
        console.log(`🎉 [AUTO-REFRESH SUKSES] ${newTokens.length} Token PixAI berhasil diperbarui ke .env!`);
        return true;
    }
    return false;
}

/**
 * CLI Menu Interaktif
 */
async function main() {
    console.log(`
==================================================
  🎨 PIXAI.ART MULTI-TOKEN MANAGER & AUTO-REFRESH 🐺
==================================================
`);

    const tokens = getAllTokens();
    console.log(`📊 Terdeteksi ${tokens.length} Token pada PIXAI_TOKEN Pool.`);
    
    for (let i = 0; i < tokens.length; i++) {
        console.log(`\n🔍 Checking Token #${i + 1}/${tokens.length}:`);
        await checkTokenStatus(tokens[i]);
    }

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const ask = (query) => new Promise(resolve => rl.question(query, resolve));

    console.log(`
Pilihan Menu:
1. 🔍 Cek Status Seluruh Token Pool
2. 🔄 Jalankan Auto-Refresh Akun (via PIXAI_CREDENTIALS)
3. 🔑 Tambah Akun Baru (Login Email & Password)
4. 📝 Tambah Token Manual ke Pool (Paste Token)
5. 🚪 Keluar
`);

    const choice = await ask('Pilih menu (1-5): ');

    if (choice === '1') {
        const currentTokens = getAllTokens();
        for (let i = 0; i < currentTokens.length; i++) {
            console.log(`\n🔍 Checking Token #${i + 1}/${currentTokens.length}:`);
            await checkTokenStatus(currentTokens[i]);
        }
    } else if (choice === '2') {
        await refreshAllCredentials();
    } else if (choice === '3') {
        const email = await ask('Masukkan Email PixAI: ');
        const password = await ask('Masukkan Password PixAI: ');

        if (!email || !password) {
            console.log('❌ Email dan Password tidak boleh kosong!');
        } else {
            try {
                const token = await loginWithCredentials(email.trim(), password.trim());
                addTokenToEnv(token);
                await checkTokenStatus(token);
            } catch (err) {
                console.log(`❌ ${err.message}`);
                console.log('💡 Jika login terhadang Captcha, gunakan menu 4 untuk menempelkan token dari browser.');
            }
        }
    } else if (choice === '4') {
        const inputToken = await ask('\nTempelkan Token PixAI Baru di sini:\n> ');
        if (!inputToken.trim()) {
            console.log('❌ Token tidak boleh kosong!');
        } else {
            addTokenToEnv(inputToken.trim());
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
    getAllTokens,
    getUserCredits,
    pruneExpiredTokens,
    removeTokenFromEnv,
    saveTokenPoolToEnv,
    addTokenToEnv,
    checkTokenStatus,
    loginWithCredentials,
    refreshAllCredentials
};

// Prune token kedaluwarsa secara otomatis saat module di-load
try {
    pruneExpiredTokens();
} catch (e) {}
