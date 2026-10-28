import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, setClock } from '../../src/core/db.js';
import { createTask, addDependency, getTask, getSession, saveSession } from '../../src/core/tasks.js';
import { setBudget, recordUsage, windowRange } from '../../src/core/costs.js';
import { runReady } from '../../src/core/scheduler.js';

const OK_USAGE = { input: 1, cachedInput: 0, cacheWrite: 0, output: 1, known: true };
const result = (o = {}) => ({ text: 'ok', final: 'ok', sessionId: null, usage: OK_USAGE, rate: null, error: null, exitCode: 0, timedOut: false, stderr: '', ...o });

/** Sahte adaptör: her çağrıyı kaydeder, cevabı fn belirler. */
function fakeAdapter(engine, fn = () => result(), delayMs = 0) {
  const calls = [];
  let active = 0;
  const a = {
    engine, calls, peak: 0,
    async execute(i) {
      calls.push(i);
      active++; a.peak = Math.max(a.peak, active);
      await new Promise((r) => setTimeout(r, delayMs));
      active--;
      return fn(i, calls.length);
    },
  };
  return a;
}

test('DAG sırası ve paralellik sınırı', async () => {
  const db = openDb();
  const order = [];
  const codex = fakeAdapter('codex', (i) => { order.push(i.prompt); return result(); }, 30);
  const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((x) => createTask(db, { title: x, prompt: x, engine: 'codex' }));
  for (const t of [a, b, c]) addDependency(db, d.id, t.id);
  const r = await runReady({ db, adapters: { codex }, maxParallel: { codex: 2 }, cwd: '.' });
  assert.equal(codex.peak, 2);
  assert.equal(order.at(-1), 'd');
  assert.equal(r.done, 4);
  db.close();
});

test('başarısız görevin bağımlısı bekler, diğerleri sürer', async () => {
  const db = openDb();
  const codex = fakeAdapter('codex', (i) => (i.prompt === 'a' ? result({ final: null, exitCode: 1, error: 'patladı' }) : result()));
  const a = createTask(db, { title: 'a', prompt: 'a', engine: 'codex' });
  const b = createTask(db, { title: 'b', prompt: 'b', engine: 'codex' });
  const c = createTask(db, { title: 'c', prompt: 'c', engine: 'codex' });
  addDependency(db, b.id, a.id);
  const r = await runReady({ db, adapters: { codex }, cwd: '.' });
  assert.equal(getTask(db, a.id).status, 'failed');
  assert.equal(getTask(db, b.id).status, 'todo');
  assert.equal(getTask(db, c.id).status, 'done');
  assert.deepEqual([r.done, r.failed], [1, 1]);
  db.close();
});

test('exit 0 ama error varsa failed', async () => {
  const db = openDb();
  const t = createTask(db, { title: 'a', engine: 'antigravity' });
  const antigravity = fakeAdapter('antigravity', () => result({ final: null, error: 'agy boş cevap döndü' }));
  await runReady({ db, adapters: { antigravity }, cwd: '.', fallback: {} });
  assert.equal(getTask(db, t.id).status, 'failed');
  db.close();
});

test('limitte görev yedek motora geçer', async () => {
  const db = openDb();
  const t = createTask(db, { title: 'a', engine: 'codex' });
  const codex = fakeAdapter('codex', () => result({ final: null, exitCode: 1, error: "You've hit your usage limit." }));
  const claude = fakeAdapter('claude');
  const r = await runReady({ db, adapters: { codex, claude }, cwd: '.' });
  assert.equal(getTask(db, t.id).status, 'done');
  const runs = db.prepare('SELECT engine, status FROM runs ORDER BY started_at, rowid').all();
  assert.deepEqual(runs.map((x) => `${x.engine}:${x.status}`), ['codex:limited', 'claude:succeeded']);
  assert.equal(r.done, 1);
  db.close();
});

test('yedek motor paralellik sınırına uyar', async () => {
  const db = openDb();
  for (const x of ['a', 'b', 'c']) createTask(db, { title: x, engine: 'codex' });
  const codex = fakeAdapter('codex', () => result({ final: null, error: 'usage limit reached', usage: null }), 20);
  const claude = fakeAdapter('claude', () => result(), 20);
  const r = await runReady({ db, adapters: { codex, claude }, maxParallel: { codex: 3, claude: 1 }, cwd: '.' });
  assert.equal(claude.peak, 1);
  assert.equal(r.done, 3);
  db.close();
});

test('yedek motora geçerken bütçe kontrol edilir', async (t) => {
  const AT = new Date(2026, 9, 28, 12).getTime();
  setClock(() => AT); t.after(() => setClock());
  const db = openDb();
  setBudget(db, { id: 'cl', scope: 'engine', scopeId: 'claude', window: 'day', limitTokens: 10 });
  recordUsage(db, { engine: 'claude', usage: { input: 10, cachedInput: 0, cacheWrite: 0, output: 0, known: true } });
  const task = createTask(db, { title: 'a', engine: 'codex' });
  const codex = fakeAdapter('codex', () => result({ final: null, error: 'usage limit reached', usage: null }));
  const claude = fakeAdapter('claude');
  const r = await runReady({ db, adapters: { codex, claude }, cwd: '.' });
  assert.equal(claude.calls.length, 0);
  assert.equal(getTask(db, task.id).status, 'blocked');
  assert.equal(r.skippedBudget, 1);
  db.close();
});

