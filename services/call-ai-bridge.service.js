const express = require('express');
const crypto = require('crypto');
const AIProvider = require('./ai/AIProvider');
const { getShirokoSystemPrompt } = require('./ai/prompts');

const MAX_AUDIO_BYTES = Number(process.env.CALL_MAX_AUDIO_BYTES || 4 * 1024 * 1024);
const MAX_TRANSCRIPT_CHARS = Number(process.env.CALL_MAX_TRANSCRIPT_CHARS || 4000);
const MAX_REPLY_CHARS = Number(process.env.CALL_MAX_REPLY_CHARS || 500);
const callTurnsInFlight = new Set();

function safeEqual(left, right) {
    const a = Buffer.from(String(left || ''));
    const b = Buffer.from(String(right || ''));
    return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function ownerNumbers() {
    const { ID_OWNER } = require('../config/constants');
    return ID_OWNER.map(value => String(value).replace(/\D/g, '')).filter(Boolean);
}

function createCallAIBridge() {
    const secret = String(process.env.CALL_SERVICE_SECRET || '').trim();
    if (!secret) {
        console.warn('[CALL] CALL_SERVICE_SECRET kosong; AI call bridge tidak diaktifkan.');
        return null;
    }

    const app = express();
    app.use(express.json({ limit: `${Math.ceil(MAX_AUDIO_BYTES * 1.5 / 1024 / 1024)}mb` }));
    app.use((req, res, next) => {
        if (!safeEqual(req.headers['x-call-secret'], secret)) return res.status(401).json({ error: 'Unauthorized' });
        next();
    });

    app.get('/health', (_req, res) => res.json({ ok: true }));
    app.post('/turn', async (req, res) => {
        let peer = '';
        try {
            peer = String(req.body?.peer || '').replace(/\D/g, '');
            if (!peer || !ownerNumbers().includes(peer)) return res.status(403).json({ error: 'Peer bukan owner yang diizinkan.' });

            if (callTurnsInFlight.has(peer)) return res.status(409).json({ error: 'Giliran sebelumnya masih diproses.' });
            const audioBuffer = Buffer.from(String(req.body?.audio || ''), 'base64');
            if (!audioBuffer.length || audioBuffer.length > MAX_AUDIO_BYTES) {
                return res.status(400).json({ error: 'Audio kosong atau melewati batas ukuran.' });
            }

            callTurnsInFlight.add(peer);
            const sttProvider = process.env.CALL_STT_PROVIDER || 'gemini';
            const sttModel = process.env.CALL_STT_MODEL || 'gemini-2.5-flash';
            const model = process.env.CALL_AI_MODEL || 'deepseek/deepseek-v4-flash';
            const transcript = await AIProvider.transcribe({
                provider: sttProvider,
                model: sttModel,
                senderId: `${peer}@s.whatsapp.net`,
                audioBuffer,
                mimeType: 'audio/wav'
            });
            const cleanTranscript = String(transcript || '').trim().slice(0, MAX_TRANSCRIPT_CHARS);
            if (!cleanTranscript) throw new Error('Transkrip kosong.');

            const answer = await AIProvider.generate({
                provider: 'xkiro',
                model,
                senderId: `${peer}@s.whatsapp.net`,
                isOwner: true,
                prompt: cleanTranscript,
                systemPrompt: `${getShirokoSystemPrompt(true)}\n\n[MODE TELEPON]\nJawab dalam bahasa Indonesia yang natural dan ringkas. Maksimal 3 kalimat. Jangan memakai markdown, daftar, emoji, atau simbol dekoratif karena jawaban akan dibacakan.`,
                useMemory: true
            });
            const spokenText = String(answer || '').replace(/[*_`#>]/g, '').trim().slice(0, MAX_REPLY_CHARS);
            if (!spokenText) throw new Error('Jawaban AI kosong.');

            const ttsProvider = process.env.CALL_TTS_PROVIDER || (process.env.FISH_API_KEY && process.env.SHIROKO_VOICE_ID ? 'fish' : 'xkiro');
            let tts;
            try {
                tts = await AIProvider.textToSpeech(
                    ttsProvider,
                    spokenText,
                    ttsProvider === 'fish' ? process.env.SHIROKO_VOICE_ID : (process.env.XKIRO_TTS_VOICE || 'mexican-female'),
                    ttsProvider === 'fish'
                        ? { model: process.env.FISH_TTS_MODEL || 's2.1-pro-free', format: 'mp3' }
                        : { responseFormat: 'mp3' }
                );
            } catch (error) {
                if (ttsProvider !== 'fish') throw error;
                console.warn(`[CALL AI] Fish Audio gagal, fallback ke xKiro: ${error.message}`);
                tts = await AIProvider.textToSpeech('xkiro', spokenText, process.env.XKIRO_TTS_VOICE || 'mexican-female', { responseFormat: 'mp3' });
            }
            res.json({
                transcript: cleanTranscript,
                reply: spokenText,
                audio: tts.buffer.toString('base64'),
                format: tts.format || 'mp3',
                mime: tts.mime || 'audio/mpeg'
            });
        } catch (error) {
            console.error('[CALL AI]', error.message);
            res.status(502).json({ error: error.message });
        } finally {
            if (peer) callTurnsInFlight.delete(peer);
        }
    });

    const port = Number(process.env.CALL_AI_BRIDGE_PORT || 8788);
    const host = process.env.CALL_AI_BRIDGE_HOST || '127.0.0.1';
    const server = app.listen(port, host, () => console.log(`[CALL] AI bridge aktif di ${host}:${port}`));
    return server;
}

module.exports = { createCallAIBridge };
