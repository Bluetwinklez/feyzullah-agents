// Git akışı: görev başına worktree ve dal, adım başına commit, onaylı birleştirme (kapı + kontroller + geri alma),
// onaylı push (önce sır taraması), dokunulmayan worktree'leri rafa kaldırma. Ofis gitwork.js mantığı.
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { runChecks } from '../core/checks.js';
import { now } from '../core/db.js';
import { append } from '../core/events.js';
import { getTask } from '../core/tasks.js';
import { TASK_FILE } from '../engines/adapter.js';
import { scanSecrets } from '../knowledge/secrets.js';
import { gate } from './gate.js';
import { securityCheck } from './security.js';

/** @typedef {import('node:sqlite').DatabaseSync} Db */

export const SHELF_AFTER_MS = 7 * 24 * 3600_000;
const DB_DIR = '.feyzullah-agents';

export class GitError extends Error {}
export class SecretError extends Error {
  /** @param {string} msg @param {{kind: string}[]} found */
  constructor(msg, found) { super(msg); this.found = found; }
}

/** @param {string} cwd @param {string[]} args */
export function git(cwd, args, { allowFail = false } = {}) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new GitError(`git çalışmadı: ${r.error.message}`);
  if (r.status !== 0 && !allowFail) throw new GitError(`git ${args[0]}: ${(r.stderr || r.stdout).trim().slice(0, 500)}`);
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

/** Depo temiz mi? Veritabanı klasörü (izlenmiyorsa) sayılmaz. */
export function isClean(repo) {
  return git(repo, ['status', '--porcelain', '--', '.', `:(exclude)${DB_DIR}`]).out === '';
}

const branchFor = (taskId) => `fa/${taskId.slice(0, 8)}`;

/** Worktree'ler .git içinde durur: ana çalışma kopyasını kirletmez. */
function worktreePath(repo, taskId) {
  const common = git(repo, ['rev-parse', '--git-common-dir']).out;
  const dir = isAbsolute(common) ? common : resolve(repo, common);
  return join(dir, 'fa-worktrees', taskId.slice(0, 8));
}

/** @param {Db} db @param {string} taskId */
export const getWorktree = (db, taskId) => db.prepare('SELECT * FROM worktrees WHERE task_id = ?').get(taskId) ?? null;

/**
 * Görevin worktree'si: yoksa açılır, raftaysa geri gelir. Yol döner.
 * @param {Db} db @param {{repo: string, taskId: string, base?: string}} o
 */
export function ensureWorktree(db, { repo, taskId, base = 'HEAD' }) {
  const row = getWorktree(db, taskId);
  if (row?.status === 'active') {
    db.prepare('UPDATE worktrees SET touched_at = ? WHERE task_id = ?').run(now(), taskId);
    return row.path;
  }
  if (row?.status === 'shelved') return unshelve(db, taskId);
  if (row?.status === 'merged') throw new GitError(`görevin dalı birleşti: ${row.branch}`);
  const path = worktreePath(repo, taskId);
  const branch = branchFor(taskId);
  const baseSha = git(repo, ['rev-parse', base]).out;
  mkdirSync(dirname(path), { recursive: true });
  const exists = git(repo, ['rev-parse', '--verify', '-q', `refs/heads/${branch}`], { allowFail: true }).ok;
  git(repo, exists ? ['worktree', 'add', path, branch] : ['worktree', 'add', '-b', branch, path, baseSha]);
  db.prepare(`INSERT INTO worktrees(task_id, repo, path, branch, base, status, created_at, touched_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`)
    .run(taskId, resolve(repo), path, branch, baseSha, now(), now());
  append(db, { actor: 'git', type: 'worktree.created', entity: 'task', entityId: taskId, data: { branch } });
  return path;
}

/**
 * Değişiklik varsa commit atar. Sahnelenen farkta sır bulunursa commit atılmaz, sahne boşaltılır.
 * @param {string} dir @param {string} message @returns {string|null} commit kimliği
 */
