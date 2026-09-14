// ============================================================
//  PIXAI WEB AUTH SESSION (OTP + NONCE) — HARDENED
//  - OTP kriptografis, sekali pakai, wajib cek kedaluwarsa
//  - Nonce kriptografis, terikat ke OTP & pemiliknya
//  - Pembersihan periodik agar tidak ada state basi
// ============================================================
const crypto = require('crypto');

const OTP_TTL_MS = 5 * 60 * 1000;
const NONCE_TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;

const otpSessions = new Map();
const nonceSessions = new Map();
const attempts = new Map();
const MAX_OTP_SESSIONS_PER_OWNER = 3;

function purgeExpired(now = Date.now()) {
    for (const [key, session] of otpSessions.entries()) {
        if (now > session.expiresAt) otpSessions.delete(key);
    }
    for (const [key, session] of nonceSessions.entries()) {
        if (now > session.expiresAt) nonceSessions.delete(key);
    }
    for (const [key, record] of attempts.entries()) {
        if (now > record.resetAt) attempts.delete(key);
    }
}

function registerFailure(clientKey) {
    const now = Date.now();
    const record = attempts.get(clientKey) || { count: 0, resetAt: now + ATTEMPT_WINDOW_MS };
    record.count += 1;
    if (now > record.resetAt) {
        record.count = 1;
        record.resetAt = now + ATTEMPT_WINDOW_MS;
    }
    attempts.set(clientKey, record);
}

function isRateLimited(clientKey) {
    purgeExpired();
    const record = attempts.get(clientKey);
    return Boolean(record && record.count >= MAX_ATTEMPTS && Date.now() <= record.resetAt);
}

function createOtp(ownerJid) {
    purgeExpired();
    const owner = ownerJid || null;
    const ownerSessions = [...otpSessions.values()].filter(session => session.ownerJid === owner);
    while (ownerSessions.length >= MAX_OTP_SESSIONS_PER_OWNER) {
        const oldest = ownerSessions.shift();
        for (const [key, session] of otpSessions.entries()) {
            if (session === oldest) {
                otpSessions.delete(key);
                break;
            }
        }
    }
    // 5 byte = 40 bit entropi (sebelumnya hanya 16 bit).
    const otp = `SRO-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
    otpSessions.set(otp, {
        ownerJid: owner,
        createdAt: Date.now(),
        expiresAt: Date.now() + OTP_TTL_MS
    });
    return { otp, expiresInMinutes: OTP_TTL_MS / 60000 };
}

function consumeOtp(otp, clientKey = 'unknown') {
    purgeExpired();
    if (isRateLimited(clientKey)) {
        return { ok: false, reason: 'RATE_LIMITED' };
    }
    const session = typeof otp === 'string' ? otpSessions.get(otp.trim().toUpperCase()) : null;
    if (!session) {
        registerFailure(clientKey);
        return { ok: false, reason: 'INVALID' };
    }
    otpSessions.delete(otp.trim().toUpperCase());
    if (Date.now() > session.expiresAt) {
        registerFailure(clientKey);
        return { ok: false, reason: 'EXPIRED' };
    }
    return { ok: true, session };
}

function createNonce(session = {}) {
    purgeExpired();
    const nonce = crypto.randomBytes(24).toString('base64url');
    nonceSessions.set(nonce, {
        ownerJid: session.ownerJid || null,
        createdAt: Date.now(),
        expiresAt: Date.now() + NONCE_TTL_MS
    });
    return nonce;
}

function consumeNonce(nonce, clientKey = 'unknown') {
    purgeExpired();
    if (isRateLimited(clientKey)) {
        return { ok: false, reason: 'RATE_LIMITED' };
    }
    const session = typeof nonce === 'string' ? nonceSessions.get(nonce) : null;
    if (!session) {
        registerFailure(clientKey);
        return { ok: false, reason: 'INVALID' };
    }
    nonceSessions.delete(nonce);
    if (Date.now() > session.expiresAt) {
        registerFailure(clientKey);
        return { ok: false, reason: 'EXPIRED' };
    }
    return { ok: true, session };
}

const cleanupTimer = setInterval(() => purgeExpired(), 60000);
if (cleanupTimer.unref) cleanupTimer.unref();

module.exports = {
    createOtp,
    consumeOtp,
    createNonce,
    consumeNonce,
    purgeExpired,
    OTP_TTL_MS,
    NONCE_TTL_MS
};
