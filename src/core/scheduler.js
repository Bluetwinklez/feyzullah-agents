// DAG zamanlayıcı: hazır görevleri motor başına sınırlı paralellikle çalıştırır. Koordinasyon deterministik;
// limitte yedek motora geçer (Ofis runner.js FALLBACK), oturumu görev başına sürdürür.
import { personaFor } from '../agents/registry.js';
import { normalizeEngine } from '../engines/args.js';
import { budgetStatus, recordUsage } from './costs.js';
import { now } from './db.js';
import { append } from './events.js';
import { detectLimit } from './limits.js';
import { toolsFor } from './policy.js';
import { blockTask, claimTask, finishRun, getSession, readyTasks, saveSession } from './tasks.js';

/** @typedef {import('node:sqlite').DatabaseSync} Db */
/** @typedef {import('../engines/adapter.js').Adapter} Adapter */

export const DEFAULT_PARALLEL = { claude: 1, codex: 3, antigravity: 2 };
export const DEFAULT_FALLBACK = { codex: ['claude'], antigravity: ['codex', 'claude'], claude: ['codex'] };
// claude --resume / codex resume / agy --conversation bilinmeyen oturum hataları (Paperclip isClaudeUnknownSessionError karşılığı).
const UNKNOWN_SESSION_RE = /no conversation found|session.{0,40}not found|unknown session|conversation.{0,40}not found|invalid session/i;
const EXCERPT = 2000;

/** @param {Db} db @returns {Record<string, number>} motor → açılma zamanı */
function loadDown(db) {
  try {
    const v = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'engine_down'").get()?.value ?? '{}');
    return Object.fromEntries(Object.entries(v).filter(([, at]) => Number(at) > now()));
  } catch { return {}; }
}

