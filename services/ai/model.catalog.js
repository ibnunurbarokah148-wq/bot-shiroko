// Katalog keluarga model: Standard memakai ArisuSoft, Premium memakai UnoRouter.
const MODEL_FAMILIES = [
    { key: 'ds3', label: 'Deepseek V3.2', standardMode: 'ds3', premiumProvider: 'unorouter', premiumModel: 'deepseek-v3.2' },
    { key: 'ds4', label: 'Deepseek V4 Pro', standardMode: 'ds4', premiumProvider: 'unorouter', premiumModel: 'deepseek-v4-pro' },
    { key: 'gemini', label: 'Gemini', standardMode: 'arisu-gemini', premiumProvider: 'unorouter', premiumModel: 'gemini-3.5-flash' },
    { key: 'glm', label: 'GLM', standardMode: 'glm', premiumProvider: 'unorouter', premiumModel: 'glm-5.3' },
    { key: 'qwen', label: 'Qwen', standardMode: 'qwen', premiumProvider: 'unorouter', premiumModel: 'qwen3.8-max' },
    { key: 'gpt', label: 'GPT', standardMode: 'gpt', premiumProvider: 'unorouter', premiumModel: 'gpt-5.6-luna' },
    { key: 'grok', label: 'Grok', standardMode: 'grok', premiumProvider: 'unorouter', premiumModel: 'grok-4.6' },
    { key: 'opensource', label: 'Open Source', openSource: true }
];

const OPEN_SOURCE_PROVIDERS = [
    { key: 'openrouter', label: 'OpenRouter', mode: 'openrouter' },
    { key: 'cloudflare', label: 'Cloudflare AI', mode: 'cloudflare' }
];

function getFamilies() { return MODEL_FAMILIES.map(family => ({ ...family })); }
function getFamilyByIndex(index) { return MODEL_FAMILIES[index] || null; }
function getFamilyByKey(key) { return MODEL_FAMILIES.find(family => family.key === key) || null; }

module.exports = { MODEL_FAMILIES, OPEN_SOURCE_PROVIDERS, getFamilies, getFamilyByIndex, getFamilyByKey };
