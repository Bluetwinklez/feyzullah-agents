// fa: feyzullah-agents komut satırı.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
import { resolveApproval } from './ops/gate.js';
import { createSantral } from './server/http.js';
import { suggestHires } from './agents/hiring.js';
import { loadPackages, packageForKind, packageModule } from './packages/loader.js';
import { exportWorkspace, importWorkspace } from './ops/transfer.js';
import { securityCheck } from './ops/security.js';
import { compareCcusage, ourDaily } from './ops/ccusage.js';
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
  merge <görev-id> [--check <komut>]... [--ff-only] [--audit]
                                               görev dalını onayla birleştirir, kontrol düşerse geri alır
  push <dal> [--remote origin]                 sır taraması + onayla iter
  worktrees [--shelve]                         görev worktree'leri; --shelve dokunulmayanları rafa kaldırır
  verify                                       olay zincirini doğrular
  usage [--ccusage <dosya|->]                  günlük Claude kullanımı; ccusage daily --json ile karşılaştırır
  security [<görev>] [--base <ref>] [--audit]  güvenlik taraması (gizli bilgi, riskli dosya, kod kalıpları)
  packages                                     yüklü alan paketleri
  roblox import [--file docs/uretim-sirasi.md] | backlog [--decisions] | next [<hedef>] | layers | autopilot on|off
                                               Roblox paketi (adımlar elle açılır; autopilot kapalı gelir)
  export [--out <dosya>] | import <dosya>      çalışma alanını JSON olarak taşır (sırlar ve günlük hariç)
  hire [--write <id>]                          işe alma önerileri; --write uzman dosyasını yazar
  serve [--port 4317 | FA_PORT] [--host 127.0.0.1] [--worktree]
                                               Santral arayüzü ve yerel API (ağa açılırsa jetonlu adres verir)
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
  if (!['init', 'add', 'run', 'status', 'goal', 'goals', 'approve', 'comment', 'council', 'know', 'agents', 'routine', 'secret', 'merge', 'push', 'worktrees', 'verify', 'security', 'usage', 'serve', 'packages', 'roblox', 'export', 'import', 'hire'].includes(cmd)) { say(`bilinmeyen komut: ${cmd}\n${USAGE}`); return 2; }

  const path = dbPath ?? process.env.FA_DB ?? join(cwd, '.feyzullah-agents', 'fa.db');
  const db = openDb(path);
  let opened = null;
  const vault = vaultIn ?? createVault(db);
  const dataDir = dirname(path);
  const packages = () => loadPackages({ workspace: join(dataDir, 'packages') });
  const kindOf = () => db.prepare("SELECT kind FROM workspaces WHERE id = 'default'").get()?.kind ?? 'generic';
  // Uzmanlar: paketle gelenler, çalışma alanı türünün paketi, sonra çalışma alanının kendi uzmanları (aynı id'yi ezer).
  const sync = () => {
    const list = loadAgents([BUNDLED_AGENTS, packageForKind(packages(), kindOf())?.agentsDir, join(dataDir, 'agents')]);
    syncAgents(db, list);
    return list;
  };
  const kindModule = async () => packageModule(packageForKind(packages(), kindOf()));
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
      const extra = { maxParallel: parseParallel(one('parallel')), network: Boolean(opt.network), ...(opt.worktree ? worktreeOpts() : {}) };
      await driveAll(ad, extra);
      // Roblox autopilot: geçen adımdan sonra sıradaki açılır (yalnız kullanıcı açtıysa; içe aktarmada kapalı).
      const mod = await kindModule();
      for (let i = 0; mod?.advance && i < 20; i++) {
        const opened = mod.advance(db);
        if (!opened.length) break;
        for (const o of opened) say(`sıradaki adım açıldı: ${o.title}`);
        await driveAll(ad, extra);
      }
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
      const { pos, opt } = parseArgs(rest, new Set(['ff-only', 'audit']));
      const taskId = resolveTaskId(db, pos[0] ?? '');
      const r = await mergeWorktree(db, { taskId, checks: opt.check ?? [], ffOnly: Boolean(opt['ff-only']), audit: Boolean(opt.audit) });
      for (const f of r.security ?? []) say(`${f.level === 'block' ? 'ENGEL' : 'uyarı'}: ${f.kind} ${f.file ?? ''} ${f.detail}`);
      if (r.merged) say('birleşti');
      else if (r.approvalId) say(`onay bekliyor: fa approve ${r.approvalId}`);
      else say(`birleşmedi: ${r.reverted ? 'kontrol düştü, geri alındı' : r.security ? 'güvenlik taraması engelledi' : r.error}`);
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
    if (cmd === 'usage') {
      const { one } = parseArgs(rest);
      const src = one('ccusage');
      if (!src) {
        for (const [d, n] of [...ourDaily(db)].sort()) say(`${d} ${n}`);
        return 0;
      }
      const text = src === '-' ? await readStdin() : readFileSync(resolve(root, src), 'utf8');
      let bad = 0;
      for (const r of compareCcusage(db, JSON.parse(text))) {
        if (r.over) bad++;
        say(`${r.date} fa ${r.ours} / ccusage ${r.theirs ?? '-'}${r.share !== null ? ` (%${Math.round(r.share * 100)})` : ''}${r.over ? '  FAZLA SAYIM' : ''}`);
      }
      say(bad ? `${bad} günde fa ccusage'tan fazla saydı: kullanım kaydını incele` : 'tutarlı: fa hiçbir gün ccusage’ı geçmedi');
      return bad ? 1 : 0;
    }
    if (cmd === 'security') {
      const { pos, opt, one } = parseArgs(rest, new Set(['audit']));
      const wt = pos[0] ? db.prepare('SELECT * FROM worktrees WHERE task_id = ?').get(resolveTaskId(db, pos[0])) : null;
      const r = securityCheck({ repo: root, base: one('base') ?? (wt ? 'HEAD' : 'HEAD~1'), branch: wt?.branch ?? 'HEAD', audit: Boolean(opt.audit) });
      for (const f of r.findings) say(`${f.level === 'block' ? 'ENGEL' : 'uyarı'}: ${f.kind} ${f.file ?? ''} ${f.detail}`);
      say(r.ok ? `temiz (${r.findings.length} uyarı)` : 'engellendi');
      return r.ok ? 0 : 1;
    }
    if (cmd === 'worktrees') {
      const { opt } = parseArgs(rest, new Set(['shelve']));
      if (opt.shelve) say(`rafa kalktı: ${shelveWorktrees(db).length}`);
      for (const w of db.prepare('SELECT * FROM worktrees ORDER BY created_at').all()) say(`${w.task_id.slice(0, 8)} ${w.status.padEnd(8)} ${w.branch} ${w.path}`);
      return 0;
    }
    if (cmd === 'serve') {
      const { one, opt } = parseArgs(rest, new Set(['worktree']));
      if (!activeAgents(db).length) sync();
      const ad = await getAdapters();
      const port = Number(one('port') ?? process.env.FA_PORT ?? 4317);
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new UsageError(`geçersiz port: ${one('port') ?? process.env.FA_PORT}`);
      const santral = createSantral({ db, adapters: ad, llm: llmFor(ad), cwd: root, knowledge: knowledgeOf(), vault, host: one('host') ?? '127.0.0.1', port, pack: await kindModule(),
        driveOpts: { lessonParentId: process.env.FA_NOESIS_PARENT ?? null, ...(opt.worktree ? worktreeOpts() : {}) } });
      const url = await santral.listen();
      say(`Santral: ${url}`);
      if ((one('host') ?? '127.0.0.1') !== '127.0.0.1') say('uyarı: ağa açık; adresi yalnız güvendiğin cihazlarla paylaş');
      santral.kick();
      await new Promise((r) => process.once('SIGINT', r));
      await santral.close();
      return 0;
    }
    if (cmd === 'packages') {
      for (const p of packages()) say(`${p.name.padEnd(10)} ${p.bundled ? 'paketle gelen' : 'çalışma alanı'}  türler: ${p.kinds.join(', ') || '-'}  ${p.description ?? ''}`);
      return 0;
    }
    if (cmd === 'roblox') {
      const [sub, ...r2] = rest;
      if (kindOf() !== 'roblox') throw new UsageError('çalışma alanı roblox değil: fa init --kind roblox');
      const mod = await kindModule();
      if (sub === 'layers') {
        const ls = mod.layers(root);
        for (const l of ls) say(`katman ${l.layer}: ${l.cmd.replace(/^set "ROKIT_ROOT=[^"]*"&& /, '')}`);
        if (!ls.length) say('bu klasörde Roblox projesi bulunamadı (stylua.toml, selene.toml, default.project.json, tests/run-*.mjs)');
        return 0;
      }
      if (sub === 'import') {
        const { one } = parseArgs(r2);
        if (!activeAgents(db).length) sync();
        const res = mod.importProduction(db, { root, ...(one('file') ? { file: resolve(root, one('file')) } : {}) });
        for (const g of res) say(`${g.goalId.slice(0, 8)} ${g.title}: ${g.done}/${g.steps} adım bitmiş, kalanlar bekliyor`);
        say('Hiçbir adım kendiliğinden çalışmaz. Sıradakini açmak için: fa roblox next <hedef>');
        return 0;
      }
      if (sub === 'next') {
        const goals = r2[0] ? [db.prepare('SELECT id FROM goals WHERE id = ? OR id LIKE ?').get(r2[0], `${r2[0]}%`)].filter(Boolean) : mod.importedGoals(db);
        if (!goals.length) throw new UsageError('içe aktarılmış hedef yok');
        if (goals.length > 1) throw new UsageError(`birden çok hedef var, birini seç: ${goals.map((g) => g.id.slice(0, 8)).join(', ')}`);
        if (mod.openCount(db, goals[0].id)) throw new UsageError('önceki adım bitmedi');
        const o = mod.promoteNext(db, goals[0].id);
        say(o ? `açıldı: ${o.title} (çalıştırmak için: fa run)` : 'açılacak adım yok');
        return 0;
      }
      if (sub === 'backlog') {
        const { opt } = parseArgs(r2, new Set(['decisions']));
        if (opt.decisions) {
          for (const k of mod.KARARLAR) say(`- ${k.konu}: ${k.secenekler} (${k.ne_zaman})`);
          return 0;
        }
        if (!activeAgents(db).length) sync();
        for (const g of mod.importBacklog(db, { root })) say(`${g.goalId.slice(0, 8)} ${g.title}: ${g.skipped ? 'zaten var, atlandı' : `${g.tasks} iş, hepsi bekliyor`}`);
        say('Hiçbir iş kendiliğinden çalışmaz. Sıradakini açmak için: fa roblox next <hedef>. Senin vermen gereken kararlar: fa roblox backlog --decisions');
        return 0;
      }
      if (sub === 'autopilot') {
        if (r2[0] !== 'on' && r2[0] !== 'off') { say(`autopilot: ${mod.autopilot(db) ? 'açık' : 'kapalı'}`); return 0; }
        mod.autopilot(db, r2[0] === 'on');
        say(`autopilot ${r2[0] === 'on' ? 'açık: geçen adımdan sonra sıradaki kendiliğinden açılır' : 'kapalı'}`);
        return 0;
      }
      throw new UsageError('roblox import | backlog | next | layers | autopilot');
    }
    if (cmd === 'export') {
      const { one } = parseArgs(rest);
      const { data, redacted } = exportWorkspace(db);
      const json = JSON.stringify(data, null, 2);
      if (one('out')) { writeFileSync(resolve(cwd, one('out')), json); say(`yazıldı: ${one('out')}${redacted ? ` (${redacted} alanda gizli bilgi maskelendi)` : ''}`); }
      else stdout.write(`${json}\n`);
      return 0;
    }
    if (cmd === 'import') {
      if (!rest[0]) throw new UsageError('dosya gerekli');
      let data;
      try { data = JSON.parse(readFileSync(resolve(cwd, rest[0]), 'utf8')); } catch (err) { throw new UsageError(`okunamadı: ${err.message}`); }
      const added = importWorkspace(db, data);
      say(`içe aktarıldı: ${Object.entries(added).filter(([, n]) => n).map(([t, n]) => `${t} ${n}`).join(', ') || 'yeni kayıt yok'}`);
      return 0;
    }
    if (cmd === 'hire') {
      const { one } = parseArgs(rest);
      const list = suggestHires(db);
      if (one('write')) {
        const h = list.find((x) => x.id === one('write'));
        if (!h) throw new UsageError(`öneri yok: ${one('write')}`);
        const dir = join(dataDir, 'agents', h.department);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, `${h.id}.md`), h.template);
        sync();
        say(`uzman eklendi: ${join(dir, `${h.id}.md`)}`);
        return 0;
      }
      if (!list.length) say('öneri yok: ekip son işleri karşılıyor');
      for (const h of list) say(`${h.id}: ${h.reason}  (eklemek için: fa hire --write ${h.id})`);
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
      const mod = await kindModule();
      const defaultChecks = mod?.layers ? mod.layers(root).map((l) => l.cmd) : [];
      const p = await planGoal({ db, goalId: goal.id, llm: llmFor(ad), agents: activeAgents(db), knowledge: context, defaultChecks, requireApproval: Boolean(opt.approval), goldfish: Boolean(opt.goldfish) });
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
      let a;
      try { a = resolveApproval(db, pos[0], { approve: !opt.reject }); } catch (err) { throw new UsageError(err.message); }
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
