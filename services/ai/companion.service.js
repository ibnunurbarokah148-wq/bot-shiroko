const AIProvider = require('./AIProvider');
const appearanceState = require('./appearance.state');
const pixaiService = require('../pixai.service');
const { cekDanPotongLimit, kembalikanLimit } = require('../../config/db');
const { getShirokoSystemPrompt } = require('./prompts');
const appState = require('../../config/state');
const { getCoreNumber } = require('../../utils/helpers');
const { parseJsonObject } = require('./utils');
const memory = require('./memory');

// Base Anchor Shiroko tanpa tag "side braid" agar hairstyle dinamis dapat di-override bersih
const SHIROKO_CHARACTER_ANCHOR = 'sunaookami shiroko, 1girl, light blue hair, blue eyes, halo, wolf ears, anime style';
const COMPANION_IMAGE_COST = 2;
const VISUAL_PLANNER_MAX_TEXT = 500;
const VALID_COMPANION_INTENTS = new Set([
    'NORMAL_CHAT',
    'VISION_ANALYSIS',
    'OUTFIT_DISCUSSION',
    'OUTFIT_APPLY',
    'OUTFIT_CANONICAL_PRESET',
    'APPEARANCE_CHANGE',
    'OUTFIT_CHANGE',
    'CHARACTER_VISUAL_REQUEST',
    'APPEARANCE_RESET',
    'OUTFIT_RESET'
]);

/**
 * Deteksi Intent secara Heuristic (Tier 1)
 */
function hasVisualRequest(text, conversationContext = '') {
    const visualPattern = /\b(kirim\s+(?:foto|gambar)|buat(?:kan)?\s+(?:foto|gambar)|generate\s+(?:foto|gambar)|minta(?:kan)?\s+(?:foto|gambar)|tunjukkan|lihat(?:kan)?|pap(?:kan)?|mana\s+(?:foto|gambar)|foto\s+kamu|gambar\s+kamu|lihat\s+kamu)\b/i;
    return visualPattern.test(`${text || ''} ${conversationContext || ''}`);
}

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
            const wantsRender = /kirim\s+(?:foto|gambar)|buat(?:kan)?\s+(?:foto|gambar)|generate\s+(?:foto|gambar)|lihat|tunjukkan|mana|pap/i.test(textLower);
            return { intent: 'OUTFIT_CANONICAL_PRESET', renderRequested: wantsRender };
        }
        if (/sekarang\s+kamu\s+(pakai|pake)|lagi\s+(pakai|pake)\s+apa|kamu\s+(pakai|pake)\s+baju\s+apa|kirim\s+(foto|gambar)|minta(?:kan)?\s+(?:foto|gambar)|mana\s+(?:foto|gambar)|pap\s+dong|lihat\s+(?:foto|gambar)|foto\s+kamu|gambar\s+kamu|lihat\s+kamu/i.test(textLower)) {
            return { intent: 'CHARACTER_VISUAL_REQUEST', renderRequested: true };
        }
        if (/ganti\s+(baju|pakaian|rambut)|pakai\s+(hoodie|gaun|kaos|jaket|kemeja|rok|seragam|celana|jepit)|rambut.*(kuncir|potong|gerai|ponytail|twintail)|(senyum|cemberut|blush|melambai|duduk|berdiri)|coba\s+di\s+(taman|pantai|kamar|sekolah)|baju\s+itu|seragam\s+itu/i.test(textLower)) {
            const wantsRender = /kirim\s+(?:foto|gambar)|buat(?:kan)?\s+(?:foto|gambar)|generate\s+(?:foto|gambar)|lihat|tunjukkan|mana|pap/i.test(textLower);
            return { intent: 'APPEARANCE_CHANGE', renderRequested: wantsRender };
        }
    }

    return null;
}

