import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../src/core/db.js';
import { createGoal } from '../../src/core/board.js';
import { planGoal } from '../../src/core/orchestrator.js';
import { runReady } from '../../src/core/scheduler.js';
import { claimTask, createTask, finishRun, getTask } from '../../src/core/tasks.js';
import { cliArgs } from '../../src/engines/args.js';
import {
  activeAgents, agentStats, DEPARTMENTS, loadAgents, missingSkills, orgChart, parseAgentFile, personaFor, pickAgent, routeDepartment, syncAgents,
} from '../../src/agents/registry.js';

const BUNDLED = join(import.meta.dirname, '..', '..', 'agents');

function setup() {
  const db = openDb();
  syncAgents(db, loadAgents([BUNDLED]));
  return db;
}

const okAdapter = (seen) => ({
  async execute(i) {
    seen.push(i);
    return { text: 'tamam', final: 'tamam', sessionId: null, usage: null, rate: null, error: null, exitCode: 0, timedOut: false, stderr: '' };
  },
});

test('ön bilgi ayrıştırılır, eksik alan ve bilinmeyen departman reddedilir', () => {
  const a = parseAgentFile('---\nid: x\nname: X\ndepartment: Build\nengine: agy\nmodel: m1\nskills: []\nkeywords: [Kod, Test]\n---\n\nSen X.\n', 'x.md');
  assert.equal(a.department, 'build');
  assert.equal(a.engine, 'antigravity');
  assert.equal(a.model, 'm1');
  assert.deepEqual(a.skills, []);
  assert.deepEqual(a.keywords, ['kod', 'test']);
  assert.equal(a.persona, 'Sen X.');
  assert.throws(() => parseAgentFile('---\nid: x\nname: X\nengine: codex\n---\n'), /department/);
  assert.throws(() => parseAgentFile('---\nid: x\nname: X\ndepartment: satış\nengine: codex\n---\n'), /bilinmeyen departman/);
  assert.throws(() => parseAgentFile('ön bilgi yok'), /ön bilgi yok/);
});

test('paketle gelen uzmanlar her departmanı kapsar ve org şeması yöneticiden başlar', () => {
  const db = setup();
  const agents = activeAgents(db);
  assert.ok(agents.length >= 11);
  for (const d of Object.keys(DEPARTMENTS)) assert.ok(agents.some((a) => a.department === d), d);
  const chart = orgChart(db).split('\n');
  assert.match(chart[0], /^- Yönetici/);
  assert.ok(chart.some((l) => /^ {4}- Ters mühendis/.test(l)));
  db.close();
});

test('çalışma alanı uzmanı aynı id ile ezer, silinen dosyanın uzmanı pasifleşir', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'fa-ag-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'build'));
  writeFileSync(join(dir, 'build', 'muhendis.md'), '---\nid: muhendis\nname: Yerel mühendis\ndepartment: build\nengine: codex\nmodel: gpt-x\n---\nYerel.\n');
  const db = setup();
  syncAgents(db, loadAgents([BUNDLED, dir]));
  const m = activeAgents(db).find((a) => a.id === 'muhendis');
  assert.equal(m.name, 'Yerel mühendis');
  assert.equal(m.model, 'gpt-x');
  syncAgents(db, loadAgents([dir]));
  assert.deepEqual(activeAgents(db).map((a) => a.id), ['muhendis']);
  db.close();
});

test('eksik skill bulunur, eklenti skill\'i atlanır', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'fa-sk-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'var'));
  writeFileSync(join(dir, 'var', 'SKILL.md'), '# var');
  assert.deepEqual(missingSkills({ skills: ['var', 'yok', 'eklenti:ad'] }, [dir]), ['yok']);
});

test('iş metni doğru departmana yönlenir', () => {
  assert.equal(routeDepartment('Giriş sayfasının arayüz tasarımı ve renkleri'), 'design');
  assert.equal(routeDepartment('Rakip araştırması ve trend analizi'), 'grow');
  assert.equal(routeDepartment('Tanıtım videosu için senaryo ve altyazı'), 'make');
  assert.equal(routeDepartment('Haftalık rapor ve özet tablo'), 'run');
  assert.equal(routeDepartment('parse fonksiyonundaki hatayı düzelt'), 'build');
  assert.equal(routeDepartment('???'), 'build');
});

