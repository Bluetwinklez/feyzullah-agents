// fa: feyzullah-agents komut satırı.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { addComment, createGoal, decideApproval, getDocument, goalProgress, pendingApprovals, saveDocument } from './core/board.js';
import { budgetStatus } from './core/costs.js';
import { councilDocument, runCouncil } from './core/council.js';
import { approvePlan, createLlm, drive, planGoal, wakeWithComment } from './core/orchestrator.js';
import { openDb, tx } from './core/db.js';
import { since } from './core/events.js';
import { DEFAULT_PARALLEL } from './core/scheduler.js';
import { addDependency, createTask, readyTasks, recoverStale } from './core/tasks.js';
import { createCliAdapter } from './engines/adapter.js';
import { normalizeEngine } from './engines/args.js';
import { findBins } from './engines/bins.js';

const USAGE = `Kullanım: fa <komut>
  init [--kind generic|roblox]                 çalışma alanını hazırlar
  add "<başlık>" [--engine codex|claude|agy] [--after <id>]... [--prompt-file <f>] [--prompt <metin>]
  run [--parallel codex=3,claude=1] [--network]  hazır görevleri çalıştırır, incelemeleri yürütür
  goal "<hedef>" [--description <m>] [--check <komut>]... [--approval] [--goldfish] [--plan-only]
                                               hedefi planlar ve (onay gerekmiyorsa) bitirir
  goals                                        hedefler ve ilerleme
  approve <onay-id> [--reject]                 bekleyen onaya karar verir
  comment <görev-id> "<metin>" [--file <f>] [--line <n>] [--wake]
  council "<soru>" [--context <metin>]         5 danışmanlı konsey kararı
  status                                       durum, son olaylar, bütçe
  bins                                         bulunan motorlar
  bench                                        1000 görevle hız ölçümü`;

const KINDS = new Set(['generic', 'roblox']);

/** Basit argüman ayrıştırıcı: --x değer (tekrarlanabilir), --bayrak, konumsal. */
function parseArgs(argv, flags = new Set()) {
  const pos = [];
  const opt = /** @type {Record<string, string[]>} */ ({});
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const k = a.slice(2);
    if (flags.has(k)) { (opt[k] ??= []).push('1'); continue; }
    if (i + 1 >= argv.length) throw new UsageError(`${a} için değer eksik`);
    (opt[k] ??= []).push(argv[++i]);
  }
  return { pos, opt, one: (k) => opt[k]?.at(-1) ?? null };
}

class UsageError extends Error {}

/** Tam kimlik ya da en az 4 karakterlik ön ek. */
function resolveTaskId(db, ref) {
  const rows = db.prepare('SELECT id FROM tasks WHERE id = ? OR id LIKE ?').all(ref, `${ref}%`);
  if (ref.length < 4 || rows.length !== 1) throw new UsageError(`görev bulunamadı ya da belirsiz: ${ref}`);
  return rows[0].id;
}

function parseParallel(s) {
  const out = { ...DEFAULT_PARALLEL };
  if (!s) return out;
  for (const part of s.split(',')) {
    const [e, n] = part.split('=');
    const v = Number(n);
    if (!Number.isInteger(v) || v < 1) throw new UsageError(`geçersiz paralellik: ${part}`);
    out[normalizeEngine(e)] = v;
  }
  return out;
}

/**
 * @param {string[]} argv
 * @param {{dbPath?: string, stdout?: {write: (s: string) => void}, cwd?: string, adapters?: Record<string, any>, llm?: import('./core/orchestrator.js').Llm}} [o]
 * @returns {Promise<number>} çıkış kodu
 */
