import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { loadAgents, syncAgents } from '../../src/agents/registry.js';
import { openDb } from '../../src/core/db.js';
import { createTask, getTask } from '../../src/core/tasks.js';
import { createSantral } from '../../src/server/http.js';

const UI = join(import.meta.dirname, '..', '..', 'src', 'ui', 'santral.html');
const ok = (final) => ({ text: final, final, sessionId: null, usage: { input: 10, cachedInput: 0, cacheWrite: 0, output: 5, known: true }, rate: null, error: null, exitCode: 0, timedOut: false, stderr: '' });

async function setup(t, extra = {}) {
  const db = openDb();
  syncAgents(db, loadAgents([join(import.meta.dirname, '..', '..', 'agents')]));
  const plan = { reply: 'İki iş açtım.', tasks: [
    { key: 'a', title: 'Veri çek', prompt: 'veriyi çek', engine: 'codex', review: false },
    { key: 'b', title: 'Rapor yaz', prompt: 'rapor yaz', engine: 'codex', after: ['a'], review: false },
  ] };
  const llm = async ({ prompt }) => (/Sen yöneticisin/.test(prompt) ? `\`\`\`json\n${JSON.stringify(plan)}\n\`\`\`` : 'Rapor: iki iş bitti. Veri temiz.');
  const codex = { engine: 'codex', execute: async (i) => ok(`bitti: ${i.prompt.split('\n')[0]}`) };
  const s = createSantral({ db, adapters: { codex }, llm, cwd: '.', port: 0, tickMs: 1e9, ...extra });
  const base = await s.listen();
  t.after(async () => { await s.close(); db.close(); });
  const call = async (path, { method = 'GET', body, token = s.token, headers = {} } = {}) => {
    const r = await fetch(new URL(path, base), { method, headers: { ...(token ? { 'x-fa-token': token } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, data: await r.json().catch(() => null), text: r.headers.get('content-type')?.includes('html') ? await r.text() : null };
  };
  return { db, s, base, call };
}

const until = async (fn, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 20)); }
  throw new Error('zaman aşımı');
};

test('arayüz 60 KB altında, harici betik ve yazı tipi yok', () => {
  assert.ok(statSync(UI).size < 60 * 1024);
});

test('jeton olmadan API kapalı, yanlış Host reddedilir', async (t) => {
  const { call, base, s } = await setup(t);
  assert.equal((await call('/api/state', { token: null })).status, 401);
  assert.equal((await call('/api/state', { token: 'yanlis' })).status, 401);
  // DNS rebinding: başka bir ad üzerinden gelen istek.
  const status = await new Promise((resolve) => {
    const u = new URL(base);
    request({ host: u.hostname, port: u.port, path: '/api/state', headers: { host: 'kotu.example:80', 'x-fa-token': s.token } }, (r) => { r.resume(); resolve(r.statusCode); }).end();
  });
  assert.equal(status, 421);
  const page = await fetch(base);
  const html = await page.text();
  assert.ok(html.includes(s.token), 'arayüz jetonu taşır');
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
});

test('ağa açıkken arayüz de jeton ister', async (t) => {
  const { base, s } = await setup(t, { host: '0.0.0.0' });
  const u = new URL(base.replace('0.0.0.0', '127.0.0.1'));
  assert.equal((await fetch(new URL('/', u))).status, 401);
  assert.equal((await fetch(new URL(`/?t=${s.token}`, u))).status, 200);
});

