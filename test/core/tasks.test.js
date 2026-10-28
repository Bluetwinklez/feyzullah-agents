import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../src/core/db.js';
import { since } from '../../src/core/events.js';
import {
  createTask, addDependency, readyTasks, claimTask, finishRun, recoverStale, getSession, saveSession, getTask, blockTask,
} from '../../src/core/tasks.js';

const ids = (list) => list.map((t) => t.id);

test('bağımlılığı bitmemiş görev hazır değil', () => {
  const db = openDb();
  const a = createTask(db, { title: 'a' });
  const b = createTask(db, { title: 'b' });
  addDependency(db, b.id, a.id);
  assert.deepEqual(ids(readyTasks(db)), [a.id]);
  db.close();
});

test('döngü reddedilir ve tablo değişmez', () => {
  const db = openDb();
  const a = createTask(db, { title: 'a' });
  const b = createTask(db, { title: 'b' });
  const c = createTask(db, { title: 'c' });
  addDependency(db, b.id, a.id);
  addDependency(db, c.id, b.id);
  assert.throws(() => addDependency(db, a.id, c.id), /döngü/);
  assert.equal(db.prepare('SELECT count(*) n FROM task_deps').get().n, 2);
  db.close();
});

test('aynı görevi ikinci claim alamaz ve yetim run kalmaz', () => {
  const db = openDb();
  const t = createTask(db, { title: 'a' });
  const run = claimTask(db, t.id, { engine: 'codex' });
  assert.ok(run);
  assert.equal(run.status, 'running');
  assert.equal(claimTask(db, t.id, { engine: 'codex' }), null);
  assert.equal(db.prepare('SELECT count(*) n FROM runs').get().n, 1);
  const got = getTask(db, t.id);
  assert.equal(got.status, 'in_progress');
  assert.equal(got.attempts, 1);
  assert.equal(got.checkout_run_id, run.id);
  db.close();
});

test('finishRun succeeded bağımlıyı hazırlar', () => {
  const db = openDb();
  const a = createTask(db, { title: 'a' });
  const b = createTask(db, { title: 'b' });
  addDependency(db, b.id, a.id);
  const run = claimTask(db, a.id, { engine: 'codex' });
  finishRun(db, run.id, { status: 'succeeded', exitCode: 0, result: { text: 'ok' } });
  assert.equal(getTask(db, a.id).status, 'done');
  assert.equal(getTask(db, a.id).checkout_run_id, null);
  assert.deepEqual(JSON.parse(getTask(db, a.id).result), { text: 'ok' });
  assert.deepEqual(ids(readyTasks(db)), [b.id]);
  assert.ok(since(db, 0).some((e) => e.type === 'task.done'));
  db.close();
});

test('limited görev retry_at gelince yeniden hazır', () => {
  const db = openDb();
  const t = createTask(db, { title: 'a' });
  const run = claimTask(db, t.id, { engine: 'codex' });
  finishRun(db, run.id, { status: 'limited', retryAt: 1000, error: 'usage limit' });
  assert.equal(getTask(db, t.id).status, 'blocked');
  assert.deepEqual(readyTasks(db, { at: 999 }), []);
  assert.deepEqual(ids(readyTasks(db, { at: 1000 })), [t.id]);
  assert.ok(claimTask(db, t.id, { engine: 'claude' }));
  db.close();
});

test('failed ve cancelled görev durumuna yansır', () => {
  const db = openDb();
  const a = createTask(db, { title: 'a' });
  const b = createTask(db, { title: 'b' });
  finishRun(db, claimTask(db, a.id, { engine: 'codex' }).id, { status: 'timed_out' });
  finishRun(db, claimTask(db, b.id, { engine: 'codex' }).id, { status: 'cancelled' });
  assert.equal(getTask(db, a.id).status, 'failed');
  assert.equal(getTask(db, b.id).status, 'cancelled');
  db.close();
});

test('blockTask claim edilmemiş görevi bekletir', () => {
  const db = openDb();
  const t = createTask(db, { title: 'a' });
  blockTask(db, t.id, { retryAt: 500, reason: 'bütçe' });
  assert.equal(getTask(db, t.id).status, 'blocked');
  assert.deepEqual(readyTasks(db, { at: 100 }), []);
  assert.deepEqual(ids(readyTasks(db, { at: 500 })), [t.id]);
  db.close();
});

test('recoverStale takılı run\'ı interrupted, görevi todo yapar', () => {
  const db = openDb();
  const t = createTask(db, { title: 'a' });
  const run = claimTask(db, t.id, { engine: 'codex' });
  assert.equal(recoverStale(db), 1);
  assert.equal(db.prepare('SELECT status FROM runs WHERE id = ?').get(run.id).status, 'interrupted');
  assert.equal(getTask(db, t.id).status, 'todo');
  assert.equal(getTask(db, t.id).checkout_run_id, null);
  assert.equal(recoverStale(db), 0);
  db.close();
});

test('görev oturumu kaydedilir ve okunur', () => {
  const db = openDb();
  const key = { agentKey: 'scripter', engine: 'codex', taskKey: 't1' };
  assert.equal(getSession(db, key), null);
  saveSession(db, key, 's1');
  saveSession(db, key, 's2');
  assert.equal(getSession(db, key), 's2');
  saveSession(db, key, null);
  assert.equal(getSession(db, key), null);
  db.close();
});
