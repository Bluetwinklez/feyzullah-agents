import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, setClock } from '../../src/core/db.js';
import { recordUsage, setBudget, budgetStatus, windowRange } from '../../src/core/costs.js';
import { detectLimit, limitUntil } from '../../src/core/limits.js';

const AT = new Date(2026, 9, 28, 12, 0, 0).getTime(); // yerel 28 Ekim 2026 12:00
const u = (input, output, extra = {}) => ({ input, cachedInput: 0, cacheWrite: 0, output, known: true, ...extra });

test('%80 uyarı, %100 durdurma', (t) => {
  setClock(() => AT); t.after(() => setClock());
  const db = openDb();
  setBudget(db, { id: 'g', scope: 'global', window: 'day', limitTokens: 1000 });
  recordUsage(db, { engine: 'codex', usage: u(500, 200) });
  assert.equal(budgetStatus(db).state, 'ok');
  recordUsage(db, { engine: 'codex', usage: u(0, 50, { cacheWrite: 50 }) });
  const w = budgetStatus(db);
  assert.equal(w.state, 'warn');
  assert.equal(w.used, 800);
  recordUsage(db, { engine: 'codex', usage: u(200, 0) });
  const s = budgetStatus(db);
  assert.equal(s.state, 'stop');
  assert.equal(s.budgetId, 'g');
  db.close();
});

test('cachedInput bütçeye girmez', (t) => {
  setClock(() => AT); t.after(() => setClock());
  const db = openDb();
  setBudget(db, { id: 'g', scope: 'global', window: 'day', limitTokens: 100 });
  recordUsage(db, { engine: 'claude', usage: u(10, 5, { cachedInput: 100000 }) });
  assert.equal(budgetStatus(db).used, 15);
  db.close();
});

test('motor bütçesi yalnız o motoru durdurur', (t) => {
  setClock(() => AT); t.after(() => setClock());
  const db = openDb();
  setBudget(db, { id: 'c', scope: 'engine', scopeId: 'codex', window: 'day', limitTokens: 100 });
  recordUsage(db, { engine: 'codex', usage: u(100, 0) });
  assert.equal(budgetStatus(db, { engine: 'codex' }).state, 'stop');
  assert.equal(budgetStatus(db, { engine: 'claude' }).state, 'ok');
  db.close();
});

test('ajan bütçesi yalnız o ajanın kullanımını sayar', (t) => {
  setClock(() => AT); t.after(() => setClock());
  const db = openDb();
  setBudget(db, { id: 'a', scope: 'agent', scopeId: 'x', window: 'month', limitTokens: 100 });
  recordUsage(db, { engine: 'codex', agentId: 'y', usage: u(500, 0) });
  assert.equal(budgetStatus(db, { agentId: 'x' }).state, 'ok');
  recordUsage(db, { engine: 'codex', agentId: 'x', usage: u(100, 0) });
  assert.equal(budgetStatus(db, { agentId: 'x' }).state, 'stop');
  db.close();
});

test('agy kayıtları unknownRuns olarak sayılır', (t) => {
  setClock(() => AT); t.after(() => setClock());
  const db = openDb();
  setBudget(db, { id: 'g', scope: 'global', window: 'day', limitTokens: 100 });
  recordUsage(db, { engine: 'antigravity', usage: { input: 0, cachedInput: 0, cacheWrite: 0, output: 0, known: false } });
  const s = budgetStatus(db);
  assert.equal(s.unknownRuns, 1);
  assert.equal(s.used, 0);
  db.close();
});

test('hardStop kapalıysa sınır aşılsa da warn', (t) => {
  setClock(() => AT); t.after(() => setClock());
  const db = openDb();
  setBudget(db, { id: 'g', scope: 'global', window: 'day', limitTokens: 100, hardStop: false });
  recordUsage(db, { engine: 'codex', usage: u(500, 0) });
  assert.equal(budgetStatus(db).state, 'warn');
  db.close();
});

test('bütçe yoksa ok ve limit null', () => {
  const db = openDb();
  const s = budgetStatus(db);
  assert.equal(s.state, 'ok');
  assert.equal(s.limit, null);
  assert.equal(s.resetAt, null);
  db.close();
});

test('dünkü kullanım günlük pencereye girmez', (t) => {
  setClock(() => AT - 24 * 3600_000); t.after(() => setClock());
  const db = openDb();
  setBudget(db, { id: 'g', scope: 'global', window: 'day', limitTokens: 100 });
  recordUsage(db, { engine: 'codex', usage: u(500, 0) });
  setClock(() => AT);
  assert.equal(budgetStatus(db).state, 'ok');
  db.close();
});

test('günlük bütçe resetAt ertesi gece yarısı', () => {
  assert.equal(windowRange('day', AT).end, new Date(2026, 9, 29).getTime());
  assert.equal(windowRange('day', AT).start, new Date(2026, 9, 28).getTime());
  assert.equal(windowRange('month', AT).end, new Date(2026, 10, 1).getTime());
});

test('detectLimit usage limit metnini yakalar', () => {
  const at = AT;
  assert.equal(detectLimit({ error: "You've hit your usage limit. Try again at 7:52 AM." }, at).limited, true);
  assert.equal(detectLimit({ error: 'Claude AI usage limit reached|1761700000' }, at).retryAt, 1761700000 * 1000);
  assert.equal(detectLimit({ error: 'Quota exceeded for this project' }, at).retryAt, at + 60 * 60_000);
  assert.equal(detectLimit({ error: 'sözdizimi hatası' }, at).limited, false);
  assert.equal(detectLimit({}, at).limited, false);
});

test('rate resetsAt saatini kullanır, allowed olay limit değildir', () => {
  assert.deepEqual(detectLimit({ rate: { status: 'rejected', resetsAt: 1761700000 } }, AT), { limited: true, retryAt: 1761700000 * 1000 });
  assert.equal(detectLimit({ rate: { status: 'allowed', resetsAt: 1761700000 } }, AT).limited, false);
  assert.equal(detectLimit({ rate: { status: 'allowed_warning' } }, AT).limited, false);
});

test('try again at saati okunur, geçtiyse ertesi gün', () => {
  assert.equal(limitUntil('Try again at 7:52 PM', AT), new Date(2026, 9, 28, 19, 52).getTime());
  assert.equal(limitUntil('try again at 7:52 AM', AT), new Date(2026, 9, 29, 7, 52).getTime());
  assert.equal(limitUntil('try again at 12:05 AM', AT), new Date(2026, 9, 29, 0, 5).getTime());
  assert.equal(limitUntil('bekle', AT), AT + 60 * 60_000);
});
