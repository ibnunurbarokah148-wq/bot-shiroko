// ==========================================
// AI MEDIA — Audio transcription & ZIP extraction
// ==========================================
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const AdmZip = require('adm-zip');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const ffmpegPath = require('ffmpeg-static');

const MAX_ZIP_BYTES = 25 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 75 * 1024 * 1024;
const MAX_FILES = 250;
const MAX_CONTEXT_CHARS = 50000;
const TEXT_EXTENSIONS = new Set([
    '.txt', '.md', '.csv', '.json', '.xml', '.yaml', '.yml', '.log', '.ini',
    '.js', '.jsx', '.ts', '.tsx', '.py', '.java', '.c', '.h', '.cpp', '.hpp',
    '.go', '.rs', '.php', '.rb', '.sh', '.sql', '.html', '.css'
]);

function normalizeAudioMime(mime = '') {
    const normalized = String(mime).toLowerCase().split(';')[0].trim();
    const formats = {
        'audio/mpeg': { mime: 'audio/mpeg', format: 'mp3', needsConversion: false },
        'audio/mp3': { mime: 'audio/mpeg', format: 'mp3', needsConversion: false },
        'audio/wav': { mime: 'audio/wav', format: 'wav', needsConversion: false },
        'audio/x-wav': { mime: 'audio/wav', format: 'wav', needsConversion: false },
        'audio/mp4': { mime: 'audio/mp4', format: 'mp4', needsConversion: true },
        'audio/m4a': { mime: 'audio/mp4', format: 'mp4', needsConversion: true },
        'audio/webm': { mime: 'audio/webm', format: 'webm', needsConversion: true },
        'audio/ogg': { mime: 'audio/ogg', format: 'ogg', needsConversion: true },
        'audio/opus': { mime: 'audio/ogg', format: 'ogg', needsConversion: true }
    };
    return formats[normalized] || { mime: 'audio/ogg', format: 'ogg', needsConversion: true };
}

// Konversi nyata audio (OGG/Opus VN WhatsApp, dsb) ke WAV 16kHz mono via ffmpeg-static.
// Wajib sebelum dikirim ke endpoint OpenAI-compatible yang hanya menerima wav/mp3 asli.
async function convertAudioToWav(buffer, mime = '') {
    const { execFile } = require('child_process');
    const ffmpegPath = require('ffmpeg-static');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shiroko-conv-'));
    const inputPath = path.join(dir, `input.${audioFormat(mime)}`);
    const outputPath = path.join(dir, 'output.wav');
    try {
        fs.writeFileSync(inputPath, buffer);
        await new Promise((resolve, reject) => {
            execFile(ffmpegPath, ['-y', '-i', inputPath, '-ar', '16000', '-ac', '1', outputPath],
                { timeout: 60000 }, (err, _stdout, stderr) => err ? reject(new Error(`ffmpeg: ${stderr?.slice(-300) || err.message}`)) : resolve());
        });
        return fs.readFileSync(outputPath);
    } finally {
        cleanupTemp(dir);
    }
}

// Pola respons provider yang sebenarnya gagal membaca audio tetapi HTTP sukses.
const AUDIO_FAILURE_PATTERNS = /unggah file audio|upload.*audio|no audio|tidak ada (file )?audio|audio tidak (ditemukan|terlampir|valid)|cannot process audio|silakan unggah|silahkan unggah/i;

function validateTranscript(text, provider = 'AI', model = 'selected') {
    const value = String(text || '').trim();
    if (!value) throw new Error(`Model ${provider}/${model} tidak mengembalikan transkrip.`);
    if (AUDIO_FAILURE_PATTERNS.test(value)) {
        throw new Error(`Model ${provider}/${model} tidak menerima audio ini. Pilih model yang mendukung audio atau gunakan !aimode gemini.`);
    }
    return value;
}

function logAudioAttempt(provider, model, mime, bytes) {
    console.log(`[AUDIO] provider=${provider} model=${model} mime=${mime} bytes=${bytes}`);
}

function audioFormat(mime = '') {
    return normalizeAudioMime(mime).format;
}

// Format yang didukung input_audio OpenAI-compatible (chat/completions).
// OGG/Opus (format VN WhatsApp) TIDAK termasuk dan wajib dikonversi dulu.
const AUDIO_API_FORMATS = new Set(['wav', 'mp3']);

