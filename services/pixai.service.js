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

    const modelId = options.modelId || '1648918127446573124'; // Default model (Anime)
    const steps = options.steps || 20;
    const width = options.width || 512;
    const height = options.height || 768;

    const authHeader = token.startsWith('Bearer ') ? token : `Bearer ${token}`;

    try {
        // Attempt 1: REST API v2
        const res = await axios.post('https://api.pixai.art/v2/image/create', {
            prompt: prompt,
            modelVersionId: modelId,
            aspectRatio: `${width}:${height}`,
            mode: 'fast'
        }, {
            headers: {
                'Authorization': authHeader,
                'Content-Type': 'application/json'
            },
            timeout: 15000
        });

        if (res.data && (res.data.id || res.data.taskId || res.data.data?.id)) {
            return res.data.id || res.data.taskId || res.data.data?.id;
        }
    } catch (e1) {
        // Attempt 2: GraphQL Fallback (Compatible dengan unofficial wrapper)
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
                return resGql.data.data.createTask.id;
            }
            if (resGql.data?.errors) {
                throw new Error(resGql.data.errors[0]?.message || 'GraphQL Error');
            }
        } catch (e2) {
            const errMsg = e2.response?.data?.message || e2.message;
            throw new Error(`PixAI Task Creation Error: ${errMsg}`);
        }
    }

    throw new Error('Gagal mendapatkan Task ID dari PixAI API');
}

/**
 * Polling status task hingga selesai dan mengambil URL gambar
 * @param {string} taskId
 * @param {number} [maxWaitSeconds=60]
 * @returns {Promise<string>} imageUrl
 */
async function pollTaskResult(taskId, maxWaitSeconds = 60) {
    const token = getPixaiToken();
    const authHeader = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
    const startTime = Date.now();

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
                if (taskData.status === 'completed' || taskData.status === 'SUCCESS' || taskData.status === 'FINISHED') {
                    const urls = taskData.mediaUrls || taskData.urls || taskData.outputs;
                    if (Array.isArray(urls) && urls.length > 0) {
                        return typeof urls[0] === 'string' ? urls[0] : (urls[0].url || urls[0].mediaUrl);
                    }
                    if (taskData.url) return taskData.url;
                } else if (taskData.status === 'failed' || taskData.status === 'FAILED' || taskData.status === 'ERROR') {
                    throw new Error(`Task PixAI gagal diproses oleh server (${taskData.errorMessage || 'Error'}).`);
                }
            }
        } catch (errRest) {
            // 2. Fallback via GraphQL
            try {
                const gqlQuery = {
                    query: `
                        query getTask($id: String!) {
                            getTaskById(id: $id) {
                                id
                                status
                                outputs {
                                    mediaUrl
                                }
                            }
                        }
                    `,
                    variables: { id: taskId }
                };

                const resGql = await axios.post('https://api.pixai.art/graphql', gqlQuery, {
                    headers: {
                        'Authorization': token,
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000
                });

                const taskGql = resGql.data?.data?.getTaskById;
                if (taskGql) {
                    if (taskGql.status === 'completed' || taskGql.status === 'SUCCESS' || taskGql.status === 'FINISHED') {
                        if (taskGql.outputs && taskGql.outputs.length > 0) {
                            return taskGql.outputs[0].mediaUrl;
                        }
                    } else if (taskGql.status === 'failed' || taskGql.status === 'FAILED') {
                        throw new Error('Task PixAI gagal diproses.');
                    }
                }
            } catch (eGql) {}
        }
    }

    throw new Error('Timeout: PixAI membutuhkan waktu terlalu lama untuk generate gambar.');
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

    // Download gambar sebagai Buffer
    const imgRes = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 30000
    });

    const buffer = Buffer.from(imgRes.data);
    const contentType = imgRes.headers['content-type'] || 'image/png';

    return { buffer, mime: contentType, imageUrl };
}

module.exports = {
    createGenerationTask,
    pollTaskResult,
    generateImage
};
