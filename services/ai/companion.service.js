const AIProvider = require('./AIProvider');
const outfitState = require('./outfit.state');
const pixaiService = require('../pixai.service');
const { cekDanPotongLimit, kembalikanLimit } = require('../../config/db');
const { getShirokoSystemPrompt } = require('./prompts');

const SHIROKO_CHARACTER_ANCHOR = 'sunaookami shiroko, 1girl, light blue hair, blue eyes, halo, wolf ears, side braid, anime style';
const COMPANION_IMAGE_COST = 2;

/**
 * Deteksi Intent secara Heuristic (Tier 1)
 */
function detectHeuristicIntent(textLower, hasImage) {
    if (hasImage) {
        if (/bagus\s+nggak|bagus\s+ga|cocok\s+nggak|cocok\s+ga|pendapatmu|menurutmu/i.test(textLower)) {
            return { intent: 'OUTFIT_DISCUSSION', renderRequested: false };
        }
        if (/ini\s+apa|apa\s+ini|jelaskan|foto\s+apa/i.test(textLower)) {
            return { intent: 'VISION_ANALYSIS', renderRequested: false };
        }
        if (/pakai\s+ini|pake\s+ini|coba.*(pakai|pake)|ganti.*(baju|pakaian)|pakaian\s+ini|baju\s+ini/i.test(textLower)) {
            return { intent: 'OUTFIT_APPLY', renderRequested: true };
        }
    } else {
        if (/reset\s+baju|baju\s+semula|seragam\s+biasa|kembali\s+ke\s+seragam/i.test(textLower)) {
            return { intent: 'OUTFIT_RESET', renderRequested: false };
        }
        if (/sekarang\s+kamu\s+(pakai|pake)|lagi\s+(pakai|pake)\s+apa|kamu\s+(pakai|pake)\s+baju\s+apa|kirim\s+foto|mana\s+foto|pap\s+dong|lihat\s+foto|foto\s+kamu/i.test(textLower)) {
            return { intent: 'CHARACTER_VISUAL_REQUEST', renderRequested: true };
        }
        if (/ganti\s+(baju|pakaian)|pakai\s+(hoodie|gaun|kaos|jaket|kemeja|rok|seragam|celana)/i.test(textLower)) {
            const wantsRender = /kirim\s+foto|lihat|tunjukkan|mana/i.test(textLower);
            return { intent: 'OUTFIT_CHANGE', renderRequested: wantsRender };
        }
    }

    return null;
}

/**
 * Deteksi Intent via LLM (Tier 2 Fallback jika heuristic ragu) - TANPA MEMORY
 */
async function detectLlmIntent(text, hasImage, senderId, isOwner) {
    const prompt = `Anda adalah klasifikator intent untuk bot WhatsApp AI Companion bernama Shiroko.
Tugas Anda adalah mengklasifikasikan pesan pengguna ke salah satu intent di bawah ini.

Pesan Pengguna: "${text}"
Ada Gambar Dilampirkan: ${hasImage ? 'YA' : 'TIDAK'}

Daftar Intent:
1. NORMAL_CHAT: Percakapan santai biasa, pertanyaan umum, atau sapaan.
2. VISION_ANALYSIS: Pengguna hanya bertanya tentang isi gambar secara umum.
3. OUTFIT_DISCUSSION: Pengguna membahas pakaian atau meminta pendapat Shiroko tanpa meminta Shiroko memakainya.
4. OUTFIT_APPLY: Pengguna mengirim gambar pakaian dan meminta Shiroko memakai pakaian tersebut.
5. OUTFIT_CHANGE: Pengguna secara eksplisit meminta Shiroko mengganti pakaian via teks.
6. CHARACTER_VISUAL_REQUEST: Pengguna meminta melihat foto/wujud Shiroko saat ini.

Berikan respons JSON murni dengan format:
{
  "intent": "NAMA_INTENT",
  "renderRequested": true/false
}`;

    try {
        const res = await AIProvider.generate({
            provider: 'gemini',
            model: 'gemini-2.5-flash-lite',
            prompt,
            senderId,
            isOwner,
            useMemory: false, // Isolasi Memory AI Internal
            systemPrompt: 'Anda adalah parser JSON intent murni. Kembalikan JSON valid tanpa tag markdown.'
        });

        const cleanJson = res.replace(/```json|```/gi, '').trim();
        const parsed = JSON.parse(cleanJson);
        return {
            intent: parsed.intent || 'NORMAL_CHAT',
            renderRequested: !!parsed.renderRequested
        };
    } catch (e) {
        return { intent: 'NORMAL_CHAT', renderRequested: false };
    }
}

