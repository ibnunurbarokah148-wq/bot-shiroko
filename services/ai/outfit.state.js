// ==========================================
// OUTFIT STATE MANAGER — Persistent User Character Outfit
// ==========================================
const { dbOutfit, getCoreNumber } = require('../../config/db');

const DEFAULT_SHIROKO_OUTFIT = {
    outer: 'abydos blue scarf, dark grey jacket on shoulders',
    inner: 'white collared shirt with black tie',
    bottom: 'pleated skirt',
    shoes: 'loafers with socks',
    accessories: ['black gloves', 'halo'],
    colors: ['blue', 'white', 'black'],
    style: 'abydos high school uniform',
    description: 'Seragam sekolah Abydos lengkap dengan syal biru khas Shiroko'
};

/**
 * Mengambil outfit state user saat ini. Jika belum ada, kembalikan default.
 * @param {string} senderId
 * @returns {object}
 */
function getOutfit(senderId) {
    const core = getCoreNumber(senderId) || senderId;
    const existing = dbOutfit[core];
    if (existing && typeof existing === 'object') {
        return { ...DEFAULT_SHIROKO_OUTFIT, ...existing };
    }
    return { ...DEFAULT_SHIROKO_OUTFIT };
}

/**
 * Menyimpan/memperbarui outfit state user.
 * @param {string} senderId
 * @param {object} outfitData
 * @param {object} [options]
 * @param {'replace'|'merge'} [options.mode='replace']
 * @returns {object} outfit terbaru
 */
function setOutfit(senderId, outfitData, options = {}) {
    const core = getCoreNumber(senderId) || senderId;
    const mode = options.mode || 'replace';
    const current = getOutfit(senderId);

    let updated;
    if (mode === 'replace') {
        // FULL REPLACEMENT: Membuat state outfit baru yang bersih tanpa mencemari atribut lama
        updated = {
            outer: outfitData.outer || '',
            inner: outfitData.inner || '',
            bottom: outfitData.bottom || '',
            shoes: outfitData.shoes || '',
            accessories: Array.isArray(outfitData.accessories) ? outfitData.accessories : [],
            colors: Array.isArray(outfitData.colors) ? outfitData.colors : [],
            style: outfitData.style || '',
            englishPromptTags: outfitData.englishPromptTags || '',
            description: outfitData.description || 'Pakaian Baru',
            updatedAt: Date.now()
        };
    } else {
        // PARTIAL UPDATE: Hanya perbarui field yang terisi (non-empty string / non-empty array) dari outfitData.
        // Atribut lama yang tidak disebutkan/kosong dalam request baru TETAP DIPERTAHANKAN.
        const mergedFields = {};
        for (const [key, value] of Object.entries(outfitData)) {
            if (key === 'englishPromptTags') continue;
            if (typeof value === 'string' && value.trim().length > 0) {
                mergedFields[key] = value.trim();
            } else if (Array.isArray(value) && value.length > 0) {
                mergedFields[key] = value;
            }
        }

        updated = {
            ...current,
            ...mergedFields,
            englishPromptTags: '', // Kosongkan agar toPixaiPromptTags menyusun tag dari gabungan field terbaru
            updatedAt: Date.now()
        };
    }

    dbOutfit[core] = updated;
    return updated;
}

/**
 * Mengembalikan outfit user ke seragam bawaan Shiroko.
 * @param {string} senderId
 * @returns {object}
 */
function resetOutfit(senderId) {
    const core = getCoreNumber(senderId) || senderId;
    const defaultData = { ...DEFAULT_SHIROKO_OUTFIT, updatedAt: Date.now() };
    dbOutfit[core] = defaultData;
    return defaultData;
}

/**
 * Mengonversi object outfit state menjadi string tag prompt PixAI yang bersih.
 * @param {object} outfit
 * @returns {string}
 */
function toPixaiPromptTags(outfit) {
    if (!outfit) return '';

    const parts = [];

    if (outfit.englishPromptTags) {
        parts.push(outfit.englishPromptTags);
    } else {
        if (outfit.style) parts.push(`${outfit.style}`);
        if (outfit.outer) parts.push(outfit.outer);
        if (outfit.inner) parts.push(outfit.inner);
        if (outfit.bottom) parts.push(outfit.bottom);
        if (outfit.shoes) parts.push(outfit.shoes);

        if (Array.isArray(outfit.accessories) && outfit.accessories.length > 0) {
            parts.push(outfit.accessories.join(', '));
        }
        if (Array.isArray(outfit.colors) && outfit.colors.length > 0) {
            parts.push(`${outfit.colors.join(' and ')} theme`);
        }
    }

    return parts.filter(Boolean).join(', ');
}

module.exports = {
    DEFAULT_SHIROKO_OUTFIT,
    getOutfit,
    setOutfit,
    resetOutfit,
    toPixaiPromptTags
};
