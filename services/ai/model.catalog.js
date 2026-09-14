// ==========================================
// KATALOG MODEL AI — Mapping nama model ke tingkatan provider
// Standard  -> ArisuSoft (semua user)
// Premium   -> xKiro Gateway (khusus VIP Premium / Owner)
// Open Source -> OpenRouter & Cloudflare (semua user)
// ==========================================

const MODEL_FAMILIES = [
    {
        key: 'ds3',
        label: 'Deepseek V3.2',
        standardMode: 'ds3',
        xkiroPatterns: [/deepseek.*v3\.2/i, /deepseek.*v3/i, /deepseek/i]
    },
    {
        key: 'ds4',
        label: 'Deepseek V4 Pro',
        standardMode: 'ds4',
        xkiroPatterns: [/deepseek.*v4.*pro/i, /deepseek.*v4/i, /deepseek/i]
    },
    {
        key: 'gemini',
        label: 'Gemini',
        standardMode: 'arisu-gemini',
        xkiroPatterns: [/gemini.*flash/i, /gemini/i, /google/i]
    },
    {
        key: 'glm',
        label: 'GLM',
        standardMode: 'glm',
        xkiroPatterns: [/glm/i, /z-ai/i]
    },
    {
        key: 'qwen',
        label: 'Qwen',
        standardMode: 'qwen',
        xkiroPatterns: [/qwen.*flash/i, /qwen/i]
    },
    {
        key: 'gpt',
        label: 'GPT',
        standardMode: 'gpt',
        xkiroPatterns: [/gpt-5/i, /gpt/i, /openai/i]
    },
    {
        key: 'grok',
        label: 'Grok',
        standardMode: 'grok',
        xkiroPatterns: [/grok/i, /x-ai/i]
    },
    {
        key: 'opensource',
        label: 'Open Source',
        openSource: true
    }
];

const OPEN_SOURCE_PROVIDERS = [
    { key: 'openrouter', label: 'OpenRouter', mode: 'openrouter' },
    { key: 'cloudflare', label: 'Cloudflare AI', mode: 'cloudflare' }
];

function getFamilies() {
    return MODEL_FAMILIES.map(family => ({ ...family }));
}

function getFamilyByIndex(index) {
    return MODEL_FAMILIES[index] || null;
}

function getFamilyByKey(key) {
    return MODEL_FAMILIES.find(family => family.key === key) || null;
}

/**
 * Pilih model xKiro terbaik untuk sebuah keluarga model.
 * Hanya model yang benar-benar boleh dipakai (allowlist premium atau free)
 * yang dipertimbangkan agar biaya limit selalu dapat dihitung.
 *
 * @param {object} family - Entry dari MODEL_FAMILIES
 * @param {Array} models - Daftar model live dari xKiro
 * @param {(model: object) => boolean} isUsable - Predikat kelayakan model
 * @returns {object|null}
 */
function resolveXKiroModel(family, models, isUsable) {
    if (!family?.xkiroPatterns || !Array.isArray(models)) return null;
    const usable = models.filter(model => isUsable(model));
    if (usable.length === 0) return null;

    for (const pattern of family.xkiroPatterns) {
        const matched = usable.filter(model => pattern.test(`${model.id} ${model.name}`));
        if (matched.length === 0) continue;
        // Utamakan model berbayar (kualitas premium) sebelum model gratis.
        const paid = matched.filter(model => model.billingType !== 'free' && model.accessTier !== 'free');
        return (paid[0] || matched[0]);
    }
    return null;
}

module.exports = {
    MODEL_FAMILIES,
    OPEN_SOURCE_PROVIDERS,
    getFamilies,
    getFamilyByIndex,
    getFamilyByKey,
    resolveXKiroModel
};
