// İşe alma önerileri: son işlere bakıp eksik uzmanı ya da zorlanan uzmana yardımcıyı önerir.
// Öneri yalnız metindir; yeni uzman dosyası kullanıcı onaylayınca yazılır (fa hire --write).
import { activeAgents, agentStats, DEPARTMENTS, routeDepartment } from './registry.js';

/** @typedef {import('node:sqlite').DatabaseSync} Db */

/**
 * @param {Db} db @param {{recent?: number, minRuns?: number}} [o]
 * @returns {{id: string, department: string, engine: string, reason: string, count: number, template: string}[]}
 */
export function suggestHires(db, { recent = 200, minRuns = 4 } = {}) {
  const agents = activeAgents(db);
  const has = (dept, engine) => agents.some((a) => a.department === dept && a.engine === engine);
  const gaps = new Map();
  for (const t of db.prepare('SELECT title, prompt, engine FROM tasks ORDER BY created_at DESC LIMIT ?').all(recent)) {
    const dept = routeDepartment(`${t.title}\n${t.prompt ?? ''}`);
    const engine = t.engine ?? 'codex';
    if (has(dept, engine)) continue;
    const k = `${dept}:${engine}`;
    gaps.set(k, (gaps.get(k) ?? 0) + 1);
  }
  const out = [];
  for (const [k, count] of gaps) {
    const [department, engine] = k.split(':');
    out.push(hire({ department, engine, count, reason: `${count} iş ${DEPARTMENTS[department].name} departmanına düştü ama ${engine} motorlu uzman yok` }));
  }
  for (const a of agents) {
    const st = agentStats(db, a.id);
    if (st.runs >= minRuns && st.success < 0.5) {
      const engine = a.engine === 'codex' ? 'claude' : 'codex';
      out.push(hire({ department: a.department, engine, count: st.runs, reason: `${a.name} son işlerin %${Math.round(st.success * 100)}'ini geçirebildi; başka motorla yardımcı`, base: a }));
    }
  }
  for (const d of Object.keys(DEPARTMENTS)) {
    if (!agents.some((a) => a.department === d)) out.push(hire({ department: d, engine: 'codex', count: 0, reason: `${DEPARTMENTS[d].name} departmanında hiç uzman yok` }));
  }
  return out.sort((a, b) => b.count - a.count);
}

function hire({ department, engine, count, reason, base = null }) {
  const id = `${department}-${engine === 'antigravity' ? 'agy' : engine}${base ? '-yardimci' : ''}`;
  const name = base ? `${base.name} yardımcısı` : `${DEPARTMENTS[department].name} uzmanı (${engine})`;
  const template = ['---', `id: ${id}`, `name: ${name}`, `department: ${department}`, `engine: ${engine}`, ...(base?.reports_to ? [`reports_to: ${base.reports_to}`] : []),
    `skills: [${(base?.skills ?? []).join(', ')}]`, `keywords: [${(base?.keywords ?? []).join(', ')}]`, '---', '',
    base ? `${base.persona ?? ''}`.trim() : `Sen ${DEPARTMENTS[department].about} işlerinde uzmansın.`, ''].join('\n');
  return { id, department, engine, reason, count, template };
}