test('sohbet hedef açar, yönetici planlar, işler biter, rapor ve konuşma görünür', async (t) => {
  const { call } = await setup(t);
  const r = await call('/api/chat', { method: 'POST', body: { text: 'NBL sezon raporu hazırla' } });
  assert.equal(r.status, 202);
  const goalId = r.data.goalId;
  const g = await until(async () => { const v = (await call(`/api/goals/${goalId}`)).data; return v.goal.status === 'done' ? v : null; });
  assert.equal(g.tasks.length, 2);
  assert.ok(g.tasks.every((x) => x.status === 'done' && x.started_at && x.finished_at));
  assert.equal(g.deps.length, 1);
  assert.match(g.report, /iki iş bitti/);
  assert.deepEqual(g.comments.map((c) => c.author), ['kullanıcı', 'yönetici']);
  const st = (await call('/api/state')).data;
  assert.equal(st.counts.done, 2);
  assert.equal(st.tokensToday, 30);
  assert.ok(st.agents.length >= 11);
  const tv = (await call(`/api/tasks/${g.tasks[0].id}`)).data;
  assert.equal(tv.runs.length, 1);
  assert.match(tv.task.result.text, /bitti/);
});

test('onay kartı arayüzden onaylanır ve plan çalışır', async (t) => {
  const { db, call } = await setup(t);
  const { planGoal } = await import('../../src/core/orchestrator.js');
  const { createGoal } = await import('../../src/core/board.js');
  const goal = createGoal(db, { title: 'onaylı iş' });
  const llm = async () => '```json\n{"tasks":[{"key":"a","title":"x","prompt":"x","engine":"codex","review":false}]}\n```';
  const p = await planGoal({ db, goalId: goal.id, llm, requireApproval: true });
  const st = (await call('/api/state')).data;
  assert.equal(st.approvals[0].action, 'plan.approve');
  assert.equal((await call(`/api/approvals/${p.approvalId}`, { method: 'POST', body: { approve: true } })).status, 200);
  await until(() => getTask(db, p.taskIds[0]).status === 'done');
  assert.equal((await call(`/api/approvals/${p.approvalId}`, { method: 'POST', body: { approve: true } })).status, 409);
});

test('pasaj ve satır yorumu kaydedilir, uyandırma işi yeniden çalıştırır', async (t) => {
  const { db, call } = await setup(t);
  const task = createTask(db, { title: 'yaz', prompt: 'yaz', engine: 'codex' });
  await call('/api/run', { method: 'POST' });
  await until(() => getTask(db, task.id).status === 'done');
  const c = await call('/api/comments', { method: 'POST', body: { entity: 'task', entityId: task.id, body: 'başlığı düzelt', anchor: { file: 'a.md', line: 3 }, wake: true } });
  assert.equal(c.status, 201);
  await until(() => db.prepare('SELECT count(*) n FROM runs WHERE task_id = ?').get(task.id).n === 2 && getTask(db, task.id).status === 'done');
  const tv = (await call(`/api/tasks/${task.id}`)).data;
  assert.deepEqual(tv.comments[0].anchor, { file: 'a.md', line: 3, quote: null, doc: null });
  assert.equal((await call('/api/comments', { method: 'POST', body: { entity: 'x', entityId: '1', body: 'a' } })).status, 400);
  assert.equal((await call('/api/comments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: { entity: 'task', entityId: task.id, body: 'x'.repeat(70_000) } })).status, 413);
});

test('SSE yeni olayları sırayla iletir ve kaldığı yerden devam eder', async (t) => {
  const { db, base, s } = await setup(t);
  const { append } = await import('../../src/core/events.js');
  const last = db.prepare('SELECT max(seq) m FROM events').get().m ?? 0;
  const ctrl = new AbortController();
  t.after(() => ctrl.abort());
  const r = await fetch(new URL(`/api/events?t=${s.token}&since=${last}`, base), { signal: ctrl.signal });
  assert.match(r.headers.get('content-type'), /event-stream/);
  const reader = r.body.getReader();
  append(db, { type: 'deneme.bir' });
  append(db, { type: 'deneme.iki' });
  let buf = '';
  const dec = new TextDecoder();
  while (!/deneme\.iki/.test(buf)) buf += dec.decode((await reader.read()).value);
  const ids = [...buf.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1]));
  assert.deepEqual(ids, [last + 1, last + 2]);
  assert.match(buf, /"type":"deneme.bir"/);
});