test('iptal edilen görev failed olmaz, todo\'ya döner', async () => {
  const db = openDb();
  const task = createTask(db, { title: 'a', engine: 'codex' });
  const ctrl = new AbortController();
  const codex = fakeAdapter('codex', () => { ctrl.abort(); return result({ final: null, error: 'durduruldu', exitCode: 1 }); });
  await runReady({ db, adapters: { codex }, cwd: '.', signal: ctrl.signal });
  assert.equal(getTask(db, task.id).status, 'todo');
  assert.equal(db.prepare('SELECT status FROM runs').get().status, 'interrupted');
  db.close();
});

test('yedek yoksa blocked ve retry_at dolu', async () => {
  const db = openDb();
  const t = createTask(db, { title: 'a', engine: 'codex' });
  const codex = fakeAdapter('codex', () => result({ final: null, error: 'usage limit reached', usage: null }));
  const r = await runReady({ db, adapters: { codex }, cwd: '.' });
  assert.equal(getTask(db, t.id).status, 'blocked');
  assert.ok(getTask(db, t.id).retry_at > Date.now());
  assert.equal(r.blocked, 1);
  assert.equal(db.prepare('SELECT count(*) n FROM usage').get().n, 0);
  db.close();
});

test('kapalı motor sonraki çalıştırmada atlanır', async () => {
  const db = openDb();
  createTask(db, { title: 'a', engine: 'codex' });
  const codex = fakeAdapter('codex', () => result({ final: null, error: 'usage limit reached' }));
  await runReady({ db, adapters: { codex }, cwd: '.' });
  const t2 = createTask(db, { title: 'b', engine: 'codex' });
  const claude = fakeAdapter('claude');
  await runReady({ db, adapters: { codex, claude }, cwd: '.' });
  assert.equal(codex.calls.length, 1);
  assert.equal(claude.calls.length, 1);
  assert.equal(getTask(db, t2.id).status, 'done');
  db.close();
});

test('bütçe dolu motor blocked, retry_at pencere sonu', async (t) => {
  const AT = new Date(2026, 9, 28, 12).getTime();
  setClock(() => AT); t.after(() => setClock());
  const db = openDb();
  setBudget(db, { id: 'c', scope: 'engine', scopeId: 'codex', window: 'day', limitTokens: 10 });
  recordUsage(db, { engine: 'codex', usage: { input: 10, cachedInput: 0, cacheWrite: 0, output: 0, known: true } });
  const task = createTask(db, { title: 'a', engine: 'codex' });
  const codex = fakeAdapter('codex');
  const r = await runReady({ db, adapters: { codex }, cwd: '.' });
  assert.equal(codex.calls.length, 0);
  assert.equal(getTask(db, task.id).status, 'blocked');
  assert.equal(getTask(db, task.id).retry_at, windowRange('day', AT).end);
  assert.equal(r.skippedBudget, 1);
  db.close();
});

test('ikinci çalıştırmada görev oturumu resumeId olarak gider', async (t) => {
  let clock = 1_000_000;
  setClock(() => clock); t.after(() => setClock());
  const db = openDb();
  const task = createTask(db, { title: 'a', engine: 'codex' });
  const codex = fakeAdapter('codex', (i, n) => (n === 1 ? result({ final: null, sessionId: 's1', error: 'usage limit reached' }) : result({ sessionId: 's1' })));
  await runReady({ db, adapters: { codex }, cwd: '.' });
  assert.equal(getTask(db, task.id).status, 'blocked');
  clock += 2 * 3600_000;
  await runReady({ db, adapters: { codex }, cwd: '.' });
  assert.equal(codex.calls[0].resumeId, null);
  assert.equal(codex.calls[1].resumeId, 's1');
  assert.equal(getTask(db, task.id).status, 'done');
  db.close();
});

test('bilinmeyen oturum hatasında oturumsuz bir kez yeniden dener', async () => {
  const db = openDb();
  const task = createTask(db, { title: 'a', engine: 'claude' });
  saveSession(db, { agentKey: 'default', engine: 'claude', taskKey: task.id }, 'eski');
  const claude = fakeAdapter('claude', (i) => (i.resumeId === 'eski'
    ? result({ final: null, exitCode: 1, error: 'No conversation found with session ID: eski' })
    : result({ sessionId: 'yeni' })));
  await runReady({ db, adapters: { claude }, cwd: '.' });
  assert.equal(claude.calls.length, 2);
  assert.equal(claude.calls[1].resumeId, null);
  assert.equal(getTask(db, task.id).status, 'done');
  assert.equal(getSession(db, { agentKey: 'default', engine: 'claude', taskKey: task.id }), 'yeni');
  db.close();
});

test('zaman aşımı timed_out ve görev failed', async () => {
  const db = openDb();
  const task = createTask(db, { title: 'a', engine: 'codex' });
  const codex = fakeAdapter('codex', () => result({ final: 'yarım', timedOut: true, exitCode: null }));
  await runReady({ db, adapters: { codex }, cwd: '.' });
  assert.equal(db.prepare('SELECT status FROM runs').get().status, 'timed_out');
  assert.equal(getTask(db, task.id).status, 'failed');
  db.close();
});

test('claude ajanına araç listesi ve persona gider', async () => {
  const db = openDb();
  db.prepare("INSERT INTO agents(id, workspace_id, name, engine, capabilities, persona) VALUES ('rev', 'default', 'Ters', 'claude', '[\"reverse\"]', 'Sen tersçisin')").run();
  createTask(db, { title: 'a', engine: 'claude', assigneeAgentId: 'rev' });
  const claude = fakeAdapter('claude');
  await runReady({ db, adapters: { claude }, cwd: '.' });
  assert.equal(claude.calls[0].persona, 'Sen tersçisin');
  assert.ok(claude.calls[0].allowedTools.includes('mcp__rea'));
  db.close();
});
