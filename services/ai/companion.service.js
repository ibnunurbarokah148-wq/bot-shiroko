const AIProvider = require('./AIProvider');
const appearanceState = require('./appearance.state');
const outfitState = require('./outfit.state'); // Re-exported façade
const pixaiService = require('../pixai.service');
const { cekDanPotongLimit, kembalikanLimit } = require('../../config/db');
const { getShirokoSystemPrompt } = require('./prompts');

// Base Anchor Shiroko tanpa tag "side braid" agar hairstyle dinamis dapat di-override bersih
const SHIROKO_CHARACTER_ANCHOR = 'sunaookami shiroko, 1girl, light blue hair, blue eyes, halo, wolf ears, anime style';
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
        if (/biasanya\s+kamu\s+(pakai|pake)|kamu\s+biasanya\s+(pakai|pake)|(pakai|pake)\s+baju\s+apa/i.test(textLower) && !/nah\s+pakai|coba\s+pakai|ganti/i.test(textLower)) {
            return { intent: 'OUTFIT_DISCUSSION', renderRequested: false };
        }
        if (/reset\s+(baju|pakaian|penampilan|rambut)|penampilan\s+semula|kembali\s+ke\s+default|reset\s+penampilan/i.test(textLower)) {
            return { intent: 'APPEARANCE_RESET', renderRequested: false };
        }
        if (/pakai\s+(baju\s+biasanya|pakaian\s+biasanya|seragam\s+abydos|seragam\s+sekolah|baju\s+itu|seragam\s+itu|baju\s+yang\s+biasa)|nah\s+pakai|pakai\s+yang\s+biasa|kembali\s+ke\s+seragam/i.test(textLower)) {
            const wantsRender = /kirim\s+foto|lihat|tunjukkan|mana|pap/i.test(textLower);
            return { intent: 'OUTFIT_CANONICAL_PRESET', renderRequested: wantsRender };
        }
        if (/sekarang\s+kamu\s+(pakai|pake)|lagi\s+(pakai|pake)\s+apa|kamu\s+(pakai|pake)\s+baju\s+apa|kirim\s+foto|mana\s+foto|pap\s+dong|lihat\s+foto|foto\s+kamu|lihat\s+kamu/i.test(textLower)) {
            return { intent: 'CHARACTER_VISUAL_REQUEST', renderRequested: true };
        }
        if (/ganti\s+(baju|pakaian|rambut)|pakai\s+(hoodie|gaun|kaos|jaket|kemeja|rok|seragam|celana|jepit)|rambut.*(kuncir|potong|gerai|ponytail|twintail)|(senyum|cemberut|blush|melambai|duduk|berdiri)|coba\s+di\s+(taman|pantai|kamar|sekolah)|baju\s+itu|seragam\s+itu/i.test(textLower)) {
            const wantsRender = /kirim\s+foto|lihat|tunjukkan|mana|pap/i.test(textLower);
            return { intent: 'APPEARANCE_CHANGE', renderRequested: wantsRender };
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
5. APPEARANCE_CHANGE: Pengguna meminta Shiroko mengganti penampilan (gaya rambut, ekspresi, pose, scene, atau pakaian) via teks.
6. CHARACTER_VISUAL_REQUEST: Pengguna meminta melihat foto/wujud/penampilan Shiroko saat ini ("pap dong", "foto kamu").

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
            useMemory: false,
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
 * Ekstraksi Atribut Outfit/Appearance dari Gambar via Vision AI (Gemini) - TANPA MEMORY
 */
async function extractOutfitFromVision(imageBuffer, senderId, isOwner) {
    const prompt = `Anda adalah pakar fashion anime & analis vision.
Analisis gambar pakaian ini dengan teliti. Ekstrak informasi komponen pakaian menjadi tag bahasa inggris terkontrol untuk AI image generator.

Kembalikan respons JSON murni tanpa markdown dengan skema berikut:
{
  "outer": "outerwear/jaket/syal dalam bahasa inggris",
  "inner": "atasan/kaos/kemeja dalam bahasa inggris",
  "bottom": "celana/rok dalam bahasa inggris",
  "shoes": "sepatu dalam bahasa inggris",
  "accessories": ["aksesoris pakaian"],
  "colors": ["warna utama"],
  "style": "gaya pakaian",
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
            useMemory: false,
            systemPrompt: 'Anda adalah parser vision JSON murni. Output harus JSON valid tanpa tambahan teks lain.',
            imageBuffer
        });

        const cleanJson = resultText.replace(/```json|```/gi, '').trim();
        return JSON.parse(cleanJson);
    } catch (err) {
        console.error('🚨 [COMPANION] Gagal ekstraksi outfit vision:', err.message);
        return null;
    }
}

/**
 * Ekstraksi Atribut Appearance (Hair, Expression, Pose, Scene, Outfit) dari Teks - TANPA MEMORY
 */
async function extractAppearanceFromText(userText, senderId, isOwner) {
    const prompt = `Pengguna meminta karakter Shiroko mengubah penampilannya dengan instruksi: "${userText}".
Ubah instruksi ini menjadi atribut penampilan berstruktur JSON dalam Bahasa Inggris untuk generator gambar anime.

Kembalikan respons JSON murni tanpa markdown:
{
  "hair": {
    "style": "gaya rambut bahasa inggris (misal: ponytail, twintails, loose hair, short hair, side braid)",
    "length": "panjang rambut"
  },
  "expression": "ekspresi wajah dalam bahasa inggris (misal: smiling, blushing, pouting, neutral)",
  "pose": "pose/postur tubuh dalam bahasa inggris (misal: standing, waving, sitting, looking back)",
  "scene": {
    "location": "lokasi/latar dalam bahasa inggris (misal: in a park, at beach, in classroom)"
  },
  "outfit": {
    "outer": "outerwear",
    "inner": "atasan",
    "bottom": "bawahan",
    "shoes": "sepatu",
    "accessories": ["aksesoris pakaian"],
    "colors": ["warna"],
    "style": "gaya pakaian"
  },
  "description": "penjelasan ringkas perubahan penampilan dalam bahasa indonesia"
}`;

    try {
        const resultText = await AIProvider.generate({
            provider: 'gemini',
            model: 'gemini-2.5-flash-lite',
            prompt,
            senderId,
            isOwner,
            useMemory: false,
            systemPrompt: 'Anda adalah parser appearance JSON murni. Output harus JSON valid.'
        });

        const cleanJson = resultText.replace(/```json|```/gi, '').trim();
        return JSON.parse(cleanJson);
    } catch (e) {
        return {
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
            useMemory: true,
            systemPrompt: getShirokoSystemPrompt(isOwner)
        });
        return reply;
    } catch (err) {
        return 'Nn... Sensei, Shiroko sudah siap.';
    }
}

/**
 * Render Karakter Shiroko via PixAI + Kirim Gambar + Balasan Roleplay Natural
 */
async function renderAndSendCharacter(ctx, appearanceData, sceneContextText) {
    const { sock, from, msg, senderId, isOwner, reply } = ctx;

    // Memotong limit 1 kali sebelum antrean gambar dibuat
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
        const promptTags = appearanceState.toPixaiPromptTags(appearanceData);
        const fullPixaiPrompt = `${SHIROKO_CHARACTER_ANCHOR}, ${promptTags}, solo, looking at viewer, high quality, masterpiece`;

        // Buat pesan roleplay pendamping gambar
        const roleplayContext = `[SISTEM ROLEPLAY]: Kamu baru saja mengubah penampilan/memakai pakaian ini: (${appearanceData.description || promptTags}). Responlah ucapan Sensei dengan sikap Shiroko yang kalem, agak malu-malu tapi senang. Sampaikan bahwa kamu sudah tampil dengan gaya ini untuknya.`;
        const roleplayText = await generateShirokoRoleplayReply(roleplayContext, senderId, isOwner);

        const pos = pixaiService.tambahAntrianPixAI({
            prompt: fullPixaiPrompt,
            senderId,
            reply,
            onSuccess: async (buffer) => {
                // WhatsApp Caption: HANYA roleplay text natural (tanpa catalog metadata)
                await sock.sendMessage(from, {
                    image: buffer,
                    caption: roleplayText
                }, { quoted: msg });
            },
            onError: async (error) => {
                console.error('🚨 [COMPANION] Render PixAI gagal:', error.message);
                safeRefund();
                await reply(`${roleplayText}\n\n_(Nn... Maaf Sensei, modul kamera PixAI sedang bermasalah: ${error.message}. Tapi Shiroko sudah siap!)_`);
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
    if (!intentInfo && (hasImage || /baju|pakaian|rambut|foto|pap|penampilan|senyum|pose/i.test(textLower))) {
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
            const extractedOutfit = await extractOutfitFromVision(chatImageBuffer, senderId, isOwner);
            if (!extractedOutfit) {
                await reply('Nn... Maaf Sensei, Shiroko gagal menganalisis gambar pakaian tersebut. Coba gambar yang lebih jelas ya.');
                return true;
            }

            // FULL OUTFIT REPLACEMENT (OUTFIT_REPLACE): Mengganti outfit penuh tetapi MEMPERTAHANKAN hair, expression, pose, scene
            appearanceState.setAppearance(senderId, { outfit: extractedOutfit }, { mode: 'outfit_replace' });
            const verifiedState = appearanceState.getAppearance(senderId);
            if (!appearanceState.verifyStateMutation(verifiedState, extractedOutfit, 'outfit_replace')) {
                console.error(`🚨 [COMPANION] Verification failed for OUTFIT_APPLY for User: ${senderId}`);
                await reply('Nn... Maaf Sensei, Shiroko gagal merapikan pakaian. Cobalah sebentar lagi.');
                return true;
            }

            await renderAndSendCharacter(ctx, verifiedState, textClean);
            return true;
        }

        case 'OUTFIT_CANONICAL_PRESET': {
            console.log(`[COMPANION] Menerapkan PRESET CANONICAL ABYDOS OUTFIT untuk User: ${senderId}...`);
            appearanceState.applyCanonicalOutfit(senderId);
            const verifiedState = appearanceState.getAppearance(senderId);
            if (!appearanceState.verifyStateMutation(verifiedState, null, 'canonical')) {
                console.error(`🚨 [COMPANION] Verification failed for OUTFIT_CANONICAL_PRESET for User: ${senderId}`);
                await reply('Nn... Maaf Sensei, Shiroko gagal mengganti seragam Abydos. Cobalah sebentar lagi.');
                return true;
            }

            if (intentInfo.renderRequested) {
                await renderAndSendCharacter(ctx, verifiedState, textClean);
            } else {
                const roleplayText = await generateShirokoRoleplayReply(
                    'Shiroko berganti mengenakan seragam sekolah Abydos bawaannya. Sampaikan ke Sensei dengan gaya Shiroko.',
                    senderId, isOwner
                );
                await reply(roleplayText);
            }
            return true;
        }

        case 'APPEARANCE_CHANGE':
        case 'OUTFIT_CHANGE': {
            console.log(`[COMPANION] Memproses perubahan appearance dari teks untuk User: ${senderId}...`);
            const extractedAppearance = await extractAppearanceFromText(textClean, senderId, isOwner);

            const isCanonicalReference = /baju\s+biasanya|pakaian\s+biasanya|seragam\s+abydos|seragam\s+sekolah|baju\s+itu|seragam\s+itu|pakai\s+yang\s+biasa/i.test(textClean);

            if (isCanonicalReference) {
                appearanceState.applyCanonicalOutfit(senderId);
            } else {
                appearanceState.setAppearance(senderId, extractedAppearance, { mode: 'merge' });
            }

            const verifiedState = appearanceState.getAppearance(senderId);
            const verifiedMode = isCanonicalReference ? 'canonical' : 'merge';
            if (!appearanceState.verifyStateMutation(verifiedState, extractedAppearance, verifiedMode)) {
                console.error(`🚨 [COMPANION] Verification failed for APPEARANCE_CHANGE for User: ${senderId}`);
                await reply('Nn... Maaf Sensei, Shiroko gagal menyesuaikan penampilan. Cobalah sebentar lagi.');
                return true;
            }

            if (intentInfo.renderRequested) {
                await renderAndSendCharacter(ctx, verifiedState, textClean);
            } else {
                const roleplayText = await generateShirokoRoleplayReply(
                    `Sensei meminta Shiroko mengubah penampilan: "${extractedAppearance.description || textClean}". Katakan bahwa kamu sudah menyesuaikan penampilanmu sesuai keinginannya dengan gaya Shiroko berdasarkan penampilanmu sekarang (${verifiedState.outfit.description || textClean}).`,
                    senderId, isOwner
                );
                await reply(roleplayText);
            }
            return true;
        }

        case 'CHARACTER_VISUAL_REQUEST': {
            const currentAppearance = appearanceState.getAppearance(senderId);
            await renderAndSendCharacter(ctx, currentAppearance, textClean);
            return true;
        }

        case 'APPEARANCE_RESET':
        case 'OUTFIT_RESET': {
            appearanceState.resetAppearance(senderId);
            const verifiedState = appearanceState.getAppearance(senderId);
            if (!appearanceState.verifyStateMutation(verifiedState, null, 'appearance_replace')) {
                console.error(`🚨 [COMPANION] Verification failed for APPEARANCE_RESET for User: ${senderId}`);
                await reply('Nn... Maaf Sensei, Shiroko gagal mereset penampilan. Cobalah sebentar lagi.');
                return true;
            }

            const roleplayText = await generateShirokoRoleplayReply(
                'Shiroko mengembalikan penampilannya ke seragam Abydos dan gaya rambut semula. Sampaikan ke Sensei dengan gaya Shiroko.',
                senderId, isOwner
            );
            await reply(roleplayText);
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
    detectHeuristicIntent,
    detectLlmIntent,
    extractOutfitFromVision,
    extractAppearanceFromText,
    generateShirokoRoleplayReply,
    renderAndSendCharacter,
    handleCompanionFlow
};
