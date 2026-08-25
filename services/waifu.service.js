const state = require('../config/state');
const db = require('../config/database');
const { getCoreNumber } = require('../utils/helpers');
const { getCharacterById, getCharacterByName } = require('../config/waifu.characters');

function keysFor(jid) { const core = getCoreNumber(jid); return core && core !== jid ? [jid, core] : [jid]; }
function persist() { db.setSetting('userWaifuState', state.waifuState); }
function activate(jid, characterId) {
  const character = getCharacterById(characterId) || getCharacterByName(characterId);
  if (!character) return null;
  if (!state.userSystemPrompt) state.userSystemPrompt = {};
  for (const key of keysFor(jid)) {
    state.waifuState[key] = character.id;
    state.userSystemPrompt[key] = character.prompt;
  }
  persist();
  return character;
}
function get(jid) {
  const id = state.waifuState[jid] || state.waifuState[getCoreNumber(jid)];
  return id ? getCharacterById(id) : null;
}
function clear(jid) {
  if (!state.userSystemPrompt) state.userSystemPrompt = {};
  for (const key of keysFor(jid)) { delete state.waifuState[key]; delete state.userSystemPrompt[key]; }
  persist();
}
function restore() {
  if (!state.userSystemPrompt) state.userSystemPrompt = {};
  for (const [jid, id] of Object.entries(state.waifuState || {})) {
    const character = getCharacterById(id);
    if (character) state.userSystemPrompt[jid] = character.prompt;
  }
}
module.exports = { activate, get, clear, restore };
