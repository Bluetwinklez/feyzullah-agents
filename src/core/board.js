// Pano: hedefler, yorumlar, sürümlü belgeler ve onay kayıtları.
import { randomUUID } from 'node:crypto';
import { now, tx } from './db.js';
import { append } from './events.js';

/** @typedef {import('node:sqlite').DatabaseSync} Db */

export const GOAL_STATUSES = ['planning', 'awaiting_approval', 'active', 'done', 'failed', 'cancelled'];

/** @param {Db} db @param {{title: string, description?: string|null, workspaceId?: string, checks?: string[]|null}} g */
export function createGoal(db, { title, description = null, workspaceId = 'default', checks = null }) {
  const id = randomUUID();
  const at = now();
  tx(db, () => {
    db.prepare(`INSERT INTO goals(id, workspace_id, title, description, status, checks, created_at, updated_at) VALUES (?, ?, ?, ?, 'planning', ?, ?, ?)`)
      .run(id, workspaceId, title, description, checks?.length ? JSON.stringify(checks) : null, at, at);
    append(db, { actor: 'core', type: 'goal.created', entity: 'goal', entityId: id, data: { title } });
  });
  return getGoal(db, id);
}

/** @param {Db} db @param {string} id */
export function getGoal(db, id) {
  return db.prepare('SELECT * FROM goals WHERE id = ?').get(id) ?? null;
}

/** @param {Db} db @param {string} id @param {string} status */
export function setGoalStatus(db, id, status) {
  if (!GOAL_STATUSES.includes(status)) throw new Error(`bilinmeyen hedef durumu: ${status}`);
  tx(db, () => {
    db.prepare('UPDATE goals SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), id);
    append(db, { actor: 'core', type: `goal.${status}`, entity: 'goal', entityId: id });
  });
}

/** Hedefin görevlerinin durum sayıları. @param {Db} db @param {string} goalId @returns {Record<string, number>} */
export function goalProgress(db, goalId) {
  return Object.fromEntries(db.prepare('SELECT status, count(*) n FROM tasks WHERE goal_id = ? GROUP BY status').all(goalId).map((r) => [r.status, r.n]));
}

/** @param {Db} db @param {string} goalId */
export function goalTasks(db, goalId) {
  return db.prepare('SELECT * FROM tasks WHERE goal_id = ? ORDER BY created_at, rowid').all(goalId);
}

/**
 * Konuma bağlı yorum: anchor {file, line} ya da {quote} olabilir. Ajana yapılandırılmış bağlam olarak gider.
 * @param {Db} db @param {{entity: string, entityId: string, author: string, body: string, anchor?: object|null}} c
 */
export function addComment(db, { entity, entityId, author, body, anchor = null }) {
  return tx(db, () => {
    const r = db.prepare('INSERT INTO comments(entity, entity_id, author, body, anchor, at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(entity, entityId, author, body, anchor ? JSON.stringify(anchor) : null, now());
    append(db, { actor: author, type: 'comment.added', entity, entityId, data: { commentId: Number(r.lastInsertRowid), anchor } });
    return Number(r.lastInsertRowid);
  });
}

/** @param {Db} db @param {string} entity @param {string} entityId */
export function listComments(db, entity, entityId) {
  return db.prepare('SELECT * FROM comments WHERE entity = ? AND entity_id = ? ORDER BY id').all(entity, entityId)
    .map((c) => ({ ...c, anchor: c.anchor ? JSON.parse(c.anchor) : null }));
}

/** Yorumları ajana verilecek metne çevirir. */
export function commentsAsContext(comments) {
  return comments.map((c) => {
    const where = c.anchor?.file ? ` [${c.anchor.file}${c.anchor.line ? `:${c.anchor.line}` : ''}]` : c.anchor?.quote ? ` [“${String(c.anchor.quote).slice(0, 120)}”]` : '';
    return `- ${c.author}${where}: ${c.body}`;
  }).join('\n');
}

/** Belge her kayıtta yeni sürüm olur. @param {Db} db @param {{entity: string, entityId: string, name: string, body: string, author?: string}} d @returns {number} sürüm */
export function saveDocument(db, { entity, entityId, name, body, author = null }) {
  return tx(db, () => {
    const v = (db.prepare('SELECT max(version) v FROM documents WHERE entity = ? AND entity_id = ? AND name = ?').get(entity, entityId, name)?.v ?? 0) + 1;
    db.prepare('INSERT INTO documents(entity, entity_id, name, body, version, author, at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(entity, entityId, name, body, v, author, now());
    append(db, { actor: author ?? 'core', type: 'document.saved', entity, entityId, data: { name, version: v } });
    return v;
  });
}

/** @param {Db} db @param {string} entity @param {string} entityId @param {string} name @param {number} [version] */
export function getDocument(db, entity, entityId, name, version) {
  return (version
    ? db.prepare('SELECT * FROM documents WHERE entity = ? AND entity_id = ? AND name = ? AND version = ?').get(entity, entityId, name, version)
    : db.prepare('SELECT * FROM documents WHERE entity = ? AND entity_id = ? AND name = ? ORDER BY version DESC LIMIT 1').get(entity, entityId, name)) ?? null;
}

/** @param {Db} db @param {{action: string, entity?: string|null, entityId?: string|null, payload?: unknown}} a @returns {string} onay kimliği */
export function requestApproval(db, { action, entity = null, entityId = null, payload = null }) {
  const id = randomUUID();
  tx(db, () => {
    db.prepare(`INSERT INTO approvals(id, action, entity, entity_id, payload, status, requested_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)`)
      .run(id, action, entity, entityId, payload == null ? null : JSON.stringify(payload), now());
    append(db, { actor: 'core', type: 'approval.requested', entity: 'approval', entityId: id, data: { action, entity, entityId } });
  });
  return id;
}

/** @param {Db} db @param {string} id @param {{approve: boolean, by: string, note?: string|null}} d */
export function decideApproval(db, id, { approve, by, note = null }) {
  return tx(db, () => {
    const r = db.prepare(`UPDATE approvals SET status = ?, decided_at = ?, decided_by = ?, note = ? WHERE id = ? AND status = 'pending'`)
      .run(approve ? 'approved' : 'rejected', now(), by, note, id);
    if (r.changes !== 1) throw new Error(`bekleyen onay yok: ${id}`);
    append(db, { actor: by, type: approve ? 'approval.approved' : 'approval.rejected', entity: 'approval', entityId: id });
    return db.prepare('SELECT * FROM approvals WHERE id = ?').get(id);
  });
}

/** @param {Db} db */
export function pendingApprovals(db) {
  return db.prepare("SELECT * FROM approvals WHERE status = 'pending' ORDER BY requested_at").all();
}

/** Bu eylem bu varlık için onaylanmış mı (henüz kullanılmamış onay). */
export function isApproved(db, action, entityId) {
  return Boolean(db.prepare("SELECT 1 FROM approvals WHERE action = ? AND entity_id IS ? AND status = 'approved' LIMIT 1").get(action, entityId));
}
