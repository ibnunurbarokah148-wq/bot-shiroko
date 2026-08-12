// ==========================================
// OUTFIT STATE MANAGER — Wrapper / Façade Kompatibilitas Mundur
// Mengarahkan panggilannya ke Appearance State Manager (appearance.state.js)
// ==========================================
const appearanceState = require('./appearance.state');

/**
 * Mengambil outfit/appearance state user saat ini (Backward Compatible).
 */
function getOutfit(senderId) {
    const app = appearanceState.getAppearance(senderId);
    return {
        ...app.outfit,
        hair: app.hair,
        expression: app.expression,
        pose: app.pose,
        scene: app.scene,
        updatedAt: app.updatedAt
    };
}

/**
 * Menyimpan/memperbarui outfit state user (Backward Compatible).
 */
function setOutfit(senderId, outfitData, options = {}) {
    const mode = options.mode === 'replace' ? 'outfit_replace' : (options.mode || 'merge');
    const app = appearanceState.setAppearance(senderId, { outfit: outfitData, ...outfitData }, { mode });
    return getOutfit(senderId);
}

/**
 * Mengembalikan outfit user ke seragam bawaan Shiroko (Backward Compatible).
 */
function resetOutfit(senderId) {
    appearanceState.resetAppearance(senderId);
    return getOutfit(senderId);
}

/**
 * Mengonversi object outfit/appearance state menjadi string tag prompt PixAI yang bersih.
 */
function toPixaiPromptTags(outfitOrApp) {
    return appearanceState.toPixaiPromptTags(outfitOrApp);
}

module.exports = {
    DEFAULT_SHIROKO_OUTFIT: appearanceState.DEFAULT_SHIROKO_APPEARANCE.outfit,
    getOutfit,
    setOutfit,
    resetOutfit,
    toPixaiPromptTags
};
