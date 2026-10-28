import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, setClock } from '../../src/core/db.js';
import { append, since } from '../../src/core/events.js';
import { createGoal, getGoal } from '../../src/core/board.js';
import { drive, planGoal } from '../../src/core/orchestrator.js';
import { createMcpClient } from '../../src/knowledge/mcp-client.js';
import { createKnowledge, keywords, parseLesson } from '../../src/knowledge/noesis.js';
import { redactText, scanSecrets } from '../../src/knowledge/secrets.js';

const FAKE = join(import.meta.dirname, '..', 'fixtures', 'fake-mcp.mjs');

function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'fa-kn-'));
  const logFile = join(dir, 'calls.jsonl');
  const client = createMcpClient({ command: process.execPath, args: [FAKE], env: { FAKE_MCP_LOG: logFile } });
  const db = openDb();
  t.after(() => { client.close(); db.close(); rmSync(dir, { recursive: true, force: true }); });
  const calls = () => { try { return readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
  return { db, client, calls, kn: createKnowledge({ db, client }) };
}

test('gizli bilgi taraması anahtar, jeton ve kişisel veriyi yakalar', () => {
  const s = [
    'anthropic sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123',
    'gh: ghp_abcdefghijklmnopqrstuvwxyz0123456789',
    'aws AKIAABCDEFGHIJKLMNOP',
    'api_key = "s3cr3tdeger1234"',
    'mail ali.veli@gmail.com',
    'tel +90 532 123 45 67',
    'tc 10000000146',
    'kart 4111 1111 1111 1111',
    'cookie _|WARNING:-DO-NOT-SHARE-THIS.--Sharing-this',
  ].join('\n');
  const kinds = scanSecrets(s).map((f) => f.kind);
  for (const k of ['anthropic anahtarı', 'github jetonu', 'aws anahtarı', 'parola/anahtar ataması', 'e-posta', 'telefon', 'tc kimlik', 'kart numarası', 'roblox çerezi']) {
    assert.ok(kinds.includes(k), k);
  }
  const r = redactText(s);
  assert.ok(!/ghp_|gmail|4111 1111|10000000146/.test(r.text));
});

test('zararsız metin değişmez, noreply e-posta ve rastgele sayılar geçer', () => {
  const s = 'Commit 144558175+Bluetwinklez@users.noreply.github.com, 1000 görev 115 ms, sürüm 2.1.309, epoch 1761700000123';
  assert.deepEqual(scanSecrets(s), []);
  assert.equal(redactText(s).text, s);
});

test('olay günlüğü metin içindeki sırları da maskeler', () => {
  const db = openDb();
  append(db, { type: 'x', data: { error: 'Bearer abcdefghijklmnopqrstuvwxyz123456 reddedildi' } });
  assert.match(since(db, 0)[0].data.error, /\[gizli: bearer jetonu\] reddedildi/);
  db.close();
});

test('anahtar sözcükler durak sözcüksüz ve tekrarsız', () => {
  assert.deepEqual(keywords('Roblox için bir Studio MCP kur ve roblox testlerini yaz'), ['roblox', 'studio', 'mcp', 'kur', 'testlerini']);
});

test('MCP istemcisi arar ve sayfa okur', async (t) => {
  const { client } = setup(t);
  const r = await client.callTool('search_notes', { query: 'roblox' });
  assert.deepEqual(r.map((x) => x.id), ['p1', 'p2']);
  await assert.rejects(client.callTool('read_page', { page_id: 'zz' }), /yok/);
});

test('bağlam uyarılı sayfayı başa ve işaretli koyar, ikinci çağrı önbellekten gelir', async (t) => {
  const { kn, calls } = setup(t);
  const c = await kn.contextFor('Roblox Studio MCP ile oynatma testi');
  assert.ok(c.pages.length >= 2);
  assert.equal(c.pages[0].id, 'p2');
  assert.match(c.text, /ExecRobloxMCP ⚠/);
  assert.equal(c.warnings.length, 1);
  const n = calls().length;
  await kn.contextFor('Roblox Studio MCP ile oynatma testi');
  assert.equal(calls().length, n);
});

test('önbellek süresi dolunca yeniden sorulur', async (t) => {
  const { kn, calls } = setup(t);
  let clock = 1_000_000;
  setClock(() => clock); t.after(() => setClock());
  await kn.search('godot');
  const n = calls().length;
  await kn.search('godot');
  assert.equal(calls().length, n);
  clock += 7 * 3600_000;
  await kn.search('godot');
  assert.ok(calls().length > n);
});

test('ders sayfası gizli bilgiden arındırılır, aynı başlık ikinci kez açılmaz', async (t) => {
  const { kn, calls, db } = setup(t);
  const a = await kn.writeLesson({ title: 'Yeni araç X', markdown: '## Özet\nanahtar: api_key=abcdef123456789 ile kurulur', parentId: 'kok' });
  assert.equal(a.created, true);
  assert.deepEqual(a.redacted, ['parola/anahtar ataması']);
  const create = calls().find((c) => c.name === 'create_page');
  assert.ok(!/abcdef123456789/.test(create.args.markdown));
  assert.equal(create.args.parent_id, 'kok');
  const b = await kn.writeLesson({ title: 'Yeni araç X', markdown: 'tekrar' });
  assert.equal(b.created, false);
  assert.equal(calls().filter((c) => c.name === 'create_page').length, 1);
  assert.ok(since(db, 0).some((e) => e.type === 'knowledge.written'));
});

test('parseLesson YOK ve başlıksız cevabı reddeder', () => {
  assert.equal(parseLesson('YOK'), null);
  assert.equal(parseLesson('başlıksız not'), null);
  assert.deepEqual(parseLesson('BAŞLIK: Godot başsız test\n## Özet\nx'), { title: 'Godot başsız test', markdown: '## Özet\nx' });
});

test('hedef Noesis bağlamıyla planlanır, görev talimatına eklenir, sonuç arşive yazılır', async (t) => {
  const { kn, calls, db } = setup(t);
  const goal = createGoal(db, { title: 'Roblox Studio MCP ile oynatma testi' });
  const ctx = await kn.contextFor(goal.title);
  const plan = { tasks: [{ key: 'a', prompt: 'testi yaz', engine: 'codex', review: false }] };
  const llm = async (i) => {
    if (/Sen yöneticisin/.test(i.prompt)) { assert.match(i.prompt, /Bilgi arşivinden/); return `\`\`\`json\n${JSON.stringify(plan)}\n\`\`\``; }
    if (/kalıcı değeri olan/.test(i.prompt)) return 'BAŞLIK: Studio MCP oynatma testi\n## Özet\nçalıştı';
    return 'rapor';
  };
  await planGoal({ db, goalId: goal.id, llm, knowledge: ctx.text });
  const seen = [];
  const codex = { async execute(i) { seen.push(i.prompt); return { text: 'ok', final: 'ok', sessionId: null, usage: null, rate: null, error: null, exitCode: 0, timedOut: false, stderr: '' }; } };
  const r = await drive({ db, adapters: { codex }, llm, cwd: '.', knowledge: kn });
  assert.match(seen[0], /ExecRobloxMCP ⚠/);
  assert.equal(getGoal(db, goal.id).status, 'done');
  assert.equal(r.goals[0].lesson.created, true);
  assert.equal(calls().filter((c) => c.name === 'create_page')[0].args.title, 'Studio MCP oynatma testi');
});
