// ==========================================
// PIXAI SERVICE — Generator Gambar Anime PixAI.art
// Multi-Token Pool & Auto-Refresh Integration
// ==========================================
const axios = require('axios');
const pixaiAuth = require('../pixai-auth');

// ==========================================
// SHARED QUEUE PIXAI (WhatsApp & Discord)
// ==========================================
const antrianPixAI = [];
let sedangRenderPixAI = false;
let currentTokenIndex = 0;

/**
 * Mendapatkan seluruh token PixAI aktif dari pool
 */
function getPixaiTokens() {
    return pixaiAuth.getAllTokens();
}

/**
 * Membuat tugas generate gambar di PixAI.art dengan rotasi & failover Multi-Token
 * @param {string} prompt - Prompt teks (misal: "1girl, white hair, blue eyes")
 * @param {object} [options]
 * @param {string} [options.modelId] - Default model ID Anime/Realism
 * @param {number} [options.width=512]
 * @param {number} [options.height=768]
 * @param {number} [options.steps=20]
 * @returns {Promise<string>} taskId
 */
async function createGenerationTask(prompt, options = {}) {
    let tokens = getPixaiTokens();
    
    // Jika token pool kosong tapi ada PIXAI_CREDENTIALS, jalankan auto-refresh dulu
    if (tokens.length === 0 && process.env.PIXAI_CREDENTIALS) {
        console.log('[PIXAI] Memulai auto-refresh kredensial pertama kali...');
        await pixaiAuth.refreshAllCredentials();
        tokens = getPixaiTokens();
    }

    if (tokens.length === 0) {
        throw new Error('PIXAI_TOKEN tidak ditemukan pada file .env! Harap tambahkan PIXAI_TOKEN ke .env.');
    }

    const modelId = options.modelId || process.env.PIXAI_MODEL_ID || '1648918127446573124'; // Default model Anime
    const steps = options.steps || 20;
    const width = options.width || 512;
    const height = options.height || 768;

    let lastError = null;

    // Rotasi & Failover Multi-Token Pool
    for (let attempt = 0; attempt < tokens.length; attempt++) {
        const tokenIdx = (currentTokenIndex + attempt) % tokens.length;
        const token = tokens[tokenIdx];
        const authHeader = token.startsWith('Bearer ') ? token : `Bearer ${token}`;

        console.log(`[PIXAI] Mengirim permintaan ke PixAI API menggunakan Token #${tokenIdx + 1}/${tokens.length} (Prompt: "${prompt}")...`);

        // Attempt 1: GraphQL createGenerationTask (Sama dengan Web API PixAI)
        try {
            const graphqlQuery = {
                query: `
                    mutation createGenerationTask($parameters: JSONObject!) {
                        createGenerationTask(parameters: $parameters) {
                            id
                            status
                        }
                    }
                `,
                variables: {
                    parameters: {
                        prompts: prompt,
                        modelId: modelId,
                        steps: steps,
                        width: width,
                        height: height
                    }
                }
            };

            const resGql = await axios.post('https://api.pixai.art/graphql', graphqlQuery, {
                headers: {
                    'Authorization': authHeader,
                    'Content-Type': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                timeout: 15000
            });

            const taskIdGql = resGql.data?.data?.createGenerationTask?.id || resGql.data?.data?.createTask?.id;
            if (taskIdGql) {
                console.log(`[PIXAI] Task GraphQL berhasil dibuat (Token #${tokenIdx + 1})! Task ID: ${taskIdGql}`);
                currentTokenIndex = (tokenIdx + 1) % tokens.length; // Rotasi untuk request selanjutnya
                return taskIdGql;
            }
        } catch (eGql) {
            console.warn(`[PIXAI] Token #${tokenIdx + 1} GraphQL gagal (${eGql.message}), mencoba REST fallback...`);
            lastError = eGql;
        }

        // Attempt 2: REST API v2 Fallback
        try {
            const payload = {
                prompt: prompt,
                modelVersionId: modelId,
                parameters: {
                    width: width,
                    height: height,
                    steps: steps
                }
            };

            const res = await axios.post('https://api.pixai.art/v2/image/create', payload, {
                headers: {
                    'Authorization': authHeader,
                    'Content-Type': 'application/json'
                },
                timeout: 15000
            });

            const taskId = res.data?.id || res.data?.taskId || res.data?.data?.id;
            if (taskId) {
                console.log(`[PIXAI] Task REST berhasil dibuat (Token #${tokenIdx + 1})! Task ID: ${taskId}`);
                currentTokenIndex = (tokenIdx + 1) % tokens.length;
                return taskId;
            }
        } catch (e1) {
            const errMsg = e1.response?.data?.message || e1.response?.data?.error || e1.message;
            console.warn(`[PIXAI] Token #${tokenIdx + 1} REST gagal (${errMsg}). Menguji token berikutnya...`);
            lastError = e1;
        }
    }

    // Emergency Auto-Refresh jika seluruh token pool gagal
    if (process.env.PIXAI_CREDENTIALS) {
        console.log('[PIXAI EMERGENCY] Seluruh token pool gagal/kedaluwarsa. Mencoba Emergency Auto-Refresh...');
        const refreshed = await pixaiAuth.refreshAllCredentials();
        if (refreshed) {
            const freshTokens = getPixaiTokens();
            if (freshTokens.length > 0) {
                const freshToken = freshTokens[0];
                const authHeader = freshToken.startsWith('Bearer ') ? freshToken : `Bearer ${freshToken}`;

                const graphqlQuery = {
                    query: `
                        mutation createGenerationTask($parameters: JSONObject!) {
                            createGenerationTask(parameters: $parameters) {
                                id
                                status
                            }
                        }
                    `,
                    variables: {
                        parameters: {
                            prompts: prompt,
                            modelId: modelId,
                            steps: steps,
                            width: width,
                            height: height
                        }
                    }
                };

                const resGql = await axios.post('https://api.pixai.art/graphql', graphqlQuery, {
                    headers: {
                        'Authorization': authHeader,
                        'Content-Type': 'application/json',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    },
                    timeout: 15000
                });

                const taskIdRefreshed = resGql.data?.data?.createGenerationTask?.id || resGql.data?.data?.createTask?.id;
                if (taskIdRefreshed) {
                    console.log(`[PIXAI EMERGENCY] Task berhasil dibuat setelah Auto-Refresh! Task ID: ${taskIdRefreshed}`);
                    return taskIdRefreshed;
                }
            }
        }
    }

    const finalErrMsg = lastError?.response?.data?.message || lastError?.message || 'Seluruh Token PixAI Gagal / Kedaluwarsa';
    throw new Error(`PixAI Task Creation Error: ${finalErrMsg}`);
}

/**
 * Polling status task hingga selesai dan mengambil URL gambar
 * @param {string} taskId
 * @param {number} [maxWaitSeconds=90]
 * @returns {Promise<string>} imageUrl
 */
async function pollTaskResult(taskId, maxWaitSeconds = 90) {
    const tokens = getPixaiTokens();
    const token = tokens[0] || process.env.PIXAI_TOKEN || '';
    const authHeader = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
    const startTime = Date.now();

    console.log(`[PIXAI] Memulai polling status untuk Task ID: ${taskId}...`);

    while ((Date.now() - startTime) < maxWaitSeconds * 1000) {
        await new Promise(resolve => setTimeout(resolve, 3000)); // Polling tiap 3 detik

        // 1. Cek via REST v1/v2
        try {
            const res = await axios.get(`https://api.pixai.art/v1/task/${taskId}`, {
                headers: { 'Authorization': authHeader },
                timeout: 10000
            });

            const taskData = res.data?.data || res.data;
            if (taskData) {
                console.log(`[PIXAI] Status Task ${taskId}: ${taskData.status}`);
                if (taskData.status === 'completed' || taskData.status === 'SUCCESS' || taskData.status === 'FINISHED') {
                    const mediaUrls = taskData.outputs?.mediaUrls || taskData.mediaUrls || taskData.urls;
                    if (Array.isArray(mediaUrls) && mediaUrls.length > 0) {
                        const urlResult = typeof mediaUrls[0] === 'string' ? mediaUrls[0] : (mediaUrls[0].url || mediaUrls[0].mediaUrl);
                        console.log(`[PIXAI] Render selesai! URL Gambar: ${urlResult}`);
                        return urlResult;
                    }
                    if (taskData.url) {
                        console.log(`[PIXAI] Render selesai! URL Gambar: ${taskData.url}`);
                        return taskData.url;
                    }
                } else if (taskData.status === 'failed' || taskData.status === 'FAILED' || taskData.status === 'ERROR') {
                    throw new Error(`Task PixAI gagal diproses oleh server (${taskData.errorMessage || 'Error'}).`);
                }
            }
        } catch (errRest) {
            if (errRest.message.includes('gagal diproses')) throw errRest;
        }
    }

    throw new Error('Timeout: PixAI membutuhkan waktu terlalu lama untuk generate gambar (melebihi 90 detik).');
}

/**
 * Shortcut: Generate gambar dari prompt dan mengembalikan Buffer gambar
 * @param {string} prompt
 * @param {object} [options]
 * @returns {Promise<{buffer: Buffer, mime: string, imageUrl: string}>}
 */
async function generateImage(prompt, options = {}) {
    const taskId = await createGenerationTask(prompt, options);
    const imageUrl = await pollTaskResult(taskId);

    console.log(`[PIXAI] Mengunduh buffer gambar dari URL...`);
    const imgRes = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 30000
    });

    const buffer = Buffer.from(imgRes.data);
    const contentType = imgRes.headers['content-type'] || 'image/png';
    console.log(`[PIXAI] Buffer gambar siap (${buffer.length} bytes)...`);

    return { buffer, mime: contentType, imageUrl };
}

