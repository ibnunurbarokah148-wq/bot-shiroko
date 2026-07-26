// ==========================================
// PROVIDER: OLLAMA — Local AI (localhost:11434)
// ==========================================
const axios = require('axios');
const state = require('../../../config/state');
const memory = require('../memory');
const { cleanThinkingLogs } = require('../utils');
const { getShirokoSystemPrompt } = require('../prompts');

const PROVIDER_NAME = 'ollama';

/**
 * Generate chat via Ollama lokal.
 * @param {object} options
 * @param {string} options.prompt
 * @param {string} options.senderId
 * @param {boolean} options.isOwner
 * @param {string} [options.model] - Model Ollama, default dari state atau 'gemma3:4b'
 * @param {string|null} [options.systemPrompt]
 * @param {Buffer|null} [options.imageBuffer]
 * @returns {Promise<string>}
 */
async function generate({ prompt, senderId, isOwner, model, systemPrompt = null, imageBuffer = null }) {
    try {
        const modelName = model || state.userOllamaModel[senderId] || 'gemma3:4b';
        const instruction = systemPrompt || getShirokoSystemPrompt(isOwner);

        // Inisialisasi memory jika belum ada
        const existing = memory.get(senderId, PROVIDER_NAME);
        if (!existing) {
            memory.init(senderId, PROVIDER_NAME, [
                { role: 'system', content: instruction }
            ]);
        }

        // Push user message
        const extra = imageBuffer ? { images: [imageBuffer.toString('base64')] } : {};
        memory.push(senderId, PROVIDER_NAME, 'user', prompt, extra);

        const messages = memory.getMessages(senderId, PROVIDER_NAME);

        const response = await axios.post('http://localhost:11434/api/chat', {
            model: modelName,
            messages,
            stream: false
        });

        const balasanAI = cleanThinkingLogs(response.data.message.content || '');
        memory.push(senderId, PROVIDER_NAME, 'assistant', balasanAI);

        return balasanAI;
    } catch (error) {
        console.error('🚨 ERROR OLLAMA:', error);
        return 'Nn... Maaf Sayang, otak offline Shiroko lagi ngadat atau VRAM penuh.';
    }
}

module.exports = { generate };