export function commitStep(dir, message) {
  git(dir, ['add', '-A', '--', '.', `:(exclude)${TASK_FILE}`, `:(exclude)${DB_DIR}`]);
  const diff = git(dir, ['diff', '--cached', '--no-color', '-U0']).out;
  if (!diff) return null;
  const added = diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).join('\n');
  const found = scanSecrets(added);
  if (found.length) {
    git(dir, ['reset', '-q']);
    throw new SecretError(`commit durduruldu, olası gizli bilgi: ${[...new Set(found.map((f) => f.kind))].join(', ')}`, found);
  }
  git(dir, ['commit', '-q', '-m', message]);
  return git(dir, ['rev-parse', 'HEAD']).out;
}

/**
 * Görev dalını ana depoya birleştirir. Onay kapısı (git.merge), temiz depo, güvenlik taraması, birleştirme,
 * kontroller; kontrol düşerse birleştirme geri alınır.
 * @param {Db} db @param {{taskId: string, checks?: string[], ffOnly?: boolean, audit?: boolean}} o
 * @returns {Promise<{merged: boolean, approvalId?: string|null, reverted?: boolean, error?: string, checks?: any, security?: import('./security.js').Finding[]}>}
 */
export async function mergeWorktree(db, { taskId, checks = [], ffOnly = false, audit = false }) {
  const wt = getWorktree(db, taskId);
  if (!wt) throw new GitError(`görevin worktree'si yok: ${taskId}`);
  if (wt.status === 'merged') return { merged: true };
  const g = gate(db, 'git.merge', { entity: 'task', entityId: taskId, payload: { branch: wt.branch, repo: wt.repo } });
  if (!g.allowed) return { merged: false, approvalId: g.approvalId };
  if (!isClean(wt.repo)) return { merged: false, error: 'ana depoda commit edilmemiş değişiklik var' };
  if (wt.status === 'active') commitStep(wt.path, `fa: ${getTask(db, taskId)?.title ?? taskId} (kalanlar)`);
  const title = getTask(db, taskId)?.title ?? taskId;
  const sec = securityCheck({ repo: wt.repo, base: 'HEAD', branch: wt.branch, audit, auditDir: wt.status === 'active' ? wt.path : wt.repo });
  if (!sec.ok) {
    append(db, { actor: 'git', type: 'merge.blocked', entity: 'task', entityId: taskId, data: { findings: sec.findings.map(({ level, kind, file }) => ({ level, kind, file })) } });
    return { merged: false, security: sec.findings };
  }
  const warnings = sec.findings;
  const m = git(wt.repo, ['merge', ffOnly ? '--ff-only' : '--no-ff', '-m', `fa: birleştir — ${title}`, wt.branch], { allowFail: true });
  if (!m.ok) {
    git(wt.repo, ['merge', '--abort'], { allowFail: true });
    append(db, { actor: 'git', type: 'merge.failed', entity: 'task', entityId: taskId, data: { error: m.err.slice(0, 300) } });
    return { merged: false, error: m.err || m.out };
  }
  if (checks.length) {
    const r = await runChecks(wt.repo, checks);
    if (!r.ok) {
      // Birleştirmeden önce depo temizdi: ORIG_HEAD'e dönmek yalnız bu birleştirmeyi geri alır.
      git(wt.repo, ['reset', '-q', '--hard', 'ORIG_HEAD']);
      append(db, { actor: 'git', type: 'merge.reverted', entity: 'task', entityId: taskId, data: { failed: r.results.at(-1)?.cmd ?? null } });
      return { merged: false, reverted: true, checks: r };
    }
  }
  db.prepare("UPDATE worktrees SET status = 'merged', touched_at = ? WHERE task_id = ?").run(now(), taskId);
  if (git(wt.path, ['status', '--porcelain'], { allowFail: true }).out === '') git(wt.repo, ['worktree', 'remove', wt.path], { allowFail: true });
  append(db, { actor: 'git', type: 'merge.done', entity: 'task', entityId: taskId, data: { branch: wt.branch, warnings: warnings.length } });
  return { merged: true, security: warnings };
}

