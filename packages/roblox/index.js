// Roblox paketi: doğrulama katmanları 1–4, üretim sırası içe aktarma ve adım adım ilerleme.
// İçe aktarılan proje durdurulmuş olabilir: hiçbir adım kendiliğinden çalışmaz (autopilot kapalı gelir).
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createGoal, getGoal, saveDocument, setGoalStatus } from '../../src/core/board.js';
import { now, tx } from '../../src/core/db.js';
import { append } from '../../src/core/events.js';
import { addDependency, createTask } from '../../src/core/tasks.js';

/** @typedef {import('node:sqlite').DatabaseSync} Db */

const DONE_RE = /^(GEÇTİ|Tamamlandı|Kapatıldı)/i;
const onPath = (bin) => spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { encoding: 'utf8', windowsHide: true }).status === 0;

/** Rokit kökü: ortamdan ya da ~/.rokit. */
export function rokitRoot(env = process.env) {
  if (env.ROKIT_ROOT) return env.ROKIT_ROOT;
  const d = join(env.USERPROFILE ?? env.HOME ?? homedir(), '.rokit');
  return existsSync(d) ? d : null;
}

/**
 * Projeye göre katman 1–4 komutları. Yalnız projede karşılığı olan katmanlar eklenir.
 * @param {string} root @param {{env?: NodeJS.ProcessEnv, has?: (bin: string) => boolean}} [o]
 * @returns {{layer: number, cmd: string}[]}
 */
export function layers(root, { env = process.env, has = onPath } = {}) {
  const rk = rokitRoot(env);
  // cmd.exe: araç shim'leri ROKIT_ROOT ister (sokak-oyunu kanıtlarındaki süreç ayarı).
  const pre = rk && process.platform === 'win32' ? `set "ROKIT_ROOT=${rk}"&& ` : '';
  const out = [];
  const src = existsSync(join(root, 'src')) ? 'src' : '.';
  if (existsSync(join(root, 'stylua.toml')) || existsSync(join(root, '.stylua.toml'))) out.push({ layer: 1, cmd: `${pre}stylua --check ${src}` });
  if (existsSync(join(root, 'selene.toml'))) out.push({ layer: 1, cmd: `${pre}selene ${src}` });
  if (existsSync(join(root, 'default.project.json'))) out.push({ layer: 2, cmd: `${pre}rojo build default.project.json -o build/game.rbxl` });
  if (has('luau-analyze')) out.push({ layer: 3, cmd: `luau-analyze ${src}` });
  const tests = join(root, 'tests');
  if (existsSync(tests)) {
    for (const f of readdirSync(tests).filter((n) => /^run-.*\.mjs$/.test(n)).sort()) out.push({ layer: 4, cmd: `node tests/${f}` });
  }
  return out;
}

/** Markdown tablolarından "#" ve "Durum" sütunlu aşama tabloları. @param {string} md */
export function parseStageTables(md) {
  const lines = String(md).split(/\r?\n/);
  const tables = [];
  let heading = null;
  for (let i = 0; i < lines.length; i++) {
    const h = /^#{1,4}\s+(.+)$/.exec(lines[i]);
    if (h) { heading = h[1].trim(); continue; }
    if (!/^\|/.test(lines[i]) || !/^\|[\s:|-]+\|$/.test(lines[i + 1] ?? '')) continue;
    const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    const head = cells(lines[i]).map((c) => c.toLocaleLowerCase('tr'));
    const iNum = head.indexOf('#');
    const iStatus = head.indexOf('durum');
    if (iNum < 0 || iStatus < 0) continue;
    const iName = head.findIndex((c) => c === 'aşama' || c === 'adım');
    const iGate = head.indexOf('tamamlanma şartı');
    const rows = [];
    for (i += 2; i < lines.length && /^\|/.test(lines[i]); i++) {
      const c = cells(lines[i]);
      const n = Number(c[iNum]);
      if (!Number.isInteger(n)) continue;
      rows.push({ n, name: c[iName] ?? `Adım ${n}`, gate: iGate >= 0 ? c[iGate] : null, status: c[iStatus] ?? '', done: DONE_RE.test(c[iStatus] ?? '') });
    }
    if (rows.length) tables.push({ title: heading ?? 'Üretim sırası', kind: iGate >= 0 ? 'stage' : 'code', rows });
  }
  return tables;
}

