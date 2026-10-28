// Görevler, bağımlılıklar, atomik checkout, run kayıtları, açılışta kurtarma ve görev başına oturumlar.
import { randomUUID } from 'node:crypto';
import { now, tx } from './db.js';
import { append } from './events.js';

/** @typedef {import('node:sqlite').DatabaseSync} Db */

/** Süreç yaşıyor mu (sinyal 0 yalnız varlığı yoklar). */
export function pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; }
}

/** Run durumu → görev durumu. */
const TASK_STATUS_FOR = { succeeded: 'done', limited: 'blocked', failed: 'failed', timed_out: 'failed', interrupted: 'todo', cancelled: 'cancelled' };
const EVENT_FOR = { done: 'task.done', in_review: 'task.in_review', blocked: 'task.blocked', failed: 'task.failed', cancelled: 'task.cancelled', todo: 'task.requeued' };

/** @param {Db} db @param {string} id */
export function getTask(db, id) {
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) ?? null;
}

/**
 * @param {Db} db
 * @param {{title: string, prompt?: string, engine?: string, assigneeAgentId?: string, parentId?: string, goalId?: string, workspaceId?: string, status?: string,
 *   needsReview?: boolean, checks?: string[]|null, planKey?: string|null}} t
 *   needsReview: başarılı run görevi done yerine in_review yapar; kontrolcü karar verince done olur.
 */
