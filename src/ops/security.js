// Güvenlik kapısı: birleştirmeden önce dalın getirdiği değişikliği tarar. Dış araç gerektirmez:
// eklenen satırlarda gizli bilgi, riskli dosya adları ve tehlikeli kod kalıpları. npm audit isteğe bağlıdır
// (bağımlılık listesini npm kayıt sunucusuna gönderir).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { scanSecrets } from '../knowledge/secrets.js';

/** @typedef {{level: 'block'|'warn', kind: string, file: string|null, detail: string}} Finding */

// Depoya girmemesi gereken dosyalar.
const RISKY_FILES = [
  /(^|\/)\.env(\.[^/]*)?$/i, /\.pem$/i, /\.p12$/i, /\.pfx$/i, /\.key$/i, /(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/i,
  /(^|\/)credentials(\.json)?$/i, /\.kdbx$/i, /(^|\/)\.npmrc$/i, /\.ROBLOSECURITY/i,
];
const SAFE_FILES = [/\.env\.example$/i, /\.env\.sample$/i];

// Uyarı düzeyi kalıplar: kendileri hata değil ama incelenmeli.
const CODE_RULES = [
  { kind: 'eval', re: /\beval\s*\(|new Function\s*\(/, files: /\.(m?js|cjs|ts)$/ },
  { kind: 'kabuk komutu', re: /\b(exec|execSync)\s*\(\s*`[^`]*\$\{/, files: /\.(m?js|cjs|ts)$/ },
  { kind: 'loadstring', re: /\bloadstring\s*\(/, files: /\.luau?$/ },
  { kind: 'HttpService', re: /HttpService\s*:\s*(RequestAsync|GetAsync|PostAsync)/, files: /\.luau?$/ },
  { kind: 'TLS doğrulaması kapalı', re: /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0/ },
  { kind: 'izin atlatma', re: /--dangerously-skip-permissions/ },
];

/** Birleşik diff'i dosya başına eklenen satırlara ayırır. @param {string} patch */
export function addedByFile(patch) {
  /** @type {Map<string, string[]>} */
  const out = new Map();
  let file = null;
  for (const l of String(patch).split('\n')) {
    const h = /^\+\+\+ (?:b\/)?(.+)$/.exec(l);
    if (h) { file = h[1] === '/dev/null' ? null : h[1]; if (file && !out.has(file)) out.set(file, []); continue; }
    if (file && l.startsWith('+') && !l.startsWith('+++')) out.get(file).push(l.slice(1));
  }
  return out;
}

/**
 * Diff üzerinde yerleşik kurallar. Gizli bilgi ve riskli dosya → block; kod kalıpları → warn.
 * @param {string} patch @returns {Finding[]}
 */
export function scanPatch(patch) {
  /** @type {Finding[]} */
  const out = [];
  for (const [file, lines] of addedByFile(patch)) {
    if (RISKY_FILES.some((r) => r.test(file)) && !SAFE_FILES.some((r) => r.test(file))) out.push({ level: 'block', kind: 'riskli dosya', file, detail: 'depoya girmemeli' });
    const text = lines.join('\n');
    for (const k of new Set(scanSecrets(text).map((f) => f.kind))) out.push({ level: 'block', kind: 'gizli bilgi', file, detail: k });
    for (const r of CODE_RULES) {
      if (r.files && !r.files.test(file)) continue;
      const i = lines.findIndex((l) => r.re.test(l));
      if (i >= 0) out.push({ level: 'warn', kind: r.kind, file, detail: lines[i].trim().slice(0, 120) });
    }
  }
  return out;
}

/** npm audit (yalnız istenirse; ağ ister). @param {string} dir @returns {Finding[]} */
export function npmAudit(dir) {
  if (!existsSync(join(dir, 'package-lock.json'))) return [];
  const r = spawnSync('npm', ['audit', '--json', '--audit-level=high'], { cwd: dir, encoding: 'utf8', shell: process.platform === 'win32', windowsHide: true, timeout: 120_000 });
  let data;
  try { data = JSON.parse(r.stdout); } catch { return [{ level: 'warn', kind: 'npm audit', file: 'package-lock.json', detail: 'çalışmadı' }]; }
  const v = data.metadata?.vulnerabilities ?? {};
  const bad = (v.high ?? 0) + (v.critical ?? 0);
  return bad ? [{ level: 'block', kind: 'npm audit', file: 'package-lock.json', detail: `${v.critical ?? 0} kritik, ${v.high ?? 0} yüksek açık` }] : [];
}

/**
 * `base...branch` aralığını tarar.
 * @param {{repo: string, base: string, branch: string, audit?: boolean, auditDir?: string}} o
 * @returns {{ok: boolean, findings: Finding[]}}
 */
export function securityCheck({ repo, base, branch, audit = false, auditDir = repo }) {
  const d = spawnSync('git', ['diff', '--no-color', '--no-ext-diff', `${base}...${branch}`], { cwd: repo, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (d.status !== 0) throw new Error(`git diff başarısız: ${(d.stderr ?? '').trim()}`);
  const patch = d.stdout;
  const findings = scanPatch(patch);
  if (audit) findings.push(...npmAudit(auditDir));
  return { ok: !findings.some((f) => f.level === 'block'), findings };
}