/**
 * Ekstraksi Atribut Outfit dari Gambar via Vision AI (Gemini) - TANPA MEMORY
 */
async function extractOutfitFromVision(imageBuffer, senderId, isOwner) {
    const prompt = `Anda adalah pakar fashion anime & analis vision.
Analisis gambar pakaian ini dengan teliti. Ekstrak informasi komponen pakaian menjadi tag bahasa inggris terkontrol untuk AI image generator.

Kembalikan respons JSON murni tanpa markdown dengan skema berikut:
{
  "outer": "deskripsi outerwear/jaket/syal dalam bahasa inggris",
  "inner": "deskripsi atasan/kaos/kemeja dalam bahasa inggris",
  "bottom": "deskripsi celana/rok dalam bahasa inggris",
  "shoes": "deskripsi sepatu dalam bahasa inggris",
  "accessories": ["aksesoris1", "aksesoris2"],
  "colors": ["warna1", "warna2"],
  "style": "gaya pakaian (misal: casual, gothic, sporty, streetwear)",
  "englishPromptTags": "tag prompt comma-separated untuk generator gambar anime",
  "description": "penjelasan ringkas pakaian dalam bahasa indonesia"
}`;

    try {
        const resultText = await AIProvider.generate({
            provider: 'gemini',
            model: 'gemini-2.5-flash-lite',
            prompt,
            senderId,
            isOwner,
            useMemory: false, // Isolasi Memory AI Internal
            systemPrompt: 'Anda adalah parser vision JSON murni. Output harus JSON valid tanpa tambahan teks lain.',
            imageBuffer
        });

        const cleanJson = resultText.replace(/```json|```/gi, '').trim();
        const parsed = JSON.parse(cleanJson);
        return parsed;
    } catch (err) {
        console.error('🚨 [COMPANION] Gagal ekstraksi outfit vision:', err.message);
        return null;
    }
}

/**
 * Ekstraksi Atribut Outfit dari Teks Perintah User - TANPA MEMORY
 */
async function extractOutfitFromText(userText, senderId, isOwner) {
    const prompt = `Pengguna meminta karakter Shiroko mengganti pakaian dengan deskripsi berikut: "${userText}".
Ubah instruksi ini menjadi atribut outfit berstruktur JSON dalam Bahasa Inggris untuk generator gambar anime:

{
  "outer": "outerwear dalam bahasa inggris",
  "inner": "atasan dalam bahasa inggris",
  "bottom": "bawahan dalam bahasa inggris",
  "shoes": "sepatu dalam bahasa inggris",
  "accessories": ["aksesoris"],
  "colors": ["warna"],
  "style": "gaya pakaian",
  "englishPromptTags": "tag prompt comma-separated",
  "description": "penjelasan ringkas dalam bahasa indonesia"
}`;

    try {
        const resultText = await AIProvider.generate({
            provider: 'gemini',
            model: 'gemini-2.5-flash-lite',
            prompt,
            senderId,
            isOwner,
            useMemory: false, // Isolasi Memory AI Internal
            systemPrompt: 'Anda adalah parser outfit JSON murni. Output harus JSON valid.'
        });

        const cleanJson = resultText.replace(/```json|```/gi, '').trim();
        return JSON.parse(cleanJson);
    } catch (e) {
        return {
            englishPromptTags: userText.replace(/ganti\s+baju|pakai/gi, '').trim(),
            description: userText
        };
    }
}

