import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { suggestHires } from '../../src/agents/hiring.js';
import { activeAgents, loadAgents, syncAgents } from '../../src/agents/registry.js';
import { main } from '../../src/cli.js';
import { getDocument } from '../../src/core/board.js';
import { openDb } from '../../src/core/db.js';
import { claimTask, createTask, finishRun, readyTasks } from '../../src/core/tasks.js';
import { exportWorkspace, importWorkspace } from '../../src/ops/transfer.js';
import { loadPackages, packageForKind, packageModule } from '../../src/packages/loader.js';
import { importProduction, layers, parseStageTables, promoteNext } from '../../packages/roblox/index.js';

const MD = `# Üretim sırası

| # | Aşama | Tamamlanma şartı | Durum |
|---|---|---|---|
| 1 | Tasarım | kapsam.md onaylı | Devam ediyor |
| 2 | Görsel stil | tutarlı | Tamamlandı (2026-10-20) |
| 3 | Konsept | ölçülü | Kapatıldı (kullanıcı kararı) |

## Kod geliştirme sırası (8. aşama)

| # | Adım | Durum | Kanıt |
|---|---|---|---|
| 1 | Temel yapı | GEÇTİ · 2026-10-21 | [a](a.md) |
| 2 | Oyuncu verisi | GEÇTİ — tamam | [b](b.md) |
| 3 | Ekonomi | yapıldı, kontrol bekliyor | – |
| 4 | Envanter | Bekliyor | – |
`;

function tmp(t) {
  const d = mkdtempSync(join(tmpdir(), 'fa-pkg-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  return d;
}

test('paketler yüklenir; çalışma alanı paketi paketle geleni ezemez ve kod çalıştıramaz', async (t) => {
  const ws = tmp(t);
  mkdirSync(join(ws, 'roblox'));
  writeFileSync(join(ws, 'roblox', 'paket.json'), JSON.stringify({ name: 'roblox', kinds: ['roblox'], module: 'kotu.js' }));
  mkdirSync(join(ws, 'yerel'));
  writeFileSync(join(ws, 'yerel', 'paket.json'), JSON.stringify({ name: 'yerel', kinds: ['yerel'], module: 'kotu.js', agents: 'agents' }));
  const pkgs = loadPackages({ workspace: ws });
  const rb = packageForKind(pkgs, 'roblox');
  assert.equal(rb.bundled, true);
  assert.ok(rb.agentsDir.endsWith(join('roblox', 'agents')));
  assert.equal(typeof (await packageModule(rb)).importProduction, 'function');
  const y = packageForKind(pkgs, 'yerel');
  assert.equal(y.module, null);
  assert.equal(await packageModule(y), null);
  assert.equal(packageForKind(pkgs, 'generic'), null);
});

test('Roblox uzmanları rol tablosundaki motor ve skill\'lerle gelir, engelli listeyi bilir', () => {
  const rb = packageForKind(loadPackages(), 'roblox');
  const a = Object.fromEntries(loadAgents([rb.agentsDir]).map((x) => [x.id, x]));
  assert.equal(Object.keys(a).length, 9);
  assert.equal(a['rb-scripter'].engine, 'codex');
  assert.ok(a['rb-scripter'].skills.includes('roblox-networking'));
  assert.equal(a['rb-test'].engine, 'antigravity');
  assert.equal(a['rb-game'].department, 'design');
  assert.match(a['rb-ui'].persona, /ExecRobloxMCP/);
});

test('aşama tabloları ayrıştırılır, bitmiş satırlar tanınır', () => {
  const [stage, code] = parseStageTables(MD);
  assert.equal(stage.kind, 'stage');
  assert.deepEqual(stage.rows.map((r) => [r.n, r.done]), [[1, false], [2, true], [3, true]]);
  assert.equal(stage.rows[0].gate, 'kapsam.md onaylı');
  assert.equal(code.title, 'Kod geliştirme sırası (8. aşama)');
  assert.deepEqual(code.rows.map((r) => r.done), [true, true, false, false]);
});

test('içe aktarma hiçbir adımı çalıştırmaz; adımlar sırayla ve elle açılır', (t) => {
  const root = tmp(t);
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'docs', 'uretim-sirasi.md'), MD);
  const db = openDb();
  const [stage, code] = importProduction(db, { root, checks: ['node -e "0"'] });
  assert.equal(stage.done, 2);
  assert.equal(code.steps, 4);
  assert.deepEqual(readyTasks(db), [], 'durdurulmuş proje kendiliğinden ilerlemez');
  const tasks = db.prepare('SELECT title, status, checks, engine FROM tasks WHERE goal_id = ? ORDER BY created_at, rowid').all(code.goalId);
  assert.deepEqual(tasks.map((x) => x.status), ['done', 'done', 'backlog', 'backlog']);
  assert.deepEqual(JSON.parse(tasks[2].checks), ['node -e "0"']);
  assert.equal(tasks[2].engine, 'codex');
  assert.match(getDocument(db, 'goal', code.goalId, 'kaynak').body, /3\. Ekonomi: yapıldı/);
  assert.match(db.prepare('SELECT prompt FROM tasks WHERE id = ?').get(code.taskIds[2]).prompt, /Belgedeki son durum: yapıldı, kontrol bekliyor/);

  const o = promoteNext(db, code.goalId);
  assert.equal(o.title, '3. Ekonomi');
  assert.equal(readyTasks(db).length, 1);
  // Önceki adım bitmeden sonraki açılmaz.
  assert.equal(promoteNext(db, code.goalId), null);
  // Aşama tablosunda 1. adım açık değil: 2 ve 3 bitmiş olsa da sıra 1'den başlar.
  assert.equal(promoteNext(db, stage.goalId).title, '1. Tasarım');
  db.close();
});

