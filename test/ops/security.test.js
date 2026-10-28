import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../../src/cli.js';
import { decideApproval } from '../../src/core/board.js';
import { recordUsage } from '../../src/core/costs.js';
import { openDb } from '../../src/core/db.js';
import { createTask } from '../../src/core/tasks.js';
import { gate } from '../../src/ops/gate.js';
import { compareCcusage, parseCcusage } from '../../src/ops/ccusage.js';
import { ensureWorktree, git, mergeWorktree } from '../../src/ops/git.js';
import { addedByFile, scanPatch } from '../../src/ops/security.js';

Object.assign(process.env, { GIT_AUTHOR_NAME: 'fa-test', GIT_AUTHOR_EMAIL: 'fa-test@example.invalid', GIT_COMMITTER_NAME: 'fa-test', GIT_COMMITTER_EMAIL: 'fa-test@example.invalid' });

const PATCH = `diff --git a/.env b/.env
new file mode 100644
--- /dev/null
+++ b/.env
@@ -0,0 +1 @@
+PORT=3000
diff --git a/src/a.js b/src/a.js
--- a/src/a.js
+++ b/src/a.js
@@ -1,2 +1,3 @@
 const x = 1;
+const y = eval(input);
-const z = 2;
diff --git a/src/b.luau b/src/b.luau
--- /dev/null
+++ b/src/b.luau
@@ -0,0 +1 @@
+local f = loadstring(code)
diff --git a/.env.example b/.env.example
--- /dev/null
+++ b/.env.example
@@ -0,0 +1 @@
+PORT=
`;

test('diff ayrıştırma ve yerleşik kurallar', () => {
  const by = addedByFile(PATCH);
  assert.deepEqual([...by.keys()], ['.env', 'src/a.js', 'src/b.luau', '.env.example']);
  assert.deepEqual(by.get('src/a.js'), ['const y = eval(input);']);
  const f = scanPatch(PATCH);
  assert.deepEqual(f.filter((x) => x.level === 'block').map((x) => [x.kind, x.file]), [['riskli dosya', '.env']]);
  assert.deepEqual(f.filter((x) => x.level === 'warn').map((x) => x.kind), ['eval', 'loadstring']);
  const s = scanPatch('+++ b/c.js\n+const token = "ghp_' + 'a'.repeat(36) + '";\n');
  assert.deepEqual(s.map((x) => [x.level, x.kind]), [['block', 'gizli bilgi']]);
  assert.deepEqual(scanPatch('+++ b/x.md\n-silinen ghp_' + 'a'.repeat(36) + '\n'), [], 'silinen satırlar sayılmaz');
});

test('güvenlik taraması riskli dosya getiren dalın birleşmesini engeller', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'fa-sec-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r = join(dir, 'repo');
  mkdirSync(r);
  git(r, ['init', '-q', '-b', 'main']);
  git(r, ['config', 'core.autocrlf', 'false']);
  writeFileSync(join(r, 'a.txt'), 'bir\n');
  git(r, ['add', '-A']);
  git(r, ['commit', '-q', '-m', 'ilk']);
  const db = openDb();
  const task = createTask(db, { title: 'anahtar dosyası', engine: 'codex' });
  const p = ensureWorktree(db, { repo: r, taskId: task.id });
  writeFileSync(join(p, 'id_rsa'), 'gizli değil ama dosya adı riskli\n');
  git(p, ['add', '-A']);
  git(p, ['commit', '-q', '-m', 'anahtar']);
  decideApproval(db, gate(db, 'git.merge', { entity: 'task', entityId: task.id }).approvalId, { approve: true, by: 'test' });
  const m = await mergeWorktree(db, { taskId: task.id });
  assert.equal(m.merged, false);
  assert.deepEqual(m.security.map((f) => [f.kind, f.file]), [['riskli dosya', 'id_rsa']]);
  assert.ok(!existsSync(join(r, 'id_rsa')), 'ana depoya girmedi');
  assert.equal(db.prepare("SELECT count(*) n FROM events WHERE type = 'merge.blocked'").get().n, 1);
  db.close();
});

test('ccusage karşılaştırması: fazla sayım yakalanır', () => {
  const db = openDb();
  const at = new Date(2026, 9, 27, 12).getTime();
  const realNow = Date.now;
  Date.now = () => at;
  try { recordUsage(db, { engine: 'claude', usage: { input: 900, cachedInput: 5000, cacheWrite: 100, output: 200 } }); } finally { Date.now = realNow; }
  db.prepare('UPDATE usage SET at = ?').run(at);
  const data = { daily: [
    { date: '2026-10-27', inputTokens: 1000, cacheCreationTokens: 100, cacheReadTokens: 9999, outputTokens: 100, totalTokens: 11199 },
    { date: '2026-10-28', inputTokens: 50, outputTokens: 10 },
  ] };
  assert.deepEqual([...parseCcusage(data)], [['2026-10-27', 1200], ['2026-10-28', 60]]);
  assert.deepEqual(compareCcusage(db, data).map((r) => [r.date, r.ours, r.theirs, r.over]), [['2026-10-27', 1200, 1200, false], ['2026-10-28', 0, 60, false]]);
  data.daily[0].outputTokens = 10;
  assert.equal(compareCcusage(db, data)[0].over, true);
  assert.throws(() => parseCcusage({ foo: 1 }), /ccusage/);
  db.close();
});

test('CLI: usage --ccusage stdin ve security', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'fa-sec-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let out = '';
  const stdout = { write: (s) => { out += s; } };
  const run = (argv, stdin = '') => main(argv, { dbPath: join(dir, 'fa.db'), cwd: dir, stdout, knowledge: null, readStdin: async () => stdin });
  assert.equal(await run(['usage', '--ccusage', '-'], JSON.stringify({ daily: [{ date: '2026-10-28', inputTokens: 5, outputTokens: 1 }] })), 0);
  assert.match(out, /2026-10-28 fa 0 \/ ccusage 6/);
  assert.match(out, /tutarlı/);
  git(dir, ['init', '-q', '-b', 'main']);
  writeFileSync(join(dir, 'a.txt'), 'bir\n');
  git(dir, ['add', 'a.txt']);
  git(dir, ['commit', '-q', '-m', 'ilk']);
  writeFileSync(join(dir, 'server.pem'), 'x\n');
  git(dir, ['add', 'server.pem']);
  git(dir, ['commit', '-q', '-m', 'pem']);
  out = '';
  assert.equal(await run(['security']), 1);
  assert.match(out, /ENGEL: riskli dosya server\.pem/);
});
