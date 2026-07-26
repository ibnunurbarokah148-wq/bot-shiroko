// ==========================================
// ERROR CLASSES — Centralized Error Handling
// ==========================================

/**
 * Base error class untuk Bot Shiroko.
 * Setiap error punya `userMessage` yang aman ditampilkan ke user.
 */
class BotError extends Error {
    /**
     * @param {string} message - Pesan teknis (untuk log)
     * @param {string} userMessage - Pesan yang aman ditampilkan ke user
     * @param {string} [code='BOT_ERROR'] - Kode error
     */
    constructor(message, userMessage, code = 'BOT_ERROR') {
        super(message);
        this.name = 'BotError';
        this.userMessage = userMessage || 'Nn... Terjadi kesalahan internal.';
        this.code = code;
    }
}

/**
 * Error dari AI Provider (Gemini, OpenRouter, Cloudflare, Arisu, Ollama).
 */
class ProviderError extends BotError {
    /**
     * @param {string} provider - Nama provider (misal 'gemini', 'openrouter')
     * @param {string} message - Pesan teknis
     * @param {string} [userMessage]
     */
    constructor(provider, message, userMessage) {
        super(
            `[${provider.toUpperCase()}] ${message}`,
            userMessage || `Nn... Maaf, jalur ${provider} sedang bermasalah.`,
            'PROVIDER_ERROR'
        );
        this.name = 'ProviderError';
        this.provider = provider;
    }
}

/**
 * Error ketika limit/token user habis.
 */
class LimitError extends BotError {
    constructor(required, available) {
        super(
            `Limit tidak cukup: butuh ${required}, tersisa ${available}`,
            `Nn... Token tidak cukup. Butuh ${required} limit.`,
            'LIMIT_ERROR'
        );
        this.name = 'LimitError';
        this.required = required;
        this.available = available;
    }
}

module.exports = { BotError, ProviderError, LimitError };
