// Append-only olay günlüğü. Silme ve güncelleme veritabanı trigger'larıyla engellenir.
import { createHash } from 'node:crypto';
import { now, tx } from './db.js';
import { redactText } from '../knowledge/secrets.js';

const SECRET_KEY = /key|token|password|secret|authorization|cookie/i;

/**
 * Anahtar adı sır gibi görünen değerleri "[gizli]" yapar; iç içe nesne ve dizilere de iner.
 * Metin değerlerin içindeki anahtar, jeton ve kişisel veriler de maskelenir.
 * @template T
 * @param {T} obj
 * @returns {T}
 */
export function redact(obj) {
  if (typeof obj === 'string') return /** @type {any} */ (redactText(obj).text);
  if (Array.isArray(obj)) return /** @type {any} */ (obj.map(redact));
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = SECRET_KEY.test(k) ? '[gizli]' : redact(v);
  return /** @type {any} */ (out);
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{actor?: string, type: string, entity?: string, entityId?: string, data?: unknown}} e
 * @returns {number} seq
 */
export function append(db, { actor = null, type, entity = null, entityId = null, data = null }) {
  // Zincir: her olay bir öncekinin özetini içerir. İşlem içinde okunur ki iki süreç zinciri çatallamasın.
  return tx(db, () => {
    const at = now();
    const json = data == null ? null : JSON.stringify(redact(data));
    const prev = db.prepare('SELECT hash FROM events ORDER BY seq DESC LIMIT 1').get()?.hash ?? '';
    const r = db.prepare('INSERT INTO events(at, actor, type, entity, entity_id, data, hash) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(at, actor, type, entity, entityId, json, chainHash(prev, { at, actor, type, entity, entityId, data: json }));
    return Number(r.lastInsertRowid);
  });
}

function chainHash(prev, e) {
  return createHash('sha256').update(JSON.stringify([prev, e.at, e.actor, e.type, e.entity, e.entityId, e.data])).digest('hex');
}

/**
 * Olay zincirini doğrular. Zincirden önce yazılmış (hash'siz) olaylar atlanır.
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {{ok: boolean, checked: number, brokenAt: number|null}}
 */
export function verifyChain(db) {
  let prev = null;
  let checked = 0;
  for (const r of db.prepare('SELECT seq, at, actor, type, entity, entity_id, data, hash FROM events ORDER BY seq').iterate()) {
    if (r.hash == null) { if (prev !== null) return { ok: false, checked, brokenAt: r.seq }; continue; }
    const want = chainHash(prev ?? '', { at: r.at, actor: r.actor, type: r.type, entity: r.entity, entityId: r.entity_id, data: r.data });
    if (want !== r.hash) return { ok: false, checked, brokenAt: r.seq };
    prev = r.hash;
    checked++;
  }
  return { ok: true, checked, brokenAt: null };
}

/**
 * @typedef {{seq: number, at: number, actor: string|null, type: string, entity: string|null, entityId: string|null, data: any}} Event
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} seq bu sıradan sonrakiler
 * @param {number} [limit]
 * @returns {Event[]}
 */
export function since(db, seq, limit = 500) {
  return db.prepare('SELECT seq, at, actor, type, entity, entity_id, data FROM events WHERE seq > ? ORDER BY seq LIMIT ?').all(seq, limit)
    .map((r) => ({ seq: r.seq, at: r.at, actor: r.actor, type: r.type, entity: r.entity, entityId: r.entity_id, data: r.data == null ? null : JSON.parse(r.data) }));
}
