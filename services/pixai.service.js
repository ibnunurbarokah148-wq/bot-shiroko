// ==========================================
// PIXAI SERVICE — Generator Gambar Anime PixAI.art
// ==========================================
const axios = require('axios');

// ==========================================
// SHARED QUEUE PIXAI (WhatsApp & Discord)
// ==========================================
const antrianPixAI = [];
let sedangRenderPixAI = false;

/**
 * Mendapatkan token PixAI dari .env
 */
function getPixaiToken() {
    return process.env.PIXAI_TOKEN || process.env.PIXAI_API_KEY || '';
}

/**
 * Membuat tugas generate gambar di PixAI.art
 * @param {string} prompt - Prompt teks (misal: "1girl, white hair, blue eyes")
 * @param {object} [options]
 * @param {string} [options.modelId] - Default model ID Anime/Realism
 * @param {number} [options.width=512]
 * @param {number} [options.height=768]
 * @param {number} [options.steps=20]
 * @returns {Promise<string>} taskId
 */
async function createGenerationTask(prompt, options = {}) {
    const token = getPixaiToken();
    if (!token) {
        throw new Error('PIXAI_TOKEN tidak ditemukan pada file .env! Harap tambahkan PIXAI_TOKEN ke .env.');
    }

    const modelId = options.modelId || process.env.PIXAI_MODEL_ID || '1648918127446573124'; // Default model Anime
    const steps = options.steps || 20;
    const width = options.width || 512;
    const height = options.height || 768;

    const authHeader = token.startsWith('Bearer ') ? token : `Bearer ${token}`;

    console.log(`[PIXAI] Mengirim permintaan ke PixAI API (Prompt: "${prompt}")...`);

    // Attempt 1: GraphQL createGenerationTask (Menggunakan Web API PixAI, mendukung NSFW untuk akun 18+)
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
            console.log(`[PIXAI] Task GraphQL berhasil dibuat! Task ID: ${taskIdGql}`);
            return taskIdGql;
        }
        if (resGql.data?.errors) {
            console.warn(`[PIXAI] GraphQL warning (${resGql.data.errors[0]?.message}), mencoba REST fallback...`);
        }
    } catch (eGql) {
        console.warn(`[PIXAI] GraphQL request gagal (${eGql.message}), mencoba REST fallback...`);
    }

    // Attempt 2: REST API v2 (Fallback)
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
            console.log(`[PIXAI] Task REST berhasil dibuat! Task ID: ${taskId}`);
            return taskId;
        }
    } catch (e1) {
        const errMsg = e1.response?.data?.message || e1.response?.data?.error || e1.message;
        throw new Error(`PixAI Task Creation Error: ${errMsg}`);
    }

    throw new Error('Gagal mendapatkan Task ID dari PixAI API');
}

/**
 * Polling status task hingga selesai dan mengambil URL gambar
 * @param {string} taskId
 * @param {number} [maxWaitSeconds=90]
 * @returns {Promise<string>} imageUrl
 */
async function pollTaskResult(taskId, maxWaitSeconds = 90) {
    const token = getPixaiToken();
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
                    // Extract mediaUrls dari outputs
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
    // Download gambar sebagai Buffer
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