export function createTask(db, { title, prompt = null, engine = null, assigneeAgentId = null, parentId = null, goalId = null, workspaceId = 'default', status = 'todo',
  needsReview = false, checks = null, planKey = null }) {
  const id = randomUUID();
  const at = now();
  tx(db, () => {
    db.prepare(`INSERT INTO tasks(id, workspace_id, title, prompt, status, engine, assignee_agent_id, parent_id, goal_id, created_at, updated_at,
      needs_review, checks, plan_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, workspaceId, title, prompt, status, engine, assigneeAgentId, parentId, goalId, at, at, needsReview ? 1 : 0,
        checks?.length ? JSON.stringify(checks) : null, planKey);
    append(db, { actor: 'core', type: 'task.created', entity: 'task', entityId: id, data: { title, engine } });
  });
  return getTask(db, id);
}

/**
 * taskId, dependsOn bitmeden başlamaz. Döngü oluşturacaksa hata atar.
 * @param {Db} db @param {string} taskId @param {string} dependsOn
 */
export function addDependency(db, taskId, dependsOn) {
  tx(db, () => {
    // dependsOn'dan bağımlılık zinciri boyunca taskId'ye ulaşılıyorsa yeni kenar döngü kurar.
    const cycle = db.prepare(`WITH RECURSIVE up(id) AS (
        SELECT depends_on FROM task_deps WHERE task_id = ?
        UNION SELECT d.depends_on FROM task_deps d JOIN up ON d.task_id = up.id)
      SELECT 1 FROM up WHERE id = ? LIMIT 1`).get(dependsOn, taskId);
    if (cycle || taskId === dependsOn) throw new Error(`döngü: ${taskId} → ${dependsOn}`);
    db.prepare('INSERT OR IGNORE INTO task_deps(task_id, depends_on) VALUES (?, ?)').run(taskId, dependsOn);
  });
}

/**
 * Çalıştırılabilir görevler: todo (ya da süresi gelmiş blocked), checkout yok, bütün bağımlılıklar done.
 * @param {Db} db
 * @param {{limit?: number, at?: number}} [o]
 */
export function readyTasks(db, { limit = 50, at = now() } = {}) {
  return db.prepare(`SELECT t.* FROM tasks t
    WHERE (t.status = 'todo' OR (t.status = 'blocked' AND t.retry_at IS NOT NULL AND t.retry_at <= ?))
      AND t.checkout_run_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM task_deps d JOIN tasks p ON p.id = d.depends_on WHERE d.task_id = t.id AND p.status <> 'done')
    ORDER BY t.created_at, t.rowid LIMIT ?`).all(at, limit);
}

/**
 * Görevi tek işlemde alır: önce checkout, kazanılırsa run satırı. Kaybedilirse null döner, run oluşmaz.
 * @param {Db} db @param {string} taskId
 * @param {{engine: string, sessionBefore?: string|null, ownerPid?: number}} o
 *   ownerPid: run'ı yürüten fa sürecinin pid'i (runs.pid); kurtarma canlı sahibin run'ına dokunmaz.
 */
export function claimTask(db, taskId, { engine, sessionBefore = null, ownerPid = process.pid }) {
  const runId = randomUUID();
  const at = now();
  return tx(db, () => {
    const r = db.prepare(`UPDATE tasks SET checkout_run_id = ?, locked_at = ?, status = 'in_progress', attempts = attempts + 1, updated_at = ?
      WHERE id = ? AND checkout_run_id IS NULL AND status IN ('todo', 'blocked')`).run(runId, at, at, taskId);
    if (r.changes !== 1) return null;
    db.prepare(`INSERT INTO runs(id, task_id, engine, status, session_before, started_at, last_output_at, pid) VALUES (?, ?, ?, 'running', ?, ?, ?, ?)`)
      .run(runId, taskId, engine, sessionBefore, at, at, ownerPid);
    append(db, { actor: 'core', type: 'task.claimed', entity: 'task', entityId: taskId, data: { runId, engine } });
    return db.prepare('SELECT * FROM runs WHERE id = ?').get(runId);
  });
}

/**
 * Run'ı kapatır, görev durumunu run durumuna göre değiştirir ve checkout'u boşaltır.
 * Run artık "running" değilse (ör. kurtarılmış) hiçbir şey yapmaz.
 * @param {Db} db @param {string} runId
 * @param {{status: 'succeeded'|'failed'|'timed_out'|'cancelled'|'limited'|'interrupted', exitCode?: number|null, signal?: string|null, error?: string|null,
 *   errorCode?: string|null, sessionAfter?: string|null, usage?: object|null, result?: unknown, retryAt?: number|null, stdoutExcerpt?: string|null}} o
 */
export function finishRun(db, runId, { status, exitCode = null, signal = null, error = null, errorCode = null, sessionAfter = null, usage = null, result = null, retryAt = null, stdoutExcerpt = null }) {
  const at = now();
  tx(db, () => {
    const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId);
    if (!run) throw new Error(`run yok: ${runId}`);
    if (run.status !== 'running') return;
    db.prepare(`UPDATE runs SET status = ?, exit_code = ?, signal = ?, error = ?, error_code = ?, session_after = ?, usage = ?, stdout_excerpt = ?, finished_at = ?
      WHERE id = ?`).run(status, exitCode, signal, error, errorCode, sessionAfter, usage ? JSON.stringify(usage) : null, stdoutExcerpt, at, runId);
    let taskStatus = TASK_STATUS_FOR[status];
    if (!taskStatus) throw new Error(`bilinmeyen run durumu: ${status}`);
    if (taskStatus === 'done' && db.prepare('SELECT needs_review FROM tasks WHERE id = ?').get(run.task_id)?.needs_review) taskStatus = 'in_review';
    const t = db.prepare(`UPDATE tasks SET status = ?, checkout_run_id = NULL, locked_at = NULL, retry_at = ?, updated_at = ?,
      result = COALESCE(?, result) WHERE id = ? AND checkout_run_id = ?`)
      .run(taskStatus, status === 'limited' ? retryAt : null, at, result == null ? null : JSON.stringify(result), run.task_id, runId);
    append(db, { actor: 'core', type: 'run.finished', entity: 'run', entityId: runId, data: { status, exitCode, error } });
    if (t.changes === 1) append(db, { actor: 'core', type: EVENT_FOR[taskStatus], entity: 'task', entityId: run.task_id, data: { runId, retryAt } });
  });
}

/**
 * Claim edilmemiş görevi bekletir (ör. bütçe doldu).
 * @param {Db} db @param {string} taskId @param {{retryAt: number|null, reason?: string}} o
 */
export function blockTask(db, taskId, { retryAt, reason = null }) {
  tx(db, () => {
    db.prepare(`UPDATE tasks SET status = 'blocked', retry_at = ?, updated_at = ? WHERE id = ? AND checkout_run_id IS NULL`).run(retryAt, now(), taskId);
    append(db, { actor: 'core', type: 'task.blocked', entity: 'task', entityId: taskId, data: { retryAt, reason } });
  });
}

/**
 * Sahibi ölmüş süreçten "running" kalan run'ları interrupted yapar, görevlerini todo'ya döndürür.
 * Başka bir canlı `fa run` sürecinin run'larına dokunmaz.
 * @param {Db} db
 * @param {{isAlive?: (pid: number|null) => boolean}} [o]
 * @returns {number} kurtarılan run sayısı
 */
export function recoverStale(db, { isAlive = pidAlive } = {}) {
  return tx(db, () => {
    const stale = db.prepare("SELECT id, task_id, pid FROM runs WHERE status = 'running'").all().filter((r) => !isAlive(r.pid));
    const at = now();
    for (const r of stale) {
      db.prepare("UPDATE runs SET status = 'interrupted', finished_at = ?, error = 'süreç yarıda kaldı' WHERE id = ?").run(at, r.id);
      db.prepare(`UPDATE tasks SET status = 'todo', checkout_run_id = NULL, locked_at = NULL, updated_at = ? WHERE id = ? AND checkout_run_id = ?`).run(at, r.task_id, r.id);
      append(db, { actor: 'core', type: 'run.recovered', entity: 'run', entityId: r.id, data: { taskId: r.task_id } });
    }
    return stale.length;
  });
}

/**
 * İncelemede ya da bitmiş görevi düzeltme için yeniden kuyruğa alır. Oturum görev başına olduğu için
 * düzeltme turu aynı motor oturumunda sürer.
 * @param {Db} db @param {string} taskId @param {{prompt: string, engine?: string|null, reason?: string}} o
 */
export function reopenTask(db, taskId, { prompt, engine = undefined, reason = null }) {
  tx(db, () => {
    const r = db.prepare(`UPDATE tasks SET status = 'todo', prompt = ?, engine = COALESCE(?, engine), review_round = review_round + 1, updated_at = ?
      WHERE id = ? AND status IN ('in_review', 'done', 'failed') AND checkout_run_id IS NULL`).run(prompt, engine ?? null, now(), taskId);
    if (r.changes !== 1) throw new Error(`görev yeniden açılamaz: ${taskId}`);
    append(db, { actor: 'core', type: 'task.reopened', entity: 'task', entityId: taskId, data: { reason } });
  });
}

/**
 * İncelemedeki görevi kapatır (kontrolcü kararı).
 * @param {Db} db @param {string} taskId @param {{verdict: 'pass'|'needs_work', feedback?: string|null}} o
 */
export function closeReview(db, taskId, { verdict, feedback = null }) {
  tx(db, () => {
    const r = db.prepare(`UPDATE tasks SET status = 'done', updated_at = ? WHERE id = ? AND status = 'in_review'`).run(now(), taskId);
    if (r.changes !== 1) throw new Error(`incelemede değil: ${taskId}`);
    append(db, { actor: 'reviewer', type: 'task.done', entity: 'task', entityId: taskId, data: { verdict, feedback: feedback?.slice(0, 2000) ?? null } });
  });
}

/** @typedef {{agentKey: string, engine: string, taskKey: string}} SessionKey */

/** @param {Db} db @param {SessionKey} k @returns {string|null} */
export function getSession(db, { agentKey, engine, taskKey }) {
  return db.prepare('SELECT session_id FROM task_sessions WHERE agent_key = ? AND engine = ? AND task_key = ?').get(agentKey, engine, taskKey)?.session_id ?? null;
}

/** sessionId null ise oturum silinir. @param {Db} db @param {SessionKey} k @param {string|null} sessionId */
export function saveSession(db, { agentKey, engine, taskKey }, sessionId) {
  if (sessionId == null) {
    db.prepare('DELETE FROM task_sessions WHERE agent_key = ? AND engine = ? AND task_key = ?').run(agentKey, engine, taskKey);
    return;
  }
  db.prepare(`INSERT INTO task_sessions(agent_key, engine, task_key, session_id, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(agent_key, engine, task_key) DO UPDATE SET session_id = excluded.session_id, updated_at = excluded.updated_at`)
    .run(agentKey, engine, taskKey, sessionId, now());
}
