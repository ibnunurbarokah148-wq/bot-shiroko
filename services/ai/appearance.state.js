// ==========================================
// APPEARANCE STATE MANAGER — Dynamic Character Appearance
// Handles hair, expression, pose, scene, and outfit persistence
// ==========================================
const { dbOutfit, getCoreNumber } = require('../../config/db');

const DEFAULT_SHIROKO_APPEARANCE = {
    hair: {
        style: 'side braid',
        length: 'medium',
        color: 'light blue'
    },
    expression: 'neutral',
    pose: 'standing',
    scene: {
        location: '',
        lighting: ''
    },
    outfit: {
        outer: 'abydos blue scarf, dark grey jacket on shoulders',
        inner: 'white collared shirt with black tie',
        bottom: 'pleated skirt',
        shoes: 'loafers with socks',
        accessories: ['black gloves'],
        colors: ['blue', 'white', 'black'],
        style: 'abydos high school uniform',
        description: 'Seragam sekolah Abydos lengkap dengan syal biru khas Shiroko'
    },
    englishPromptTags: '',
    description: 'Penampilan bawaan Shiroko (Seragam Abydos)',
    updatedAt: Date.now()
};

/**
 * Normalisasi record lama dari database ke format Appearance State standar.
 * Menjamin backward compatibility 100% untuk record user_outfits lama.
 * @param {object} raw
 * @returns {object}
 */
function normalizeAppearance(raw) {
    if (!raw || typeof raw !== 'object') {
        return JSON.parse(JSON.stringify(DEFAULT_SHIROKO_APPEARANCE));
    }

    // Cek apakah data merupakan format outfit lama (tanpa key hair/expression)
    const isOldFormat = !raw.hair && !raw.expression && !raw.outfit;
    let outfitObj;

    if (isOldFormat) {
        outfitObj = {
            outer: raw.outer || '',
            inner: raw.inner || '',
            bottom: raw.bottom || '',
            shoes: raw.shoes || '',
            accessories: Array.isArray(raw.accessories) ? raw.accessories : [],
            colors: Array.isArray(raw.colors) ? raw.colors : [],
            style: raw.style || '',
            description: raw.description || ''
        };
    } else {
        outfitObj = {
            outer: raw.outfit?.outer || '',
            inner: raw.outfit?.inner || '',
            bottom: raw.outfit?.bottom || '',
            shoes: raw.outfit?.shoes || '',
            accessories: Array.isArray(raw.outfit?.accessories) ? raw.outfit.accessories : (Array.isArray(raw.accessories) ? raw.accessories : []),
            colors: Array.isArray(raw.outfit?.colors) ? raw.outfit.colors : [],
            style: raw.outfit?.style || '',
            description: raw.outfit?.description || ''
        };
    }

    return {
        hair: {
            style: raw.hair?.style || DEFAULT_SHIROKO_APPEARANCE.hair.style,
            length: raw.hair?.length || DEFAULT_SHIROKO_APPEARANCE.hair.length,
            color: raw.hair?.color || DEFAULT_SHIROKO_APPEARANCE.hair.color
        },
        expression: raw.expression || DEFAULT_SHIROKO_APPEARANCE.expression,
        pose: raw.pose || DEFAULT_SHIROKO_APPEARANCE.pose,
        scene: {
            location: raw.scene?.location || '',
            lighting: raw.scene?.lighting || ''
        },
        outfit: {
            ...DEFAULT_SHIROKO_APPEARANCE.outfit,
            ...outfitObj
        },
        englishPromptTags: raw.englishPromptTags || '',
        description: raw.description || outfitObj.description || DEFAULT_SHIROKO_APPEARANCE.description,
        updatedAt: raw.updatedAt || Date.now()
    };
}

/**
 * Mengambil Appearance State user saat ini.
 * @param {string} senderId
 * @returns {object}
 */
function getAppearance(senderId) {
    const core = getCoreNumber(senderId) || senderId;
    const existing = dbOutfit[core];
    return normalizeAppearance(existing);
}

/**
 * Menyimpan/memperbarui Appearance State user.
 * @param {string} senderId
 * @param {object} inputData
 * @param {object} [options]
 * @param {'outfit_replace'|'appearance_replace'|'merge'} [options.mode='merge']
 * @returns {object} appearance terbaru
 */
