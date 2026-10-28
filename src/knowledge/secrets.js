// Gizli bilgi filtresi: Noesis'e, GitHub'a ve olay günlüğüne giden her metin buradan geçer.
// Anahtar, jeton, parola, özel anahtar ve kişisel veri (e-posta, telefon, TC kimlik, kart) yakalanır.

/** Luhn denetimi (kart numaraları için yanlış alarmı azaltır). */
function luhn(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

/** TC kimlik numarası denetimi. */
function tcValid(s) {
  if (!/^[1-9]\d{10}$/.test(s)) return false;
  const d = [...s].map(Number);
  const odd = d[0] + d[2] + d[4] + d[6] + d[8];
  const even = d[1] + d[3] + d[5] + d[7];
  return ((odd * 7 - even) % 10 + 10) % 10 === d[9] && d.slice(0, 10).reduce((a, b) => a + b, 0) % 10 === d[10];
}

/** @type {{kind: string, re: RegExp, check?: (m: string) => boolean}[]} */
const RULES = [
  { kind: 'özel anahtar', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { kind: 'anthropic anahtarı', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { kind: 'openai anahtarı', re: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/g },
  { kind: 'github jetonu', re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/g },
  { kind: 'aws anahtarı', re: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { kind: 'google anahtarı', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: 'slack jetonu', re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { kind: 'roblox çerezi', re: /_\|WARNING:-DO-NOT-SHARE-THIS[^\s"']*/g },
  { kind: 'jwt', re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  { kind: 'bearer jetonu', re: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/g },
  { kind: 'parola/anahtar ataması', re: /\b(?:api[_-]?key|apikey|secret|token|password|passwd|parola|şifre)\s*[:=]\s*["']?[^\s"']{8,}/gi },
  { kind: 'e-posta', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, check: (m) => !/@(users\.noreply\.github\.com|example\.(com|org)|anthropic\.com)$/i.test(m) },
  { kind: 'telefon', re: /(?:\+90[\s-]?|\b0)5\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b/g },
  { kind: 'tc kimlik', re: /\b[1-9]\d{10}\b/g, check: tcValid },
  { kind: 'kart numarası', re: /\b(?:\d[ -]?){13,19}\b/g, check: (m) => { const d = m.replace(/\D/g, ''); return d.length >= 13 && d.length <= 19 && luhn(d); } },
];

/**
 * @param {string} text
 * @returns {{kind: string, index: number, length: number}[]}
 */
export function scanSecrets(text) {
  const s = String(text ?? '');
  const found = [];
  for (const r of RULES) {
    for (const m of s.matchAll(r.re)) {
      if (r.check && !r.check(m[0])) continue;
      if (found.some((f) => m.index < f.index + f.length && f.index < m.index + m[0].length)) continue;
      found.push({ kind: r.kind, index: m.index, length: m[0].length });
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

/** Bulunanları "[gizli: tür]" ile değiştirir. @param {string} text */
export function redactText(text) {
  const s = String(text ?? '');
  const found = scanSecrets(s);
  let out = '';
  let at = 0;
  for (const f of found) {
    out += s.slice(at, f.index) + `[gizli: ${f.kind}]`;
    at = f.index + f.length;
  }
  return { text: out + s.slice(at), found: found.map((f) => f.kind) };
}
