// Bilgi katmanı: Noesis'ten okuma (önbellekli, FTS), görevlere bağlam, uyarı işaretleri ve "ne öğrendik" sayfaları.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { now } from '../core/db.js';
import { append } from '../core/events.js';
import { createMcpClient } from './mcp-client.js';
import { redactText } from './secrets.js';

/** @typedef {import('node:sqlite').DatabaseSync} Db */

export const WARNING_RE = /önerilmez|önerilmiyor|güvenlik riski|doğrulanmadı|kullanılmaz|not recommended|security risk|unverified/i;
const STOP = new Set(('ve veya ile için gibi bir bu şu o da de ki mi mı ne nasıl daha çok en ama fakat ya yap yaz oku dosya dosyasına dosyası ' +
  'the and for with from this that into your have will what about make write read file').split(' '));

/** Varsayılan Noesis yolu (Windows kurulumu). */
export function noesisCommand(env = process.env) {
  if (env.FA_NOESIS === '0') return null;
  const exe = env.FA_NOESIS_EXE ?? join(env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Noesis', 'noesis.exe');
  return existsSync(exe) ? exe : null;
}

/** Metinden arama sözcükleri: 3+ harfli (MCP, API gibi), durak sözcüksüz, tekrarsız. */
export function keywords(text, max = 6) {
  const words = String(text ?? '').toLocaleLowerCase('tr').match(/[\p{L}\p{N}][\p{L}\p{N}._-]{2,}/gu) ?? [];
  return [...new Set(words.filter((w) => !STOP.has(w)))].slice(0, max);
}

/** FTS sorgusu için güvenli ifade (sözcükler OR ile). */
const ftsQuery = (words) => words.map((w) => `"${w.replace(/"/g, '')}"`).join(' OR ');

/**
 * @param {{db: Db, client: {callTool: (name: string, args?: object) => Promise<any>}, ttlMs?: number, readLimit?: number}} o
 */
export function createKnowledge({ db, client, ttlMs = 6 * 3600_000, readLimit = 3 }) {
  const putPage = (p) => {
    const warning = WARNING_RE.test(`${p.title}\n${p.body}`) ? (WARNING_RE.exec(`${p.title}\n${p.body}`)[0]) : null;
    db.prepare(`INSERT INTO knowledge_pages(id, source, title, body, warning, fetched_at) VALUES (?, 'noesis', ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET title = excluded.title, body = excluded.body, warning = excluded.warning, fetched_at = excluded.fetched_at`)
      .run(p.id, p.title, p.body, warning, now());
    db.prepare('DELETE FROM knowledge_fts WHERE page_id = ?').run(p.id);
    db.prepare('INSERT INTO knowledge_fts(page_id, title, body) VALUES (?, ?, ?)').run(p.id, p.title, p.body);
  };
  const cachedPage = (id) => db.prepare('SELECT * FROM knowledge_pages WHERE id = ? AND fetched_at > ?').get(id, now() - ttlMs);

  async function readPage(id) {
    const c = cachedPage(id);
    if (c) return c;
    const r = await client.callTool('read_page', { page_id: id });
    const body = typeof r === 'string' ? r : r?.markdown ?? r?.body ?? r?.content ?? JSON.stringify(r);
    // Noesis tabloları HTML olarak saklıyor: etiketler bağlamda yalnız gürültü.
    const text = String(body).replace(/<\/(p|tr|li|h\d)>/gi, '\n').replace(/<\/t[dh]>/gi, ' | ').replace(/<[^>]+>/g, '')
      .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
    const title = typeof r === 'object' && r?.title ? r.title : id;
    putPage({ id, title, body: text });
    return cachedPage(id);
  }

  /** Noesis araması; sonuç sorguya göre önbelleklenir, ilk sayfalar okunup FTS'e girer. */
  async function search(query, { limit = 8 } = {}) {
    const q = db.prepare('SELECT * FROM knowledge_queries WHERE query = ? AND fetched_at > ?').get(query, now() - ttlMs);
    if (q) return JSON.parse(q.results);
    const raw = await client.callTool('search_notes', { query, limit });
    const results = (Array.isArray(raw) ? raw : []).filter((r) => r?.id).map((r) => ({ id: r.id, title: r.title ?? '', snippet: r.snippet ?? '' }));
    db.prepare(`INSERT INTO knowledge_queries(query, source, results, fetched_at) VALUES (?, 'noesis', ?, ?)
      ON CONFLICT(query) DO UPDATE SET results = excluded.results, fetched_at = excluded.fetched_at`).run(query, JSON.stringify(results), now());
    for (const r of results.slice(0, readLimit)) await readPage(r.id).catch(() => null);
    return results;
  }

  /**
   * Görev metnine göre bağlam: Noesis araması + yerel FTS sıralaması. Uyarılı sayfalar başta ve işaretli verilir.
   * Noesis'e ulaşılamazsa yalnız önbellekten döner.
   * @param {string} text @param {{maxChars?: number, limit?: number}} [o]
   */
  async function contextFor(text, { maxChars = 4000, limit = 5 } = {}) {
    const words = keywords(text);
    if (!words.length) return { text: '', pages: [], warnings: [] };
    // Önce Noesis'in kendi sıralaması, sonra yerel FTS (Noesis kapalıysa yalnız FTS).
    const ids = [];
    try {
      for (const r of await search(words.slice(0, 3).join(' '))) ids.push(r.id);
    } catch (err) {
      append(db, { actor: 'knowledge', type: 'knowledge.offline', data: { error: err.message } });
    }
    for (const w of words.slice(0, 2)) for (const r of (await search(w).catch(() => [])) ?? []) ids.push(r.id);
    for (const r of db.prepare('SELECT page_id FROM knowledge_fts WHERE knowledge_fts MATCH ? ORDER BY bm25(knowledge_fts) LIMIT ?').all(ftsQuery(words), limit * 2)) ids.push(r.page_id);
    const byId = db.prepare('SELECT id, title, body, warning FROM knowledge_pages WHERE id = ?');
    const seen = new Set();
    const ordered = [];
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      const p = byId.get(id);
      if (p) ordered.push(p);
    }
    // Uyarılı sayfalar başa: "önerilmez" bilgisi ajan bir aracı seçmeden önce görünsün.
    const rows = [...ordered.filter((p) => p.warning), ...ordered.filter((p) => !p.warning)].slice(0, limit);
    let out = '';
    const pages = [];
    for (const r of rows) {
      const head = `### ${r.title}${r.warning ? ` ⚠ ${r.warning}: önce doğrula ya da kullanma` : ''}\n`;
      const body = r.body.replace(/\s+\n/g, '\n').slice(0, 900);
      if (out.length + head.length + body.length > maxChars) break;
      out += `${head}${body}\n\n`;
      pages.push({ id: r.id, title: r.title, warning: r.warning });
    }
    return { text: out.trim(), pages, warnings: pages.filter((p) => p.warning) };
  }

  /**
   * "Ne öğrendik" sayfası. Metin gizli bilgi filtresinden geçer; aynı başlıkta sayfa varsa yenisi açılmaz
   * (var olan sayfayı değiştirmek kullanıcı onayı ister).
   * @param {{title: string, markdown: string, parentId?: string|null}} p
   */
  async function writeLesson({ title, markdown, parentId = null }) {
    const existing = (await client.callTool('search_notes', { query: title, limit: 5 }).catch(() => [])) ?? [];
    const same = (Array.isArray(existing) ? existing : []).find((r) => r?.title?.trim().toLocaleLowerCase('tr') === title.trim().toLocaleLowerCase('tr'));
    if (same) return { id: same.id, created: false, redacted: [] };
    const clean = redactText(markdown);
    const cleanTitle = redactText(title).text;
    const r = await client.callTool('create_page', { title: cleanTitle, markdown: clean.text, ...(parentId ? { parent_id: parentId } : {}) });
    append(db, { actor: 'knowledge', type: 'knowledge.written', data: { id: r?.id ?? null, title: cleanTitle, redacted: clean.found } });
    return { id: r?.id ?? null, created: true, redacted: clean.found };
  }

  return { search, readPage, contextFor, writeLesson };
}

