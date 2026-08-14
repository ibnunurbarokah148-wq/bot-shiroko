// ==========================================
// COMMAND: AKADEMIK
// Handler: !karyailmiah, !jurnal, !para, !ringkas, !ide + sesi handler
// ==========================================
const axios = require('axios');
const state = require('../config/state');
const { cekDanPotongLimit, kembalikanLimit } = require('../config/db');
const AIProvider = require('../services/ai/AIProvider');

async function handle(ctx) {
    const { sock, from, senderId, isOwner, textClean, textLower, quotedText, isQuoted, reply } = ctx;

    function getAiCost(mode) {
        const costMap = {
            'ds3': 2, 'ds4': 4, 'glm': 2, 'qwen': 2,
            'arisu-gemini': 2, 'gpt': 2, 'grok': 2,
            'gemini': 2, 'ollama': 0
        };
        return costMap[mode] || 2;
    }

    /**
     * Helper eksekusi AI untuk fitur akademik.
     */
    async function prosesAkademikAI(promptAI) {
        const defaultMode = isOwner ? 'gemini' : 'arisu-gemini';
        const userMode = state.userAIMode[senderId] || defaultMode;
        const { provider, model } = AIProvider.resolveMode(userMode, senderId);
        
        // Custom system prompt agar AI menjawab dengan gaya asisten akademik formal (bukan Shiroko yang biasa)
        const systemPrompt = "Kamu adalah asisten akademik profesional. Jawablah dengan bahasa Indonesia formal, terstruktur, akurat, dan gunakan referensi jika diperlukan.";
        
        return await AIProvider.generate({
            provider,
            model,
            prompt: promptAI,
            senderId,
            isOwner,
            systemPrompt
        });
    }

    // ==========================================
    // HANDLER SESI KARYA ILMIAH (INTERAKTIF)
    // ==========================================
    if (state.sesiKaryaIlmiah[senderId]) {
        const sesi = state.sesiKaryaIlmiah[senderId];
        if (textLower === 'batal') {
            delete state.sesiKaryaIlmiah[senderId];
            kembalikanLimit(senderId);
            await reply('Nn... Pembuatan karya ilmiah dibatalkan.');
            return true;
        }

        if (sesi.step === 1) {
            if (textLower !== 'makalah' && textLower !== 'artikel' && textLower !== 'laporan') {
                await reply(`Nn... Pilihan tidak valid.\nPilih: makalah, artikel, laporan.`);
                return true;
            }
            sesi.jenis = textLower;
            sesi.step = 2;
            await reply(`Nn... Jenis karya dipilih: *${textLower}*\nSekarang kirim topik pembahasan.`);
            return true;
        }

        if (sesi.step === 2) {
            await reply(`Nn... Menyusun ${sesi.jenis}. Proses ini mungkin cukup lama...`);
            try {
                const promptAI = `Buatkan ${sesi.jenis} akademik lengkap.\nTOPIK:\n${textClean}\nATURAN: Gunakan bahasa Indonesia formal akademik. Minimal 700 kata. Beri referensi.`;
                const hasilTeks = await prosesAkademikAI(promptAI);
                await reply(`📚 *HASIL ${sesi.jenis.toUpperCase()}*\n\n${hasilTeks}`);
            } catch (err) {
                kembalikanLimit(senderId);
                await reply('Nn... Mesin penulis akademik mengalami gangguan.');
            }
            delete state.sesiKaryaIlmiah[senderId];
            return true;
        }
    }

    // ==========================================
    // ENTRY POINT KARYA ILMIAH (FIX BUG #4)
    // ==========================================
    if (textLower === '!karyailmiah') {
        const defaultMode = isOwner ? 'gemini' : 'arisu-gemini';
        const userMode = state.userAIMode[senderId] || defaultMode;
        const cost = getAiCost(userMode);
        if (!cekDanPotongLimit(senderId, cost)) { await reply(`Nn... Token harian Sensei habis. Butuh ${cost} limit.`); return true; }
        state.sesiKaryaIlmiah[senderId] = { step: 1 };
        await reply('Nn... Sensei ingin membuat karya ilmiah? Pilih jenisnya:\n\n*makalah*\n*artikel*\n*laporan*\n\n_Ketik *batal* untuk membatalkan._');
        return true;
    }

    // ==========================================
    // JURNAL
    // ==========================================
    if (textLower.startsWith('!jurnal ')) {
        const query = textClean.substring(8).trim();
        if (!query) { await reply('Nn... Masukkan topik jurnal.'); return true; }
        try {
            await reply(`Nn... Menelusuri database akademik untuk topik *${query}*...`);
            const randomOffset = Math.floor(Math.random() * 50);
            const response = await axios.get(`https://api.crossref.org/works?query=${encodeURIComponent(query)}&rows=5&offset=${randomOffset}&filter=from-pub-date:2020-01-01`);
            let items = response.data.message.items;

            if (!items || items.length === 0) { await reply('Nn... Tidak ada jurnal yang ditemukan.'); return true; }
            let replyText = `📚 *HASIL PENCARIAN JURNAL*\n\n🔍 Topik: *${query}*\n\n`;
            items.forEach((paper, index) => {
                const title = paper.title?.[0] || 'Tanpa Judul';
                let authors = paper.author ? paper.author.slice(0, 3).map(a => `${a.given || ''} ${a.family || ''}`.trim()).join(', ') : 'Tidak diketahui';
                let tahun = paper['published-print']?.['date-parts']?.[0]?.[0] || '-';
                replyText += `*${index + 1}. ${title}*\n👤 Penulis: ${authors}\n📅 Tahun: ${tahun}\n🔗 Link: ${paper.URL || '-'}\n━━━━━━━━━━━━━━\n\n`;
            });
            await reply(replyText);
        } catch (error) { await reply('Nn... Server akademik sedang sibuk.'); }
        return true;
    }

    // ==========================================
    // PARAFRASE
    // ==========================================
    if (textLower.startsWith('!para ') || textLower.startsWith('!paraphrase ')) {
        const teksAsli = textClean.replace(/^!(para|paraphrase)\s+/i, '').trim();
        if (!teksAsli) { await reply('Nn... Mana teks yang mau diparafrase?'); return true; }
        try {
            await reply('Nn... Mengaktifkan protokol Anti-Plagiasi...');
            const defaultMode = isOwner ? 'gemini' : 'arisu-gemini';
            const userMode = state.userAIMode[senderId] || defaultMode;
            const cost = getAiCost(userMode);
            if (!cekDanPotongLimit(senderId, cost)) { await reply(`Nn... Token habis. Butuh ${cost} limit.`); return true; }

            const promptAI = `Parafrase teks ini ke bahasa Indonesia akademik formal: "${teksAsli}"`;
            const hasilTeks = await prosesAkademikAI(promptAI);

            await reply(`*📝 HASIL PARAFRASE*\n\n${hasilTeks}`);
        } catch (error) { await reply('Nn... Mesin pengolah kata error.'); }
        return true;
    }

    // ==========================================
    // RINGKAS
    // ==========================================
    if (textLower === '!ringkas' || textLower.startsWith('!ringkas ')) {
        const teksInline = textClean.substring(8).trim();
        const teksAsli = teksInline || (isQuoted ? quotedText.trim() : '');
        if (!teksAsli) { await reply('Nn... Mana teks yang mau diringkas?'); return true; }
        try {
            const defaultMode = isOwner ? 'gemini' : 'arisu-gemini';
            const userMode = state.userAIMode[senderId] || defaultMode;
            const cost = getAiCost(userMode);
            if (!cekDanPotongLimit(senderId, cost)) { await reply(`Nn... Token habis. Butuh ${cost} limit.`); return true; }

            const promptAI = `Buatkan ringkasan bullet points dari teks ini: "${teksAsli}"`;
            const hasilTeks = await prosesAkademikAI(promptAI);

            await reply(`*📑 HASIL RINGKASAN*\n\n${hasilTeks}`);
        } catch (error) { await reply('Nn... Gagal meringkas.'); }
        return true;
    }

    // ==========================================
    // IDE SKRIPSI
    // ==========================================
    if (textLower.startsWith('!ide ')) {
        const jurusanTopik = textClean.substring(5).trim();
        if (!jurusanTopik) { await reply('Nn... Masukkan jurusan.'); return true; }
        try {
            const defaultMode = isOwner ? 'gemini' : 'arisu-gemini';
            const userMode = state.userAIMode[senderId] || defaultMode;
            const cost = getAiCost(userMode);
            if (!cekDanPotongLimit(senderId, cost)) { await reply(`Nn... Token habis. Butuh ${cost} limit.`); return true; }

            const promptAI = `Berikan 3 ide judul skripsi untuk jurusan "${jurusanTopik}" beserta fokus masalahnya.`;
            const hasilTeks = await prosesAkademikAI(promptAI);

            await reply(`*💡 REKOMENDASI PENELITIAN*\n\n${hasilTeks}`);
        } catch (error) { await reply('Nn... Generator ide error.'); }
        return true;
    }

    return false;
}

module.exports = { handle };
