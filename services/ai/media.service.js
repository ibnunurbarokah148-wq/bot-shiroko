// ==========================================
// AI MEDIA — Audio transcription & ZIP extraction
// ==========================================
const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

const MAX_ZIP_BYTES = 25 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 75 * 1024 * 1024;
const MAX_FILES = 250;
const MAX_CONTEXT_CHARS = 50000;
const TEXT_EXTENSIONS = new Set([
    '.txt', '.md', '.csv', '.json', '.xml', '.yaml', '.yml', '.log', '.ini',
    '.js', '.jsx', '.ts', '.tsx', '.py', '.java', '.c', '.h', '.cpp', '.hpp',
    '.go', '.rs', '.php', '.rb', '.sh', '.sql', '.html', '.css'
]);

function audioFormat(mime = '') {
    if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3';
    if (mime.includes('wav')) return 'wav';
    if (mime.includes('mp4') || mime.includes('m4a')) return 'mp4';
    if (mime.includes('webm')) return 'webm';
    return 'ogg';
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

async function transcribeWithProvider(provider, options) {
    if (provider === 'arisu') throw new Error('Mode ArisuSoft belum mendukung pemrosesan audio. Silakan pilih Gemini, OpenRouter, Cloudflare, atau xKiro.');
    const transcribe = options.providerModule?.transcribe;
    if (typeof transcribe !== 'function') throw new Error(`Provider ${provider} belum mendukung transkripsi audio.`);
    return transcribe(options);
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

module.exports = { extractZip, isZip, transcribeWithProvider, temporaryAudioFile, cleanupTemp, audioFormat };
