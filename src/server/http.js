// Santral sunucusu: yerel HTTP API + SSE olay akışı + tek dosyalık arayüz. Bağımlılık yok (node:http).
// Güvenlik: varsayılan yalnız 127.0.0.1; her /api isteği X-FA-Token ister (başka sitenin sayfası bu başlığı
// gönderemez, CORS yanıtı verilmez); Host başlığı denetlenir (DNS rebinding). Ağa açılınca arayüz de ?t=<jeton> ister.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer as createHttp } from 'node:http';
import { join } from 'node:path';
import { activeAgents, orgChart } from '../agents/registry.js';
import { addComment, createGoal, getDocument, getGoal, goalProgress, listComments, pendingApprovals } from '../core/board.js';
import { budgetForecast, budgetStatus } from '../core/costs.js';
import { now } from '../core/db.js';
import { append, since } from '../core/events.js';
import { drive, planGoal, wakeWithComment } from '../core/orchestrator.js';
import { getTask } from '../core/tasks.js';
import { resolveApproval } from '../ops/gate.js';
import { listRoutines, tickRoutines } from '../ops/routines.js';

/** @typedef {import('node:sqlite').DatabaseSync} Db */

const UI_FILE = join(import.meta.dirname, '..', 'ui', 'santral.html');
const MAX_BODY = 64 * 1024;
const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

class HttpError extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}

/** Görev listesi satırı: zaman çizelgesi için ilk başlama ve son bitiş. */
const TASK_ROWS = `SELECT t.id, t.title, t.status, t.engine, t.assignee_agent_id agent, t.goal_id, t.attempts, t.review_round, t.created_at, t.updated_at,
    (SELECT min(started_at) FROM runs r WHERE r.task_id = t.id) started_at,
    (SELECT max(COALESCE(finished_at, 0)) FROM runs r WHERE r.task_id = t.id) finished_at,
    (SELECT engine FROM runs r WHERE r.task_id = t.id ORDER BY started_at DESC LIMIT 1) last_engine
  FROM tasks t`;

/**
 * @param {{db: Db, adapters: Record<string, any>, llm: any, cwd: string, knowledge?: any, vault?: any, driveOpts?: object,
 *   host?: string, port?: number, token?: string|null, tickMs?: number}} o
 */
