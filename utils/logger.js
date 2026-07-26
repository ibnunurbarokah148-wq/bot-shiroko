// ==========================================
// LOGGER — Centralized Logging dengan Timestamp & Level
// ==========================================

const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const currentLevel = LEVELS[process.env.LOG_LEVEL] || LEVELS.INFO;

function timestamp() {
    return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

function formatMsg(level, prefix, ...args) {
    const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : a)).join(' ');
    return `[${timestamp()}] [${level}] [${prefix}] ${msg}`;
}

const logger = {
    debug(prefix, ...args) {
        if (currentLevel <= LEVELS.DEBUG) console.log(formatMsg('DEBUG', prefix, ...args));
    },
    info(prefix, ...args) {
        if (currentLevel <= LEVELS.INFO) console.log(formatMsg('INFO', prefix, ...args));
    },
    warn(prefix, ...args) {
        if (currentLevel <= LEVELS.WARN) console.warn(formatMsg('WARN', prefix, ...args));
    },
    error(prefix, ...args) {
        if (currentLevel <= LEVELS.ERROR) console.error(formatMsg('ERROR', prefix, ...args));
    }
};

module.exports = logger;
