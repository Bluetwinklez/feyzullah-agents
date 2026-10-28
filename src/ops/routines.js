// Zamanlanmış rutinler: 5 alanlı cron (yerel saat), eşzamanlılık (skip/queue), kaçırılan çalışma (latest/none)
// ve "limit açılınca çalış". Rutin zamanı gelince hedef ya da görev açar; planlama ve yürütme çağırana kalır.
import { randomUUID } from 'node:crypto';
import { createGoal, getGoal } from '../core/board.js';
import { now, tx } from '../core/db.js';
import { append } from '../core/events.js';
import { createTask, getTask } from '../core/tasks.js';
import { normalizeEngine } from '../engines/args.js';

/** @typedef {import('node:sqlite').DatabaseSync} Db */

const ALIASES = { '@hourly': '0 * * * *', '@daily': '0 0 * * *', '@weekly': '0 0 * * 0', '@monthly': '0 0 1 * *' };
const RANGES = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
const LATE_MS = 5 * 60_000;

/**
 * @param {string} expr
 * @returns {{minute: Set<number>, hour: Set<number>, dom: Set<number>, month: Set<number>, dow: Set<number>, domAny: boolean, dowAny: boolean}}
 */
export function parseCron(expr) {
  const src = ALIASES[String(expr).trim()] ?? String(expr).trim();
  const parts = src.split(/\s+/);
  if (parts.length !== 5) throw new Error(`cron 5 alan ister: ${expr}`);
  const sets = parts.map((p, i) => {
    const [lo, hi] = RANGES[i];
    const out = new Set();
    for (const item of p.split(',')) {
      const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(item);
      if (!m) throw new Error(`geçersiz cron alanı: ${item}`);
      const step = m[4] ? Number(m[4]) : 1;
      const a = m[1] === '*' ? lo : Number(m[2]);
      const b = m[1] === '*' ? hi : m[3] != null ? Number(m[3]) : m[4] ? hi : a;
      if (step < 1 || a < lo || b > hi || a > b) throw new Error(`cron aralık dışı: ${item}`);
      for (let v = a; v <= b; v += step) out.add(i === 4 && v === 7 ? 0 : v);
    }
    return out;
  });
  return { minute: sets[0], hour: sets[1], dom: sets[2], month: sets[3], dow: sets[4], domAny: parts[2] === '*', dowAny: parts[4] === '*' };
}

/** Verilen andan sonraki ilk eşleşen dakika (yerel saat). @param {string} expr @param {number} from @returns {number} */
export function nextRun(expr, from) {
  const c = parseCron(expr);
  const d = new Date(from);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  const dayOk = (x) => {
    const dom = c.dom.has(x.getDate());
    const dow = c.dow.has(x.getDay());
    // Standart cron: iki gün alanı da kısıtlıysa biri yeter.
    if (!c.domAny && !c.dowAny) return dom || dow;
    return dom && dow;
  };
  const limit = from + 5 * 366 * 24 * 3600_000;
  while (d.getTime() < limit) {
    if (!c.month.has(d.getMonth() + 1)) { d.setMonth(d.getMonth() + 1, 1); d.setHours(0, 0, 0, 0); continue; }
    if (!dayOk(d)) { d.setDate(d.getDate() + 1); d.setHours(0, 0, 0, 0); continue; }
    if (!c.hour.has(d.getHours())) { d.setHours(d.getHours() + 1, 0, 0, 0); continue; }
    if (!c.minute.has(d.getMinutes())) { d.setMinutes(d.getMinutes() + 1, 0, 0); continue; }
    return d.getTime();
  }
  throw new Error(`cron hiç eşleşmiyor: ${expr}`);
}

/**
 * @param {Db} db
 * @param {{name: string, cron?: string|null, kind?: 'goal'|'task', body: string, engine?: string|null, concurrency?: 'skip'|'queue',
 *   catchUp?: 'latest'|'none', whenFree?: boolean}} r
 *   whenFree: motorun limiti açılınca çalışır (engine gerekir); cron yoksa tek seferliktir.
 */