/** @param {Db} db @param {Record<string, number>} down */
function saveDown(db, down) {
  db.prepare("INSERT INTO meta(key, value) VALUES ('engine_down', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(down));
}

/**
 * @param {{db: Db, adapters: Record<string, Adapter>, maxParallel?: Record<string, number>, cwd: string,
 *   fallback?: Record<string, string[]>, network?: boolean, signal?: AbortSignal}} o
 * @returns {Promise<{done: number, failed: number, blocked: number, skippedBudget: number}>}
 */
export async function runReady({ db, adapters, maxParallel = DEFAULT_PARALLEL, cwd, fallback = DEFAULT_FALLBACK, network = false, signal }) {
  const down = loadDown(db);
  const isDown = (e) => (down[e] ?? 0) > now();
  const running = /** @type {Record<string, number>} */ ({});
  const limitFor = (e) => maxParallel[e] ?? DEFAULT_PARALLEL[e] ?? 1;
  const outcome = new Map(); // görev → son durum
  const active = new Set();
  let skippedBudget = 0;

  const agentOf = (id) => (id ? db.prepare('SELECT * FROM agents WHERE id = ?').get(id) : null);
  /** Görevin denenecek motorları: kendi motoru + yedekleri, adaptörü olan ve kapalı olmayanlar. */
  const chainFor = (primary) => [primary, ...(fallback[primary] ?? [])].filter((e, i, a) => a.indexOf(e) === i && adapters[e]);

  async function attempt(task, engine) {
    const agent = agentOf(task.assignee_agent_id);
    const key = { agentKey: task.assignee_agent_id ?? 'default', engine, taskKey: task.id };
    let resumeId = getSession(db, key);
    const run = claimTask(db, task.id, { engine, sessionBefore: resumeId });
    if (!run) return { status: 'lost' };
    const input = {
      prompt: task.prompt ?? task.title, persona: personaFor(agent), cwd, model: agent && agent.engine === engine ? agent.model ?? null : null,
      allowedTools: toolsFor({ engine, capabilities: agent?.capabilities }), network: network && engine === 'codex', signal,
    };
    let res = await adapters[engine].execute({ ...input, resumeId });
    if (resumeId && res.error && UNKNOWN_SESSION_RE.test(res.error)) {
      // Oturum motor tarafında yok: silinir, görev bir kez oturumsuz denenir.
      append(db, { actor: 'scheduler', type: 'session.reset', entity: 'task', entityId: task.id, data: { engine } });
      saveSession(db, key, null);
      resumeId = null;
      res = await adapters[engine].execute({ ...input, resumeId: null });
    }
    if (res.sessionId) saveSession(db, key, res.sessionId);
    const lim = res.timedOut || (!res.error && res.final != null) ? { limited: false, retryAt: null }
      : detectLimit({ error: res.error, rate: res.rate, text: res.final == null ? res.stderr : null });
    // Kullanıcı iptali (Ctrl+C) görevi bozmaz: run interrupted, görev todo'ya döner.
    const status = signal?.aborted ? 'interrupted' : res.timedOut ? 'timed_out' : !res.error && res.final != null ? 'succeeded' : lim.limited ? 'limited' : 'failed';
    // Kullanım satırı gelmediyse kayıt yok; "bilinmeyen kullanım" yalnız kullanım vermeyen motorların (agy) başarılı işlerini sayar.
    if (res.usage) recordUsage(db, { runId: run.id, agentId: task.assignee_agent_id, engine, model: agent?.model ?? null, usage: res.usage });
    finishRun(db, run.id, {
      status, exitCode: res.exitCode, error: res.error ?? (status === 'failed' ? res.stderr?.slice(-300) || 'cevap yok' : null),
      sessionAfter: res.sessionId, usage: res.usage, retryAt: lim.retryAt, stdoutExcerpt: res.text?.slice(-EXCERPT) ?? null,
      result: status === 'succeeded' ? { text: res.text } : null,
    });
    return { status, retryAt: lim.retryAt };
  }

  /** Tek deneme. Limitte motor kapanır; yedek motor varsa görev hemen yeniden hazır olur ve dış döngü
   *  onu kapasite ve bütçe kontrolünden geçirerek yedek motora verir. */
  async function work(task, engine, chain) {
    running[engine] = (running[engine] ?? 0) + 1;
    let r;
    try { r = await attempt(task, engine); } finally { running[engine]--; }
    if (r.status === 'lost') return;
    outcome.set(task.id, r.status);
    if (r.status !== 'limited') return;
    down[engine] = r.retryAt;
    saveDown(db, down);
    append(db, { actor: 'scheduler', type: 'engine.down', entity: 'engine', entityId: engine, data: { until: r.retryAt } });
    const next = chain.find((e) => !isDown(e));
    if (next && !signal?.aborted) {
      blockTask(db, task.id, { retryAt: now(), reason: `yedek motor: ${next}` });
      append(db, { actor: 'scheduler', type: 'task.fallback', entity: 'task', entityId: task.id, data: { from: engine, to: next } });
    }
  }

  while (!signal?.aborted) {
    let launched = 0;
    for (const task of readyTasks(db, { limit: 200 })) {
      const primary = normalizeEngine(task.engine ?? 'codex');
      const chain = chainFor(primary);
      const usable = chain.filter((e) => !isDown(e));
      if (!usable.length) {
        const until = chain.length ? Math.min(...chain.map((e) => down[e])) : null;
        if (until && until > (task.retry_at ?? 0)) blockTask(db, task.id, { retryAt: until, reason: 'motor limiti' });
        else if (!chain.length) blockTask(db, task.id, { retryAt: null, reason: `motor yok: ${primary}` });
        outcome.set(task.id, 'limited');
        continue;
      }
      const engine = usable[0];
      if ((running[engine] ?? 0) >= limitFor(engine)) continue;
      const budget = budgetStatus(db, { engine, agentId: task.assignee_agent_id });
      if (budget.state === 'stop') {
        blockTask(db, task.id, { retryAt: budget.resetAt, reason: 'bütçe' });
        append(db, { actor: 'scheduler', type: 'budget.blocked', entity: 'task', entityId: task.id, data: { budgetId: budget.budgetId, used: budget.used, limit: budget.limit } });
        skippedBudget++;
        outcome.set(task.id, 'limited');
        continue;
      }
      // work, ilk await'e kadar senkron çalışır: claim ve sayaç artışı bu satır dönmeden yapılmış olur.
      const p = work(task, engine, chain).finally(() => active.delete(p));
      active.add(p);
      launched++;
    }
    if (!active.size && !launched) break;
    if (active.size) await Promise.race(active);
  }
  await Promise.all(active);

  const counts = { done: 0, failed: 0, blocked: 0, skippedBudget };
  for (const s of outcome.values()) {
    if (s === 'succeeded') counts.done++;
    else if (s === 'limited') counts.blocked++;
    else if (s === 'interrupted') continue;
    else counts.failed++;
  }
  return counts;
}