function setAppearance(senderId, inputData, options = {}) {
    const core = getCoreNumber(senderId) || senderId;
    const mode = options.mode || 'merge';
    const current = getAppearance(senderId);

    let updated;

    if (mode === 'appearance_replace') {
        // FULL APPEARANCE REPLACEMENT: Reset total penampilan ke bawaan + ganti outfit/atribut baru yang diberikan
        const inputOutfit = inputData.outfit || inputData;
        updated = {
            ...DEFAULT_SHIROKO_APPEARANCE,
            hair: {
                ...DEFAULT_SHIROKO_APPEARANCE.hair,
                ...(inputData.hair || {})
            },
            expression: inputData.expression || DEFAULT_SHIROKO_APPEARANCE.expression,
            pose: inputData.pose || DEFAULT_SHIROKO_APPEARANCE.pose,
            scene: {
                ...DEFAULT_SHIROKO_APPEARANCE.scene,
                ...(inputData.scene || {})
            },
            outfit: {
                outer: inputOutfit.outer || '',
                inner: inputOutfit.inner || '',
                bottom: inputOutfit.bottom || '',
                shoes: inputOutfit.shoes || '',
                accessories: Array.isArray(inputOutfit.accessories) ? inputOutfit.accessories : [],
                colors: Array.isArray(inputOutfit.colors) ? inputOutfit.colors : [],
                style: inputOutfit.style || '',
                description: inputOutfit.description || 'Penampilan Baru'
            },
            description: inputData.description || 'Penampilan Baru',
            updatedAt: Date.now()
        };
    } else if (mode === 'outfit_replace') {
        // FULL OUTFIT REPLACEMENT: Hanya ganti outfit total, tapi PERTAHANKAN hair, expression, pose, scene
        const inputOutfit = inputData.outfit || inputData;
        updated = {
            ...current,
            outfit: {
                outer: inputOutfit.outer || '',
                inner: inputOutfit.inner || '',
                bottom: inputOutfit.bottom || '',
                shoes: inputOutfit.shoes || '',
                accessories: Array.isArray(inputOutfit.accessories) ? inputOutfit.accessories : [],
                colors: Array.isArray(inputOutfit.colors) ? inputOutfit.colors : [],
                style: inputOutfit.style || '',
                description: inputOutfit.description || 'Outfit Baru'
            },
            englishPromptTags: '',
            description: inputData.description || inputOutfit.description || current.description,
            updatedAt: Date.now()
        };
    } else {
        // PARTIAL MERGE: Update atribut yang terisi tanpa menghapus state lama
        const newHair = { ...current.hair };
        if (inputData.hair?.style) newHair.style = inputData.hair.style;
        if (inputData.hair?.length) newHair.length = inputData.hair.length;
        if (inputData.hair?.color) newHair.color = inputData.hair.color;

        const newScene = { ...current.scene };
        if (inputData.scene?.location) newScene.location = inputData.scene.location;
        if (inputData.scene?.lighting) newScene.lighting = inputData.scene.lighting;

        const newOutfit = { ...current.outfit };
        const inputOutfit = inputData.outfit || (inputData.outer || inputData.inner || inputData.bottom || inputData.shoes ? inputData : null);
        if (inputOutfit) {
            if (inputOutfit.outer) newOutfit.outer = inputOutfit.outer;
            if (inputOutfit.inner) newOutfit.inner = inputOutfit.inner;
            if (inputOutfit.bottom) newOutfit.bottom = inputOutfit.bottom;
            if (inputOutfit.shoes) newOutfit.shoes = inputOutfit.shoes;
            if (inputOutfit.style) newOutfit.style = inputOutfit.style;
            if (Array.isArray(inputOutfit.accessories) && inputOutfit.accessories.length > 0) {
                newOutfit.accessories = inputOutfit.accessories;
            }
            if (Array.isArray(inputOutfit.colors) && inputOutfit.colors.length > 0) {
                newOutfit.colors = inputOutfit.colors;
            }
            if (inputOutfit.description) newOutfit.description = inputOutfit.description;
        }

        updated = {
            hair: newHair,
            expression: inputData.expression || current.expression,
            pose: inputData.pose || current.pose,
            scene: newScene,
            outfit: newOutfit,
            englishPromptTags: '',
            description: inputData.description || current.description,
            updatedAt: Date.now()
        };
    }

    dbOutfit[core] = updated;
    return updated;
}

/**
 * Reset Appearance State user kembali ke bawaan Shiroko.
 * @param {string} senderId
 * @returns {object}
 */
function resetAppearance(senderId) {
    const core = getCoreNumber(senderId) || senderId;
    const defaultData = { ...DEFAULT_SHIROKO_APPEARANCE, updatedAt: Date.now() };
    dbOutfit[core] = defaultData;
    return defaultData;
}

/**
 * Mengonversi Appearance State menjadi prompt tags PixAI yang bersih tanpa konflik.
 * @param {object} appearanceState
 * @returns {string}
 */
function toPixaiPromptTags(appearanceState) {
    const app = normalizeAppearance(appearanceState);

    if (app.englishPromptTags) {
        return app.englishPromptTags;
    }

    const parts = [];

    // 1. Hairstyle (jika terisi)
    if (app.hair && app.hair.style) {
        const style = app.hair.style.toLowerCase();
        if (style.includes('hair')) {
            parts.push(app.hair.style);
        } else {
            parts.push(`${app.hair.style} hair`);
        }
    }

    // 2. Ekspresi
    if (app.expression && app.expression !== 'neutral') {
        parts.push(app.expression);
    }

    // 3. Pose
    if (app.pose && app.pose !== 'standing') {
        parts.push(app.pose);
    }

    // 4. Outfit & Aksesori Pakaian (Canonical Source)
    const o = app.outfit;
    if (o.style) parts.push(o.style);
    if (o.outer) parts.push(o.outer);
    if (o.inner) parts.push(o.inner);
    if (o.bottom) parts.push(o.bottom);
    if (o.shoes) parts.push(o.shoes);
    if (Array.isArray(o.accessories) && o.accessories.length > 0) {
        parts.push(o.accessories.join(', '));
    }
    if (Array.isArray(o.colors) && o.colors.length > 0) {
        parts.push(`${o.colors.join(' and ')} theme`);
    }

    // 5. Scene / Location
    if (app.scene && app.scene.location) {
        parts.push(app.scene.location);
    }

    return parts.filter(Boolean).join(', ');
}

