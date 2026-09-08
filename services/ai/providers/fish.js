const axios = require('axios');

const FISH_TTS_URL = 'https://api.fish.audio/v1/tts';

function getApiKey() {
    const key = String(process.env.FISH_API_KEY || '').trim();
    if (!key) throw new Error('FISH_API_KEY belum dikonfigurasi.');
    return key;
}

function getVoiceId(voiceId) {
    const value = String(voiceId || process.env.SHIROKO_VOICE_ID || '').trim();
    if (!value) throw new Error('SHIROKO_VOICE_ID belum dikonfigurasi.');
    return value;
}

async function textToSpeech(textInput, voiceId = process.env.SHIROKO_VOICE_ID, options = {}) {
    const text = String(textInput || '').trim();
    if (!text) throw new Error('Teks Fish Audio tidak boleh kosong.');

    const format = String(options.format || 'mp3').toLowerCase();
    if (format !== 'mp3') throw new Error('Fish Audio adapter saat ini hanya mendukung format mp3.');

    try {
        const response = await axios.post(FISH_TTS_URL, {
            text,
            reference_id: getVoiceId(voiceId),
            format
        }, {
            headers: {
                Authorization: `Bearer ${getApiKey()}`,
                'Content-Type': 'application/json',
                model: options.model || process.env.FISH_TTS_MODEL || 's2.1-pro-free'
            },
            responseType: 'arraybuffer',
            timeout: Number(process.env.FISH_TTS_TIMEOUT || 95000),
            maxContentLength: Infinity,
            maxBodyLength: Infinity
        });
        const buffer = Buffer.from(response.data);
        if (!buffer.length) throw new Error('Fish Audio mengembalikan audio kosong.');
        return { buffer, mime: 'audio/mpeg', format: 'mp3', voice: getVoiceId(voiceId) };
    } catch (error) {
        let detail = error.message;
        if (error.response?.data) {
            try {
                const parsed = JSON.parse(Buffer.from(error.response.data).toString('utf8'));
                detail = parsed?.error?.message || parsed?.message || detail;
            } catch {}
        }
        throw new Error(`Fish Audio TTS Error: ${detail}`);
    }
}

module.exports = { textToSpeech };
