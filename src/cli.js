// fa: feyzullah-agents komut satırı.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { addComment, createGoal, decideApproval, getDocument, goalProgress, pendingApprovals, saveDocument } from './core/board.js';
import { budgetForecast, budgetStatus } from './core/costs.js';
import { councilDocument, runCouncil } from './core/council.js';
import { approvePlan, createLlm, drive, planGoal, wakeWithComment } from './core/orchestrator.js';
import { openDb, tx } from './core/db.js';
import { since, verifyChain } from './core/events.js';
import { DEFAULT_PARALLEL } from './core/scheduler.js';
import { addDependency, blockTask, createTask, getTask, readyTasks, recoverStale } from './core/tasks.js';
import { commitStep, ensureWorktree, mergeWorktree, pushBranch, shelveWorktrees } from './ops/git.js';
import { addRoutine, listRoutines, setRoutineEnabled, tickRoutines } from './ops/routines.js';
import { createVault } from './ops/vault.js';
import { createCliAdapter } from './engines/adapter.js';
import { normalizeEngine } from './engines/args.js';
import { findBins } from './engines/bins.js';
import { openKnowledge } from './knowledge/noesis.js';
import { activeAgents, loadAgents, missingSkills, orgChart, syncAgents } from './agents/registry.js';

/** Paketle gelen uzmanlar; çalışma alanındaki .feyzullah-agents/agents aynı id'yi ezer. */
const BUNDLED_AGENTS = join(import.meta.dirname, '..', 'agents');