/**
 * Memproses antrean PixAI satu per satu secara berurutan
 */
async function prosesAntrianPixAI() {
    if (sedangRenderPixAI || antrianPixAI.length === 0) return;

    sedangRenderPixAI = true;
    const item = antrianPixAI[0];
    const { prompt, options, isDiscord, reply, sendImage, onSuccess, onError } = item;

    try {
        console.log(`[PIXAI QUEUE] Memproses pesanan (Sisa antrean: ${antrianPixAI.length}). Prompt: "${prompt}"...`);
        const { buffer, mime, imageUrl } = await generateImage(prompt, options);

        if (isDiscord && sendImage) {
            await sendImage(buffer, `🎨 **[ PIXAI.ART GENERATED ]**\n\n*Prompt:* ${prompt}\n*Engine:* PixAI.art Anime Generator`);
        } else if (onSuccess) {
            await onSuccess(buffer, mime, imageUrl);
        }

        antrianPixAI.shift(); // Hapus item yang selesai
    } catch (err) {
        console.error(`[PIXAI QUEUE ERROR]:`, err.message);
        antrianPixAI.shift(); // Hapus item jika error agar antrean tidak macet
        if (onError) {
            await onError(err);
        } else if (reply) {
            await reply(`❌ Nn... Gagal generate gambar via PixAI:\n_${err.message}_`);
        }
    } finally {
        sedangRenderPixAI = false;
        if (antrianPixAI.length > 0) {
            setTimeout(() => prosesAntrianPixAI(), 1000);
        }
    }
}

/**
 * Menambahkan pesanan baru ke dalam antrean PixAI
 */
function tambahAntrianPixAI(pesanan) {
    antrianPixAI.push(pesanan);
    prosesAntrianPixAI();
    return antrianPixAI.length;
}

module.exports = {
    createGenerationTask,
    pollTaskResult,
    generateImage,
    antrianPixAI,
    prosesAntrianPixAI,
    tambahAntrianPixAI
};
