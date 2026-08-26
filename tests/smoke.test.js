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

console.log(`Smoke test lulus: ${files.length} file JavaScript valid, roster 10 waifu dan persona pasangan valid.`);
