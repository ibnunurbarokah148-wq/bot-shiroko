const axios = require('axios');

const DEFAULT_URL = 'http://127.0.0.1:8787';

function baseUrl() {
    return String(process.env.CALL_SERVICE_URL || DEFAULT_URL).replace(/\/$/, '');
}

function secret() {
    const value = String(process.env.CALL_SERVICE_SECRET || '').trim();
    if (!value) throw new Error('CALL_SERVICE_SECRET belum dikonfigurasi.');
    return value;
}

async function request(method, endpoint, data, options = {}) {
    try {
        const response = await axios({
            method,
            url: `${baseUrl()}${endpoint}`,
            data,
            responseType: options.responseType || 'json',
            headers: { 'x-call-secret': secret(), ...(options.headers || {}) },
            timeout: options.timeout || 15000,
            maxContentLength: Infinity,
            maxBodyLength: Infinity
        });
        return response.data;
    } catch (error) {
        const message = error.response?.data?.error || error.response?.data?.message || error.message;
        throw new Error(`Call service: ${message}`);
    }
}

function status() {
    return request('get', '/status');
}

function startCall(number) {
    return request('post', '/call', { target: String(number || '').replace(/[^0-9+]/g, '') }, { timeout: 30000 });
}

function hangup() {
    return request('post', '/hangup', {});
}

function play(url) {
    return request('post', '/music/play', { url }, { timeout: 75000 });
}

function startMusicCall(number, url) {
    return request('post', '/call/music', { target: String(number || '').replace(/[^0-9+]/g, ''), url }, { timeout: 210000 });
}

function pauseMusic() {
    return request('post', '/music/pause', {});
}

function resumeMusic() {
    return request('post', '/music/resume', {});
}

function skipMusic() {
    return request('post', '/music/skip', {});
}

function stopMusic() {
    return request('post', '/music/stop', {});
}

function musicQueue() {
    return request('get', '/music/queue');
}

module.exports = { status, startCall, startMusicCall, hangup, play, pauseMusic, resumeMusic, skipMusic, stopMusic, musicQueue };
