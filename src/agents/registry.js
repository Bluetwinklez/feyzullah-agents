// Uzman havuzu: agents/**/*.md dosyalarından ajanlar, departmanlar, org şeması, skill bağları,
// geçmiş başarıya göre seçim ve iş metnine göre departman yönlendirmesi.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { tx } from '../core/db.js';
import { append } from '../core/events.js';
import { normalizeEngine } from '../engines/args.js';

/** @typedef {import('node:sqlite').DatabaseSync} Db */
/**
 * @typedef {{id: string, name: string, department: string, role?: string|null, engine: string, model?: string|null, reportsTo?: string|null,
 *   capabilities: string[], skills: string[], keywords: string[], persona: string, file?: string|null}} AgentDef
 */

export const DEPARTMENTS = {
  build: { name: 'Build', about: 'kod, test, mimari, güvenlik' },
  design: { name: 'Design', about: 'arayüz, görsel, hareket' },
  grow: { name: 'Grow', about: 'araştırma, pazarlama, büyüme' },
  make: { name: 'Make', about: 'içerik, video, oyun içeriği' },
  run: { name: 'Run', about: 'yönetim, operasyon, belge, ters mühendislik' },
};

/** İş metninden departman tahmini için sözcük kökleri (Türkçe ve İngilizce). */
const ROUTES = {
  build: ['kod', 'test', 'hata', 'bug', 'api', 'build', 'derle', 'refactor', 'fonksiyon', 'modül', 'sunucu', 'veritabanı', 'güvenlik', 'script', 'luau', 'npm'],
  design: ['tasarım', 'arayüz', 'ui', 'ux', 'logo', 'görsel', 'renk', 'font', 'sayfa düzeni', 'animasyon', 'ikon', 'figma', 'css'],
  grow: ['araştır', 'pazar', 'rakip', 'seo', 'trend', 'kitle', 'büyüme', 'reklam', 'analiz', 'research', 'kampanya'],
  make: ['içerik', 'video', 'reel', 'gönderi', 'post', 'senaryo', 'altyazı', 'thumbnail', 'oyun içeriği', 'metin yaz'],
  run: ['belge', 'rapor', 'özet', 'plan', 'tablo', 'excel', 'pdf', 'sunum', 'ters mühendis', 'reverse', 'operasyon', 'finans'],
};

/** Basit ön bilgi (frontmatter) ayrıştırıcı: `anahtar: değer` ve `anahtar: [a, b]`. */
export function parseAgentFile(text, file = null) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(String(text));
  if (!m) throw new Error(`ön bilgi yok: ${file ?? '?'}`);
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_]+)\s*:\s*(.*)$/.exec(line.trim());
    if (!kv) continue;
    const v = kv[2].trim();
    meta[kv[1]] = /^\[.*\]$/.test(v) ? v.slice(1, -1).split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean) : v.replace(/^["']|["']$/g, '');
  }
  for (const k of ['id', 'name', 'department', 'engine']) if (!meta[k]) throw new Error(`${file ?? '?'}: "${k}" eksik`);
  const department = String(meta.department).toLowerCase();
  if (!DEPARTMENTS[department]) throw new Error(`${file ?? '?'}: bilinmeyen departman ${meta.department}`);
  const list = (x) => (Array.isArray(x) ? x : x ? [x] : []);
  return {
    id: meta.id, name: meta.name, department, role: meta.role ?? null, engine: normalizeEngine(meta.engine), model: meta.model || null,
    reportsTo: meta.reports_to || null, capabilities: list(meta.capabilities), skills: list(meta.skills), keywords: list(meta.keywords).map((k) => k.toLocaleLowerCase('tr')),
    persona: m[2].trim(), file,
  };
}

/** Dizindeki bütün .md ajan dosyaları (alt klasörler dahil). Sonraki dizin aynı id'yi ezer. @param {string[]} dirs */
export function loadAgents(dirs) {
  const byId = new Map();
  const walk = (dir, root) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, root);
      else if (name.endsWith('.md') && name.toLowerCase() !== 'readme.md') {
        const a = parseAgentFile(readFileSync(p, 'utf8'), relative(root, p).replace(/\\/g, '/'));
        byId.set(a.id, a);
      }
    }
  };
  for (const d of dirs) if (d && existsSync(d)) walk(d, d);
  return [...byId.values()];
}

/** Ajanları veritabanına yazar; dosyası silinen ajan pasif olur. @param {Db} db @param {AgentDef[]} agents */
export function syncAgents(db, agents, { workspaceId = 'default' } = {}) {
  tx(db, () => {
    const ids = new Set(agents.map((a) => a.id));
    // reports_to yabancı anahtar: önce hepsi yazılır, sonra bağlar kurulur.
    for (const a of agents) {
      db.prepare(`INSERT INTO agents(id, workspace_id, name, engine, model, department, reports_to, capabilities, persona, role, skills, keywords, file, active)
        VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 1)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, engine = excluded.engine, model = excluded.model, department = excluded.department,
          capabilities = excluded.capabilities, persona = excluded.persona, role = excluded.role, skills = excluded.skills, keywords = excluded.keywords,
          file = excluded.file, active = 1`)
        .run(a.id, workspaceId, a.name, a.engine, a.model, a.department, JSON.stringify(a.capabilities), a.persona, a.role,
          JSON.stringify(a.skills), JSON.stringify(a.keywords), a.file);
    }
    for (const a of agents) {
      const boss = a.reportsTo && ids.has(a.reportsTo) ? a.reportsTo : null;
      db.prepare('UPDATE agents SET reports_to = ? WHERE id = ?').run(boss, a.id);
    }
    for (const r of db.prepare('SELECT id FROM agents WHERE active = 1').all()) {
      if (!ids.has(r.id)) db.prepare('UPDATE agents SET active = 0 WHERE id = ?').run(r.id);
    }
    append(db, { actor: 'registry', type: 'agents.synced', data: { count: agents.length } });
  });
}

