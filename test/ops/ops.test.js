import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decideApproval, getGoal } from '../../src/core/board.js';
import { budgetForecast, recordUsage, setBudget } from '../../src/core/costs.js';
import { openDb, setClock } from '../../src/core/db.js';
import { append, verifyChain } from '../../src/core/events.js';
import { runReady } from '../../src/core/scheduler.js';
import { createTask, getTask } from '../../src/core/tasks.js';
import { deleteImpact, gate, gateDelete } from '../../src/ops/gate.js';
import { commitStep, ensureWorktree, git, mergeWorktree, pushBranch, SecretError, shelveWorktrees } from '../../src/ops/git.js';
import { addRoutine, nextRun, parseCron, tickRoutines } from '../../src/ops/routines.js';
import { createVault, dpapi, maskValues } from '../../src/ops/vault.js';

// Testlerdeki commit'ler için geçici kimlik (kullanıcının git ayarına dokunmaz).
Object.assign(process.env, { GIT_AUTHOR_NAME: 'fa-test', GIT_AUTHOR_EMAIL: 'fa-test@example.invalid', GIT_COMMITTER_NAME: 'fa-test', GIT_COMMITTER_EMAIL: 'fa-test@example.invalid' });

const ok = (final = 'tamam') => ({ text: final, final, sessionId: null, usage: null, rate: null, error: null, exitCode: 0, timedOut: false, stderr: '' });
const approve = (db, id) => decideApproval(db, id, { approve: true, by: 'test' });

