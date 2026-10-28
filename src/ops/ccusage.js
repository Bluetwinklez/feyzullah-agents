// ccusage çapraz kontrolü: `ccusage daily --json` çıktısındaki Claude kullanımını bizim kayıtla gün gün karşılaştırır.
// ccusage makinedeki bütün Claude Code kullanımını sayar (elle yapılan oturumlar dahil); bizimki yalnız fa'nın
// çalıştırdıkları. Bu yüzden bizimkinin ccusage'ı geçmesi sayım hatasıdır, geride kalması normaldir.

/** @typedef {import('node:sqlite').DatabaseSync} Db */

/** Yerel saatle YYYY-MM-DD. @param {number} ms */
const day = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * ccusage daily JSON'u → gün başına token (input + cacheCreation + output; önbellekten okunan sayılmaz, bizdeki gibi).
 * @param {any} data @returns {Map<string, number>}
 */
export function parseCcusage(data) {
  const rows = Array.isArray(data) ? data : data?.daily;
  if (!Array.isArray(rows)) throw new Error('ccusage daily --json çıktısı değil');
  const out = new Map();
  for (const r of rows) {
    const date = String(r.date ?? r.day ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const n = (r.inputTokens ?? 0) + (r.cacheCreationTokens ?? r.cacheCreationInputTokens ?? 0) + (r.outputTokens ?? 0);
    out.set(date, (out.get(date) ?? 0) + n);
  }
  return out;
}

/** @param {Db} db @param {string} [engine] @returns {Map<string, number>} */
export function ourDaily(db, engine = 'claude') {
  const out = new Map();
  for (const u of db.prepare('SELECT input, cache_write, output, at FROM usage WHERE engine = ?').all(engine)) {
    const d = day(u.at);
    out.set(d, (out.get(d) ?? 0) + u.input + u.cache_write + u.output);
  }
  return out;
}

/**
 * @param {Db} db @param {any} data ccusage JSON
 * @returns {{date: string, ours: number, theirs: number|null, share: number|null, over: boolean}[]}
 */
export function compareCcusage(db, data) {
  const theirs = parseCcusage(data);
  const ours = ourDaily(db);
  const dates = [...new Set([...ours.keys(), ...theirs.keys()])].sort();
  return dates.map((date) => {
    const o = ours.get(date) ?? 0;
    const t = theirs.has(date) ? theirs.get(date) : null;
    return { date, ours: o, theirs: t, share: t ? o / t : null, over: t !== null ? o > t * 1.02 : o > 0 };
  });
}