test('katmanlar yalnız projede karşılığı olan araçları içerir', (t) => {
  const root = tmp(t);
  assert.deepEqual(layers(root, { has: () => false }), []);
  for (const f of ['stylua.toml', 'selene.toml', 'default.project.json']) writeFileSync(join(root, f), '');
  mkdirSync(join(root, 'src'));
  mkdirSync(join(root, 'tests'));
  writeFileSync(join(root, 'tests', 'run-b.mjs'), '');
  writeFileSync(join(root, 'tests', 'run-a.mjs'), '');
  writeFileSync(join(root, 'tests', 'yardimci.mjs'), '');
  const ls = layers(root, { has: (b) => b === 'luau-analyze', env: { ROKIT_ROOT: 'C:\\rk' } });
  assert.deepEqual(ls.map((l) => l.layer), [1, 1, 2, 3, 4, 4]);
  assert.deepEqual(ls.slice(-2).map((l) => l.cmd), ['node tests/run-a.mjs', 'node tests/run-b.mjs']);
  if (process.platform === 'win32') assert.match(ls[0].cmd, /^set "ROKIT_ROOT=C:\\rk"&& stylua --check src$/);
});

test('dışa/içe aktarma: sırlar maskelenir, kimlikler korunur, ikinci aktarım çoğaltmaz', () => {
  const a = openDb();
  syncAgents(a, loadAgents([join(import.meta.dirname, '..', '..', 'agents')]));
  const task = createTask(a, { title: 'anahtarı ayarla', prompt: 'api_key = "s3cr3tdeger1234" ile bağlan', engine: 'codex', assigneeAgentId: 'muhendis' });
  a.prepare("INSERT INTO vault(name, cipher, agents, created_at, updated_at) VALUES ('X', 'şifreli', '[]', 0, 0)").run();
  const { data, redacted } = exportWorkspace(a);
  assert.ok(redacted >= 1);
  assert.ok(!JSON.stringify(data).includes('s3cr3tdeger1234'));
  assert.equal(data.vault, undefined);
  assert.equal(data.agents[0].file, undefined);
  const b = openDb();
  const added = importWorkspace(b, JSON.parse(JSON.stringify(data)));
  assert.equal(added.tasks, 1);
  assert.equal(added.agents, activeAgents(a).length);
  assert.equal(b.prepare('SELECT reports_to FROM agents WHERE id = ?').get('mimar').reports_to, 'yonetici');
  assert.equal(b.prepare('SELECT title FROM tasks WHERE id = ?').get(task.id).title, 'anahtarı ayarla');
  assert.deepEqual(Object.values(importWorkspace(b, data)).filter(Boolean), []);
  assert.throws(() => importWorkspace(b, { format: 'baska' }), /biçimi değil/);
  a.close(); b.close();
});

