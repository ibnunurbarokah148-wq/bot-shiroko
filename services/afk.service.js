const { dbAFK } = require('../config/db');

function key(groupJid, userJid) { return `${groupJid}:${userJid}`; }
function get(groupJid, userJid) { return dbAFK[key(groupJid, userJid)] || null; }
function set(groupJid, userJid, reason = 'Sedang AFK') { dbAFK[key(groupJid, userJid)] = { reason, since: Date.now() }; }
function clear(groupJid, userJid) { delete dbAFK[key(groupJid, userJid)]; }
function list(groupJid) { return Object.entries(dbAFK).filter(([id]) => id.startsWith(`${groupJid}:`)).map(([id, data]) => ({ userJid: id.slice(groupJid.length + 1), ...data })); }
function formatDuration(timestamp) {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (minutes < 1) return 'baru saja';
  if (minutes < 60) return `${minutes} menit`;
  return `${Math.floor(minutes / 60)} jam ${minutes % 60} menit`;
}
function canNotify(keyValue) {
  const last = notifyCache.get(keyValue) || 0;
  if (Date.now() - last < 30000) return false;
  notifyCache.set(keyValue, Date.now());
  return true;
}
const notifyCache = new Map();
module.exports = { get, set, clear, list, formatDuration, canNotify };
