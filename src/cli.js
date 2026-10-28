// fa: feyzullah-agents komut satırı.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { budgetStatus } from './core/costs.js';
import { openDb, tx } from './core/db.js';
import { since } from './core/events.js';
import { runReady, DEFAULT_PARALLEL } from './core/scheduler.js';
import { addDependency, createTask, readyTasks, recoverStale } from './core/tasks.js';
import { createCliAdapter } from './engines/adapter.js';
import { normalizeEngine } from './engines/args.js';
import { findBins } from './engines/bins.js';

const USAGE = `Kullanım: fa <komut>
  init [--kind generic|roblox]                 çalışma alanını hazırlar
  add "<başlık>" [--engine codex|claude|agy] [--after <id>]... [--prompt-file <f>] [--prompt <metin>]
  run [--parallel codex=3,claude=1] [--network]  hazır görevleri çalıştırır
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
 * @param {{dbPath?: string, stdout?: {write: (s: string) => void}, cwd?: string, adapters?: Record<string, any>}} [o]
 * @returns {Promise<number>} çıkış kodu
 */
export async function main(argv, { dbPath, stdout = process.stdout, cwd = process.cwd(), adapters } = {}) {
  const say = (s = '') => stdout.write(`${s}\n`);
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === 'help' || cmd === '--help') { say(USAGE); return 0; }
  if (cmd === 'bins') {
    const bins = await findBins();
    for (const e of ['claude', 'codex', 'antigravity']) say(`${e.padEnd(12)} ${bins[e] ?? '(yok)'}`);
    return 0;
  }
  if (cmd === 'bench') return bench(say);
  if (!['init', 'add', 'run', 'status'].includes(cmd)) { say(`bilinmeyen komut: ${cmd}\n${USAGE}`); return 2; }

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
    if (cmd === 'run') {
      const { one, opt } = parseArgs(rest, new Set(['network']));
      const maxParallel = parseParallel(one('parallel'));
      let ad = adapters;
      if (!ad) {
        const bins = await findBins();
        ad = Object.fromEntries(Object.entries(bins).map(([e, bin]) => [e, createCliAdapter(/** @type {any} */ (e), { bin })]));
      }
      const root = db.prepare("SELECT root FROM workspaces WHERE id = 'default'").get()?.root ?? cwd;
      const ctrl = new AbortController();
      const stop = () => ctrl.abort();
      process.once('SIGINT', stop);
      try {
        const r = await runReady({ db, adapters: ad, maxParallel, cwd: root, network: Boolean(opt.network), signal: ctrl.signal });
        say(`bitti ${r.done}, başarısız ${r.failed}, bekleyen ${r.blocked} (bütçe ${r.skippedBudget})`);
      } finally { process.off('SIGINT', stop); }
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
