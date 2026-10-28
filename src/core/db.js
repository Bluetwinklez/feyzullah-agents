// Kalıcı durum: node:sqlite (DatabaseSync), dosyada WAL. Yazmalar tx() ile BEGIN IMMEDIATE altında yapılır.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** Testte değiştirilebilsin diye zaman tek yerden gelir. */
let clock = () => Date.now();
export const now = () => clock();
/** Yalnız testler için: saati sabitler ya da (fn verilmezse) gerçek saate döndürür. */
export function setClock(fn) { clock = fn ?? (() => Date.now()); }

const MIGRATIONS = [
  // 1: çekirdek tablolar
  `
  CREATE TABLE workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, root TEXT, kind TEXT NOT NULL DEFAULT 'generic', created_at INTEGER NOT NULL);
  CREATE TABLE agents (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), name TEXT NOT NULL, engine TEXT NOT NULL, model TEXT,
    department TEXT, reports_to TEXT REFERENCES agents(id), capabilities TEXT NOT NULL DEFAULT '[]', persona TEXT
  );
  CREATE TABLE tasks (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), title TEXT NOT NULL, prompt TEXT, status TEXT NOT NULL,
    engine TEXT, assignee_agent_id TEXT REFERENCES agents(id), parent_id TEXT REFERENCES tasks(id), goal_id TEXT,
    checkout_run_id TEXT, locked_at INTEGER, retry_at INTEGER, attempts INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, result TEXT
  );
  CREATE INDEX tasks_status ON tasks(status, created_at);
  CREATE TABLE task_deps (
    task_id TEXT NOT NULL REFERENCES tasks(id), depends_on TEXT NOT NULL REFERENCES tasks(id),
    PRIMARY KEY (task_id, depends_on), CHECK (task_id <> depends_on)
  );
  CREATE INDEX task_deps_on ON task_deps(depends_on);
  CREATE TABLE runs (
    id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), engine TEXT NOT NULL, status TEXT NOT NULL,
    session_before TEXT, session_after TEXT, exit_code INTEGER, signal TEXT, error TEXT, error_code TEXT, stdout_excerpt TEXT,
    usage TEXT, started_at INTEGER NOT NULL, finished_at INTEGER, last_output_at INTEGER, pid INTEGER
  );
  CREATE INDEX runs_task ON runs(task_id);
  CREATE TABLE task_sessions (
    agent_key TEXT NOT NULL, engine TEXT NOT NULL, task_key TEXT NOT NULL, session_id TEXT NOT NULL, updated_at INTEGER NOT NULL,
    PRIMARY KEY (agent_key, engine, task_key)
  );
  CREATE TABLE events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor TEXT, type TEXT NOT NULL, entity TEXT, entity_id TEXT, data TEXT
  );
  CREATE TRIGGER events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT, 'append-only'); END;
  CREATE TRIGGER events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT, 'append-only'); END;
  CREATE TABLE usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT, agent_id TEXT, engine TEXT NOT NULL, model TEXT,
    input INTEGER NOT NULL DEFAULT 0, cached_input INTEGER NOT NULL DEFAULT 0, cache_write INTEGER NOT NULL DEFAULT 0,
    output INTEGER NOT NULL DEFAULT 0, known INTEGER NOT NULL DEFAULT 1, at INTEGER NOT NULL
  );
  CREATE INDEX usage_at ON usage(at);
  CREATE TABLE budgets (
    id TEXT PRIMARY KEY, scope TEXT NOT NULL CHECK (scope IN ('global','engine','agent')), scope_id TEXT,
    window TEXT NOT NULL CHECK (window IN ('day','month')), limit_tokens INTEGER NOT NULL,
    warn_percent INTEGER NOT NULL DEFAULT 80, hard_stop INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
  INSERT INTO workspaces(id, name, root, kind, created_at) VALUES ('default', 'default', NULL, 'generic', 0);
  `,
];

/**
 * İşlem: BEGIN IMMEDIATE (yazma kilidi baştan alınır), hata olursa ROLLBACK ve hata yeniden atılır.
 * İç içe çağrıda yeni işlem açılmaz, dıştakine katılır.
 * @template T
 * @param {DatabaseSync} db
 * @param {() => T} fn
 * @returns {T}
 */
export function tx(db, fn) {
  if (db.isTransaction) return fn();
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw err;
  }
}

/** @param {DatabaseSync} db */
export function schemaVersion(db) {
  const has = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='meta'").get();
  if (!has) return 0;
  return Number(db.prepare("SELECT value FROM meta WHERE key='schema_version'").get()?.value ?? 0);
}

/**
 * Veritabanını açar, ayarları yapar ve eksik göçleri uygular.
 * @param {string} [path]
 * @returns {DatabaseSync}
 */
export function openDb(path = ':memory:') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA busy_timeout = 5000');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  const from = schemaVersion(db);
  for (let v = from; v < MIGRATIONS.length; v++) {
    tx(db, () => {
      db.exec(MIGRATIONS[v]);
      db.prepare("INSERT INTO meta(key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(v + 1));
    });
  }
  return db;
}