test('seçim motora uyar, anahtar sözcük ve geçmiş başarıyı tartar', () => {
  const db = setup();
  assert.equal(pickAgent(db, { text: 'birim test yaz ve regresyonu doğrula', engine: 'codex' }).id, 'qa');
  assert.equal(pickAgent(db, { text: 'parse fonksiyonunu refactor et', engine: 'codex' }).id, 'muhendis');
  // Departmanda o motordan uzman yoksa başka departmandan aynı motor seçilir.
  assert.equal(pickAgent(db, { text: 'arayüz tasarımı', engine: 'antigravity' }).engine, 'antigravity');
  // Geçmiş: qa sürekli başarısızsa, anahtar sözcüksüz build işi mühendise gider.
  for (let i = 0; i < 3; i++) {
    const t = createTask(db, { title: `q${i}`, engine: 'codex', assigneeAgentId: 'qa' });
    const run = claimTask(db, t.id, { engine: 'codex' });
    finishRun(db, run.id, { status: 'failed', error: 'x' });
  }
  assert.deepEqual(agentStats(db, 'qa'), { runs: 3, success: 0 });
  assert.equal(pickAgent(db, { text: 'npm derle', engine: 'codex' }).id, 'muhendis');
  assert.match(orgChart(db), /Test uzmanı .* başarı %0 \(3\)/);
  db.close();
});

test('her departmandan bir örnek iş uzmanının kimliğiyle çalışıp biter', async () => {
  const db = setup();
  const samples = {
    build: ['Hata düzelt', 'parse fonksiyonundaki hatayı düzelt', 'codex'],
    design: ['Arayüz', 'giriş sayfasının arayüz tasarımı', 'codex'],
    grow: ['Araştırma', 'rakip araştırması yap', 'antigravity'],
    make: ['Video', 'tanıtım videosu senaryosu yaz', 'antigravity'],
    run: ['Rapor', 'haftalık rapor ve özet hazırla', 'antigravity'],
  };
  const ids = {};
  for (const [dept, [title, prompt, engine]] of Object.entries(samples)) {
    const a = pickAgent(db, { text: prompt, engine });
    assert.equal(a.department, dept, dept);
    ids[dept] = createTask(db, { title, prompt, engine, assigneeAgentId: a.id }).id;
  }
  const seen = [];
  await runReady({ db, adapters: { codex: okAdapter(seen), antigravity: okAdapter(seen) }, cwd: '.' });
  for (const [dept, id] of Object.entries(ids)) {
    assert.equal(getTask(db, id).status, 'done', dept);
    const call = seen.find((s) => s.prompt === samples[dept][1]);
    assert.match(call.persona, new RegExp(`Departman: ${DEPARTMENTS[dept].name}`));
  }
  db.close();
});

test('kimlik metni skill bağlarını ve rolü içerir; veritabanı satırı da kabul edilir', () => {
  const db = setup();
  const row = db.prepare("SELECT * FROM agents WHERE id = 'ters-muhendis'").get();
  const p = personaFor(row);
  assert.match(p, /rol: ters mühendislik/);
  assert.match(p, /reverse-engineer-anything/);
  assert.equal(personaFor(null), null);
  assert.equal(personaFor({ persona: 'düz' }), 'düz');
  db.close();
});

test('planlayıcı uzman seçmezse görev havuzdan atanır', async () => {
  const db = setup();
  const goal = createGoal(db, { title: 'Ürün sayfası' });
  const plan = { tasks: [
    { key: 'a', title: 'Arayüz', prompt: 'ürün sayfasının arayüz tasarımı', engine: 'codex', review: false },
    { key: 'b', title: 'Metin', prompt: 'tanıtım videosu senaryosu', engine: 'antigravity', review: false },
    { key: 'c', title: 'Kod', prompt: 'api ucunu yaz', engine: 'codex', agent: 'qa', review: false },
  ] };
  await planGoal({ db, goalId: goal.id, llm: async () => `\`\`\`json\n${JSON.stringify(plan)}\n\`\`\``, agents: activeAgents(db) });
  const rows = Object.fromEntries(db.prepare('SELECT plan_key k, assignee_agent_id a FROM tasks').all().map((r) => [r.k, r.a]));
  assert.deepEqual(rows, { a: 'urun-tasarimci', b: 'icerik', c: 'qa' });
  db.close();
});

test('ajan modeli motor bayrağına çevrilir', () => {
  const o = { cwd: 'C:/w', prompt: 'p', model: 'm1' };
  const codex = cliArgs('codex', o);
  assert.deepEqual(codex.slice(codex.indexOf('-m'), codex.indexOf('-m') + 2), ['-m', 'm1']);
  assert.ok(codex.indexOf('-m') < codex.indexOf('-C'));
  assert.ok(cliArgs('antigravity', o).join(' ').includes('--model m1'));
  assert.ok(cliArgs('claude', o).join(' ').includes('--model m1'));
  assert.ok(!cliArgs('claude', { ...o, model: null }).includes('--model'));
});
