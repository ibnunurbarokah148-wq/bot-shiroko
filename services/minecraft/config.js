// ============================================================
//  KONFIGURASI MINECRAFT BOT (Support Overrides via .env)
// ============================================================

const CONFIG = {
    host: process.env.MC_HOST || 'id-1.zknesia.app',
    port: parseInt(process.env.MC_PORT || '25675'),
    username: process.env.MC_USERNAME || 'Ritian223',
    version: (!process.env.MC_VERSION || process.env.MC_VERSION.toLowerCase() === 'auto' || process.env.MC_VERSION.toLowerCase() === 'false') ? false : process.env.MC_VERSION,
    auth: process.env.MC_AUTH || 'offline',
    owners: process.env.MC_OWNERS ? process.env.MC_OWNERS.split(',').map(s => s.trim().toLowerCase()) : ['rukaajah'],
    reconnectDelay: 5000,
    aiCooldown: 3000,
    autoAfkInterval: 55000
};

// ============================================================
//  ZONA AMAN RUMAH (ANTI-HANCUR)
// ============================================================
const CONFIG_RUMAH = {
    petiX: process.env.MC_HOME_X ? parseInt(process.env.MC_HOME_X) : 82,
    petiY: process.env.MC_HOME_Y ? parseInt(process.env.MC_HOME_Y) : 72,
    petiZ: process.env.MC_HOME_Z ? parseInt(process.env.MC_HOME_Z) : 37,
    radiusAman: process.env.MC_HOME_RADIUS ? parseInt(process.env.MC_HOME_RADIUS) : 20
};

const kamusBlok = {
    "tanah": "dirt",
    "batu": "stone",
    "cobblestone": "cobblestone",
    "kayu": "oak_log",
    "pasir": "sand",
    "arang": "coal_ore",
    "besi": "iron_ore",
    "emas": "gold_ore",
    "berlian": "diamond_ore"
};

const daftarMakanan = [
    'apple', 'bread', 'cooked_beef', 'cooked_chicken',
    'cooked_porkchop', 'cooked_mutton', 'cooked_rabbit',
    'cooked_salmon', 'carrot', 'baked_potato', 'golden_apple'
];

const hostileMobs = [
    'zombie', 'zombie_villager', 'skeleton', 'creeper', 'spider', 'cave_spider',
    'enderman', 'witch', 'slime', 'phantom', 'drowned', 'husk', 'stray',
    'pillager', 'vindicator', 'evoker'
];

function isOwner(username) {
    if (!username || typeof username !== 'string') return false;
    const cleanUser = username.toLowerCase().replace(/^[.*_]/, '').trim();
    return CONFIG.owners.some(owner => {
        const cleanOwner = owner.toLowerCase().replace(/^[.*_]/, '').trim();
        return cleanUser === cleanOwner || username.toLowerCase() === owner.toLowerCase();
    });
}

module.exports = {
    CONFIG,
    CONFIG_RUMAH,
    kamusBlok,
    daftarMakanan,
    hostileMobs,
    isOwner
};
