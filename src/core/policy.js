// Ajan başına izinli araçlar ve onay isteyen eylemler. Araç listeleri Ofis `src/agents/runner.js:20-31` mantığıyla aynı.

const SAFE_BASH = ['npm test', 'npm run', 'npm install', 'npm ci', 'npx', 'node', 'git status', 'git diff', 'git log', 'git show', 'git add', 'git commit',
  'ls', 'dir', 'cat', 'type', 'python', 'py', 'pytest', 'pip install', 'tsc', 'eslint', 'prettier',
  // salt okuma git ve zararsız dosya/metin araçları; paket yöneticileri (silme, taşıma, curl yok)
  'git --version', 'git branch', 'git rev-parse', 'git ls-files', 'mkdir', 'touch', 'echo', 'pwd', 'grep', 'find', 'head', 'tail', 'wc', 'sort',
  'pnpm', 'yarn', 'bun', 'cargo', 'go', 'make'].map((c) => `Bash(${c}:*)`);
// Ters mühendislik: yalnız okuyan komutlar; kurma ve commit yok.
const READ_BASH = ['ls', 'dir', 'cat', 'type', 'git status', 'git log', 'git show', 'git diff'].map((c) => `Bash(${c}:*)`);
const WEB = ['WebSearch', 'WebFetch'];

/** Yetenek → ek araçlar (yalnız claude'a verilir; codex ve agy kum havuzuna güvenir). */
const CAPABILITY_TOOLS = {
  reverse: [...READ_BASH, 'mcp__rea'],
  krea: ['mcp__krea-ai'],
  godot: ['Bash(godot:*)', 'Bash(godot.cmd:*)'],
  roblox: ['rojo', 'selene', 'stylua', 'lune', 'rokit', 'luau-analyze', 'luau-lsp'].map((c) => `Bash(${c}:*)`),
};

/** @param {string[]|string|null|undefined} caps */
function parseCaps(caps) {
  if (Array.isArray(caps)) return caps;
  if (typeof caps === 'string' && caps.trim()) { try { const v = JSON.parse(caps); return Array.isArray(v) ? v : []; } catch { return []; } }
  return [];
}

/**
 * claude için --allowedTools listesi; diğer motorlar boş liste alır.
 * Yalnız "reverse" yeteneği olan ajan SAFE_BASH yerine salt okuma komutlarıyla çalışır (Ofis'teki gibi).
 * @param {{engine: string, department?: string|null, capabilities?: string[]|string|null}} agent
 * @returns {string[]}
 */
export function toolsFor(agent) {
  if (agent.engine !== 'claude') return [];
  const caps = parseCaps(agent.capabilities);
  const onlyReverse = caps.length === 1 && caps[0] === 'reverse';
  const out = new Set(onlyReverse ? [] : SAFE_BASH);
  for (const c of caps) for (const t of CAPABILITY_TOOLS[c] ?? []) out.add(t);
  for (const t of WEB) out.add(t);
  return [...out];
}

const ASK = new Set(['git.push', 'git.merge', 'fs.delete', 'credits.spend', 'external.send', 'roblox.publish', 'roblox.cloud_exec', 'roblox.insert_asset']);
const DENY = new Set(['secrets.read', 'permissions.bypass']);
const ALLOW = new Set(['fs.read', 'fs.write', 'git.commit', 'git.branch', 'checks.run', 'task.create']);

/**
 * Listede olmayan eylem güvenli varsayılan olarak "ask" döner.
 * @param {string} action
 * @returns {'allow'|'ask'|'deny'}
 */
export function decide(action) {
  if (DENY.has(action)) return 'deny';
  if (ASK.has(action)) return 'ask';
  if (ALLOW.has(action)) return 'allow';
  return 'ask';
}
