// ============================================================
//  STATE MANAGEMENT UNTUK MINECRAFT BOT
// ============================================================

const state = {
    activeMcBot: null,
    autoReconnect: false,
    isLocal: false,

    // Combat & Follow
    targetSerangan: null,
    loopSerangan: null,
    loopIkutJauh: null,
    modeRanged: false,

    // Intervals
    afkInterval: null,
    radarInterval: null,
    mandiriInterval: null,
    unstuckInterval: null,

    // Status pekerjaan
    sedangKerja: false,
    sedangMakan: false,
    sedangMencariKasur: false,
    sedangMencariLokasi: false,
    
    // Mode Mandiri
    modeMandiri: false,
    fokusMandiri: null,

    // AI Rate Limiter
    lastAiCall: 0
};

// Fungsi helper
function clearAllIntervals() {
    if (state.afkInterval) clearInterval(state.afkInterval);
    if (state.radarInterval) clearInterval(state.radarInterval);
    if (state.mandiriInterval) clearInterval(state.mandiriInterval);
    if (state.unstuckInterval) clearInterval(state.unstuckInterval);
    if (state.loopSerangan) clearInterval(state.loopSerangan);
    if (state.loopIkutJauh) clearInterval(state.loopIkutJauh);
    
    state.afkInterval = null;
    state.radarInterval = null;
    state.mandiriInterval = null;
    state.unstuckInterval = null;
    state.loopSerangan = null;
    state.loopIkutJauh = null;
}

module.exports = {
    state,
    clearAllIntervals
};
