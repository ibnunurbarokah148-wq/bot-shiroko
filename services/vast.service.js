const axios = require('axios');

let currentComfyUrl = "http://127.0.0.1:18188"; // Default jika tidak pakai port dinamis Vast
let currentJupyterToken = null; // Token untuk basic auth Nginx

/**
 * Mendapatkan status instance Vast.ai saat ini
 * @returns {Promise<Object>} Data instance termasuk status dan port mapping
 */
async function getVastInstanceStatus() {
    const apiKey = process.env.VAST_API_KEY;
    const instanceId = process.env.VAST_INSTANCE_ID;
    if (!apiKey || !instanceId) throw new Error("API Key atau Instance ID Vast belum disetel di .env");

    const res = await axios.get(`https://console.vast.ai/api/v1/instances/?api_key=${apiKey}`);
    const instances = res.data.instances;
    if (!instances) throw new Error("Gagal mengambil data dari Vast.ai");

    const instance = instances.find(inst => String(inst.id) === String(instanceId));
    if (!instance) throw new Error(`Instance dengan ID ${instanceId} tidak ditemukan di akun Anda.`);

    return instance;
}

/**
 * Mengecek apakah mesin sedang menyala, dan mengekstrak URL ComfyUI secara dinamis (jika ada)
 * @returns {Promise<boolean>} true jika menyala, false jika mati
 */
async function checkIsRunning() {
    try {
        const instance = await getVastInstanceStatus();
        
        if (instance.actual_status === 'running') {
            // Ambil token otentikasi
            if (instance.jupyter_token) {
                currentJupyterToken = instance.jupyter_token;
            }

            // Coba cari port 8188 (ComfyUI) yang diekspos oleh Vast.ai
            if (instance.ports && instance.ports["8188/tcp"]) {
                const portMap = instance.ports["8188/tcp"][0];
                if (portMap && portMap.HostPort) {
                    currentComfyUrl = `http://${instance.public_ipaddr}:${portMap.HostPort}`;
                }
            } else if (instance.public_ipaddr && instance.ports) {
                // Fallback pencarian port direct
                for (const key in instance.ports) {
                    if (key.includes('8188')) {
                        const portMap = instance.ports[key][0];
                        currentComfyUrl = `http://${instance.public_ipaddr}:${portMap.HostPort}`;
                        break;
                    }
                }
            }
            
            console.log(`[VAST DEBUG] Token: ${currentJupyterToken ? 'ADA' : 'KOSONG'}, URL: ${currentComfyUrl}`);
            return true;
        }
        return false;
    } catch (error) {
        console.error("Vast.ai API Error (check):", error.message);
        return false;
    }
}

/**
 * Menyalakan mesin Vast.ai
 */
async function startVastInstance() {
    const apiKey = process.env.VAST_API_KEY;
    const instanceId = process.env.VAST_INSTANCE_ID;
    if (!apiKey || !instanceId) throw new Error("API Key atau Instance ID Vast belum disetel di .env");

    const res = await axios.put(`https://console.vast.ai/api/v0/instances/${instanceId}/?api_key=${apiKey}`, {
        state: "running"
    });
    
    if (!res.data || !res.data.success) {
        throw new Error("Gagal mengirim perintah Start ke Vast.ai");
    }
}

/**
 * Mematikan mesin Vast.ai
 */
async function stopVastInstance() {
    const apiKey = process.env.VAST_API_KEY;
    const instanceId = process.env.VAST_INSTANCE_ID;
    if (!apiKey || !instanceId) return;

    try {
        await axios.put(`https://console.vast.ai/api/v0/instances/${instanceId}/?api_key=${apiKey}`, {
            state: "stopped"
        });
        console.log("🟢 VAST.AI: Mesin berhasil dimatikan karena sistem sedang idle.");
    } catch (error) {
        console.error("Vast.ai API Error (stop):", error.message);
    }
}

function getComfyUrl() {
    return currentComfyUrl;
}

function getJupyterToken() {
    return currentJupyterToken;
}

module.exports = {
    checkIsRunning,
    startVastInstance,
    stopVastInstance,
    getComfyUrl,
    getJupyterToken
};