export function addRoutine(db, { name, cron = null, kind = 'goal', body, engine = null, concurrency = 'skip', catchUp = 'latest', whenFree = false }) {
  if (!cron && !whenFree) throw new Error('cron ya da whenFree gerekli');
  if (whenFree && !engine) throw new Error('whenFree için motor gerekli');
  const e = engine ? normalizeEngine(engine) : null;
  const id = randomUUID();
  const at = now();
  tx(db, () => {
    db.prepare(`INSERT INTO routines(id, name, cron, kind, body, engine, concurrency, catch_up, when_free, next_run_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, name, cron, kind, body, e, concurrency, catchUp, whenFree ? 1 : 0, cron ? nextRun(cron, at) : at, at);
    append(db, { actor: 'routines', type: 'routine.created', entity: 'routine', entityId: id, data: { name, cron, whenFree } });
  });
  return id;
}

/** @param {Db} db */
export const listRoutines = (db) => db.prepare('SELECT * FROM routines ORDER BY created_at').all();

/** @param {Db} db @param {string} id @param {boolean} enabled */
export function setRoutineEnabled(db, id, enabled) {
  db.prepare('UPDATE routines SET enabled = ? WHERE id = ? OR id LIKE ?').run(enabled ? 1 : 0, id, `${id}%`);
}

function engineDown(db, engine, at) {
  try {
    const v = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'engine_down'").get()?.value ?? '{}');
    return Number(v[engine] ?? 0) > at;
  } catch { return false; }
}

function stillRunning(db, r) {
  if (!r.last_entity_id) return false;
  if (r.kind === 'goal') return !['done', 'failed', 'cancelled'].includes(getGoal(db, r.last_entity_id)?.status ?? 'done');
  return !['done', 'failed', 'cancelled'].includes(getTask(db, r.last_entity_id)?.status ?? 'done');
}

/**
 * Zamanı gelen rutinleri çalıştırır (hedef ya da görev açar).
 * @param {Db} db @param {{at?: number}} [o]
 * @returns {{routineId: string, kind: 'goal'|'task', entityId: string|null, skipped?: string}[]}
 */
export function tickRoutines(db, { at = now() } = {}) {
  const out = [];
  for (const r of db.prepare('SELECT * FROM routines WHERE enabled = 1 AND next_run_at <= ?').all(at)) {
    if (r.when_free && engineDown(db, r.engine, at)) continue;
    const next = r.cron ? nextRun(r.cron, at) : null;
    const advance = (entityId) => db.prepare('UPDATE routines SET next_run_at = ?, enabled = ?, last_run_at = COALESCE(?, last_run_at), last_entity_id = COALESCE(?, last_entity_id) WHERE id = ?')
      .run(next, next == null ? 0 : 1, entityId ? at : null, entityId, r.id);
    let skipped = null;
    if (r.concurrency === 'skip' && stillRunning(db, r)) skipped = 'önceki çalışma sürüyor';
    else if (r.catch_up === 'none' && r.cron && !r.when_free && at - r.next_run_at > LATE_MS) skipped = 'kaçırıldı';
    if (skipped) {
      tx(db, () => { advance(null); append(db, { actor: 'routines', type: 'routine.skipped', entity: 'routine', entityId: r.id, data: { reason: skipped } }); });
      out.push({ routineId: r.id, kind: r.kind, entityId: null, skipped });
      continue;
    }
    const entityId = tx(db, () => {
      const id = r.kind === 'goal'
        ? createGoal(db, { title: r.name, description: r.body }).id
        : createTask(db, { title: r.name, prompt: r.body, engine: r.engine }).id;
      advance(id);
      append(db, { actor: 'routines', type: 'routine.fired', entity: 'routine', entityId: r.id, data: { kind: r.kind, entityId: id } });
      return id;
    });
    out.push({ routineId: r.id, kind: r.kind, entityId });
  }
  return out;
}