const XKIRO_COMPANION_TOOLS = Object.freeze([
    {
        type: 'function',
        function: {
            name: 'get_current_appearance',
            description: 'Membaca penampilan Shiroko saat ini dari database sebelum menjawab atau membuat gambar.',
            parameters: { type: 'object', properties: {}, additionalProperties: false }
        }
    },
    {
        type: 'function',
        function: {
            name: 'update_appearance',
            description: 'Mengubah pakaian, rambut, ekspresi, pose, atau lokasi penampilan Shiroko sesuai permintaan pengguna. Tidak membuat gambar.',
            parameters: {
                type: 'object',
                properties: {
                    hair: { type: 'object' },
                    expression: { type: 'string' },
                    pose: { type: 'string' },
                    scene: { type: 'object' },
                    outfit: { type: 'object' },
                    description: { type: 'string' }
                },
                additionalProperties: false
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'reset_appearance',
            description: 'Mengembalikan penampilan Shiroko ke penampilan default.',
            parameters: { type: 'object', properties: {}, additionalProperties: false }
        }
    },
    {
        type: 'function',
        function: {
            name: 'generate_character_image',
            description: 'Membuat dan mengirim gambar Shiroko menggunakan penampilan terbaru dari database. Gunakan jika pengguna meminta melihat atau membuat visual.',
            parameters: {
                type: 'object',
                properties: { reason: { type: 'string' } },
                required: ['reason'],
                additionalProperties: false
            }
        }
    }
]);

function compactVisualPatch(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const result = {};
    const copyString = (key, source = value, target = result) => {
        if (typeof source[key] === 'string' && source[key].trim()) {
            target[key] = source[key].trim().slice(0, VISUAL_PLANNER_MAX_TEXT);
        }
    };

    if (value.hair && typeof value.hair === 'object') {
        result.hair = {};
        copyString('style', value.hair, result.hair);
        copyString('length', value.hair, result.hair);
        copyString('color', value.hair, result.hair);
        if (!Object.keys(result.hair).length) delete result.hair;
    }
    copyString('expression');
    copyString('pose');
    if (value.scene && typeof value.scene === 'object') {
        result.scene = {};
        copyString('location', value.scene, result.scene);
        copyString('lighting', value.scene, result.scene);
        if (!Object.keys(result.scene).length) delete result.scene;
    }
    if (value.outfit && typeof value.outfit === 'object') {
        result.outfit = {};
        for (const key of ['outer', 'inner', 'bottom', 'shoes', 'style', 'description']) {
            copyString(key, value.outfit, result.outfit);
        }
        for (const key of ['accessories', 'colors']) {
            if (Array.isArray(value.outfit[key])) {
                const items = value.outfit[key]
                    .filter(item => typeof item === 'string' && item.trim())
                    .map(item => item.trim().slice(0, VISUAL_PLANNER_MAX_TEXT));
                if (items.length) result.outfit[key] = items.slice(0, 10);
            }
        }
        if (!Object.keys(result.outfit).length) delete result.outfit;
    }
    copyString('description');
    return result;
}

function mergeAppearancePatch(current, patch) {
    return {
        ...current,
        hair: { ...current.hair, ...(patch.hair || {}) },
        scene: { ...current.scene, ...(patch.scene || {}) },
        outfit: { ...current.outfit, ...(patch.outfit || {}) },
        expression: patch.expression || current.expression,
        pose: patch.pose || current.pose,
        description: patch.description || current.description,
        updatedAt: Date.now()
    };
}

async function createArisuVisualPlan({ text, appearance, senderId, isOwner, model }) {
    const prompt = `Kamu adalah visual planner untuk karakter anime Shiroko.
Analisis permintaan pengguna berdasarkan penampilan saat ini. Jangan menjawab percakapan.
Hanya isi field appearancePatch yang benar-benar diminta pengguna. Jangan menebak atau mengubah atribut lain.
Jika pengguna meminta "pap", "foto", atau "gambar", set render=true.
Jika pengguna meminta perubahan tanpa kata visual, render=false.
Perubahan pakaian/penampilan dianggap permanen hanya jika pengguna mengatakan mulai sekarang, selalu, ganti, ubah, atau menyuruh karakter memakai pakaian itu. Untuk permintaan pap satu kali, persistAppearance=false.
Semua nilai atribut dan renderPrompt harus berbahasa Inggris. Kembalikan JSON murni tanpa markdown.

Penampilan saat ini:
${JSON.stringify(appearance)}

Permintaan pengguna:
${String(text || '').slice(0, 2000)}

Format wajib:
{
  "render": true,
  "persistAppearance": false,
  "appearancePatch": {
    "hair": {}, "expression": "", "pose": "",
    "scene": {"location": "", "lighting": ""},
    "outfit": {"outer": "", "inner": "", "bottom": "", "shoes": "", "accessories": [], "colors": [], "style": ""}
  },
  "renderPrompt": "short extra visual instruction, empty if none",
  "captionContext": "short Indonesian context for roleplay"
}`;
    const resultText = await AIProvider.generate({
        provider: 'arisu',
        model,
        prompt,
        senderId,
        isOwner,
        useMemory: false,
        throwOnError: true,
        systemPrompt: 'Anda adalah parser visual JSON. Keluarkan JSON valid saja, tanpa markdown atau penjelasan.'
    });
    const plan = parseJsonObject(resultText, 'respons visual planner Arisu');
    return {
        render: plan.render === true,
        persistAppearance: plan.persistAppearance === true,
        appearancePatch: compactVisualPatch(plan.appearancePatch),
        renderPrompt: typeof plan.renderPrompt === 'string' ? plan.renderPrompt.trim().slice(0, VISUAL_PLANNER_MAX_TEXT) : '',
        captionContext: typeof plan.captionContext === 'string' ? plan.captionContext.trim().slice(0, VISUAL_PLANNER_MAX_TEXT) : ''
    };
}

function createXkiroToolExecutor(ctx) {
    return async (name, args = {}) => {
        const { senderId, isOwner } = ctx;
        if (name === 'get_current_appearance') {
            return { ok: true, appearance: appearanceState.getAppearance(senderId) };
        }
        if (name === 'update_appearance') {
            const updated = appearanceState.setAppearance(senderId, args, { mode: 'merge' });
            return { ok: true, appearance: updated };
        }
        if (name === 'reset_appearance') {
            appearanceState.resetAppearance(senderId);
            return { ok: true, appearance: appearanceState.getAppearance(senderId) };
        }
        if (name === 'generate_character_image') {
            if (!ctx.companionRenderAllowed) {
                return { ok: false, error: 'Render tidak diizinkan untuk intent ini.' };
            }
            const appearance = appearanceState.getAppearance(senderId);
            const queued = await renderAndSendCharacter({ ...ctx, provider: 'xkiro' }, appearance, args.reason || ctx.textClean);
            return { ok: queued, status: queued ? 'image_queued' : 'image_not_queued', reason: args.reason || null };
        }
        return { ok: false, error: `Tool tidak dikenal: ${name}` };
    };
}

async function handleXkiroCompanionFlow(ctx) {
    const { provider, model, senderId, isOwner, textClean, companionIntent, companionRenderAllowed, systemPrompt: providedSystemPrompt, moodContext } = ctx;
    if (provider !== 'xkiro' || !companionIntent) return false;
    const appearanceContext = appearanceState.buildAppearanceContext(appearanceState.getAppearance(senderId));
    const systemPrompt = `${providedSystemPrompt || getShirokoSystemPrompt(isOwner)}

[NATIVE BOT TOOLS]
Intent lokal yang sudah divalidasi: ${companionIntent}.
Render diizinkan: ${companionRenderAllowed ? 'YA' : 'TIDAK'}.
${moodContext || ''}
Kamu terhubung langsung ke tool bot. Jangan menulis prompt gambar atau berpura-pura sudah mengirim gambar.
Jangan panggil generate_character_image jika Render diizinkan bernilai TIDAK.
Untuk intent perubahan penampilan, panggil update_appearance saja kecuali render diizinkan.
Untuk intent permintaan visual, panggil generate_character_image.
Gunakan get_current_appearance jika perlu mengetahui state penampilan saat ini.
Gunakan reset_appearance jika pengguna meminta kembali ke penampilan default.
Penampilan saat ini (referensi awal):
${appearanceContext}`;
    const result = await require('./providers/xkiro').generateWithTools({
        prompt: textClean,
        senderId,
        isOwner,
        model,
        systemPrompt,
        tools: XKIRO_COMPANION_TOOLS,
        executeTool: createXkiroToolExecutor(ctx),
        imageBuffer: ctx.chatImageBuffer,
        imageMimeType: ctx.chatImageMime
    });
    await ctx.reply(result);
    return true;
}

/**
 * Deteksi Intent via LLM (Tier 2 Fallback jika heuristic ragu) - TANPA MEMORY
 */
async function detectLlmIntent(text, hasImage, senderId, isOwner, provider = 'arisu', model, conversationContext = '') {
    const prompt = `Anda adalah pengendali intent untuk bot WhatsApp AI Companion bernama Shiroko.
Pahami maksud pesan berdasarkan konteks, bukan hanya kata kunci. Bedakan perubahan state penampilan dari permintaan gambar.
Jangan meminta render hanya karena pesan menyebut pakaian, tubuh, atau penampilan. Set "renderRequested" true hanya jika pengguna secara eksplisit atau jelas dari konteks meminta melihat hasil visual/foto/gambar.

Konteks percakapan terbaru:
${conversationContext || '(tidak ada)'}

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

    const classifierOptions = {
        model,
        prompt,
        senderId,
        isOwner,
        useMemory: false,
        throwOnError: true,
        systemPrompt: 'Anda adalah parser JSON intent murni. Kembalikan JSON valid tanpa tag markdown.'
    };

    async function classify(options) {
        const resultText = await AIProvider.generate(options);
        const parsed = parseJsonObject(resultText, 'respons intent classifier');
        const intent = typeof parsed.intent === 'string' ? parsed.intent.toUpperCase() : 'NORMAL_CHAT';
        if (!VALID_COMPANION_INTENTS.has(intent)) {
            throw new Error(`intent classifier tidak dikenal: ${intent}`);
        }
        return { intent, renderRequested: parsed.renderRequested === true };
    }

    try {
        return await classify({ ...classifierOptions, provider });
    } catch (primaryError) {
        if (provider !== 'gemini') {
            console.warn(`[COMPANION] Classifier ${provider} gagal (${primaryError.message}). Fallback ke Gemini.`);
            try {
                return await classify({
                    ...classifierOptions,
                    provider: 'gemini',
                    model: 'gemini-2.5-flash-lite'
                });
            } catch (fallbackError) {
                console.warn(`[COMPANION] Classifier Gemini juga gagal: ${fallbackError.message}`);
            }
        } else {
            console.warn(`[COMPANION] Intent classifier dilewati: ${primaryError.message}`);
        }
        return null;
    }
}

/**
 * Ekstraksi atribut outfit dari gambar via Vision AI - TANPA MEMORY.
 * Analisis vision tetap memakai Gemini karena tidak semua gateway/model mendukung vision.
 */
async function extractOutfitFromVision(imageBuffer, senderId, isOwner, provider = 'gemini', model = 'gemini-2.5-flash-lite') {
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
            provider,
            model,
            prompt,
            senderId,
            isOwner,
            useMemory: false,
            systemPrompt: 'Anda adalah parser vision JSON murni. Output harus JSON valid tanpa tambahan teks lain.',
            imageBuffer
        });

        return parseJsonObject(resultText, 'respons ekstraksi outfit');
    } catch (err) {
        console.error('🚨 [COMPANION] Gagal ekstraksi outfit vision:', err.message);
        return null;
    }
}

/**
 * Ekstraksi atribut appearance (hair, expression, pose, scene, outfit) dari teks.
 * Provider aktif dipakai terlebih dahulu agar konteks model tetap konsisten.
 */
async function extractAppearanceFromText(userText, senderId, isOwner, provider = 'gemini', model = 'gemini-2.5-flash-lite') {
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
            provider,
            model,
            prompt,
            senderId,
            isOwner,
            useMemory: false,
            systemPrompt: 'Anda adalah parser appearance JSON murni. Output harus JSON valid.',
            throwOnError: true
        });

        return parseJsonObject(resultText, 'respons ekstraksi appearance');
    } catch (e) {
        // Fallback dilakukan oleh caller agar kegagalan JSON tidak mengubah state
        // appearance dengan data kosong atau hanya mengulang instruksi pengguna.
        return null;
    }
}

/**
 * Generate Roleplay Text Reply dari Shiroko (Menggunakan Memory Chat Normal)
 */
function resolveActiveSystemPrompt(senderId, isOwner, userMode) {
    const core = getCoreNumber(senderId);
    const customPrompt = appState.userSystemPrompt?.[senderId] || (core && appState.userSystemPrompt?.[core]);
    return customPrompt || getShirokoSystemPrompt(isOwner);
}

async function generateShirokoRoleplayReply(promptContext, senderId, isOwner, userMode = 'gemini', systemPrompt = null) {
    const { provider, model } = AIProvider.resolveMode(userMode, senderId);
    try {
        const reply = await AIProvider.generate({
            provider,
            model,
            prompt: promptContext,
            senderId,
            isOwner,
            useMemory: true,
            systemPrompt: systemPrompt || resolveActiveSystemPrompt(senderId, isOwner, userMode)
        });
        return reply;
    } catch (err) {
        return 'Nn... Sensei, Shiroko sudah siap.';
    }
}

/**
 * Render Karakter Shiroko via PixAI + Kirim Gambar + Balasan Roleplay Natural
 */
async function renderAndSendCharacter(ctx, appearanceData, sceneContextText, renderPrompt = '') {
    const { sock, from, msg, senderId, isOwner, reply, userMode, provider } = ctx;

    // Memotong limit 1 kali sebelum antrean gambar dibuat
    if (!cekDanPotongLimit(senderId, COMPANION_IMAGE_COST)) {
        await reply(`Nn... Token limit Sensei tidak cukup. Diperlukan *${COMPANION_IMAGE_COST} limit* untuk membuat gambar karakter.`);
        return false;
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
        const extraRenderPrompt = typeof renderPrompt === 'string' ? renderPrompt.trim() : '';
        const sceneContext = typeof sceneContextText === 'string' && sceneContextText.trim() ? sceneContextText.trim() : '';
        const fullPixaiPrompt = `${SHIROKO_CHARACTER_ANCHOR}, ${promptTags}${sceneContext ? `, ${sceneContext}` : ''}${extraRenderPrompt ? `, ${extraRenderPrompt}` : ''}, solo, looking at viewer, high quality, masterpiece`;

        // Buat pesan roleplay pendamping gambar
        const roleplayContext = `[SISTEM ROLEPLAY]: Kamu baru saja mengubah penampilan/memakai pakaian ini: (${appearanceData.description || promptTags}). Responlah ucapan Sensei dengan sikap Shiroko yang kalem, agak malu-malu tapi senang. Sampaikan bahwa kamu sudah tampil dengan gaya ini untuknya.`;
        const roleplayText = await generateShirokoRoleplayReply(roleplayContext, senderId, isOwner, userMode);

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
        return true;
    } catch (err) {
        console.error('🚨 [COMPANION] Gagal memproses render/queue PixAI:', err.message);
        safeRefund();
        await reply(`❌ Nn... Terjadi kesalahan saat menyiapkan kamera render: _${err.message}_. Limit telah dikembalikan.`);
        return false;
    }
}

/**
 * Main Companion Orchestrator Flow
 */
async function handleCompanionFlow(ctx) {
    const { textClean, textLower, chatImageBuffer, senderId, isOwner, reply, provider, model, userMode } = ctx;
    // Arisu memakai flow legacy berbasis trigger/classifier. xKiro diproses
    // setelah validasi dan pemotongan biaya model di commands/ai.js.
    if (provider !== 'arisu') return false;
    const hasImage = !!chatImageBuffer;

    // Text-based visual requests use an isolated Arisu planner. This prevents
    // the normal roleplay history from inventing or overwriting outfit fields.
    const preliminaryIntent = !hasImage ? detectHeuristicIntent(textLower, false) : null;
    const shouldUseVisualPlanner = preliminaryIntent && !['NORMAL_CHAT', 'OUTFIT_DISCUSSION', 'VISION_ANALYSIS'].includes(preliminaryIntent.intent);

    if (shouldUseVisualPlanner) {
        try {
            const currentAppearance = appearanceState.getAppearance(senderId);
            const plan = await createArisuVisualPlan({
                text: textClean,
                appearance: currentAppearance,
                senderId,
                isOwner,
                model
            });
            const effectiveAppearance = mergeAppearancePatch(currentAppearance, plan.appearancePatch);

            if (plan.persistAppearance && Object.keys(plan.appearancePatch).length > 0) {
                appearanceState.setAppearance(senderId, plan.appearancePatch, { mode: 'merge' });
            }

                if (plan.render) {
                await renderAndSendCharacter(ctx, effectiveAppearance, textClean, plan.renderPrompt);
            } else {
                const changeDescription = plan.captionContext || plan.appearancePatch.description || textClean;
                const roleplayText = await generateShirokoRoleplayReply(
                    `Sensei meminta penyesuaian penampilan: "${changeDescription}". Sampaikan respons natural sesuai state penampilan terbaru, tanpa menyebut sistem internal.`,
                    senderId,
                    isOwner,
                    userMode
                );
                await reply(roleplayText);
            }
            return true;
        } catch (error) {
            console.warn(`[COMPANION] Arisu visual planner gagal, memakai flow lama: ${error.message}`);
        }
    }

    // Gunakan konteks provider aktif agar follow-up seperti "tunjukkan" tetap dipahami.
    const recentMessages = memory.getMessages(senderId, provider)
        .slice(-6)
        .map(message => `${message.role}: ${message.content}`)
        .join('\n');

    // 1. Cek heuristic intent
    let intentInfo = detectHeuristicIntent(textLower, hasImage);

    // 2. Fallback classifier provider aktif untuk pesan yang relevan/ambigu.
    if (!intentInfo && (hasImage || /baju|pakaian|rambut|foto|gambar|pap|penampilan|senyum|pose|tunjukkan|lihat|buat|generate|kirim|minta/i.test(textLower))) {
        intentInfo = await detectLlmIntent(textClean, hasImage, senderId, isOwner, provider, model, recentMessages);
    }

    // Perubahan state saja tidak otomatis membuat gambar; harus ada permintaan visual eksplisit atau kontekstual.
    if (intentInfo && ['APPEARANCE_CHANGE', 'OUTFIT_CHANGE', 'OUTFIT_CANONICAL_PRESET'].includes(intentInfo.intent)) {
        intentInfo.renderRequested = intentInfo.renderRequested && hasVisualRequest(textClean, recentMessages);
    }

    // Jangan render hanya karena classifier mengembalikan flag tanpa intent visual.
    if (intentInfo && !['OUTFIT_APPLY', 'OUTFIT_CANONICAL_PRESET', 'APPEARANCE_CHANGE', 'OUTFIT_CHANGE', 'CHARACTER_VISUAL_REQUEST'].includes(intentInfo.intent)) {
        intentInfo.renderRequested = false;
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
            // Arisu tidak memiliki adapter vision; analisis gambar tetap memakai Gemini.
            const extractedOutfit = await extractOutfitFromVision(
                chatImageBuffer,
                senderId,
                isOwner,
                'gemini',
                'gemini-2.5-flash-lite'
            );
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
                    senderId, isOwner, userMode
                );
                await reply(roleplayText);
            }
            return true;
        }

        case 'APPEARANCE_CHANGE':
        case 'OUTFIT_CHANGE': {
            console.log(`[COMPANION] Memproses perubahan appearance dari teks untuk User: ${senderId}...`);
            let extractedAppearance = await extractAppearanceFromText(textClean, senderId, isOwner, provider, model);
            if (!extractedAppearance && provider !== 'gemini') {
                console.warn(`[COMPANION] Extractor ${provider} gagal menghasilkan JSON; fallback ke Gemini.`);
                extractedAppearance = await extractAppearanceFromText(
                    textClean,
                    senderId,
                    isOwner,
                    'gemini',
                    'gemini-2.5-flash-lite'
                );
            }
            if (!extractedAppearance) {
                await reply('Nn... Maaf Sensei, Shiroko belum bisa memahami perubahan penampilan itu. Coba jelaskan lagi dengan lebih spesifik.');
                return true;
            }

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
                    senderId, isOwner, userMode
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
                senderId, isOwner, userMode
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
    handleXkiroCompanionFlow,
    handleCompanionFlow
};
