import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, tx, schemaVersion } from '../../src/core/db.js';

const TABLES = ['workspaces', 'agents', 'tasks', 'task_deps', 'runs', 'task_sessions', 'events', 'usage', 'budgets', 'meta'];

test('şema kurulur ve sürüm 1', () => {
  const db = openDb();
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  for (const t of TABLES) assert.ok(names.includes(t), t);
  assert.equal(schemaVersion(db), 1);
  assert.equal(db.prepare("SELECT kind FROM workspaces WHERE id='default'").get().kind, 'generic');
  db.close();
});

test('dosya veritabanı WAL ve busy_timeout 5000, ikinci açılış göç tekrarlamaz', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fa-db-'));
  try {
    const path = join(dir, 'a.db');
    const a = openDb(path);
    assert.equal(a.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
    assert.equal(a.prepare('PRAGMA busy_timeout').get().timeout, 5000);
    a.close();
    const b = openDb(path);
    assert.equal(schemaVersion(b), 1);
    assert.equal(b.prepare("SELECT count(*) n FROM workspaces").get().n, 1);
    b.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('tx hata atınca geri alır', () => {
  const db = openDb();
  assert.throws(() => tx(db, () => {
    db.prepare("INSERT INTO meta(key, value) VALUES ('x', '1')").run();
    throw new Error('dur');
  }), /dur/);
  assert.equal(db.prepare("SELECT count(*) n FROM meta WHERE key='x'").get().n, 0);
  assert.equal(tx(db, () => 7), 7);
  db.close();
});

test('öz bağımlılık CHECK ile reddedilir', () => {
  const db = openDb();
  db.prepare("INSERT INTO tasks(id, workspace_id, title, status, created_at, updated_at) VALUES ('t1', 'default', 'a', 'todo', 1, 1)").run();
  assert.throws(() => db.prepare("INSERT INTO task_deps(task_id, depends_on) VALUES ('t1', 't1')").run(), /CHECK/);
  db.close();
});
