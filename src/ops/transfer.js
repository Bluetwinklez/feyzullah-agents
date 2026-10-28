// Çalışma alanı dışa/içe aktarma (JSON). Sır kasası, olay günlüğü, çalışma kayıtları, kullanım ve oturumlar
// dışarı çıkmaz; metinler gizli bilgi filtresinden geçer. İçe aktarma var olan kayıtları ezmez.
import { SCHEMA_VERSION, now, tx } from '../core/db.js';
import { append } from '../core/events.js';
import { redactText } from '../knowledge/secrets.js';

/** @typedef {import('node:sqlite').DatabaseSync} Db */

export const FORMAT = 'fa-workspace';
// Sıra yabancı anahtarlara göre: önce bağımsız tablolar.
const TABLES = ['workspaces', 'agents', 'goals', 'tasks', 'task_deps', 'documents', 'comments', 'routines', 'budgets'];
// Yerel yollar ve makineye özgü durum dışarı çıkmaz.
const DROP = { agents: ['file'], tasks: ['checkout_run_id', 'locked_at'], workspaces: ['root'] };

const clean = (v) => (typeof v === 'string' ? redactText(v).text : v);

/** @param {Db} db */
export function exportWorkspace(db) {
  const data = { format: FORMAT, version: 1, schema: SCHEMA_VERSION, exportedAt: now() };
  let redacted = 0;
  for (const t of TABLES) {
    data[t] = db.prepare(`SELECT * FROM ${t}`).all().map((row) => {
      const out = {};
      for (const [k, v] of Object.entries(row)) {
        if (DROP[t]?.includes(k)) continue;
        const c = clean(v);
        if (c !== v) redacted++;
        out[k] = c;
      }
      return out;
    });
  }
  // Çalışan görevler dışarıda "todo" görünür: kilitleri bu makineye aittir.
  for (const t of data.tasks) if (t.status === 'in_progress') t.status = 'todo';
  return { data, redacted };
}

/** @param {Db} db @param {any} data @returns {Record<string, number>} tablo başına eklenen satır */
export function importWorkspace(db, data) {
  if (data?.format !== FORMAT) throw new Error('fa-workspace biçimi değil');
  if (data.schema > SCHEMA_VERSION) throw new Error(`dosya daha yeni bir sürümden (şema ${data.schema} > ${SCHEMA_VERSION})`);
  const cols = (t) => new Set(db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name));
  return tx(db, () => {
    // Uzman → yönetici ve görev → üst görev bağları satır sırasından bağımsız olsun: anahtar kontrolü commit'te.
    db.exec('PRAGMA defer_foreign_keys = ON');
    const added = {};
    for (const t of TABLES) {
      const have = cols(t);
      let n = 0;
      for (const row of data[t] ?? []) {
        // Kimlikler korunur: aynı dosya ikinci kez içe aktarılırsa satırlar çoğalmaz.
        const keys = Object.keys(row).filter((k) => have.has(k));
        if (!keys.length) continue;
        const r = db.prepare(`INSERT OR IGNORE INTO ${t}(${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...keys.map((k) => row[k]));
        n += Number(r.changes);
      }
      added[t] = n;
    }
    append(db, { actor: 'transfer', type: 'workspace.imported', data: added });
    return added;
  });
}
