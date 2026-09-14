// ============================================================
//  MINECRAFT SERVER LIST PING (STATUS ASLI, TANPA DATA DUMMY)
//  Implementasi protokol handshake + status request Java Edition.
// ============================================================
const net = require('net');
const { CONFIG } = require('./minecraft/config');

const PING_INTERVAL_MS = 30000;
const PING_TIMEOUT_MS = 4000;

let lastResult = {
    status: 'UNKNOWN',
    online: false,
    host: CONFIG.host,
    port: CONFIG.port,
    players: null,
    maxPlayers: null,
    version: null,
    latencyMs: null,
    checkedAt: null,
    error: null
};
let pingTimer = null;

function writeVarInt(value) {
    const bytes = [];
    let current = value;
    do {
        let temp = current & 0b01111111;
        current >>>= 7;
        if (current !== 0) temp |= 0b10000000;
        bytes.push(temp);
    } while (current !== 0);
    return Buffer.from(bytes);
}

function writeString(value) {
    const payload = Buffer.from(value, 'utf8');
    return Buffer.concat([writeVarInt(payload.length), payload]);
}

function buildPacket(packetId, payload) {
    const body = Buffer.concat([writeVarInt(packetId), payload]);
    return Buffer.concat([writeVarInt(body.length), body]);
}

function readVarInt(buffer, offset) {
    let result = 0;
    let shift = 0;
    let position = offset;
    while (position < buffer.length) {
        const byte = buffer[position];
        result |= (byte & 0b01111111) << shift;
        position += 1;
        if ((byte & 0b10000000) === 0) return { value: result, offset: position };
        shift += 7;
        if (shift > 35) break;
    }
    return null;
}

function pingServer(host = CONFIG.host, port = CONFIG.port) {
    return new Promise(resolve => {
        const startedAt = Date.now();
        const socket = new net.Socket();
        let chunks = Buffer.alloc(0);
        let settled = false;

        const finish = result => {
            if (settled) return;
            settled = true;
            socket.destroy();
            resolve(result);
        };

        socket.setTimeout(PING_TIMEOUT_MS);
        socket.on('timeout', () => finish({ online: false, error: 'timeout' }));
        socket.on('error', error => finish({ online: false, error: error.message }));

        socket.connect(port, host, () => {
            const handshake = buildPacket(0x00, Buffer.concat([
                writeVarInt(766),
                writeString(host),
                Buffer.from([(port >> 8) & 0xff, port & 0xff]),
                writeVarInt(1)
            ]));
            socket.write(handshake);
            socket.write(buildPacket(0x00, Buffer.alloc(0)));
        });

        socket.on('data', data => {
            chunks = Buffer.concat([chunks, data]);
            const lengthHeader = readVarInt(chunks, 0);
            if (!lengthHeader) return;
            if (chunks.length < lengthHeader.offset + lengthHeader.value) return;

            const packetIdHeader = readVarInt(chunks, lengthHeader.offset);
            if (!packetIdHeader || packetIdHeader.value !== 0x00) {
                return finish({ online: false, error: 'unexpected packet' });
            }
            const stringHeader = readVarInt(chunks, packetIdHeader.offset);
            if (!stringHeader) return finish({ online: false, error: 'malformed response' });

            const json = chunks.slice(stringHeader.offset, stringHeader.offset + stringHeader.value).toString('utf8');
            try {
                const parsed = JSON.parse(json);
                finish({
                    online: true,
                    latencyMs: Date.now() - startedAt,
                    players: parsed.players?.online ?? null,
                    maxPlayers: parsed.players?.max ?? null,
                    version: parsed.version?.name ?? null
                });
            } catch (error) {
                finish({ online: false, error: 'invalid status json' });
            }
        });
    });
}

async function refreshServerStatus() {
    const host = CONFIG.host;
    const port = CONFIG.port;
    const result = await pingServer(host, port);
    lastResult = {
        status: result.online ? 'ONLINE' : 'OFFLINE',
        online: Boolean(result.online),
        host,
        port,
        players: result.players ?? null,
        maxPlayers: result.maxPlayers ?? null,
        version: result.version ?? null,
        latencyMs: result.latencyMs ?? null,
        checkedAt: new Date().toISOString(),
        error: result.error || null
    };
    return lastResult;
}

function getServerStatus() {
    return lastResult;
}

function startServerStatusMonitor() {
    if (pingTimer) return;
    refreshServerStatus().catch(() => {});
    pingTimer = setInterval(() => {
        refreshServerStatus().catch(() => {});
    }, PING_INTERVAL_MS);
    if (pingTimer.unref) pingTimer.unref();
}

module.exports = {
    pingServer,
    refreshServerStatus,
    getServerStatus,
    startServerStatusMonitor
};
