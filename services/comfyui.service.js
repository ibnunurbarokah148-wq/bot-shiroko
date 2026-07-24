// ==========================================
// COMFYUI SERVICE — Antrean & Render Gambar
// ==========================================
const fs = require('fs');
const axios = require('axios');
const { kembalikanLimit } = require('../config/db');
const state = require('../config/state');
const { getSocket } = require('../utils/socket');
const { checkIsRunning, startVastInstance, stopVastInstance, getComfyUrl, getJupyterToken } = require('./vast.service');

const antrianGambar = [];
let sedangRender = false;
let vastIdleTimer = null; // Timer untuk mematikan mesin

async function prosesAntrianGambar() {
    // Kalau mesin lagi jalan, atau antrean kosong, batalkan eksekusi
    if (sedangRender || antrianGambar.length === 0) return;

    // Kunci mesin (Lock)
    sedangRender = true;

    // Bersihkan timer idle jika ada aktivitas baru
    if (vastIdleTimer) {
        clearTimeout(vastIdleTimer);
        vastIdleTimer = null;
    }

    // [AUTO-START VAST.AI] Jika API Key dan Instance ID ada
    if (process.env.VAST_API_KEY && process.env.VAST_INSTANCE_ID) {
        let isVastOn = await checkIsRunning();

        // Jika mesin mati, nyalakan dulu
        if (!isVastOn) {
            if (antrianGambar[0]) {
                await antrianGambar[0].reply('⏳ Nn... Mesin GPU di awan (Vast.ai) sedang mati karena idle. Shiroko sedang memanasinya kembali. Mohon tunggu sekitar 1-3 menit ya, Sensei...');
            }
            try {
                await startVastInstance();
                console.log("[VAST] Perintah start berhasil dikirim. Menunggu mesin menyala...");
            } catch (err) {
                console.error("Gagal auto-start Vast:", err.message);
                // Lanjutkan — mungkin bisa fallback ke ArisuSoft nanti
            }
        }

        // Tunggu ComfyUI siap (baik setelah start maupun jika sudah running tapi belum ready)
        let isReady = false;
        let waitCount = 0;
        const maxWait = 40; // Maks 40x cek (~4 menit)

        while (!isReady && waitCount < maxWait) {
            // Cek apakah instance sudah running
            const onSekarang = await checkIsRunning();
            if (onSekarang) {
                try {
                    const requestConfig = { timeout: 5000 };
                    if (getJupyterToken()) {
                        requestConfig.auth = { username: 'vastai', password: getJupyterToken() };
                    }
                    await axios.get(`${getComfyUrl()}/system_stats`, requestConfig);
                    isReady = true;
                    console.log("[VAST] ✅ ComfyUI merespons! Siap menerima prompt.");
                } catch (e) {
                    console.log(`[VAST] ⏳ ComfyUI belum siap (percobaan ${waitCount + 1}/${maxWait})... ${e.message}`);
                }
            } else {
                console.log(`[VAST] ⏳ Instance belum running (percobaan ${waitCount + 1}/${maxWait})...`);
            }

            if (!isReady) {
                await new Promise(r => setTimeout(r, 6000)); // Tunggu 6 detik sebelum cek lagi
                waitCount++;
            }
        }
        
        if (!isReady) {
            console.log("[VAST] ❌ ComfyUI tidak merespons setelah menunggu lama. Semua antrian akan di-fallback.");
            // Keluarkan semua antrian dan arahkan ke ArisuSoft
            while (antrianGambar.length > 0) {
                const pesanan = antrianGambar.shift();
                const { senderId, msg, from, promptMentah, reply } = pesanan;
                try {
                    if (pesanan.isDiscord) {
                        await reply('⚠️ *Mesin Vast.ai gagal merespons setelah menunggu lama.*\nNn... Silakan coba lagi atau gunakan mesin Arisu SDXL.');
                    } else {
                        if (process.env.ARISU_API_KEY) {
                            state.sesiArisu[senderId] = { promptMentah, msg, from };
                            await reply('⚠️ *Mesin Vast.ai gagal merespons setelah menunggu lama.*\n\nNn... Shiroko mengalihkan ke satelit *ArisuSoft*.\nBalas dengan angka untuk memilih model:\n\n1️⃣ *SDXL Turbo* (Butuh tambahan 3 limit)\n2️⃣ *Agnes 2.0* (Butuh tambahan 1 limit)\n3️⃣ *Agnes 2.1* (Butuh tambahan 1 limit)\n\n_Ketik *batal* untuk mengembalikan token limit awalmu._');
                        } else {
                            kembalikanLimit(senderId);
                            await reply('⚠️ Mesin Vast.ai dan ArisuSoft tidak tersedia. Token limit dikembalikan.');
                        }
                    }
                } catch (e) {
                    if (!pesanan.isDiscord) kembalikanLimit(senderId);
                    console.error("Error saat fallback antrian:", e.message);
                }
            }
            sedangRender = false;
            return; // STOP — jangan lanjut ke rendering
        }
    }

    while (antrianGambar.length > 0) {
        // Ambil pesanan paling depan (Shift)
        const pesanan = antrianGambar.shift();
        const { from, msg, promptMentah, senderId, reply } = pesanan;

        try {
            await reply('Nn... Giliran Sensei tiba. Mengirimkan data ke mesin RTX lokal...');

            const workflow = JSON.parse(fs.readFileSync('./Workflow gacor.json', 'utf-8'));

            if (workflow["59"] && workflow["59"]["inputs"]) {
                const promptAkhir = `${promptMentah}, masterpiece, best quality, ultra detailed, absurdres`;
                workflow["59"]["inputs"]["wildcard_text"] = promptAkhir;
                workflow["59"]["inputs"]["populated_text"] = promptAkhir;
            }

            const COMFYUI_MAX_SEED = 1125899906842624;
            const randomSeed = Math.floor(Math.random() * COMFYUI_MAX_SEED);
            for (let key in workflow) {
                let node = workflow[key];
                if (node.inputs) {
                    for (let param in node.inputs) {
                        if (param.toLowerCase().includes('seed') && !Array.isArray(node.inputs[param])) {
                            node.inputs[param] = randomSeed;
                        } else if (typeof node.inputs[param] === 'number' && node.inputs[param] > 100000) {
                            node.inputs[param] = randomSeed;
                        }
                    }
                }
            }

            let finalImageLink = null;
            for (let key in workflow) {
                let node = workflow[key];
                if (node.class_type === "Image Saver" || node.class_type === "SaveImageExtended") {
                    if (node.inputs && node.inputs.images) {
                        finalImageLink = node.inputs.images;
                    }
                    delete workflow[key];
                }
            }

            if (!finalImageLink) {
                throw new Error("Kabel output gambar tidak ditemukan di file JSON!");
            }

            // ANTI-TABRAKAN: Kasih tanda 'WA' dan angka acak biar gak bentrok
            const prefixAman = `Shiroko_WA_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
            workflow["9999"] = {
                "inputs": {
                    "filename_prefix": prefixAman,
                    "images": finalImageLink
                },
                "class_type": "SaveImage"
            };

            const reqConfig = {};
            if (getJupyterToken()) {
                reqConfig.auth = { username: 'vastai', password: getJupyterToken() };
            }

            const res = await axios.post(`${getComfyUrl()}/prompt`, { prompt: workflow }, reqConfig);
            const promptId = res.data.prompt_id;

            let isDone = false;
            let outputFileName = "";
            let outputSubfolder = "";
            let loopCount = 0;

            while (!isDone) {
                // DETEKTOR KOMA: Kalau render lebih dari 5 menit, batalkan!
                if (loopCount > 150) {
                    throw new Error("Waktu habis! Mesin ComfyUI nyangkut atau VRAM penuh.");
                }

                await new Promise(r => setTimeout(r, 2000));
                loopCount++;

                const histRes = await axios.get(`${getComfyUrl()}/history/${promptId}`, reqConfig);
                const history = histRes.data[promptId];

                if (history) {
                    isDone = true;
                    if (history.status && history.status.status_str === 'error') {
                        throw new Error("ComfyUI mengalami error internal saat ngerender. (VRAM Habis / Node Bentrok)");
                    }

                    const outputs = history.outputs;
                    if (outputs && outputs["9999"] && outputs["9999"].images && outputs["9999"].images.length > 0) {
                        outputFileName = outputs["9999"].images[0].filename;
                        outputSubfolder = outputs["9999"].images[0].subfolder || "";
                    } else {
                        throw new Error("Mesin ComfyUI selesai jalan tapi gagal mengeluarkan file gambar!");
                    }
                }
            }

            // Download gambar via HTTP API ComfyUI (mendukung remote Vast.ai DAN lokal)
            const viewParams = new URLSearchParams({ filename: outputFileName, type: 'output' });
            if (outputSubfolder) viewParams.set('subfolder', outputSubfolder);

            const imgRes = await axios.get(`${getComfyUrl()}/view?${viewParams.toString()}`, {
                ...reqConfig,
                responseType: 'arraybuffer',
                timeout: 30000
            });
            const imgBuffer = Buffer.from(imgRes.data);

            // Kirim pesan sesuai platform
            const caption = `🎨 *Ide Sensei:* ${promptMentah}\n✨ *Mesin:* ComfyUI (Vast.ai RTX)\n\nNn... Render berhasil diselesaikan! 🐺✨`;
            if (pesanan.isDiscord && pesanan.sendImage) {
                await pesanan.sendImage(imgBuffer, caption);
            } else {
                await getSocket().sendMessage(from, {
                    image: imgBuffer,
                    caption: caption
                }, { quoted: msg });
            }

        } catch (error) {
            // Fallback interaktif ke ArisuSoft jika ComfyUI mati / tidak terhubung atau butuh otentikasi
            const errMsg = error.message ? error.message.toLowerCase() : '';
            const isAxiosOrNetwork = error.isAxiosError || errMsg.includes('econnrefused') || errMsg.includes('status code') || errMsg.includes('timeout') || errMsg.includes('401');
            
            // LOG DETAIL ERROR — ini penting untuk debugging
            console.error(`🔍 [DEBUG ERROR] message: ${error.message}`);
            if (error.response) {
                const errDataStr = JSON.stringify(error.response.data) || "";
                console.error(`🔍 [DEBUG ERROR] status: ${error.response.status}, data:`, errDataStr.substring(0, 500));
            }
            if (error.config) {
                console.error(`🔍 [DEBUG ERROR] url: ${error.config.url}, method: ${error.config.method}`);
            }

            if (isAxiosOrNetwork) {
                console.log("⚠️ ComfyUI tidak merespons, melempar sesi ke ArisuSoft...");
                try {
                    if (pesanan.isDiscord) {
                        await reply('⚠️ *Mesin Vast.ai sedang offline / tidak merespons.*\nNn... Silakan coba lagi atau gunakan mesin Arisu SDXL.');
                    } else {
                        if (!process.env.ARISU_API_KEY) {
                            throw new Error("API Key ArisuSoft belum dikonfigurasi di .env (ARISU_API_KEY)");
                        }
                        // Set sesi interaktif
                        state.sesiArisu[senderId] = { promptMentah, msg, from };
                        await reply('⚠️ *Mesin lokal sedang offline.*\n\nNn... Shiroko bisa mengalihkan render ini ke satelit *ArisuSoft*.\nBalas dengan angka untuk memilih model:\n\n1️⃣ *SDXL Turbo* (Butuh tambahan 3 limit)\n2️⃣ *Agnes 2.0* (Butuh tambahan 1 limit)\n3️⃣ *Agnes 2.1* (Butuh tambahan 1 limit)\n\n_Ketik *batal* untuk mengembalikan token limit awalmu._');
                    }
                } catch (arisuErr) {
                    if (!pesanan.isDiscord) kembalikanLimit(senderId);
                    console.error("🚨 ERROR ARISUSOFT FALLBACK:", arisuErr.message);
                    await reply(`Nn... Gagal menginisiasi fallback. \n*Laporan Sistem:* ${arisuErr.message}`);
                }
            } else {
                if (!pesanan.isDiscord) kembalikanLimit(senderId);
                console.error("🚨 ERROR COMFYUI API:", error.message);
                await reply(`Nn... Gagal membuat gambar di mesin lokal. \n*Laporan Sistem:* ${error.message}`);
            }
        }

        // Beri jeda 3 detik biar GPU istirahat sejenak
        await new Promise(r => setTimeout(r, 3000));
    }

    // Buka kunci (Unlock)
    sedangRender = false;

    // [AUTO-STOP VAST.AI] Set timer untuk mematikan mesin setelah 10 menit idle
    if (process.env.VAST_API_KEY && process.env.VAST_INSTANCE_ID) {
        vastIdleTimer = setTimeout(async () => {
            console.log("⏳ VAST.AI: Mesin sudah menganggur 1 menit. Mematikan...");
            await stopVastInstance();
        }, 1 * 60 * 1000);
    }
}

module.exports = {
    antrianGambar,
    prosesAntrianGambar
};
