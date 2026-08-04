require('dotenv').config();
const { spawn } = require('child_process');
const path = require('path');
const { CONFIG } = require('./config');

let pythonProcess = null;
let botStatus = {
    online: false,
    username: CONFIG.username,
    health: 20,
    food: 20,
    position: { x: 0, y: 0, z: 0 },
    inventory: 'Memuat data...'
};

function startMcBot() {
    if (pythonProcess) {
        return false; // Sudah berjalan
    }

    const scriptPath = path.join(__dirname, 'bot.py');
    console.log(`[MC Multi-Lang] Memulai Python Minecraft Bot dari: ${scriptPath}`);

    // Pilih binary python yang tersedia (python / python3 / py)
    const pyCmd = process.platform === 'win32' ? 'python' : 'python3';
    
    pythonProcess = spawn(pyCmd, [scriptPath], {
        cwd: path.join(__dirname, '../../'),
        env: {
            ...process.env,
            PYTHONUNBUFFERED: '1',
            PYTHONIOENCODING: 'utf-8',
            PYTHONUTF8: '1'
        }
    });

    pythonProcess.stdout.on('data', (data) => {
        const text = data.toString();
        const lines = text.split('\n');

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            // Cek apakah baris adalah pesan IPC
            if (trimmed.includes('__IPC_MESSAGE_START__') && trimmed.includes('__IPC_MESSAGE_END__')) {
                try {
                    const startIdx = trimmed.indexOf('__IPC_MESSAGE_START__') + '__IPC_MESSAGE_START__'.length;
                    const endIdx = trimmed.indexOf('__IPC_MESSAGE_END__');
                    const jsonStr = trimmed.substring(startIdx, endIdx);
                    const ipc = JSON.parse(jsonStr);

                    handleIpcMessage(ipc);
                } catch (e) {
                    console.error('[MC IPC Error]:', e.message);
                }
            } else {
                // Log biasa dari Python
                console.log(trimmed);
            }
        }
    });

    pythonProcess.stderr.on('data', (data) => {
        const errStr = data.toString().trim();
        if (errStr) {
            console.error(`[MC Python Stderr]: ${errStr}`);
        }
    });

    pythonProcess.on('close', (code) => {
        console.log(`[MC Multi-Lang] Python Bot berhenti dengan exit code: ${code}`);
        pythonProcess = null;
        botStatus.online = false;
    });

    pythonProcess.on('error', (err) => {
        console.error('[MC Multi-Lang] Gagal menjalankan Python Bot:', err.message);
        pythonProcess = null;
        botStatus.online = false;
    });

    return true;
}

function handleIpcMessage(ipc) {
    if (!ipc || !ipc.ipc_type) return;

    switch (ipc.ipc_type) {
        case 'login':
            botStatus.online = true;
            botStatus.username = ipc.data.username || CONFIG.username;
            break;
        case 'spawn':
            botStatus.online = true;
            botStatus.position = {
                x: Math.round(ipc.data.x || 0),
                y: Math.round(ipc.data.y || 0),
                z: Math.round(ipc.data.z || 0)
            };
            break;
        case 'disconnected':
        case 'kicked':
            botStatus.online = false;
            break;
        case 'status_response':
            if (ipc.data) {
                botStatus.online = ipc.data.online;
                if (ipc.data.health !== undefined) botStatus.health = Math.round(ipc.data.health);
                if (ipc.data.food !== undefined) botStatus.food = Math.round(ipc.data.food);
                if (ipc.data.x !== undefined) {
                    botStatus.position = {
                        x: Math.round(ipc.data.x),
                        y: Math.round(ipc.data.y),
                        z: Math.round(ipc.data.z)
                    };
                }
            }
            break;
        default:
            break;
    }
}

function stopMcBot() {
    if (!pythonProcess) return false;

    try {
        pythonProcess.stdin.write(JSON.stringify({ cmd: 'stop' }) + '\n');
    } catch (e) {}

    setTimeout(() => {
        if (pythonProcess) {
            try {
                pythonProcess.kill('SIGTERM');
            } catch (e) {}
            pythonProcess = null;
        }
    }, 1000);

    botStatus.online = false;
    return true;
}

function getMinecraftBot() {
    if (!pythonProcess) return null;

    return {
        chat: (message) => {
            if (pythonProcess && pythonProcess.stdin.writable) {
                pythonProcess.stdin.write(JSON.stringify({ cmd: 'chat', msg: message }) + '\n');
            }
        },
        quit: () => {
            stopMcBot();
        }
    };
}

function getMinecraftStatus() {
    if (pythonProcess && pythonProcess.stdin.writable) {
        try {
            pythonProcess.stdin.write(JSON.stringify({ cmd: 'status' }) + '\n');
        } catch (e) {}
    }

    return {
        online: Boolean(pythonProcess && botStatus.online),
        username: botStatus.username,
        health: botStatus.health,
        food: botStatus.food,
        position: botStatus.position,
        inventory: botStatus.inventory
    };
}

module.exports = {
    startMcBot,
    stopMcBot,
    getMinecraftBot,
    getMinecraftStatus
};
