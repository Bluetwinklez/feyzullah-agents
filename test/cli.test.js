import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/cli.js';
import { openDb } from '../src/core/db.js';
import { claimTask, createTask, getTask } from '../src/core/tasks.js';

function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'fa-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let out = '';
  const stdout = { write: (s) => { out += s; } };
  const run = (argv, extra = {}) => main(argv, { dbPath: join(dir, 'fa.db'), cwd: dir, stdout, knowledge: null, ...extra });
  return { dir, run, out: () => out, reset: () => { out = ''; } };
}

const okAdapter = (engine) => ({ engine, async execute(i) { return { text: `bitti: ${i.prompt}`, final: `bitti: ${i.prompt}`, sessionId: 's', usage: { input: 1, cachedInput: 0, cacheWrite: 0, output: 1, known: engine !== 'antigravity' }, rate: null, error: null, exitCode: 0, timedOut: false, stderr: '' }; } });

test('init, add, run, status uçtan uca', async (t) => {
  const s = setup(t);
  assert.equal(await s.run(['init', '--kind', 'roblox']), 0);
  assert.equal(await s.run(['add', 'birinci', '--engine', 'agy']), 0);
  const first = s.out().trim().split('\n').at(-1).split(' ')[0];
  writeFileSync(join(s.dir, 'p.md'), 'uzun talimat');
  assert.equal(await s.run(['add', 'ikinci', '--engine', 'codex', '--after', first.slice(0, 8), '--prompt-file', 'p.md']), 0);
  s.reset();
  assert.equal(await s.run(['run'], { adapters: { antigravity: okAdapter('antigravity'), codex: okAdapter('codex') } }), 0);
  assert.match(s.out(), /bitti 2/);
  s.reset();
  assert.equal(await s.run(['status']), 0);
  assert.match(s.out(), /done\s+2/);
  assert.match(s.out(), /bilinmeyen kullanım: 1/);
  const db = openDb(join(s.dir, 'fa.db'));
  assert.equal(db.prepare("SELECT kind FROM workspaces WHERE id='default'").get().kind, 'roblox');
  assert.equal(db.prepare("SELECT prompt FROM tasks WHERE title='ikinci'").get().prompt, 'uzun talimat');
  db.close();
});

test('goal planlar, bitirir ve goals listeler; onaylı hedef bekler', async (t) => {
  const s = setup(t);
  await s.run(['init']);
  const plan = { reply: 'tek iş', tasks: [{ key: 'a', title: 'iş', prompt: 'yap', engine: 'codex', review: false }] };
  const llm = async (i) => (/Sen yöneticisin/.test(i.prompt) ? `\`\`\`json\n${JSON.stringify(plan)}\n\`\`\`` : 'RAPOR tamam');
  const adapters = { codex: okAdapter('codex') };
  assert.equal(await s.run(['goal', 'Bir şey yap'], { llm, adapters }), 0);
  assert.match(s.out(), /hedef .+: done/);
  assert.match(s.out(), /RAPOR tamam/);
  s.reset();
  assert.equal(await s.run(['goal', 'Onaylı iş', '--approval'], { llm, adapters }), 0);
  const approval = /fa approve (\S+)/.exec(s.out())[1];
  s.reset();
  await s.run(['goals']);
  assert.match(s.out(), /awaiting_approval\s+Onaylı iş \(backlog 1\)/);
  assert.equal(await s.run(['approve', approval.slice(0, 8)]), 0);
  s.reset();
  await s.run(['run'], { llm, adapters });
  await s.run(['goals']);
  assert.match(s.out(), /done\s+Onaylı iş/);
});

test('bilinmeyen komut 2 döner', async (t) => {
  const s = setup(t);
  assert.equal(await s.run(['uç']), 2);
  assert.equal(await s.run(['add']), 2);
  assert.equal(await s.run(['add', 'x', '--engine', 'gpt']), 2);
});

test('bench 1000 görevde 1 saniyenin altında', async (t) => {
  const s = setup(t);
  assert.equal(await s.run(['bench']), 0);
  const ms = Number(/(\d+(?:\.\d+)?) ms/.exec(s.out())[1]);
  assert.ok(ms < 1000, `${ms} ms`);
});

test('açılışta takılı run kurtarılır', async (t) => {
  const s = setup(t);
  const db = openDb(join(s.dir, 'fa.db'));
  const task = createTask(db, { title: 'a' });
  claimTask(db, task.id, { engine: 'codex', ownerPid: spawnSync(process.execPath, ['-e', '']).pid });
  db.close();
  assert.equal(await s.run(['status']), 0);
  assert.match(s.out(), /kurtarıldı: 1/);
  const db2 = openDb(join(s.dir, 'fa.db'));
  assert.equal(getTask(db2, task.id).status, 'todo');
  db2.close();
});