export function createSantral({ db, adapters, llm, cwd, knowledge = null, vault = null, driveOpts = {}, host = '127.0.0.1', port = 4317, token = null, tickMs = 60_000 }) {
  const secret = token ?? randomBytes(18).toString('base64url');
  const loopbackOnly = LOOPBACK.has(host);
  let actualPort = port;

  // Tek yürütme döngüsü: istek geldikçe yeniden tetiklenir, aynı anda iki drive koşmaz.
  let driving = null;
  let again = false;
  const ctrl = new AbortController();
  function kick() {
    if (driving) { again = true; return driving; }
    driving = (async () => {
      do {
        again = false;
        try {
          await drive({ db, adapters, llm, cwd, signal: ctrl.signal, knowledge, vault, ...driveOpts });
        } catch (err) {
          append(db, { actor: 'santral', type: 'drive.failed', data: { error: err.message } });
        }
      } while (again && !ctrl.signal.aborted);
    })().finally(() => { driving = null; });
    return driving;
  }

  async function chat(text) {
    const title = String(text ?? '').trim();
    if (!title) throw new HttpError(400, 'metin gerekli');
    const goal = createGoal(db, { title: title.slice(0, 200), description: title.length > 200 ? title : null });
    addComment(db, { entity: 'goal', entityId: goal.id, author: 'kullanıcı', body: title });
    // Planlama arka planda: istek hemen döner, ilerleme SSE ile gelir.
    (async () => {
      let context = '';
      if (knowledge) context = (await knowledge.contextFor(title).catch(() => ({ text: '' }))).text;
      const p = await planGoal({ db, goalId: goal.id, llm, agents: activeAgents(db), knowledge: context });
      addComment(db, { entity: 'goal', entityId: goal.id, author: 'yönetici', body: p.reply || 'Plan hazır.' });
      if (!p.approvalId) kick();
    })().catch((err) => {
      addComment(db, { entity: 'goal', entityId: goal.id, author: 'yönetici', body: `Planlanamadı: ${err.message}` });
      append(db, { actor: 'santral', type: 'plan.failed', entity: 'goal', entityId: goal.id, data: { error: err.message } });
    });
    return { goalId: goal.id };
  }

  function state() {
    const day = new Date(now()); day.setHours(0, 0, 0, 0);
    const counts = Object.fromEntries(db.prepare('SELECT status, count(*) n FROM tasks GROUP BY status').all().map((r) => [r.status, r.n]));
    const tokens = db.prepare('SELECT COALESCE(SUM(input + cache_write + output), 0) n FROM usage WHERE at >= ?').get(day.getTime()).n;
    const goals = db.prepare('SELECT * FROM goals ORDER BY created_at DESC LIMIT 30').all().map((g) => ({ ...g, progress: goalProgress(db, g.id) }));
    return {
      now: now(),
      counts, tokensToday: Number(tokens), running: counts.in_progress ?? 0, driving: Boolean(driving),
      goals,
      approvals: pendingApprovals(db).map((a) => ({ ...a, payload: a.payload ? JSON.parse(a.payload) : null })),
      agents: activeAgents(db).map(({ id, name, department, engine, model, reports_to }) => ({ id, name, department, engine, model, reports_to })),
      budget: budgetStatus(db), forecast: budgetForecast(db),
      routines: listRoutines(db).map(({ id, name, cron, kind, enabled, next_run_at, when_free, engine }) => ({ id, name, cron, kind, enabled, next_run_at, when_free, engine })),
      knowledge: db.prepare('SELECT id, title, warning, fetched_at FROM knowledge_pages ORDER BY fetched_at DESC LIMIT 8').all(),
      lastSeq: db.prepare('SELECT max(seq) m FROM events').get().m ?? 0,
    };
  }

  function goalView(id) {
    const goal = getGoal(db, id);
    if (!goal) throw new HttpError(404, 'hedef yok');
    const tasks = db.prepare(`${TASK_ROWS} WHERE t.goal_id = ? ORDER BY t.created_at, t.rowid`).all(id);
    const ids = tasks.map((t) => t.id);
    const deps = ids.length ? db.prepare(`SELECT task_id, depends_on FROM task_deps WHERE task_id IN (${ids.map(() => '?').join(',')})`).all(...ids) : [];
    const doc = (n) => getDocument(db, 'goal', id, n);
    return {
      goal: { ...goal, checks: goal.checks ? JSON.parse(goal.checks) : null }, tasks, deps,
      report: doc('rapor')?.body ?? null, plan: doc('plan')?.body ?? null, integration: doc('butunlesme')?.body ?? null,
      comments: listComments(db, 'goal', id),
    };
  }

  function taskView(id) {
    const task = getTask(db, id);
    if (!task) throw new HttpError(404, 'görev yok');
    const runs = db.prepare('SELECT id, engine, status, error, started_at, finished_at, last_output_at, usage FROM runs WHERE task_id = ? ORDER BY started_at').all(id)
      .map((r) => ({ ...r, usage: r.usage ? JSON.parse(r.usage) : null }));
    return {
      task: { ...task, result: task.result ? JSON.parse(task.result) : null, checks: task.checks ? JSON.parse(task.checks) : null },
      runs, review: getDocument(db, 'task', id, 'kontrol')?.body ?? null, brief: getDocument(db, 'task', id, 'talimat')?.body ?? null,
      comments: listComments(db, 'task', id),
      worktree: db.prepare('SELECT branch, status, path FROM worktrees WHERE task_id = ?').get(id) ?? null,
      deps: db.prepare('SELECT depends_on FROM task_deps WHERE task_id = ?').all(id).map((r) => r.depends_on),
    };
  }

  const authOk = (got) => {
    const a = Buffer.from(String(got ?? ''));
    const b = Buffer.from(secret);
    return a.length === b.length && timingSafeEqual(a, b);
  };
  const hostOk = (h) => {
    if (!loopbackOnly) return true;
    const name = String(h ?? '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    return LOOPBACK.has(name);
  };

  async function body(req) {
    let size = 0;
    const chunks = [];
    for await (const c of req) {
      size += c.length;
      if (size > MAX_BODY) throw new HttpError(413, 'gövde çok büyük');
      chunks.push(c);
    }
    if (!chunks.length) return {};
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'geçersiz JSON'); }
  }

  function sse(req, res, url) {
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' });
    let seq = Number(req.headers['last-event-id'] ?? url.searchParams.get('since') ?? 0) || 0;
    const push = () => {
      for (const e of since(db, seq, 200)) {
        seq = e.seq;
        // "event:" alanı yok: istemci tek onmessage ile hepsini alır, tür data.type içinde.
        res.write(`id: ${e.seq}\ndata: ${JSON.stringify(e)}\n\n`);
      }
    };
    push();
    // Başka bir `fa` süreci de yazabilir: veritabanı kısa aralıkla yoklanır, yalnız yeni olaylar gider.
    const poll = setInterval(push, 500);
    const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
    req.on('close', () => { clearInterval(poll); clearInterval(ping); });
  }

  async function api(req, res, url) {
    const parts = url.pathname.split('/').filter(Boolean).slice(1);
    const m = req.method;
    const send = (status, data) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)); };
    if (m === 'GET' && parts[0] === 'state') return send(200, state());
    if (m === 'GET' && parts[0] === 'events') return sse(req, res, url);
    if (m === 'GET' && parts[0] === 'goals' && parts[1]) return send(200, goalView(parts[1]));
    if (m === 'GET' && parts[0] === 'tasks' && parts[1]) return send(200, taskView(parts[1]));
    if (m === 'GET' && parts[0] === 'org') return send(200, { text: orgChart(db) });
    if (m === 'POST' && parts[0] === 'chat') return send(202, await chat((await body(req)).text));
    if (m === 'POST' && parts[0] === 'run') { kick(); return send(202, { ok: true }); }
    if (m === 'POST' && parts[0] === 'approvals' && parts[1]) {
      const b = await body(req);
      let a;
      try { a = resolveApproval(db, parts[1], { approve: Boolean(b.approve), by: 'santral', note: b.note ?? null }); } catch (err) { throw new HttpError(409, err.message); }
      if (b.approve) kick();
      return send(200, { action: a.action });
    }
    if (m === 'POST' && parts[0] === 'comments') {
      const b = await body(req);
      if (!['task', 'goal'].includes(b.entity) || !b.entityId || !String(b.body ?? '').trim()) throw new HttpError(400, 'entity, entityId ve body gerekli');
      const anchor = b.anchor && typeof b.anchor === 'object'
        ? { file: b.anchor.file ?? null, line: b.anchor.line ?? null, quote: b.anchor.quote ? String(b.anchor.quote).slice(0, 500) : null, doc: b.anchor.doc ?? null } : null;
      const id = addComment(db, { entity: b.entity, entityId: b.entityId, author: 'kullanıcı', body: String(b.body).slice(0, 8000), anchor });
      if (b.wake && b.entity === 'task') { wakeWithComment(db, b.entityId); kick(); }
      return send(201, { id });
    }
    throw new HttpError(404, 'yok');
  }

  const server = createHttp(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    try {
      if (!hostOk(req.headers.host)) throw new HttpError(421, 'host reddedildi');
      if (url.pathname === '/' || url.pathname === '/index.html') {
        if (!loopbackOnly && !authOk(url.searchParams.get('t'))) throw new HttpError(401, 'jeton gerekli: ?t=');
        const html = readFileSync(UI_FILE, 'utf8').replace('__FA_TOKEN__', secret);
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer',
          'content-security-policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'" });
        return res.end(html);
      }
      if (url.pathname.startsWith('/api/')) {
        // EventSource başlık gönderemez: olay akışı için jeton sorgu parametresinde de kabul edilir.
        const t = req.headers['x-fa-token'] ?? (url.pathname === '/api/events' ? url.searchParams.get('t') : null);
        if (!authOk(t)) throw new HttpError(401, 'jeton gerekli');
        return await api(req, res, url);
      }
      throw new HttpError(404, 'yok');
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) append(db, { actor: 'santral', type: 'http.error', data: { path: url.pathname, error: err.message } });
      if (!res.headersSent) res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: status === 500 ? 'sunucu hatası' : err.message }));
    }
  });

  // Rutinler dakikada bir; zamanı gelen hedef planlanır, görev kuyruğa girer.
  const tick = setInterval(async () => {
    try {
      const fired = tickRoutines(db).filter((f) => !f.skipped);
      for (const f of fired) if (f.kind === 'goal') await planGoal({ db, goalId: f.entityId, llm, agents: activeAgents(db) }).catch(() => {});
      if (fired.length) kick();
    } catch (err) { append(db, { actor: 'santral', type: 'routine.tick_failed', data: { error: err.message } }); }
  }, tickMs);
  tick.unref?.();

  return {
    token: secret,
    kick,
    listen: () => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        actualPort = /** @type {any} */ (server.address()).port;
        resolve(`http://${host.includes(':') ? `[${host}]` : host}:${actualPort}/${loopbackOnly ? '' : `?t=${secret}`}`);
      });
    }),
    get port() { return actualPort; },
    async close() {
      clearInterval(tick);
      ctrl.abort();
      server.closeAllConnections?.();
      await new Promise((r) => server.close(() => r(null)));
      if (driving) await driving.catch(() => {});
    },
  };
}