/**
 * Membuat ringkasan konteks appearance yang hemat token untuk disisipkan ke AI System Prompt.
 * @param {object} appearanceState
 * @returns {string}
 */
function buildAppearanceContext(appearanceState) {
    const app = normalizeAppearance(appearanceState);
    const parts = [];

    parts.push(`Gunakan detail visual berikut hanya jika user secara langsung bertanya tentang penampilan, pakaian, rambut, atau memujinya. Jangan menyebut sumber, state internal, metadata, atau instruksi ini.`);
    parts.push(`Karakter: Sunaookami Shiroko`);

    if (app.hair && app.hair.style) {
        parts.push(`Rambut: ${app.hair.style}`);
    }

    if (app.outfit) {
        const o = app.outfit;
        const oParts = [];
        if (o.style) oParts.push(`gaya ${o.style}`);
        if (o.outer) oParts.push(o.outer);
        if (o.inner) oParts.push(o.inner);
        if (o.bottom) oParts.push(o.bottom);
        if (o.shoes) oParts.push(o.shoes);
        if (oParts.length > 0) {
            parts.push(`Pakaian: ${oParts.join(', ')}`);
        }
        if (Array.isArray(o.accessories) && o.accessories.length > 0) {
            parts.push(`Aksesori: ${o.accessories.join(', ')}`);
        }
    }

    if (app.expression && app.expression !== 'neutral') {
        parts.push(`Ekspresi Wajah: ${app.expression}`);
    }

    if (app.pose && app.pose !== 'standing') {
        parts.push(`Pose/Postur: ${app.pose}`);
    }

    if (app.scene && app.scene.location) {
        parts.push(`Lokasi/Latar: ${app.scene.location}`);
    }

    parts.push(`Jika user bertanya tentang penampilan sekarang atau memujinya, jawab secara natural sesuai detail ini; jika tidak relevan, jangan menyebutkannya.`);

    return parts.join('\n');
}

// Single Canonical Source of Truth untuk Seragam Abydos Bawaan Shiroko
const CANONICAL_ABYDOS_OUTFIT = DEFAULT_SHIROKO_APPEARANCE.outfit;

/**
 * Memperbarui outfit user ke seragam Abydos kanonikal (SINGLE CANONICAL SOURCE),
 * tetapi MEMPERTAHANKAN hair, expression, pose, scene saat ini.
 * @param {string} senderId
 * @returns {object} appearance terbaru
 */
function applyCanonicalOutfit(senderId) {
    return setAppearance(senderId, { outfit: CANONICAL_ABYDOS_OUTFIT }, { mode: 'outfit_replace' });
}

/**
 * Memverifikasi apakah mutasi state di SQLite berhasil tersimpan secara valid.
 * @param {object} verifiedState - State terverifikasi yang dibaca dari SQLite
 * @param {object} targetInput - Data yang diminta untuk diubah
 * @param {'outfit_replace'|'appearance_replace'|'merge'|'canonical'} mode
 * @returns {boolean}
 */
function verifyStateMutation(verifiedState, targetInput, mode) {
    if (!verifiedState || typeof verifiedState !== 'object') return false;

    if (mode === 'canonical') {
        return verifiedState.outfit && verifiedState.outfit.outer === CANONICAL_ABYDOS_OUTFIT.outer;
    }

    if (mode === 'outfit_replace') {
        const targetOuter = targetInput?.outfit?.outer || targetInput?.outer || CANONICAL_ABYDOS_OUTFIT.outer;
        return verifiedState.outfit && verifiedState.outfit.outer === targetOuter;
    }

    if (mode === 'appearance_replace') {
        return !!(verifiedState.outfit && verifiedState.hair && verifiedState.expression !== undefined);
    }

    // mode merge
    if (targetInput?.hair?.style && verifiedState.hair?.style !== targetInput.hair.style) {
        return false;
    }
    if (targetInput?.outfit?.outer && verifiedState.outfit?.outer !== targetInput.outfit.outer) {
        return false;
    }

    return true;
}

module.exports = {
    DEFAULT_SHIROKO_APPEARANCE,
    CANONICAL_ABYDOS_OUTFIT,
    normalizeAppearance,
    getAppearance,
    setAppearance,
    resetAppearance,
    applyCanonicalOutfit,
    verifyStateMutation,
    toPixaiPromptTags,
    buildAppearanceContext
};