test('işe alma önerisi: boş departman motoru ve zorlanan uzman', () => {
  const db = openDb();
  syncAgents(db, loadAgents([join(import.meta.dirname, '..', '..', 'agents')]));
  createTask(db, { title: 'tanıtım videosu senaryosu', engine: 'codex' });
  for (let i = 0; i < 4; i++) {
    const tk = createTask(db, { title: `q${i}`, engine: 'codex', assigneeAgentId: 'qa' });
    finishRun(db, claimTask(db, tk.id, { engine: 'codex' }).id, { status: 'failed', error: 'x' });
  }
  const h = suggestHires(db);
  const gap = h.find((x) => x.id === 'make-codex');
  assert.match(gap.reason, /Make/);
  assert.match(gap.template, /^---\nid: make-codex\n/);
  const helper = h.find((x) => x.id === 'build-claude-yardimci');
  assert.match(helper.reason, /Test uzmanı/);
  db.close();
});

test('CLI: roblox çalışma alanı, içe aktarma, elle adım, autopilot', async (t) => {
  const dir = tmp(t);
  mkdirSync(join(dir, 'docs'));
  writeFileSync(join(dir, 'docs', 'uretim-sirasi.md'), MD);
  let out = '';
  const stdout = { write: (s) => { out += s; } };
  const seen = [];
  const ok = (final) => ({ text: final, final, sessionId: null, usage: null, rate: null, error: null, exitCode: 0, timedOut: false, stderr: '' });
  const adapter = (engine) => ({ engine, execute: async (i) => { seen.push(i.prompt.split('\n')[0]); return ok('tamam'); } });
  const llm = async () => 'KARAR: PASS';
  const run = (argv) => main(argv, { dbPath: join(dir, '.feyzullah-agents', 'fa.db'), cwd: dir, stdout, knowledge: null, llm,
    adapters: { codex: adapter('codex'), antigravity: adapter('antigravity'), claude: adapter('claude') } });
  assert.equal(await run(['init', '--kind', 'roblox']), 0);
  assert.match(out, /20 uzman/);
  assert.equal(await run(['roblox', 'import']), 0);
  assert.match(out, /Kod geliştirme sırası \(8\. aşama\): 2\/4 adım bitmiş/);
  await run(['run']);
  assert.deepEqual(seen, [], 'içe aktarmadan sonra hiçbir adım çalışmaz');
  out = '';
  assert.equal(await run(['roblox', 'next']), 2, 'iki hedef varken seçim ister');
  const code = /([0-9a-f]{8}) \S+\s+Kod/.exec((await (async () => { out = ''; await run(['goals']); return out; })()))[1];
  out = '';
  assert.equal(await run(['roblox', 'next', code]), 0);
  assert.match(out, /açıldı: 3\. Ekonomi/);
  await run(['run']);
  assert.deepEqual(seen, ['Kod geliştirme sırası (8. aşama), 3. adım: Ekonomi.']);
  // Autopilot açılınca geçen adımdan sonra sıradaki kendiliğinden açılır.
  await run(['roblox', 'autopilot', 'on']);
  await run(['roblox', 'next', code]);
  out = '';
  await run(['run']);
  assert.ok(seen.includes('Kod geliştirme sırası (8. aşama), 4. adım: Envanter.'));
  assert.ok(seen.includes('Üretim sırası, 1. adım: Tasarım.'), 'autopilot diğer içe aktarılmış hedefi de sürdürür');
});
