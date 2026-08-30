// ==========================================
// AI UTILITIES — Helper Functions
// Dipindahkan dari ai.service.js monolitik
// ==========================================

/**
 * Membersihkan tag pemikiran (<think>, <thought>, <reasoning>) dari respons AI.
 * Banyak model reasoning (DeepSeek R1, Qwen QwQ) mengeluarkan tag ini.
 * @param {string} text
 * @returns {string}
 */
function parseJsonObject(text, label = 'respons AI') {
    if (typeof text !== 'string' || !text.trim()) {
        throw new Error(`${label} kosong`);
    }

    const withoutFence = text.replace(/```(?:json)?|```/gi, '').trim();
    const firstBrace = withoutFence.indexOf('{');
    const lastBrace = withoutFence.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace < firstBrace) {
        throw new Error(`${label} bukan JSON object`);
    }

    return JSON.parse(withoutFence.slice(firstBrace, lastBrace + 1));
}

function cleanThinkingLogs(text) {
    if (!text || typeof text !== 'string') return text;
    let original = text.trim();
    let cleaned = original;

    // 1. Hapus blok <think>...</think>, <thought>...</thought>, <reasoning>...</reasoning>
    cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '');
    cleaned = cleaned.replace(/<thought>[\s\S]*?<\/thought>/gi, '');
    cleaned = cleaned.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '');

    // 2. Hapus format pemikiran khas OpenRouter/Cloudflare seperti "Thinking Process: ..." atau "Thought: ..."
    cleaned = cleaned.replace(/^(Thought|Thinking Process|Thinking|Reasoning):\s*[\s\S]*?\n\n/i, '');

    // 3. Hapus jika pemikiran dibungkus ```think ... ``` atau ```thought ... ```
    cleaned = cleaned.replace(/```(?:think|thought|reasoning)[\s\S]*?```/gi, '');

    // 4. Fallback jika hasil pembersihan menjadi KOSONG (misal karena respons terpotong sebelum tag </think> tertutup)
    if (!cleaned.trim()) {
        cleaned = original.replace(/<\/?(?:think|thought|reasoning)>/gi, '').trim();
    }

    return cleaned.trim();
}

/**
 * Mengekstrak teks dari respons Cloudflare Workers AI.
 * Cloudflare punya format respons yang bervariasi antar model.
 * @param {object|string|Array} result
 * @returns {string}
 */
function extractCloudflareText(result) {
    if (!result) return '';
    if (typeof result === 'string') return result;
    if (result.response && typeof result.response === 'string') return result.response;
    if (result.text && typeof result.text === 'string') return result.text;
    if (result.description && typeof result.description === 'string') return result.description;

    if (Array.isArray(result.choices) && result.choices.length > 0) {
        const choice = result.choices[0];
        if (choice.message) {
            if (typeof choice.message.content === 'string') return choice.message.content;
            if (Array.isArray(choice.message.content)) {
                return choice.message.content.map(c => c.text || c.content || '').join('');
            }
        }
        if (typeof choice.text === 'string') return choice.text;
    }

    if (Array.isArray(result) && result.length > 0) {
        return extractCloudflareText(result[0]);
    }

    return typeof result === 'object' ? JSON.stringify(result) : String(result);
}

/**
 * Mengekstrak teks dari respons OpenRouter API.
 * Format standar OpenAI-compatible chat completions.
 * @param {object} data
 * @returns {string}
 */
function extractOpenRouterText(data) {
    if (!data) return '';
    if (data.choices && data.choices.length > 0) {
        const choice = data.choices[0];
        if (choice.message) {
            if (typeof choice.message.content === 'string') return choice.message.content;
            if (Array.isArray(choice.message.content)) {
                return choice.message.content.map(c => c.text || c.content || '').join('');
            }
            if (typeof choice.message.text === 'string') return choice.message.text;
        }
        if (typeof choice.text === 'string') return choice.text;
    }
    return typeof data === 'string' ? data : JSON.stringify(data);
}

/**
 * Mendeteksi MIME type dari magic bytes buffer.
 * @param {Buffer} buffer
 * @param {'image'|'audio'} type
 * @returns {string} MIME type
 */
function sanitizeInternalDisclosure(text) {
    let value = String(text || '').trim();
    if (!value) return value;
    const markers = /\[\/?(?:KONTEKS MOOD OWNER|CURRENT APPEARANCE|PENAMPILAN SHIROKO SAAT INI)[^\]]*\]|(?:system prompt|prompt internal|instruksi internal|metadata internal|mood internal|appearance state|outfit state)/i;
    if (markers.test(value)) {
        return 'Nn... Aku tetap Shiroko. Ada hal lain yang ingin Sensei bicarakan?';
    }
    return value;
}

function detectMimeType(buffer, type = 'image') {
    const hex = buffer.subarray(0, 4).toString('hex').toUpperCase();

    if (type === 'image') {
        if (hex.startsWith('FFD8')) return 'image/jpeg';
        if (hex.startsWith('8950')) return 'image/png';
        if (hex.startsWith('5249')) return 'image/webp';
        return 'image/png'; // default
    }

    // Audio
    if (hex.startsWith('5249')) return 'audio/wav';
    if (hex.startsWith('FFF3') || hex.startsWith('FFF2') || hex.startsWith('FFFB') || hex.startsWith('494433')) return 'audio/mpeg';
    if (hex.startsWith('4F676753')) return 'audio/ogg';
    return 'audio/mpeg'; // default
}

module.exports = {
    parseJsonObject,
    cleanThinkingLogs,
    extractCloudflareText,
    extractOpenRouterText,
    detectMimeType,
    sanitizeInternalDisclosure
};
