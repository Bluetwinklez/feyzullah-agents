// Motor argümanları: Ofis `src/agents/cli.js` cliArgs ile birebir. İzin atlatma bayrağı yok.

const ALIASES = { claude: 'claude', codex: 'codex', antigravity: 'antigravity', agy: 'antigravity', gemini: 'antigravity' };

/**
 * @param {string} name
 * @returns {'claude'|'codex'|'antigravity'}
 */
export function normalizeEngine(name) {
  const e = ALIASES[String(name ?? '').trim().toLowerCase()];
  if (!e) throw new Error(`bilinmeyen motor: ${name}`);
  return e;
}

/** @param {string|null|undefined} persona @param {string} prompt */
export const withPersona = (persona, prompt) => (persona ? `${persona}\n\n---\n\nGörev:\n${prompt}` : prompt);

/**
 * @param {'claude'|'codex'|'antigravity'} engine
 * @param {{cwd: string, persona?: string|null, personaFile?: string|null, prompt: string, resumeId?: string|null, allowedTools?: string[], network?: boolean}} o
 * @returns {string[]}
 */
export function cliArgs(engine, { cwd, persona = null, personaFile = null, prompt, resumeId = null, allowedTools = [], network = false }) {
  if (engine === 'codex') {
    // network: kum havuzu içinde ağ erişimi (npm install vb.); dosya yazma yine yalnız çalışma klasörü.
    return ['exec', '--json', '-s', 'workspace-write', ...(network ? ['-c', 'sandbox_workspace_write.network_access=true'] : []),
      '--skip-git-repo-check', '-C', cwd, ...(resumeId ? ['resume', resumeId] : []), '-'];
  }
  if (engine === 'antigravity') {
    // --mode accept-edits: -p kipinde izin sorulamaz; bayrak yoksa agy dosya yazamaz ve boş cevapla "SUCCESS" döner.
    return ['-p', resumeId ? prompt : withPersona(persona, prompt), '--output-format', 'stream-json', '--sandbox', '--mode', 'accept-edits',
      ...(resumeId ? ['--conversation', resumeId] : [])];
  }
  return ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits',
    ...(persona ? ['--append-system-prompt', persona] : personaFile ? ['--append-system-prompt-file', personaFile] : []),
    ...(resumeId ? ['--resume', resumeId] : []),
    ...(allowedTools.length ? ['--allowedTools', ...allowedTools] : [])];
}

/** @param {string} engine @returns {'stdin'|'argv'} */
export const promptVia = (engine) => (engine === 'antigravity' ? 'argv' : 'stdin');

/**
 * Süreç stdin'ine yazılacak metin; null ise stdin hemen kapatılır.
 * @param {string} engine
 * @param {{persona?: string|null, prompt: string, resumeId?: string|null}} o
 * @returns {string|null}
 */
export function stdinText(engine, { persona = null, prompt, resumeId = null }) {
  if (engine === 'antigravity') return null;
  if (engine === 'claude' || resumeId) return prompt;
  return withPersona(persona, prompt);
}