/**
 * Generate Roleplay Text Reply dari Shiroko (Menggunakan Memory Chat Normal)
 */
async function generateShirokoRoleplayReply(promptContext, senderId, isOwner, userMode = 'gemini') {
    const { provider, model } = AIProvider.resolveMode(userMode, senderId);
    try {
        const reply = await AIProvider.generate({
            provider,
            model,
            prompt: promptContext,
            senderId,
            isOwner,
            useMemory: true, // Roleplay normal memakai memory
            systemPrompt: getShirokoSystemPrompt(isOwner)
        });
        return reply;
    } catch (err) {
        return 'Nn... Sensei, Shiroko sudah siap.';
    }
}

/**
 * Render Karakter Shiroko via PixAI + Kirim Gambar + Balasan Roleplay
 */
async function renderAndSendCharacter(ctx, outfit, sceneContextText) {
    const { sock, from, msg, senderId, isOwner, reply } = ctx;

    // Memotong limit hanya 1 kali saat render gambar
    if (!cekDanPotongLimit(senderId, COMPANION_IMAGE_COST)) {
        await reply(`Nn... Token limit Sensei tidak cukup. Diperlukan *${COMPANION_IMAGE_COST} limit* untuk membuat gambar karakter.`);
        return;
    }

    let limitRefunded = false;
    const safeRefund = () => {
        if (!limitRefunded) {
            limitRefunded = true;
            kembalikanLimit(senderId, COMPANION_IMAGE_COST);
        }
    };

    try {
        const outfitTags = outfitState.toPixaiPromptTags(outfit);
        const fullPixaiPrompt = `${SHIROKO_CHARACTER_ANCHOR}, ${outfitTags}, solo, looking at viewer, high quality, masterpiece`;

        // Buat pesan roleplay pendamping gambar
        const roleplayContext = `[SISTEM ROLEPLAY]: Kamu baru saja berganti/memakai pakaian ini: (${outfit.description || outfitTags}). Responlah ucapan Sensei dengan sikap Shiroko yang kalem, agak malu-malu tapi senang. Sampaikan bahwa kamu sudah memakai pakaian ini untuknya.`;
        const roleplayText = await generateShirokoRoleplayReply(roleplayContext, senderId, isOwner);

        const pos = pixaiService.tambahAntrianPixAI({
            prompt: fullPixaiPrompt,
            senderId,
            reply,
            onSuccess: async (buffer) => {
                await sock.sendMessage(from, {
                    image: buffer,
                    caption: `${roleplayText}\n\n👗 *Outfit:* _${outfit.description || 'Pakaian Pilihan Sensei'}_`
                }, { quoted: msg });
            },
            onError: async (error) => {
                console.error('🚨 [COMPANION] Render PixAI gagal:', error.message);
                safeRefund();
                await reply(`${roleplayText}\n\n_(Nn... Maaf Sensei, modul kamera PixAI sedang bermasalah: ${error.message}. Tapi Shiroko sudah memakai pakaiannya!)_`);
            }
        });

        console.log(`[COMPANION RENDER] Task PixAI terdaftar untuk User: ${senderId} (Posisi Antrean: ${pos})`);
    } catch (err) {
        console.error('🚨 [COMPANION] Gagal memproses render/queue PixAI:', err.message);
        safeRefund();
        await reply(`❌ Nn... Terjadi kesalahan saat menyiapkan kamera render: _${err.message}_. Limit telah dikembalikan.`);
    }
}

/**
 * Main Companion Orchestrator Flow
 */
