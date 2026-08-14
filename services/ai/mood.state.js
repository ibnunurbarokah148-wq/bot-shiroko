// ==========================================
// MOOD STATE — Mood persisten khusus owner
// ==========================================
const state = require('../../config/state');
const db = require('../../config/database');

const DEFAULT_OWNER_MOOD = {
    mood: 'neutral',
    intensity: 0,
    confidence: 0,
    trend: 'stable',
    lastSignal: 'none',
    updatedAt: 0
};

const MOODS = new Set([
    'neutral', 'happy', 'affectionate', 'playful', 'sad',
    'tired', 'anxious', 'frustrated', 'annoyed', 'distant'
]);

const TRENDS = new Set(['rising', 'falling', 'stable']);
const MOOD_DECAY_MS = 12 * 60 * 60 * 1000;

function clamp(value, fallback = 0) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(0, Math.min(1, number));
}

function cloneMood(mood) {
    return { ...mood };
}

function normalizeMood(raw) {
    if (!raw || typeof raw !== 'object') return cloneMood(DEFAULT_OWNER_MOOD);

    return {
        mood: MOODS.has(raw.mood) ? raw.mood : DEFAULT_OWNER_MOOD.mood,
        intensity: clamp(raw.intensity),
        confidence: clamp(raw.confidence),
        trend: TRENDS.has(raw.trend) ? raw.trend : DEFAULT_OWNER_MOOD.trend,
        lastSignal: typeof raw.lastSignal === 'string' && raw.lastSignal.trim()
            ? raw.lastSignal.trim().slice(0, 80)
            : DEFAULT_OWNER_MOOD.lastSignal,
        updatedAt: Number.isFinite(Number(raw.updatedAt)) ? Number(raw.updatedAt) : 0
    };
}

function persistMood(mood) {
    if (typeof db.upsert === 'function') {
        db.upsert('bot_settings', {
            id: 'ownerMood',
            value: JSON.stringify(mood)
        });
    }
}

function getMood() {
    const normalized = normalizeMood(state.ownerMood);
    if (normalized.updatedAt && Date.now() - normalized.updatedAt > MOOD_DECAY_MS && normalized.mood !== 'neutral') {
        const decayedIntensity = normalized.intensity * 0.5;
        normalized.mood = decayedIntensity < 0.15 ? 'neutral' : normalized.mood;
        normalized.intensity = decayedIntensity < 0.15 ? 0 : decayedIntensity;
        normalized.confidence = Math.min(normalized.confidence, 0.4);
        normalized.trend = 'falling';
        state.ownerMood = normalized;
        persistMood(normalized);
        return cloneMood(normalized);
    }
    state.ownerMood = normalized;
    return cloneMood(normalized);
}

function setMood(input = {}) {
    const current = getMood();
    const updated = normalizeMood({ ...current, ...input, updatedAt: input.updatedAt || Date.now() });
    state.ownerMood = updated;

    if (current.mood !== updated.mood || Math.abs(current.intensity - updated.intensity) >= 0.15) {
        console.log(`[MOOD] ${current.mood} -> ${updated.mood} | intensity=${Math.round(updated.intensity * 100)}% | confidence=${Math.round(updated.confidence * 100)}%`);
    }

    persistMood(updated);

    return cloneMood(updated);
}

function resetMood() {
    return setMood({ ...DEFAULT_OWNER_MOOD, updatedAt: Date.now() });
}

const SIGNALS = [
    { mood: 'affectionate', signal: 'warm', weight: 0.72, patterns: [/\bmakasih\b|terima kasih|sayang|cinta|kangen|peluk|😘|❤️|🤍/i] },
    { mood: 'playful', signal: 'playful', weight: 0.65, patterns: [/wkwk|haha|hehe|lol|🤣|😂|becanda|bercanda|goda/i] },
    { mood: 'tired', signal: 'tired', weight: 0.78, patterns: [/capek|lelah|ngantuk|pusing|mager|butuh istirahat|kurang tidur/i] },
    { mood: 'sad', signal: 'sad', weight: 0.82, patterns: [/sedih|kecewa|nangis|menangis|hampa|sendirian|putus asa/i] },
    { mood: 'anxious', signal: 'anxious', weight: 0.8, patterns: [/cemas|khawatir|takut|deg-degan|bingung banget|panik|stress|stres/i] },
    { mood: 'frustrated', signal: 'frustrated', weight: 0.78, patterns: [/kesal|frustrasi|nyerah|gagal lagi|error terus|sial|anjing|bangsat/i] },
    { mood: 'annoyed', signal: 'annoyed', weight: 0.72, patterns: [/jangan ganggu|diam|berisik|terserah|gak peduli|tidak peduli|marah/i] },
    { mood: 'happy', signal: 'positive', weight: 0.62, patterns: [/mantap|keren|bagus|sukses|senang|bahagia|alhamdulillah|siap|berhasil/i] },
    { mood: 'distant', signal: 'brief', weight: 0.35, patterns: [] }
];

