// ==========================================
// PIXAI SERVICE — Generator Gambar Anime PixAI.art
// ==========================================
const axios = require('axios');

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

    const payload = {
        prompt: prompt,
        modelVersionId: modelId,
        parameters: {
            width: width,
            height: height,
            steps: steps
        }
    };

    console.log(`[PIXAI] Mengirim permintaan ke PixAI API (Prompt: "${prompt}")...`);

    try {
        // Attempt 1: REST API v2
        const res = await axios.post('https://api.pixai.art/v2/image/create', payload, {
            headers: {
                'Authorization': authHeader,
                'Content-Type': 'application/json'
            },
            timeout: 15000
        });

        const taskId = res.data?.id || res.data?.taskId || res.data?.data?.id;
        if (taskId) {
            console.log(`[PIXAI] Task berhasil dibuat! Task ID: ${taskId}`);
            return taskId;
        }
    } catch (e1) {
        console.warn(`[PIXAI] Rest v2 gagal (${e1.message}), mencoba GraphQL fallback...`);
        // Attempt 2: GraphQL Fallback
        try {
            const graphqlQuery = {
                query: `
                    mutation createTask($input: CreateTaskInput!) {
                        createTask(input: $input) {
                            id
                            status
                        }
                    }
                `,
                variables: {
                    input: {
                        prompts: prompt,
                        modelId: modelId,
                        parameters: {
                            steps: steps,
                            width: width,
                            height: height
                        }
                    }
                }
            };

            const resGql = await axios.post('https://api.pixai.art/graphql', graphqlQuery, {
                headers: {
                    'Authorization': token,
                    'Content-Type': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                timeout: 15000
            });

            if (resGql.data?.data?.createTask?.id) {
                const taskIdGql = resGql.data.data.createTask.id;
                console.log(`[PIXAI] Task GraphQL berhasil dibuat! Task ID: ${taskIdGql}`);
                return taskIdGql;
            }
            if (resGql.data?.errors) {
                throw new Error(resGql.data.errors[0]?.message || 'GraphQL Error');
            }
        } catch (e2) {
            const errMsg1 = e1.response?.data?.message || e1.response?.data?.error || e1.message;
            const errMsg2 = e2.response?.data?.message || e2.message;
            console.error(`[PIXAI] Error Task Creation:`, errMsg1, errMsg2);
            throw new Error(`PixAI Task Creation Error: ${errMsg1} | ${errMsg2}`);
        }
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
    console.log(`[PIXAI] Buffer gambar siap (${buffer.length} bytes), mengirim ke WhatsApp...`);

    return { buffer, mime: contentType, imageUrl };
}

module.exports = {
    createGenerationTask,
    pollTaskResult,
    generateImage
};
