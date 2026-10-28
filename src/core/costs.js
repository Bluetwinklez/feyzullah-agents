// Kullanım kaydı ve token bütçesi. used = input + cacheWrite + output (önbellekten okunan girdi sayılmaz).
import { now } from './db.js';

/** @typedef {import('node:sqlite').DatabaseSync} Db */
/** @typedef {import('../engines/parse.js').Usage} Usage */

/** @param {Db} db @param {{runId?: string|null, agentId?: string|null, engine: string, model?: string|null, usage: Usage}} o */
export function recordUsage(db, { runId = null, agentId = null, engine, model = null, usage }) {
  db.prepare(`INSERT INTO usage(run_id, agent_id, engine, model, input, cached_input, cache_write, output, known, at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(runId, agentId, engine, model, usage.input ?? 0, usage.cachedInput ?? 0,
    usage.cacheWrite ?? 0, usage.output ?? 0, usage.known === false ? 0 : 1, now());
}

/** @param {Db} db @param {{id: string, scope: 'global'|'engine'|'agent', scopeId?: string|null, window: 'day'|'month', limitTokens: number, warnPercent?: number, hardStop?: boolean}} b */
export function setBudget(db, { id, scope, scopeId = null, window, limitTokens, warnPercent = 80, hardStop = true }) {
  db.prepare(`INSERT INTO budgets(id, scope, scope_id, window, limit_tokens, warn_percent, hard_stop) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET scope = excluded.scope, scope_id = excluded.scope_id, window = excluded.window,
      limit_tokens = excluded.limit_tokens, warn_percent = excluded.warn_percent, hard_stop = excluded.hard_stop`)
    .run(id, scope, scopeId, window, limitTokens, warnPercent, hardStop ? 1 : 0);
}

/**
 * Yerel saatle pencere: day → bugün 00:00 .. yarın 00:00, month → ayın 1'i .. gelecek ayın 1'i.
 * @param {'day'|'month'} window @param {number} at
 */
export function windowRange(window, at) {
  const d = new Date(at);
  if (window === 'month') return { start: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), end: new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime() };
  return { start: new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(), end: new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() };
}

const RANK = { ok: 0, warn: 1, stop: 2 };

/**
 * Uygun bütçelerin (global + bu motor + bu ajan) en kötüsü.
 * @param {Db} db
 * @param {{engine?: string|null, agentId?: string|null, at?: number}} [o]
 * @returns {{state: 'ok'|'warn'|'stop', used: number, limit: number|null, budgetId: string|null, unknownRuns: number, resetAt: number|null}}
 */
export function budgetStatus(db, { engine = null, agentId = null, at = now() } = {}) {
  const budgets = db.prepare(`SELECT * FROM budgets WHERE scope = 'global' OR (scope = 'engine' AND scope_id = ?) OR (scope = 'agent' AND scope_id = ?)`)
    .all(engine, agentId);
  const sum = db.prepare(`SELECT COALESCE(SUM(input + cache_write + output), 0) used, COALESCE(SUM(known = 0), 0) unknown FROM usage
    WHERE at >= ? AND at < ? AND (? IS NULL OR engine = ?) AND (? IS NULL OR agent_id = ?)`);
  const measure = (window, e, a) => {
    const { start, end } = windowRange(window, at);
    const r = sum.get(start, end, e, e, a, a);
    return { used: Number(r.used), unknown: Number(r.unknown), end };
  };
  let worst = null;
  for (const b of budgets) {
    const m = measure(b.window, b.scope === 'engine' ? b.scope_id : null, b.scope === 'agent' ? b.scope_id : null);
    const pct = (m.used / b.limit_tokens) * 100;
    const state = pct >= 100 ? (b.hard_stop ? 'stop' : 'warn') : pct >= b.warn_percent ? 'warn' : 'ok';
    const cur = { state, used: m.used, limit: b.limit_tokens, budgetId: b.id, unknownRuns: m.unknown, resetAt: m.end };
    if (!worst || RANK[state] > RANK[worst.state] || (RANK[state] === RANK[worst.state] && pct > (worst.used / worst.limit) * 100)) worst = cur;
  }
  if (worst) return /** @type {any} */ (worst);
  const m = measure('day', engine, agentId);
  return { state: 'ok', used: m.used, limit: null, budgetId: null, unknownRuns: m.unknown, resetAt: null };
}