function repo(t) {
  const dir = mkdtempSync(join(tmpdir(), 'fa-git-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r = join(dir, 'repo');
  mkdirSync(r);
  git(r, ['init', '-q', '-b', 'main']);
  git(r, ['config', 'core.autocrlf', 'false']);
  writeFileSync(join(r, 'a.txt'), 'bir\n');
  git(r, ['add', '-A']);
  git(r, ['commit', '-q', '-m', 'ilk']);
  return { dir, r };
}

test('onay kapısı: allow geçer, deny durur, ask kart açar ve onay bir kez kullanılır', () => {
  const db = openDb();
  assert.equal(gate(db, 'git.commit').allowed, true);
  assert.equal(gate(db, 'secrets.read').allowed, false);
  const a = gate(db, 'git.push', { entity: 'branch', entityId: 'origin/x' });
  assert.equal(a.allowed, false);
  // Bekleyen kart varken ikinci istek aynı kartı döner, yeni kart açmaz.
  assert.equal(gate(db, 'git.push', { entity: 'branch', entityId: 'origin/x' }).approvalId, a.approvalId);
  assert.equal(db.prepare('SELECT count(*) n FROM approvals').get().n, 1);
  approve(db, a.approvalId);
  assert.equal(gate(db, 'git.push', { entity: 'branch', entityId: 'origin/x' }).allowed, true);
  assert.equal(gate(db, 'git.push', { entity: 'branch', entityId: 'origin/x' }).allowed, false);
  db.close();
});

test('silme kartı etkiyi gösterir', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'fa-del-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'alt'));
  writeFileSync(join(dir, 'x'), '12345');
  writeFileSync(join(dir, 'alt', 'y'), '123');
  assert.deepEqual(deleteImpact([dir, join(dir, 'yok')]), { files: 2, bytes: 8 });
  const db = openDb();
  const g = gateDelete(db, [dir]);
  assert.equal(g.allowed, false);
  assert.deepEqual(JSON.parse(db.prepare('SELECT payload FROM approvals').get().payload).files, 2);
  db.close();
});

test('olay zinciri doğrulanır, kurcalama yakalanır', () => {
  const db = openDb();
  for (let i = 0; i < 5; i++) append(db, { type: 't', data: { i } });
  assert.deepEqual(verifyChain(db), { ok: true, checked: 5, brokenAt: null });
  // Trigger'lar kapatılıp bir olay elle değiştirilirse zincir kırılır.
  db.exec('DROP TRIGGER events_no_update');
  db.prepare("UPDATE events SET data = '{\"i\":9}' WHERE seq = 3").run();
  assert.equal(verifyChain(db).brokenAt, 3);
  db.close();
});

test('cron ayrıştırma ve sonraki çalışma (yerel saat)', () => {
  assert.throws(() => parseCron('* * *'), /5 alan/);
  assert.throws(() => parseCron('61 * * * *'), /aralık/);
  assert.deepEqual([...parseCron('*/20 * * * *').minute], [0, 20, 40]);
  assert.deepEqual([...parseCron('0 9 * * 1-5').dow], [1, 2, 3, 4, 5]);
  assert.ok(parseCron('0 0 * * 7').dow.has(0));
  const from = new Date(2026, 9, 28, 10, 7).getTime(); // Çarşamba
  assert.equal(nextRun('*/15 * * * *', from), new Date(2026, 9, 28, 10, 15).getTime());
  assert.equal(nextRun('0 9 * * 1-5', from), new Date(2026, 9, 29, 9, 0).getTime());
  assert.equal(nextRun('@monthly', from), new Date(2026, 10, 1, 0, 0).getTime());
  assert.equal(nextRun('30 8 * * 6', from), new Date(2026, 9, 31, 8, 30).getTime());
  // İki gün alanı da kısıtlı: biri yeter (ayın 1'i ya da pazartesi).
  assert.equal(nextRun('0 0 1 * 1', from), new Date(2026, 10, 1, 0, 0).getTime());
});

test('rutin: zamanı gelince görev açar, önceki sürerken atlar, kaçırılanı politikaya göre işler', (t) => {
  let clock = new Date(2026, 9, 28, 10, 0).getTime();
  setClock(() => clock); t.after(() => setClock());
  const db = openDb();
  const id = addRoutine(db, { name: 'yedek', cron: '0 * * * *', kind: 'task', body: 'yedek al', engine: 'codex' });
  assert.deepEqual(tickRoutines(db), []);
  clock += 3600_000;
  const [f] = tickRoutines(db);
  assert.equal(getTask(db, f.entityId).prompt, 'yedek al');
  clock += 3600_000;
  assert.equal(tickRoutines(db)[0].skipped, 'önceki çalışma sürüyor');
  db.prepare("UPDATE tasks SET status = 'done'").run();
  // Üç saat kaçırıldı: latest bir kez çalışır.
  clock += 3 * 3600_000 + 10 * 60_000;
  const fired = tickRoutines(db);
  assert.equal(fired.length, 1);
  assert.ok(fired[0].entityId);
  assert.equal(db.prepare('SELECT next_run_at FROM routines WHERE id = ?').get(id).next_run_at, new Date(2026, 9, 28, 16, 0).getTime());
  // none: geç kalınmışsa çalışmaz.
  db.prepare("UPDATE tasks SET status = 'done'").run();
  addRoutine(db, { name: 'rapor', cron: '0 * * * *', kind: 'goal', body: 'rapor yaz', catchUp: 'none' });
  clock += 3600_000 + 20 * 60_000;
  const r = tickRoutines(db);
  assert.equal(r.find((x) => x.kind === 'goal').skipped, 'kaçırıldı');
  db.close();
});

test('limit açılınca çalış: motor kapalıyken bekler, açılınca bir kez hedef açar', (t) => {
  let clock = 1_000_000;
  setClock(() => clock); t.after(() => setClock());
  const db = openDb();
  db.prepare("INSERT INTO meta(key, value) VALUES ('engine_down', ?)").run(JSON.stringify({ codex: clock + 60_000 }));
  addRoutine(db, { name: 'büyük iş', body: 'yap', engine: 'codex', whenFree: true });
  assert.deepEqual(tickRoutines(db), []);
  clock += 61_000;
  const [f] = tickRoutines(db);
  assert.equal(getGoal(db, f.entityId).title, 'büyük iş');
  assert.deepEqual(tickRoutines(db), []);
  assert.equal(db.prepare('SELECT enabled FROM routines').get().enabled, 0);
  db.close();
});

test('sır kasası: izinli uzmana ortam olarak gider, değer olaylara ve çıktıya yazılmaz', async () => {
  const db = openDb();
  const fake = { protect: (s) => `enc:${Buffer.from(s).toString('base64')}`, unprotect: (c) => Buffer.from(c.slice(4), 'base64').toString() };
  const v = createVault(db, { crypto: fake });
  assert.throws(() => v.set('kucuk', 'x'), /BÜYÜK/);
  v.set('API_TOKEN', 'deger-123456', { agents: ['muhendis'] });
  v.set('ORTAK', 'herkes-icin', { agents: ['*'] });
  assert.deepEqual(v.envFor('muhendis'), { API_TOKEN: 'deger-123456', ORTAK: 'herkes-icin' });
  assert.deepEqual(v.envFor('qa'), { ORTAK: 'herkes-icin' });
  assert.ok(!JSON.stringify(v.list()).includes('deger-123456'));
  assert.ok(!db.prepare('SELECT group_concat(data) d FROM events').get().d.includes('deger-123456'));
  assert.equal(maskValues('çıktı deger-123456 bitti', { API_TOKEN: 'deger-123456' }), 'çıktı [gizli:API_TOKEN] bitti');

  db.prepare("INSERT INTO agents(id, workspace_id, name, engine) VALUES ('muhendis', 'default', 'M', 'codex')").run();
  const task = createTask(db, { title: 'a', engine: 'codex', assigneeAgentId: 'muhendis' });
  let env = null;
  const codex = { engine: 'codex', execute: async (i) => { env = i.env; return ok('anahtar deger-123456 kullanıldı'); } };
  await runReady({ db, adapters: { codex }, cwd: '.', vault: v });
  assert.equal(env.API_TOKEN, 'deger-123456');
  assert.match(getTask(db, task.id).result, /\[gizli:API_TOKEN\]/);
  assert.ok(!db.prepare('SELECT stdout_excerpt FROM runs').get().stdout_excerpt.includes('deger-123456'));
  db.close();
});

test('DPAPI gerçek gidiş-dönüş (yalnız Windows)', { skip: process.platform !== 'win32' }, () => {
  const c = dpapi.protect('şifre-Ğü 123');
  assert.notEqual(c, 'şifre-Ğü 123');
  assert.equal(dpapi.unprotect(c), 'şifre-Ğü 123');
});

test('worktree: görev kendi dalında çalışır, adım commit\'i atılır, onaylı birleşir', async (t) => {
  const { r } = repo(t);
  const db = openDb();
  const task = createTask(db, { title: 'b dosyası', engine: 'codex' });
  const codex = { engine: 'codex', execute: async (i) => { writeFileSync(join(i.cwd, 'b.txt'), 'iki\n'); return ok(); } };
  await runReady({
    db, adapters: { codex }, cwd: r,
    cwdFor: (tk) => ensureWorktree(db, { repo: r, taskId: tk.id }),
    onSucceeded: (tk, at) => commitStep(at, `fa: ${tk.title}`),
  });
  const wt = db.prepare('SELECT * FROM worktrees').get();
  assert.ok(!existsSync(join(r, 'b.txt')), 'ana depo değişmedi');
  assert.equal(git(r, ['log', '-1', '--format=%s', wt.branch]).out, 'fa: b dosyası');
  assert.equal(git(r, ['status', '--porcelain']).out, '', 'worktree ana depoyu kirletmez');

  const first = await mergeWorktree(db, { taskId: task.id, checks: ['node -e "process.exit(0)"'] });
  assert.equal(first.merged, false);
  approve(db, first.approvalId);
  const m = await mergeWorktree(db, { taskId: task.id, checks: ['node -e "process.exit(0)"'] });
  assert.equal(m.merged, true);
  assert.equal(readFileSync(join(r, 'b.txt'), 'utf8'), 'iki\n');
  assert.equal(git(r, ['log', '-1', '--format=%s']).out, 'fa: birleştir — b dosyası', 'birleştirme commit\'i adım commit\'inden ayırt edilir');
  db.close();
});

test('birleştirme sonrası kontrol düşerse birleştirme geri alınır', async (t) => {
  const { r } = repo(t);
  const db = openDb();
  const task = createTask(db, { title: 'bozuk', engine: 'codex' });
  const p = ensureWorktree(db, { repo: r, taskId: task.id });
  writeFileSync(join(p, 'c.txt'), 'x\n');
  commitStep(p, 'c');
  approve(db, gate(db, 'git.merge', { entity: 'task', entityId: task.id }).approvalId);
  const head = git(r, ['rev-parse', 'HEAD']).out;
  const m = await mergeWorktree(db, { taskId: task.id, checks: ['node -e "process.exit(3)"'] });
  assert.equal(m.reverted, true);
  assert.equal(git(r, ['rev-parse', 'HEAD']).out, head);
  assert.ok(!existsSync(join(r, 'c.txt')));
  db.close();
});

test('sır içeren değişiklik commit edilmez ve push edilmez', (t) => {
  const { dir, r } = repo(t);
  const db = openDb();
  writeFileSync(join(r, 'ayar.js'), 'const k = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";\n');
  assert.throws(() => commitStep(r, 'ayar'), SecretError);
  assert.equal(git(r, ['diff', '--cached', '--name-only']).out, '', 'sahne boşaltıldı');
  // Elle commit edilmiş sır push'ta yakalanır.
  git(r, ['add', '-A']);
  git(r, ['commit', '-q', '-m', 'sır']);
  git(dir, ['init', '-q', '--bare', 'uzak.git']);
  git(r, ['remote', 'add', 'origin', join(dir, 'uzak.git')]);
  const p = pushBranch(db, { repo: r, branch: 'main' });
  assert.equal(p.pushed, false);
  assert.deepEqual(p.secrets, ['github jetonu']);
  assert.equal(db.prepare('SELECT count(*) n FROM approvals').get().n, 0);
  db.close();
});

test('push onay ister, onaydan sonra yalnız bir kez gider', (t) => {
  const { dir, r } = repo(t);
  const db = openDb();
  git(dir, ['init', '-q', '--bare', 'uzak.git']);
  git(r, ['remote', 'add', 'origin', join(dir, 'uzak.git')]);
  const a = pushBranch(db, { repo: r, branch: 'main' });
  assert.equal(a.pushed, false);
  approve(db, a.approvalId);
  assert.equal(pushBranch(db, { repo: r, branch: 'main' }).pushed, true);
  assert.equal(git(join(dir, 'uzak.git'), ['rev-parse', 'main']).out, git(r, ['rev-parse', 'main']).out);
  writeFileSync(join(r, 'd.txt'), 'd\n');
  commitStep(r, 'd');
  assert.ok(pushBranch(db, { repo: r, branch: 'main' }).approvalId, 'yeni push yeni onay ister');
  db.close();
});

test('dokunulmayan worktree rafa kalkar, iş gelince geri açılır', (t) => {
  let clock = 1_000_000;
  setClock(() => clock); t.after(() => setClock());
  const { r } = repo(t);
  const db = openDb();
  const task = createTask(db, { title: 'raf' });
  const p = ensureWorktree(db, { repo: r, taskId: task.id });
  assert.deepEqual(shelveWorktrees(db), []);
  clock += 8 * 24 * 3600_000;
  assert.deepEqual(shelveWorktrees(db), [task.id]);
  assert.ok(!existsSync(p));
  assert.equal(ensureWorktree(db, { repo: r, taskId: task.id }), p);
  assert.ok(existsSync(join(p, 'a.txt')));
  db.close();
});

test('bütçe tahmini: bu hızla ne zaman dolar', (t) => {
  const at = new Date(2026, 9, 28, 12, 0).getTime();
  setClock(() => at - 3600_000); t.after(() => setClock());
  const db = openDb();
  setBudget(db, { id: 'g', scope: 'global', window: 'day', limitTokens: 10_000 });
  recordUsage(db, { engine: 'codex', usage: { input: 1000, cachedInput: 0, cacheWrite: 0, output: 0, known: true } });
  const [f] = budgetForecast(db, { at, lookbackMs: 3600_000 });
  assert.equal(f.used, 1000);
  assert.equal(f.perHour, 1000);
  assert.equal(f.exhaustAt, at + 9 * 3600_000);
  db.close();
});