export async function main(argv, { dbPath, stdout = process.stdout, cwd = process.cwd(), adapters, llm } = {}) {
  const say = (s = '') => stdout.write(`${s}\n`);
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === 'help' || cmd === '--help') { say(USAGE); return 0; }
  if (cmd === 'bins') {
    const bins = await findBins();
    for (const e of ['claude', 'codex', 'antigravity']) say(`${e.padEnd(12)} ${bins[e] ?? '(yok)'}`);
    return 0;
  }
  if (cmd === 'bench') return bench(say);
  if (!['init', 'add', 'run', 'status', 'goal', 'goals', 'approve', 'comment', 'council'].includes(cmd)) { say(`bilinmeyen komut: ${cmd}\n${USAGE}`); return 2; }

  const path = dbPath ?? process.env.FA_DB ?? join(cwd, '.feyzullah-agents', 'fa.db');
  const db = openDb(path);
  try {
    const recovered = recoverStale(db);
    if (recovered) say(`kurtarıldı: ${recovered} yarım kalan çalışma yeniden kuyrukta`);
    if (cmd === 'init') {
      const { one } = parseArgs(rest);
      const kind = one('kind') ?? 'generic';
      if (!KINDS.has(kind)) throw new UsageError(`bilinmeyen tür: ${kind}`);
      db.prepare("UPDATE workspaces SET root = ?, kind = ? WHERE id = 'default'").run(resolve(cwd), kind);
      say(`hazır: ${path} (${kind})`);
      return 0;
    }
    if (cmd === 'add') {
      const { pos, opt, one } = parseArgs(rest);
      const title = pos.join(' ').trim();
      if (!title) throw new UsageError('başlık gerekli');
      const engine = one('engine') ? normalizeEngine(one('engine')) : null;
      const file = one('prompt-file');
      const prompt = file ? readFileSync(resolve(cwd, file), 'utf8') : one('prompt');
      const task = tx(db, () => {
        const t = createTask(db, { title, prompt, engine });
        for (const ref of opt.after ?? []) addDependency(db, t.id, resolveTaskId(db, ref));
        return t;
      });
      say(`${task.id} ${title}`);
      return 0;
    }
    const root = db.prepare("SELECT root FROM workspaces WHERE id = 'default'").get()?.root ?? cwd;
    const getAdapters = async () => adapters ?? Object.fromEntries(Object.entries(await findBins()).map(([e, bin]) => [e, createCliAdapter(/** @type {any} */ (e), { bin })]));
    const driveAll = async (ad, extra = {}) => {
      const ctrl = new AbortController();
      const stop = () => ctrl.abort();
      process.once('SIGINT', stop);
      try {
        const r = await drive({ db, adapters: ad, llm: llmFor(ad), cwd: root, signal: ctrl.signal, ...extra });
        say(`bitti ${r.done}, başarısız ${r.failed}, bekleyen ${r.blocked} (bütçe ${r.skippedBudget}), inceleme ${r.reviews}`);
        for (const g of r.goals) say(`hedef ${g.goalId.slice(0, 8)}: ${g.status}\n${g.report}`);
      } finally { process.off('SIGINT', stop); }
    };
    const llmFor = (ad) => llm ?? createLlm(ad, { cwd: root });
    if (cmd === 'run') {
      const { one, opt } = parseArgs(rest, new Set(['network']));
      await driveAll(await getAdapters(), { maxParallel: parseParallel(one('parallel')), network: Boolean(opt.network) });
      return 0;
    }
    if (cmd === 'goal') {
      const { pos, opt, one } = parseArgs(rest, new Set(['approval', 'goldfish', 'plan-only']));
      const title = pos.join(' ').trim();
      if (!title) throw new UsageError('hedef gerekli');
      const goal = createGoal(db, { title, description: one('description'), checks: opt.check ?? null });
      const ad = await getAdapters();
      const p = await planGoal({ db, goalId: goal.id, llm: llmFor(ad), requireApproval: Boolean(opt.approval), goldfish: Boolean(opt.goldfish) });
      say(`hedef ${goal.id}\n${p.reply}`);
      for (const r of db.prepare('SELECT id, title, engine FROM tasks WHERE goal_id = ? ORDER BY created_at, rowid').all(goal.id)) say(`  ${r.id.slice(0, 8)} [${r.engine}] ${r.title}`);
      if (p.approvalId) { say(`plan onay bekliyor: fa approve ${p.approvalId}`); return 0; }
      if (!opt['plan-only']) await driveAll(ad, { goalId: goal.id });
      return 0;
    }
    if (cmd === 'goals') {
      for (const g of db.prepare('SELECT * FROM goals ORDER BY created_at DESC LIMIT 20').all()) {
        const p = Object.entries(goalProgress(db, g.id)).map(([s, n]) => `${s} ${n}`).join(', ');
        say(`${g.id.slice(0, 8)} ${g.status.padEnd(17)} ${g.title} (${p || 'görev yok'})`);
      }
      for (const a of pendingApprovals(db)) say(`onay bekliyor: ${a.id} ${a.action} ${a.entity_id?.slice(0, 8) ?? ''}`);
      return 0;
    }
    if (cmd === 'approve') {
      const { pos, opt } = parseArgs(rest, new Set(['reject']));
      const a = pos[0] && db.prepare('SELECT * FROM approvals WHERE id = ? OR id LIKE ?').get(pos[0], `${pos[0]}%`);
      if (!a) throw new UsageError(`onay bulunamadı: ${pos[0] ?? ''}`);
      if (a.action === 'plan.approve') approvePlan(db, a.entity_id, { approve: !opt.reject });
      else decideApproval(db, a.id, { approve: !opt.reject, by: 'kullanıcı' });
      say(`${opt.reject ? 'reddedildi' : 'onaylandı'}: ${a.action}`);
      return 0;
    }
    if (cmd === 'comment') {
      const { pos, opt, one } = parseArgs(rest, new Set(['wake']));
      if (pos.length < 2) throw new UsageError('görev ve metin gerekli');
      const taskId = resolveTaskId(db, pos[0]);
      const anchor = one('file') ? { file: one('file'), line: one('line') ? Number(one('line')) : null } : null;
      addComment(db, { entity: 'task', entityId: taskId, author: 'kullanıcı', body: pos.slice(1).join(' '), anchor });
      if (opt.wake) wakeWithComment(db, taskId);
      say(`yorum eklendi${opt.wake ? ', görev yeniden kuyrukta' : ''}`);
      return 0;
    }
    if (cmd === 'council') {
      const { pos, one } = parseArgs(rest);
      const question = pos.join(' ').trim();
      if (!question) throw new UsageError('soru gerekli');
      const r = await runCouncil({ question, context: one('context') ?? '', llm: llmFor(await getAdapters()) });
      const doc = councilDocument(question, r);
      saveDocument(db, { entity: 'council', entityId: String(Date.now()), name: 'karar', body: doc, author: 'council' });
      say(doc);
      return 0;
    }
    // status
    for (const r of db.prepare('SELECT status, count(*) n FROM tasks GROUP BY status ORDER BY status').all()) say(`${r.status.padEnd(12)} ${r.n}`);
    const b = budgetStatus(db);
    say(`bütçe: ${b.state}${b.limit ? ` ${b.used}/${b.limit} token` : ` (sınır yok, bugün ${b.used} token)`}, bilinmeyen kullanım: ${b.unknownRuns}`);
    const last = db.prepare('SELECT max(seq) m FROM events').get().m ?? 0;
    for (const e of since(db, Math.max(0, last - 10), 10)) say(`  ${new Date(e.at).toLocaleTimeString('tr-TR')} ${e.type} ${e.entityId?.slice(0, 8) ?? ''}`);
    return 0;
  } catch (err) {
    if (err instanceof UsageError || /bilinmeyen motor|döngü/.test(err.message)) { say(`hata: ${err.message}`); return 2; }
    throw err;
  } finally {
    db.close();
  }
}

/** 1000 görev (her biri bir öncekine yarı olasılıkla bağlı) + readyTasks süresi. */
function bench(say) {
  const db = openDb();
  const t0 = performance.now();
  tx(db, () => {
    let prev = null;
    for (let i = 0; i < 1000; i++) {
      const t = createTask(db, { title: `g${i}` });
      if (prev && i % 2) addDependency(db, t.id, prev);
      prev = t.id;
    }
  });
  const ready = readyTasks(db, { limit: 1000 }).length;
  const ms = performance.now() - t0;
  db.close();
  say(`1000 görev, ${ready} hazır: ${ms.toFixed(1)} ms`);
  return 0;
}