/**
 * Dalı uzak depoya iter. Onay kapısı (git.push) ve gönderilecek commit'lerde sır taraması.
 * @param {Db} db @param {{repo: string, branch: string, remote?: string}} o
 */
export function pushBranch(db, { repo, branch, remote = 'origin' }) {
  const upstream = git(repo, ['rev-parse', '--verify', '-q', `refs/remotes/${remote}/${branch}`], { allowFail: true });
  const range = upstream.ok ? `${upstream.out}..${branch}` : branch;
  const patch = git(repo, ['log', '-p', '--no-color', '--max-count=200', range]).out;
  const added = patch.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).join('\n');
  const found = scanSecrets(added);
  if (found.length) {
    append(db, { actor: 'git', type: 'push.blocked', entity: 'branch', entityId: branch, data: { kinds: [...new Set(found.map((f) => f.kind))] } });
    return { pushed: false, secrets: found.map((f) => f.kind) };
  }
  const g = gate(db, 'git.push', { entity: 'branch', entityId: `${remote}/${branch}`, payload: { repo, commits: range } });
  if (!g.allowed) return { pushed: false, approvalId: g.approvalId };
  const r = git(repo, ['push', '-u', remote, branch], { allowFail: true });
  append(db, { actor: 'git', type: r.ok ? 'push.done' : 'push.failed', entity: 'branch', entityId: branch, data: r.ok ? null : { error: r.err.slice(0, 300) } });
  return { pushed: r.ok, error: r.ok ? undefined : r.err };
}

/**
 * Birleşmiş ya da bir haftadır dokunulmamış temiz worktree'yi kaldırır; dal kalır, iş geri gelince açılır.
 * @param {Db} db @param {{idleMs?: number, at?: number}} [o] @returns {string[]} rafa kalkan görevler
 */
export function shelveWorktrees(db, { idleMs = SHELF_AFTER_MS, at = now() } = {}) {
  const out = [];
  for (const w of db.prepare("SELECT * FROM worktrees WHERE status = 'active'").all()) {
    // Hiç commit almamış dal tabana eşittir; "birleşmiş" sayılmaz.
    const tip = git(w.repo, ['rev-parse', w.branch], { allowFail: true }).out;
    const merged = tip !== w.base && git(w.repo, ['branch', '--merged', 'HEAD', '--list', w.branch], { allowFail: true }).out !== '';
    if (!merged && w.touched_at > at - idleMs) continue;
    if (git(w.path, ['status', '--porcelain'], { allowFail: true }).out !== '') continue;
    if (!git(w.repo, ['worktree', 'remove', w.path], { allowFail: true }).ok) continue;
    db.prepare("UPDATE worktrees SET status = 'shelved' WHERE task_id = ?").run(w.task_id);
    append(db, { actor: 'git', type: 'worktree.shelved', entity: 'task', entityId: w.task_id, data: { merged } });
    out.push(w.task_id);
  }
  return out;
}

/** @param {Db} db @param {string} taskId @returns {string} yol */
export function unshelve(db, taskId) {
  const w = getWorktree(db, taskId);
  if (!w || w.status !== 'shelved') throw new GitError(`rafta değil: ${taskId}`);
  mkdirSync(dirname(w.path), { recursive: true });
  git(w.repo, ['worktree', 'add', w.path, w.branch]);
  db.prepare("UPDATE worktrees SET status = 'active', touched_at = ? WHERE task_id = ?").run(now(), taskId);
  append(db, { actor: 'git', type: 'worktree.unshelved', entity: 'task', entityId: taskId });
  return w.path;
}