/**
 * `docs/uretim-sirasi.md` → her tablo bir hedef, her satır sıralı bir görev. Bitmiş satırlar done,
 * kalanlar backlog (kendiliğinden çalışmaz). Kod adımlarına katman 1–4 kontrolleri eklenir.
 * @param {Db} db @param {{root: string, file?: string, checks?: string[]}} o
 */
export function importProduction(db, { root, file = join(root, 'docs', 'uretim-sirasi.md'), checks = layers(root).map((l) => l.cmd) }) {
  const tables = parseStageTables(readFileSync(file, 'utf8'));
  if (!tables.length) throw new Error(`aşama tablosu bulunamadı: ${file}`);
  return tx(db, () => tables.map((t) => {
    const goal = createGoal(db, { title: t.title, description: `İçe aktarıldı: ${file}` });
    let prev = null;
    const ids = [];
    for (const r of t.rows) {
      const gate = r.gate ? `\nKabul ölçütü (kapı): ${r.gate}` : '';
      const was = r.status ? `\nBelgedeki son durum: ${r.status.slice(0, 300)}` : '';
      const prompt = `${t.title}, ${r.n}. adım: ${r.name}.${gate}${was}\nProje kurallarına (AGENTS.md, CLAUDE.md, docs/) uy. Bitince kanıtı (komut çıktısı, dosya yolu) raporla.`;
      const task = createTask(db, {
        title: `${r.n}. ${r.name}`, prompt, engine: t.kind === 'code' ? 'codex' : 'antigravity', goalId: goal.id,
        status: r.done ? 'done' : 'backlog', needsReview: !r.done, checks: t.kind === 'code' ? checks : null, planKey: `adim-${r.n}`,
      });
      if (prev) addDependency(db, task.id, prev);
      prev = task.id;
      ids.push(task.id);
    }
    saveDocument(db, { entity: 'goal', entityId: goal.id, name: 'kaynak', body: t.rows.map((r) => `${r.n}. ${r.name}: ${r.status}`).join('\n'), author: 'roblox' });
    // Durdurulmuş proje: hedef "planning"de kalır, adımlar elle açılır.
    setGoalStatus(db, goal.id, 'planning');
    append(db, { actor: 'roblox', type: 'roblox.imported', entity: 'goal', entityId: goal.id, data: { steps: t.rows.length, done: t.rows.filter((r) => r.done).length } });
    return { goalId: goal.id, title: t.title, steps: t.rows.length, done: t.rows.filter((r) => r.done).length, taskIds: ids };
  }));
}

/** Autopilot ayarı (çalışma alanı başına; içe aktarmada kapalı). @param {Db} db */
export function autopilot(db, value) {
  if (value !== undefined) db.prepare("INSERT INTO meta(key, value) VALUES ('roblox_autopilot', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(value ? '1' : '0');
  return db.prepare("SELECT value FROM meta WHERE key = 'roblox_autopilot'").get()?.value === '1';
}

/**
 * Sıradaki adımı açar: bağımlılıkları bitmiş ilk backlog görevi todo olur. Önceki adım bitmemişse açılmaz.
 * @param {Db} db @param {string} goalId @returns {{taskId: string, title: string}|null}
 */
export function promoteNext(db, goalId) {
  const next = db.prepare(`SELECT t.id, t.title FROM tasks t WHERE t.goal_id = ? AND t.status = 'backlog'
    AND NOT EXISTS (SELECT 1 FROM task_deps d JOIN tasks p ON p.id = d.depends_on WHERE d.task_id = t.id AND p.status <> 'done')
    ORDER BY t.created_at, t.rowid LIMIT 1`).get(goalId);
  if (!next) return null;
  tx(db, () => {
    db.prepare("UPDATE tasks SET status = 'todo', updated_at = ? WHERE id = ? AND status = 'backlog'").run(now(), next.id);
    if (getGoal(db, goalId)?.status !== 'active') setGoalStatus(db, goalId, 'active');
    append(db, { actor: 'roblox', type: 'roblox.step_opened', entity: 'task', entityId: next.id });
  });
  return { taskId: next.id, title: next.title };
}