/** Çalışan Noesis'e bağlı bilgi katmanı; Noesis yoksa null. */
export function openKnowledge(db, env = process.env) {
  const command = noesisCommand(env);
  if (!command) return null;
  const client = createMcpClient({ command, args: ['--mcp'] });
  return { ...createKnowledge({ db, client }), close: () => client.close() };
}

export const lessonPrompt = (goal, report) => `Bu hedef tamamlandı: ${goal.title}

Rapor:
${String(report).slice(0, 4000)}

Bu işten kalıcı değeri olan bir şey öğrenildi mi (yeni araç, kurulum yolu, çözüm, önemli karar)? Yoksa yalnız "YOK" yaz.
Varsa şu başlıklarla kısa bir Markdown not yaz: ## Kaynak, ## Özet, ## Ayrıntılar, ## Kurulum/komutlar, ## Değerlendirme, ## Durum.
Not başlığını ilk satıra "BAŞLIK: ..." olarak yaz. Anahtar, jeton, parola ya da kişisel veri yazma.`;

/** lessonPrompt cevabı → {title, markdown} | null */
export function parseLesson(text) {
  const t = String(text ?? '').trim();
  if (!t || /^YOK\b/i.test(t)) return null;
  const m = /^BAŞLIK:\s*(.+)$/im.exec(t);
  if (!m) return null;
  return { title: m[1].trim().slice(0, 160), markdown: t.replace(m[0], '').trim() };
}
