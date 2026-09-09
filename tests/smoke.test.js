const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const ignored = new Set(['node_modules', '.git', 'auth_session', 'temp']);

function collectJavaScript(directory) {
    const files = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (ignored.has(entry.name) || entry.name.startsWith('.')) continue;
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) files.push(...collectJavaScript(entryPath));
        else if (entry.isFile() && entry.name.endsWith('.js')) files.push(entryPath);
    }
    return files;
}

const files = collectJavaScript(root);
assert(files.length > 0, 'Tidak ada file JavaScript untuk diperiksa.');

for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status !== 0) {
        throw new Error(`Syntax error pada ${path.relative(root, file)}\n${result.stderr || result.stdout}`);
    }
}

const { WAIFU_CHARACTERS } = require('../config/waifu.characters');
const mediaQueue = require('../services/media-queue.service');
assert.strictEqual(WAIFU_CHARACTERS.length, 10, 'Roster waifu harus berisi 10 karakter.');
assert.strictEqual(new Set(WAIFU_CHARACTERS.map(character => character.id)).size, 10, 'ID karakter waifu harus unik.');
for (const character of WAIFU_CHARACTERS) {
    assert(/istri|suami|pasangan/i.test(character.prompt), `Persona ${character.id} belum memiliki konteks pasangan.`);
    assert(/sayang|suamiku/i.test(character.prompt), `Persona ${character.id} belum memiliki sapaan pasangan.`);
}

assert.deepStrictEqual(mediaQueue.getStatus(), { active: 0, queued: 0, maxActive: 2 }, 'Queue media harus kosong saat test dimulai.');

const { parseJsonObject } = require('../services/ai/utils');
const activity = require('../services/activity.service');
const initialActivity = activity.recordActivity({ platform: 'whatsapp', type: 'test', message: 'Smoke test activity.' });
assert.strictEqual(initialActivity.platform, 'whatsapp', 'Activity harus menormalisasi platform WhatsApp.');
assert.strictEqual(activity.getRecentActivity(1)[0].message, 'Smoke test activity.', 'Ring buffer activity harus menyimpan event terbaru.');
assert.strictEqual(activity.getActivitySeries().whatsapp.reduce((sum, value) => sum + value, 0), 1, 'Activity series WhatsApp harus menghitung event.');
assert.deepStrictEqual(
    parseJsonObject('```json\n{"intent":"NORMAL_CHAT","renderRequested":false}\n```', 'test classifier'),
    { intent: 'NORMAL_CHAT', renderRequested: false },
    'Parser Companion harus menerima JSON dalam markdown fence.'
);
assert.deepStrictEqual(
    parseJsonObject('Hasil:\n{"intent":"OUTFIT_DISCUSSION","renderRequested":false}\nSelesai.', 'test classifier'),
    { intent: 'OUTFIT_DISCUSSION', renderRequested: false },
    'Parser Companion harus mengekstrak JSON object dari teks tambahan.'
);
assert.throws(
    () => parseJsonObject('Nn... Maaf Sayang, jalur Arisu terputus (Timeout/Error).', 'test classifier'),
    /bukan JSON object/,
    'Parser Companion harus menolak fallback teks provider tanpa memunculkan SyntaxError mentah.'
);

console.log(`Smoke test lulus: ${files.length} file JavaScript valid, roster 10 waifu, dan parser Companion valid.`);
