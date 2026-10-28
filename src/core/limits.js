// Kullanım limiti algılama. Metin kuralları Ofis `src/agents/runner.js:57-71` ile aynı.
import { now } from './db.js';

export const LIMIT_RE = /usage limit|rate limit|hit your .{0,20}limit|quota exceeded|limit reached/i;

/**
 * "try again at 7:52 AM" → o saatin zamanı (geçtiyse yarın); yoksa 1 saat sonra.
 * @param {string} msg @param {number} [at]
 */
export function limitUntil(msg, at = now()) {
  const m = /try again at (\d{1,2}):(\d{2})\s*(AM|PM)?/i.exec(String(msg));
  if (!m) return at + 60 * 60_000;
  let h = Number(m[1]);
  const ap = (m[3] ?? '').toUpperCase();
  if (ap === 'PM' && h < 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  const d = new Date(at);
  d.setHours(h, Number(m[2]), 0, 0);
  if (d.getTime() <= at) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/**
 * @param {{error?: string|null, rate?: any, text?: string|null}} o
 * @param {number} [at]
 * @returns {{limited: boolean, retryAt: number|null}}
 */
export function detectLimit(input = {}, at = now()) {
  const r = detect(input, at);
  // Geçmişte kalan sıfırlama saati (saat kayması, eski mesaj) motoru hemen yeniden denetip döngü yapmasın.
  return r.limited ? { limited: true, retryAt: Math.max(r.retryAt, at + 60_000) } : r;
}

function detect({ error = null, rate = null, text = null }, at) {
  // claude rate_limit_event her istekte gelir; yalnız "rejected" gerçek limittir.
  if (rate && rate.status === 'rejected') {
    const s = Number(rate.resetsAt);
    return { limited: true, retryAt: Number.isFinite(s) && s > 0 ? s * 1000 : at + 60 * 60_000 };
  }
  const msg = [error, text].filter(Boolean).join('\n');
  if (!msg || !LIMIT_RE.test(msg)) return { limited: false, retryAt: null };
  // Claude'un eski biçimi: "Claude AI usage limit reached|<epoch saniye>"
  const epoch = /limit reached\|(\d{10})\b/i.exec(msg);
  if (epoch) return { limited: true, retryAt: Number(epoch[1]) * 1000 };
  return { limited: true, retryAt: limitUntil(msg, at) };
}