/** @param {Db} db */
export function activeAgents(db) {
  return db.prepare('SELECT * FROM agents WHERE active = 1 ORDER BY department, id').all()
    .map((a) => ({ ...a, capabilities: JSON.parse(a.capabilities ?? '[]'), skills: JSON.parse(a.skills ?? '[]'), keywords: JSON.parse(a.keywords ?? '[]') }));
}

/** Skill klasörleri: ~/.claude/skills ve ~/.codex/skills. */
export function skillDirs(env = process.env) {
  const home = env.USERPROFILE ?? env.HOME ?? homedir();
  return [join(home, '.claude', 'skills'), join(home, '.codex', 'skills')];
}

/** Ajanın bağlı skill'lerinden bulunamayanlar. Eklenti skill'leri ("eklenti:ad") kontrol edilmez. */
export function missingSkills(agent, dirs = skillDirs()) {
  return agent.skills.filter((s) => !s.includes(':') && !dirs.some((d) => existsSync(join(d, s, 'SKILL.md'))));
}

/** Ajanın kimlik metni: dosya gövdesi + departman + skill bağları. Veritabanı satırı da kabul eder (skills JSON metni). */
export function personaFor(agent) {
  if (!agent) return null;
  const list = typeof agent.skills === 'string' ? JSON.parse(agent.skills || '[]') : agent.skills ?? [];
  if (!agent.department) return agent.persona ?? null;
  const dept = DEPARTMENTS[agent.department];
  const skills = list.length ? `\n\nKullanabileceğin skill'ler: ${list.join(', ')}. İş bunlardan birine uyuyorsa önce onu kullan.` : '';
  return `${agent.persona ?? ''}\n\nDepartman: ${dept?.name ?? agent.department}${agent.role ? `, rol: ${agent.role}` : ''}.${skills}`.trim();
}

/** Geçmiş başarı: bitmiş run'lara göre. @param {Db} db @param {string} agentId */
export function agentStats(db, agentId) {
  const r = db.prepare(`SELECT sum(r.status = 'succeeded') ok, count(*) n FROM runs r JOIN tasks t ON t.id = r.task_id
    WHERE t.assignee_agent_id = ? AND r.status IN ('succeeded', 'failed', 'timed_out')`).get(agentId);
  const n = Number(r?.n ?? 0);
  return { runs: n, success: n ? Number(r.ok) / n : null };
}

/** İş metninden departman. Eşleşme yoksa build. */
export function routeDepartment(text) {
  const t = String(text ?? '').toLocaleLowerCase('tr');
  let best = 'build';
  let score = 0;
  for (const [dept, words] of Object.entries(ROUTES)) {
    const s = words.reduce((n, w) => n + (t.includes(w) ? 1 : 0), 0);
    if (s > score) { best = dept; score = s; }
  }
  return best;
}

/**
 * İşe en uygun ajan: departman (verilmezse metinden), motor (verilirse), ajan anahtar sözcükleri ve geçmiş başarı.
 * claude motorlu ajanlara kod işi verilmez (Ofis kuralı) — engine verilmişse o motordan seçilir.
 * @param {Db} db @param {{text: string, department?: string|null, engine?: string|null}} q
 */
export function pickAgent(db, { text, department = null, engine = null }) {
  const dept = department ?? routeDepartment(text);
  const t = String(text ?? '').toLocaleLowerCase('tr');
  const all = activeAgents(db).filter((a) => !engine || a.engine === engine);
  const pool = all.filter((a) => a.department === dept);
  const candidates = pool.length ? pool : all;
  let best = null;
  let bestScore = -Infinity;
  for (const a of candidates) {
    const kw = a.keywords.reduce((n, k) => n + (t.includes(k) ? 1 : 0), 0);
    const st = agentStats(db, a.id);
    // Geçmişi olmayan ajan nötr (0.5) sayılır; anahtar sözcük eşleşmesi daha ağır basar.
    const score = kw * 2 + (st.success ?? 0.5) + (a.department === dept ? 1 : 0);
    if (score > bestScore) { best = a; bestScore = score; }
  }
  return best;
}

/** Org şeması metni (reports_to ağacı). @param {Db} db */
export function orgChart(db) {
  const agents = activeAgents(db);
  const kids = new Map();
  for (const a of agents) {
    const k = a.reports_to ?? '';
    if (!kids.has(k)) kids.set(k, []);
    kids.get(k).push(a);
  }
  const lines = [];
  const walk = (parent, depth) => {
    for (const a of kids.get(parent) ?? []) {
      const st = agentStats(db, a.id);
      lines.push(`${'  '.repeat(depth)}- ${a.name} [${DEPARTMENTS[a.department]?.name ?? a.department}, ${a.engine}${a.model ? `/${a.model}` : ''}]${st.runs ? ` başarı %${Math.round(st.success * 100)} (${st.runs})` : ''}`);
      walk(a.id, depth + 1);
    }
  };
  walk('', 0);
  return lines.join('\n');
}