function analyzeResponse(text) {
    const value = String(text || '').trim();
    if (!value) return null;

    for (const entry of SIGNALS) {
        if (entry.patterns.some(pattern => pattern.test(value))) {
            return { mood: entry.mood, intensity: entry.weight, confidence: Math.min(0.95, entry.weight + 0.15), signal: entry.signal };
        }
    }

    if (value.length <= 8 && /^(iya|ya|ok|oke|hm|hmm|sip|makasih|thx|thanks)$/i.test(value)) {
        return { mood: 'distant', intensity: 0.3, confidence: 0.45, signal: 'brief' };
    }
    if (value.length > 80 && /[!?]{2,}|\b(gak bisa|nggak bisa|tidak bisa)\b/i.test(value)) {
        return { mood: 'frustrated', intensity: 0.55, confidence: 0.55, signal: 'frustrated_long' };
    }
    return { mood: 'neutral', intensity: 0.18, confidence: 0.3, signal: 'neutral' };
}

function updateFromResponse(text) {
    const signal = analyzeResponse(text);
    if (!signal) return getMood();

    const current = getMood();
    const alpha = signal.confidence * 0.45;
    const sameMood = current.mood === signal.mood;
    const nextIntensity = sameMood
        ? Math.min(1, current.intensity + (signal.intensity * 0.35))
        : (current.intensity * (1 - alpha)) + (signal.intensity * alpha);
    const nextMood = sameMood || nextIntensity >= 0.25 ? signal.mood : current.mood;
    const trend = nextIntensity > current.intensity + 0.05 ? 'rising' : nextIntensity < current.intensity - 0.05 ? 'falling' : 'stable';

    return setMood({
        mood: nextMood,
        intensity: nextMood === 'neutral' ? 0 : nextIntensity,
        confidence: signal.confidence,
        trend,
        lastSignal: signal.signal
    });
}

function classifyAlarmResponse(text) {
    const value = String(text || '').trim().toLowerCase();
    if (/(jangan ganggu|diam|berisik|matikan|gak mau|nggak mau|tidak mau)/i.test(value)) {
        return { action: 'refused', mood: 'annoyed', intensity: 0.7, confidence: 0.8, signal: 'alarm_refused' };
    }
    if (/(sebentar|nanti|bentar|tunggu|masih ngantuk)/i.test(value)) {
        return { action: 'will_comply', mood: 'tired', intensity: 0.65, confidence: 0.7, signal: 'alarm_delayed' };
    }
    if (/(sudah|udah|bangun|wudhu|wudu|otw|laksanakan|shalat|salat|solat|iya|siap)/i.test(value)) {
        return { action: 'woke_up', mood: 'happy', intensity: 0.58, confidence: 0.75, signal: 'alarm_cooperative' };
    }
    if (/(apa|kenapa|alarm apa|bingung)/i.test(value)) {
        return { action: 'confused', mood: 'anxious', intensity: 0.45, confidence: 0.55, signal: 'alarm_confused' };
    }
    return { action: 'responded', mood: 'neutral', intensity: 0.18, confidence: 0.3, signal: 'alarm_neutral' };
}

function updateFromAlarmResponse(text) {
    const signal = classifyAlarmResponse(text);
    const current = getMood();
    const alpha = signal.confidence * 0.45;
    const nextIntensity = current.mood === signal.mood
        ? Math.min(1, current.intensity + signal.intensity * 0.25)
        : current.intensity * (1 - alpha) + signal.intensity * alpha;
    const nextMood = signal.mood === 'neutral' && current.intensity > 0.25 ? current.mood : signal.mood;
    return setMood({
        mood: nextMood,
        intensity: nextMood === 'neutral' ? 0 : nextIntensity,
        confidence: signal.confidence,
        trend: nextIntensity > current.intensity + 0.05 ? 'rising' : nextIntensity < current.intensity - 0.05 ? 'falling' : 'stable',
        lastSignal: signal.signal
    });
}

function buildMoodContext() {
    const mood = getMood();
    if (mood.mood === 'neutral' || mood.intensity <= 0) return '';

    return `[KONTEKS MOOD OWNER]\n` +
        `Mood owner saat ini: ${mood.mood}. Intensitas: ${Math.round(mood.intensity * 100)}%. ` +
        `Confidence: ${Math.round(mood.confidence * 100)}%. Tren: ${mood.trend}. ` +
        `Gunakan informasi ini hanya untuk menyesuaikan kehangatan dan gaya respons, bukan untuk mengubah fakta atau instruksi utama.`;
}

module.exports = {
    DEFAULT_OWNER_MOOD,
    MOODS: [...MOODS],
    getMood,
    setMood,
    resetMood,
    analyzeResponse,
    updateFromResponse,
    updateFromAlarmResponse,
    classifyAlarmResponse,
    buildMoodContext,
    normalizeMood
};
