// Onay kapısı: policy.decide sonucunu uygular. "ask" eylemi onay kartı açar ve beklemez (iş kuyruğu bloklanmaz);
// onaylanan kart bir kez kullanılır.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { decideApproval, requestApproval } from '../core/board.js';
import { now, tx } from '../core/db.js';
import { append } from '../core/events.js';
import { approvePlan } from '../core/orchestrator.js';
import { decide } from '../core/policy.js';
import { blockTask, getTask } from '../core/tasks.js';

/** @typedef {import('node:sqlite').DatabaseSync} Db */

/**
 * @param {Db} db @param {string} action
 * @param {{entity?: string|null, entityId?: string|null, payload?: unknown, consume?: boolean}} [o]
 * @returns {{allowed: boolean, decision: 'allow'|'ask'|'deny', approvalId: string|null}}
 */
export function gate(db, action, { entity = null, entityId = null, payload = null, consume = true } = {}) {
  const decision = decide(action);
  if (decision === 'deny') {
    append(db, { actor: 'gate', type: 'gate.denied', entity, entityId, data: { action } });
    return { allowed: false, decision, approvalId: null };
  }
  if (decision === 'allow') return { allowed: true, decision, approvalId: null };
  return tx(db, () => {
    const approved = db.prepare(`SELECT id FROM approvals WHERE action = ? AND entity_id IS ? AND status = 'approved' AND used_at IS NULL
      ORDER BY decided_at DESC LIMIT 1`).get(action, entityId);
    if (approved) {
      if (consume) db.prepare('UPDATE approvals SET used_at = ? WHERE id = ?').run(now(), approved.id);
      append(db, { actor: 'gate', type: 'gate.passed', entity, entityId, data: { action, approvalId: approved.id } });
      return { allowed: true, decision, approvalId: approved.id };
    }
    const pending = db.prepare("SELECT id FROM approvals WHERE action = ? AND entity_id IS ? AND status = 'pending' LIMIT 1").get(action, entityId);
    const approvalId = pending?.id ?? requestApproval(db, { action, entity, entityId, payload });
    return { allowed: false, decision, approvalId };
  });
}

/**
 * Silme etkisi: kaç dosya, kaç bayt. Onay kartında gösterilir.
 * @param {string[]} paths
 */
export function deleteImpact(paths) {
  let files = 0;
  let bytes = 0;
  const walk = (p) => {
    if (!existsSync(p)) return;
    const s = statSync(p);
    if (s.isDirectory()) { for (const n of readdirSync(p)) walk(join(p, n)); return; }
    files++;
    bytes += s.size;
  };
  for (const p of paths) walk(p);
  return { files, bytes };
}

/**
 * Onay kartına karar verir ve eylemin yan etkisini uygular (plan onayı görevleri kuyruğa alır,
 * kurtarma onayı takılan görevi yeniden dener). CLI ve Santral aynı yolu kullanır.
 * @param {Db} db @param {string} ref kimlik ya da ön ek @param {{approve: boolean, by?: string, note?: string|null}} o
 */
export function resolveApproval(db, ref, { approve, by = 'kullanıcı', note = null }) {
  const a = ref && db.prepare('SELECT * FROM approvals WHERE id = ? OR id LIKE ?').get(ref, `${ref}%`);
  if (!a) throw new Error(`onay bulunamadı: ${ref ?? ''}`);
  if (a.status !== 'pending') throw new Error(`onay zaten karara bağlandı: ${a.status}`);
  if (a.action === 'plan.approve') approvePlan(db, a.entity_id, { approve, by });
  else decideApproval(db, a.id, { approve, by, note });
  if (a.action === 'task.recover' && approve && getTask(db, a.entity_id)?.status === 'blocked') {
    blockTask(db, a.entity_id, { retryAt: now(), reason: 'kurtarma onaylandı' });
  }
  return a;
}

/** fs.delete için kapı; kartta silme etkisi yazar. @param {Db} db @param {string[]} paths */
export function gateDelete(db, paths) {
  const key = [...paths].sort().join('|');
  return gate(db, 'fs.delete', { entity: 'paths', entityId: key, payload: { paths, ...deleteImpact(paths) } });
}