async function handleCompanionFlow(ctx) {
    const { textClean, textLower, chatImageBuffer, senderId, isOwner, reply } = ctx;
    const hasImage = !!chatImageBuffer;

    // 1. Cek Heuristic Intent
    let intentInfo = detectHeuristicIntent(textLower, hasImage);

    // 2. Fallback LLM jika ambigu dan ada gambar atau frase visual
    if (!intentInfo && (hasImage || /baju|pakaian|foto|pap|penampilan/i.test(textLower))) {
        intentInfo = await detectLlmIntent(textClean, hasImage, senderId, isOwner);
    }

    // Jika intent adalah normal chat, lewati ke handler AI biasa
    if (!intentInfo || intentInfo.intent === 'NORMAL_CHAT') {
        return false;
    }

    console.log(`[COMPANION] Detected Intent: ${intentInfo.intent} (Render: ${intentInfo.renderRequested}) for User: ${senderId}`);

    switch (intentInfo.intent) {
        case 'OUTFIT_APPLY': {
            if (!hasImage) {
                await reply('Nn... Lampirkan gambar pakaian yang ingin Shiroko pakai, Sensei.');
                return true;
            }
            console.log(`[COMPANION] Menganalisis gambar pakaian via Gemini Vision untuk User: ${senderId}...`);
            const extracted = await extractOutfitFromVision(chatImageBuffer, senderId, isOwner);
            if (!extracted) {
                await reply('Nn... Maaf Sensei, Shiroko gagal menganalisis gambar pakaian tersebut. Coba gambar yang lebih jelas ya.');
                return true;
            }

            // Full Replacement untuk OUTFIT_APPLY (kirim gambar pakaian baru)
            const newOutfit = outfitState.setOutfit(senderId, extracted, { mode: 'replace' });
            await renderAndSendCharacter(ctx, newOutfit, textClean);
            return true;
        }

        case 'OUTFIT_CHANGE': {
            console.log(`[COMPANION] Memproses perubahan outfit dari teks untuk User: ${senderId}...`);
            const extracted = await extractOutfitFromText(textClean, senderId, isOwner);

            // Cek apakah perintah merupakan parsial tweak (hanya celana/sepatu/topi dll) atau full replacement
            const isPartial = /ganti\s+(celana|sepatu|jaket|syal|aksesoris|topi|kaos|kemeja)|lepas\s+/i.test(textLower) && !/ganti\s+(baju|pakaian)/i.test(textLower);
            const mode = isPartial ? 'merge' : 'replace';

            const newOutfit = outfitState.setOutfit(senderId, extracted, { mode });

            if (intentInfo.renderRequested) {
                await renderAndSendCharacter(ctx, newOutfit, textClean);
            } else {
                const roleplayText = await generateShirokoRoleplayReply(
                    `Sensei meminta Shiroko berganti pakaian ke: "${extracted.description || textClean}". Katakan bahwa kamu sudah mengganti pakaianmu sesuai keinginannya dengan gaya Shiroko.`,
                    senderId, isOwner
                );
                await reply(`${roleplayText}\n\n✨ *Outfit tersimpan:* _${extracted.description || 'Pakaian Baru'}_`);
            }
            return true;
        }

        case 'CHARACTER_VISUAL_REQUEST': {
            const currentOutfit = outfitState.getOutfit(senderId);
            await renderAndSendCharacter(ctx, currentOutfit, textClean);
            return true;
        }

        case 'OUTFIT_RESET': {
            const defaultOutfit = outfitState.resetOutfit(senderId);
            const roleplayText = await generateShirokoRoleplayReply(
                'Shiroko mengembalikan pakaiannya ke seragam Abydos semula. Sampaikan ke Sensei dengan gaya Shiroko.',
                senderId, isOwner
            );
            await reply(`${roleplayText}\n\n🌸 *Outfit dikembalikan ke Seragam Bawaan Abydos.*`);
            return true;
        }

        case 'OUTFIT_DISCUSSION': {
            return false;
        }

        case 'VISION_ANALYSIS': {
            return false;
        }

        default:
            return false;
    }
}

module.exports = {
    handleCompanionFlow,
    detectHeuristicIntent,
    detectLlmIntent,
    extractOutfitFromVision,
    extractOutfitFromText,
    renderAndSendCharacter
};