/**
 * Konversi nyata audio buffer ke WAV 16kHz mono via ffmpeg-static.
 * Diperlukan karena VN WhatsApp adalah OGG/Opus, sedangkan endpoint
 * input_audio OpenAI/xKiro hanya menerima wav/mp3 yang benar-benar valid.
 * @param {Buffer} buffer
 * @param {string} mime
 * @returns {{ buffer: Buffer, format: string, converted: boolean }}
 */
function convertAudioForApi(buffer, mime) {
    const { format } = normalizeAudioMime(mime);
    if (AUDIO_API_FORMATS.has(format)) return { buffer, format, converted: false };

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shiroko-conv-'));
    const inputPath = path.join(dir, `input.${format}`);
    const outputPath = path.join(dir, 'output.wav');
    try {
        fs.writeFileSync(inputPath, buffer);
        execFileSync(ffmpegPath, [
            '-y', '-i', inputPath,
            '-ac', '1', '-ar', '16000', '-f', 'wav', outputPath
        ], { timeout: 60000 });
        const converted = fs.readFileSync(outputPath);
        if (!converted.length) throw new Error('Hasil konversi audio kosong.');
        return { buffer: converted, format: 'wav', converted: true };
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

function prepareAudioForChatApi(buffer, mime = 'audio/ogg') {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        throw new Error('Data audio kosong atau tidak valid.');
    }
    return convertAudioForApi(buffer, mime);
}

function isZip(buffer, fileName = '') {
    return fileName.toLowerCase().endsWith('.zip') || buffer?.subarray(0, 4).toString('hex') === '504b0304';
}

function isSafeEntry(name) {
    const normalized = path.posix.normalize(name.replace(/\\/g, '/'));
    return normalized !== '..' && !normalized.startsWith('../') && !path.isAbsolute(normalized);
}

async function readEntry(entry) {
    const ext = path.extname(entry.entryName).toLowerCase();
    const data = entry.getData();
    if (TEXT_EXTENSIONS.has(ext)) return data.toString('utf8');
    if (ext === '.pdf') return (await pdfParse(data)).text;
    if (ext === '.docx') return (await mammoth.extractRawText({ buffer: data })).value;
    return null;
}

async function extractZip(buffer, fileName = 'archive.zip') {
    if (!Buffer.isBuffer(buffer) || buffer.length > MAX_ZIP_BYTES) {
        throw new Error(`ZIP terlalu besar. Batas maksimum ${MAX_ZIP_BYTES / 1024 / 1024} MB.`);
    }
    let zip;
    try { zip = new AdmZip(buffer); } catch { throw new Error('File ZIP rusak atau tidak valid.'); }
    const entries = zip.getEntries();
    if (entries.length > MAX_FILES) throw new Error(`ZIP berisi terlalu banyak file. Batas maksimum ${MAX_FILES} file.`);

    let totalBytes = 0;
    let totalChars = 0;
    const parts = [];
    for (const entry of entries) {
        if (entry.isDirectory) continue;
        if (!isSafeEntry(entry.entryName)) throw new Error('ZIP ditolak karena memiliki path berbahaya.');
        const size = entry.header?.size ?? entry.getData().length;
        totalBytes += size;
        if (totalBytes > MAX_EXTRACTED_BYTES) throw new Error('Ukuran hasil ekstraksi ZIP melewati batas aman.');
        const text = await readEntry(entry);
        if (text && text.trim() && totalChars < MAX_CONTEXT_CHARS) {
            const remaining = MAX_CONTEXT_CHARS - totalChars;
            const clipped = text.slice(0, remaining);
            parts.push(`\n===== ${entry.entryName} =====\n${clipped}`);
            totalChars += clipped.length;
        }
    }
    if (!parts.length) throw new Error('ZIP tidak berisi file teks/dokumen yang bisa dibaca.');
    return { text: parts.join('').slice(0, MAX_CONTEXT_CHARS), fileCount: entries.length };
}

function temporaryAudioFile(buffer, mime) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shiroko-audio-'));
    const filePath = path.join(dir, `audio.${audioFormat(mime)}`);
    fs.writeFileSync(filePath, buffer);
    return { dir, filePath };
}

function cleanupTemp(dir) {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
}

module.exports = {
    extractZip,
    isZip,
    temporaryAudioFile,
    cleanupTemp,
    audioFormat,
    normalizeAudioMime,
    convertAudioToWav,
    convertAudioForApi,
    prepareAudioForChatApi,
    validateTranscript,
    logAudioAttempt
};