const USAGE = `Kullanım: fa <komut>
  init [--kind generic|roblox]                 çalışma alanını hazırlar
  add "<başlık>" [--engine codex|claude|agy] [--after <id>]... [--prompt-file <f>] [--prompt <metin>]
  run [--parallel codex=3,claude=1] [--network] [--worktree]
                                               zamanı gelen rutinleri açar, hazır görevleri çalıştırır
  goal "<hedef>" [--description <m>] [--check <komut>]... [--approval] [--goldfish] [--plan-only]
                                               hedefi planlar ve (onay gerekmiyorsa) bitirir
  goals                                        hedefler ve ilerleme
  approve <onay-id> [--reject]                 bekleyen onaya karar verir
  comment <görev-id> "<metin>" [--file <f>] [--line <n>] [--wake]
  council "<soru>" [--context <metin>]         5 danışmanlı konsey kararı
  know "<metin>"                               Noesis'ten bu metne uygun bağlam
  agents [--sync]                              uzman havuzu, org şeması, eksik skill'ler
  routine add "<ad>" (--cron "<ifade>" | --when-free <motor>) (--goal <metin> | --task <metin>) [--engine e] [--queue] [--no-catch-up]
  routine list | off <id> | on <id>            zamanlanmış rutinler
  secret set <AD> [--agent <id>]...            değeri stdin'den okur, DPAPI ile saklar
  secret list | grant <AD> <ajan> | rm <AD>    sır kasası (değer gösterilmez)
  merge <görev-id> [--check <komut>]... [--ff-only]
                                               görev dalını onayla birleştirir, kontrol düşerse geri alır
  push <dal> [--remote origin]                 sır taraması + onayla iter
  worktrees [--shelve]                         görev worktree'leri; --shelve dokunulmayanları rafa kaldırır
  verify                                       olay zincirini doğrular
  status                                       durum, son olaylar, bütçe ve tahmin
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
 * @param {{dbPath?: string, stdout?: {write: (s: string) => void}, cwd?: string, adapters?: Record<string, any>, llm?: import('./core/orchestrator.js').Llm,
 *   knowledge?: any}} [o]
 *   knowledge: verilmezse Noesis kuruluysa ona bağlanılır (FA_NOESIS=0 kapatır).
 * @returns {Promise<number>} çıkış kodu
 */
export async function main(argv, { dbPath, stdout = process.stdout, cwd = process.cwd(), adapters, llm, knowledge: knowledgeIn, readStdin = readAllStdin, vault: vaultIn } = {}) {
  const say = (s = '') => stdout.write(`${s}\n`);
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === 'help' || cmd === '--help') { say(USAGE); return 0; }
  if (cmd === 'bins') {
    const bins = await findBins();
    for (const e of ['claude', 'codex', 'antigravity']) say(`${e.padEnd(12)} ${bins[e] ?? '(yok)'}`);
    return 0;
  }
  if (cmd === 'bench') return bench(say);
  if (!['init', 'add', 'run', 'status', 'goal', 'goals', 'approve', 'comment', 'council', 'know', 'agents', 'routine', 'secret', 'merge', 'push', 'worktrees', 'verify'].includes(cmd)) { say(`bilinmeyen komut: ${cmd}\n${USAGE}`); return 2; }

  const path = dbPath ?? process.env.FA_DB ?? join(cwd, '.feyzullah-agents', 'fa.db');
  const db = openDb(path);
  let opened = null;
  const agentDirs = [BUNDLED_AGENTS, join(dirname(path), 'agents')];
  const vault = vaultIn ?? createVault(db);
  const sync = () => { const list = loadAgents(agentDirs); syncAgents(db, list); return list; };
  const knowledgeOf = () => {
    if (knowledgeIn !== undefined) return knowledgeIn;
    if (opened === null) opened = openKnowledge(db) ?? false;
    return opened || null;
  };
  try {
    const recovered = recoverStale(db);
    if (recovered) say(`kurtarıldı: ${recovered} yarım kalan çalışma yeniden kuyrukta`);
    if (cmd === 'init') {
      const { one } = parseArgs(rest);
      const kind = one('kind') ?? 'generic';
      if (!KINDS.has(kind)) throw new UsageError(`bilinmeyen tür: ${kind}`);
      db.prepare("UPDATE workspaces SET root = ?, kind = ? WHERE id = 'default'").run(resolve(cwd), kind);
      const n = sync().length;
      say(`hazır: ${path} (${kind}), ${n} uzman`);
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
        const r = await drive({ db, adapters: ad, llm: llmFor(ad), cwd: root, signal: ctrl.signal, knowledge: knowledgeOf(), lessonParentId: process.env.FA_NOESIS_PARENT ?? null, vault, ...extra });
        say(`bitti ${r.done}, başarısız ${r.failed}, bekleyen ${r.blocked} (bütçe ${r.skippedBudget}), inceleme ${r.reviews}`);
        for (const g of r.goals) say(`hedef ${g.goalId.slice(0, 8)}: ${g.status}\n${g.report}${g.lesson?.created ? `\nNoesis'e not yazıldı: ${g.lesson.id}` : ''}`);
      } finally { process.off('SIGINT', stop); }
    };
    const llmFor = (ad) => llm ?? createLlm(ad, { cwd: root });
    /** Zamanı gelen rutinler: görevler kuyruğa girer, hedefler planlanır. */
    const fireRoutines = async (ad) => {
      for (const f of tickRoutines(db)) {
        if (f.skipped) { say(`rutin atlandı (${f.skipped}): ${f.routineId.slice(0, 8)}`); continue; }
        say(`rutin çalıştı: ${f.kind} ${f.entityId.slice(0, 8)}`);
        if (f.kind === 'goal') {
          if (!activeAgents(db).length) sync();
          await planGoal({ db, goalId: f.entityId, llm: llmFor(ad), agents: activeAgents(db) }).catch((err) => say(`rutin planlanamadı: ${err.message}`));
        }
      }
    };
    /** --worktree: her görev kendi dalında; başarılı adım commit'lenir (sır varsa commit durur). */
    const worktreeOpts = () => ({
      cwdFor: (t) => ensureWorktree(db, { repo: root, taskId: t.id }),
      onSucceeded: (t, at) => commitStep(at, `fa: ${t.title}`),
    });
    if (cmd === 'run') {
      const { one, opt } = parseArgs(rest, new Set(['network', 'worktree']));
      const ad = await getAdapters();
      await fireRoutines(ad);
      await driveAll(ad, { maxParallel: parseParallel(one('parallel')), network: Boolean(opt.network), ...(opt.worktree ? worktreeOpts() : {}) });
      return 0;
    }
    if (cmd === 'routine') {
      const [sub, ...r2] = rest;
      if (sub === 'add') {
        const { pos, opt, one } = parseArgs(r2, new Set(['queue', 'no-catch-up']));
        const name = pos.join(' ').trim();
        const body = one('goal') ?? one('task');
        if (!name || !body) throw new UsageError('ad ve --goal ya da --task gerekli');
        const id = addRoutine(db, {
          name, cron: one('cron'), kind: one('task') != null ? 'task' : 'goal', body, engine: one('engine') ?? one('when-free'),
          concurrency: opt.queue ? 'queue' : 'skip', catchUp: opt['no-catch-up'] ? 'none' : 'latest', whenFree: one('when-free') != null,
        });
        const r = db.prepare('SELECT next_run_at FROM routines WHERE id = ?').get(id);
        say(`${id} sonraki: ${new Date(r.next_run_at).toLocaleString('tr-TR')}`);
        return 0;
      }
      if (sub === 'off' || sub === 'on') { setRoutineEnabled(db, r2[0] ?? '', sub === 'on'); say(`rutin ${sub === 'on' ? 'açıldı' : 'kapandı'}`); return 0; }
      if (sub === 'tick') { await fireRoutines(await getAdapters()); return 0; }
      for (const r of listRoutines(db)) {
        say(`${r.id.slice(0, 8)} ${r.enabled ? 'açık ' : 'kapalı'} ${r.cron ?? `limit açılınca (${r.engine})`} ${r.kind} "${r.name}" sonraki ${r.next_run_at ? new Date(r.next_run_at).toLocaleString('tr-TR') : '-'}`);
      }
      return 0;
    }
    if (cmd === 'secret') {
      const [sub, ...r2] = rest;
      if (sub === 'set') {
        const { pos, opt } = parseArgs(r2);
        const value = (await readStdin()).replace(/\r?\n$/, '');
        vault.set(pos[0] ?? '', value, { agents: opt.agent ?? [] });
        say(`saklandı: ${pos[0]}`);
        return 0;
      }
      if (sub === 'grant') { vault.grant(r2[0], r2[1]); say(`izin verildi: ${r2[0]} → ${r2[1]}`); return 0; }
      if (sub === 'rm') { vault.remove(r2[0]); say(`silindi: ${r2[0]}`); return 0; }
      for (const s of vault.list()) say(`${s.name.padEnd(24)} ${s.agents.join(', ') || '(kimseye açık değil)'}`);
      return 0;
    }
    if (cmd === 'merge') {
      const { pos, opt } = parseArgs(rest, new Set(['ff-only']));
      const taskId = resolveTaskId(db, pos[0] ?? '');
      const r = await mergeWorktree(db, { taskId, checks: opt.check ?? [], ffOnly: Boolean(opt['ff-only']) });
      if (r.merged) say('birleşti');
      else if (r.approvalId) say(`onay bekliyor: fa approve ${r.approvalId}`);
      else say(`birleşmedi: ${r.reverted ? 'kontrol düştü, geri alındı' : r.error}`);
      return r.merged || r.approvalId ? 0 : 1;
    }
    if (cmd === 'push') {
      const { pos, one } = parseArgs(rest);
      if (!pos[0]) throw new UsageError('dal gerekli');
      const r = pushBranch(db, { repo: root, branch: pos[0], remote: one('remote') ?? 'origin' });
      if (r.pushed) say('gönderildi');
      else if (r.secrets) say(`durduruldu, olası gizli bilgi: ${r.secrets.join(', ')}`);
      else if (r.approvalId) say(`onay bekliyor: fa approve ${r.approvalId}`);
      else say(`gönderilemedi: ${r.error}`);
      return r.pushed || r.approvalId ? 0 : 1;
    }
    if (cmd === 'worktrees') {
      const { opt } = parseArgs(rest, new Set(['shelve']));
      if (opt.shelve) say(`rafa kalktı: ${shelveWorktrees(db).length}`);
      for (const w of db.prepare('SELECT * FROM worktrees ORDER BY created_at').all()) say(`${w.task_id.slice(0, 8)} ${w.status.padEnd(8)} ${w.branch} ${w.path}`);
      return 0;
    }
    if (cmd === 'verify') {
      const v = verifyChain(db);
      say(v.ok ? `olay zinciri sağlam (${v.checked} olay)` : `olay zinciri bozuk: #${v.brokenAt}`);
      return v.ok ? 0 : 1;
    }
    if (cmd === 'goal') {
      const { pos, opt, one } = parseArgs(rest, new Set(['approval', 'goldfish', 'plan-only']));
      const title = pos.join(' ').trim();
      if (!title) throw new UsageError('hedef gerekli');
      const goal = createGoal(db, { title, description: one('description'), checks: opt.check ?? null });
      const ad = await getAdapters();
      const kn = knowledgeOf();
      let context = '';
      if (kn) {
        const c = await kn.contextFor(`${title} ${one('description') ?? ''}`).catch(() => ({ text: '', pages: [], warnings: [] }));
        context = c.text;
        if (c.pages.length) say(`Noesis: ${c.pages.length} not bağlama eklendi${c.warnings.length ? `, ${c.warnings.length} uyarılı (${c.warnings.map((w) => w.title).join('; ')})` : ''}`);
      }
      if (!activeAgents(db).length) sync();
      const p = await planGoal({ db, goalId: goal.id, llm: llmFor(ad), agents: activeAgents(db), knowledge: context, requireApproval: Boolean(opt.approval), goldfish: Boolean(opt.goldfish) });
      say(`hedef ${goal.id}\n${p.reply}`);
      for (const r of db.prepare('SELECT id, title, engine, assignee_agent_id a FROM tasks WHERE goal_id = ? ORDER BY created_at, rowid').all(goal.id)) say(`  ${r.id.slice(0, 8)} [${r.engine}${r.a ? `, ${r.a}` : ''}] ${r.title}`);
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
      // Kurtarma kartı onaylanınca takılan görev yeniden kuyruğa girer.
      if (a.action === 'task.recover' && !opt.reject && getTask(db, a.entity_id)?.status === 'blocked') blockTask(db, a.entity_id, { retryAt: Date.now(), reason: 'kurtarma onaylandı' });
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
    if (cmd === 'agents') {
      const { opt } = parseArgs(rest, new Set(['sync']));
      if (opt.sync || !activeAgents(db).length) say(`eşitlendi: ${sync().length} uzman`);
      say(orgChart(db));
      for (const a of activeAgents(db)) {
        const miss = missingSkills(a);
        if (miss.length) say(`uyarı: ${a.id} için skill bulunamadı: ${miss.join(', ')}`);
      }
      return 0;
    }
    if (cmd === 'know') {
      const kn = knowledgeOf();
      if (!kn) { say('Noesis bulunamadı (FA_NOESIS_EXE ile yol verilebilir)'); return 1; }
      const c = await kn.contextFor(rest.join(' '));
      say(c.text || '(ilgili not yok)');
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
    for (const f of budgetForecast(db)) {
      if (f.perHour) say(`  ${f.budgetId}: saatte ${f.perHour} token${f.exhaustAt ? `, bu hızla ${new Date(f.exhaustAt).toLocaleTimeString('tr-TR')} dolar` : ', pencere içinde dolmaz'}`);
    }
    const last = db.prepare('SELECT max(seq) m FROM events').get().m ?? 0;
    for (const e of since(db, Math.max(0, last - 10), 10)) say(`  ${new Date(e.at).toLocaleTimeString('tr-TR')} ${e.type} ${e.entityId?.slice(0, 8) ?? ''}`);
    return 0;
  } catch (err) {
    if (err instanceof UsageError || /bilinmeyen motor|döngü/.test(err.message)) { say(`hata: ${err.message}`); return 2; }
    throw err;
  } finally {
    if (opened) opened.close();
    db.close();
  }
}

/** Standart girdinin tamamı (sır değeri komut satırında görünmesin diye). */
async function readAllStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
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
