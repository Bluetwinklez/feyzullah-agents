import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../src/core/db.js';
import {
  addComment, createGoal, getDocument, getGoal, goalProgress, goalTasks, isApproved, listComments, pendingApprovals, requestApproval, decideApproval,
  saveDocument, commentsAsContext,
} from '../../src/core/board.js';
import { approvePlan, createLlm, drive, planGoal, reviewTask, wakeWithComment } from '../../src/core/orchestrator.js';
import { runCouncil, councilDocument } from '../../src/core/council.js';
import { parsePlan, parseVerdict } from '../../src/prompts/manager.js';
import { getTask } from '../../src/core/tasks.js';

const json = (o) => `Plan hazır.\n\`\`\`json\n${JSON.stringify(o)}\n\`\`\``;
const PLAN = {
  reply: 'iki iş',
  tasks: [
    { key: 'kod', title: 'Kodu yaz', prompt: 'kod yaz', engine: 'codex' },
    { key: 'belge', title: 'Belgeyi yaz', prompt: 'belge yaz', engine: 'agy', after: ['kod'] },
  ],
};
const ok = (text = 'yaptım') => ({ text, final: text, sessionId: null, usage: null, rate: null, error: null, exitCode: 0, timedOut: false, stderr: '' });
const fake = (fn = () => ok()) => { const calls = []; return { calls, async execute(i) { calls.push(i); return fn(i, calls.length); } }; };

/** Sahte LLM: istemin türüne göre cevap verir, çağrıları kaydeder. */
function fakeLlm(handlers) {
  const calls = [];
  const llm = async (i) => {
    calls.push(i);
    for (const [re, fn] of handlers) if (re.test(i.prompt)) return typeof fn === 'function' ? fn(i, calls) : fn;
    return 'tamam';
  };
  llm.calls = calls;
  return llm;
}

test('parsePlan: son json bloğu, bilinmeyen bağımlılık ve boş liste reddedilir', () => {
  const p = parsePlan(json(PLAN));
  assert.equal(p.tasks.length, 2);
  assert.equal(p.tasks[1].engine, 'antigravity');
  assert.deepEqual(p.tasks[1].after, ['kod']);
  assert.equal(p.tasks[0].review, true);
  assert.match(parsePlan('json yok').error, /json bloğu yok/);
  assert.match(parsePlan(json({ tasks: [] })).error, /boş/);
  assert.match(parsePlan(json({ tasks: [{ key: 'a', prompt: 'x', after: ['z'] }] })).error, /bilinmeyen bağımlılık/);
});

test('parseVerdict belirsizse geçer, son karar sayılır', () => {
  assert.equal(parseVerdict('iyi\nKARAR: PASS').pass, true);
  assert.equal(parseVerdict('önce PASS dedim ama\nKARAR: NEEDS WORK').pass, false);
  assert.equal(parseVerdict('karar yok').pass, true);
});

test('plan görevleri bağımlılıklarıyla kurar ve hedef aktif olur', async () => {
  const db = openDb();
  const goal = createGoal(db, { title: 'Site yap' });
  const llm = fakeLlm([[/Sen yöneticisin/, json(PLAN)]]);
  const r = await planGoal({ db, goalId: goal.id, llm });
  assert.equal(r.taskIds.length, 2);
  assert.equal(getGoal(db, goal.id).status, 'active');
  const [a, b] = goalTasks(db, goal.id);
  assert.equal(a.status, 'todo');
  assert.equal(b.engine, 'antigravity');
  assert.equal(db.prepare('SELECT depends_on FROM task_deps WHERE task_id = ?').get(b.id).depends_on, a.id);
  assert.ok(getDocument(db, 'goal', goal.id, 'plan'));
  db.close();
});

test('bozuk plan bir kez düzeltme istenir', async () => {
  const db = openDb();
  const goal = createGoal(db, { title: 'x' });
  const llm = fakeLlm([[/sözleşmeye uymadı/, json(PLAN)], [/Sen yöneticisin/, 'json unuttum']]);
  await planGoal({ db, goalId: goal.id, llm });
  assert.equal(llm.calls.length, 2);
  assert.equal(goalTasks(db, goal.id).length, 2);
  db.close();
});

test('plan onayı istenirse görevler backlogda bekler, onayla kuyruğa girer', async () => {
  const db = openDb();
  const goal = createGoal(db, { title: 'x' });
  const r = await planGoal({ db, goalId: goal.id, llm: fakeLlm([[/Sen yöneticisin/, json(PLAN)]]), requireApproval: true });
  assert.ok(r.approvalId);
  assert.equal(getGoal(db, goal.id).status, 'awaiting_approval');
  assert.deepEqual(goalProgress(db, goal.id), { backlog: 2 });
  assert.equal(pendingApprovals(db).length, 1);
  approvePlan(db, goal.id);
  assert.equal(getGoal(db, goal.id).status, 'active');
  assert.deepEqual(goalProgress(db, goal.id), { todo: 2 });
  assert.ok(isApproved(db, 'plan.approve', goal.id));
  db.close();
});

test('japon balığı sorun bulursa plan eleştiriyle yeniden yapılır', async () => {
  const db = openDb();
  const goal = createGoal(db, { title: 'x' });
  const llm = fakeLlm([[/ilk kez görüyorsun/, '- hangi dil kullanılacak belli değil'], [/Sen yöneticisin/, json(PLAN)]]);
  await planGoal({ db, goalId: goal.id, llm, goldfish: true });
  const planCalls = llm.calls.filter((c) => /Sen yöneticisin/.test(c.prompt));
  assert.equal(planCalls.length, 2);
  assert.match(planCalls[1].prompt, /hangi dil/);
  assert.equal(llm.calls.find((c) => /ilk kez/.test(c.prompt)).engine, 'codex');
  assert.equal(goalTasks(db, goal.id).length, 2);
  db.close();
});

test('hedef plandan bitişe gider: inceleme, düzeltme turu, rapor', async () => {
  const db = openDb();
  const goal = createGoal(db, { title: 'Site yap' });
  let reviews = 0;
  const llm = fakeLlm([
    [/Sen yöneticisin/, json(PLAN)],
    [/işini kontrol et/, () => (++reviews === 1 ? 'eksik test\nKARAR: NEEDS WORK' : 'KARAR: PASS')],
    [/Hedef raporu/, 'RAPOR: iki iş bitti'],
  ]);
  await planGoal({ db, goalId: goal.id, llm });
  const codex = fake();
  const antigravity = fake();
  const r = await drive({ db, adapters: { codex, antigravity }, llm, cwd: '.' });
  assert.equal(getGoal(db, goal.id).status, 'done');
  assert.equal(codex.calls.length, 2);
  assert.match(codex.calls[1].prompt, /eksik test/);
  assert.match(codex.calls[1].prompt, /kod yaz/);
  assert.equal(antigravity.calls.length, 1);
  assert.equal(getDocument(db, 'goal', goal.id, 'rapor').body, 'RAPOR: iki iş bitti');
  assert.equal(r.goals[0].status, 'done');
  db.close();
});

test('iki turdan sonra başka motorla düzeltici, sonra döngü kapanır', async () => {
  const db = openDb();
  const goal = createGoal(db, { title: 'x' });
  const llm = fakeLlm([
    [/Sen yöneticisin/, json({ tasks: [{ key: 'a', prompt: 'iş', engine: 'codex' }] })],
    [/işini kontrol et/, 'KARAR: NEEDS WORK'],
  ]);
  await planGoal({ db, goalId: goal.id, llm });
  const codex = fake();
  const antigravity = fake();
  await drive({ db, adapters: { codex, antigravity }, llm, cwd: '.' });
  const [t] = goalTasks(db, goal.id);
  assert.equal(t.status, 'done');
  assert.equal(codex.calls.length, 3);
  assert.equal(antigravity.calls.length, 1);
  assert.match(antigravity.calls[0].prompt, /iki kez düzeltme/);
  assert.equal(getGoal(db, goal.id).status, 'done');
  db.close();
});

test('makine kontrolü geçerse LLM kontrolcüsü çağrılmaz', async () => {
  const db = openDb();
  const goal = createGoal(db, { title: 'x' });
  const llm = fakeLlm([[/Sen yöneticisin/, json({ tasks: [{ key: 'a', prompt: 'iş', engine: 'codex', checks: ['node -e "process.exit(0)"'] }] })]]);
  await planGoal({ db, goalId: goal.id, llm });
  await drive({ db, adapters: { codex: fake() }, llm, cwd: process.cwd() });
  assert.ok(!llm.calls.some((c) => /işini kontrol et/.test(c.prompt)));
  assert.match(getDocument(db, 'task', goalTasks(db, goal.id)[0].id, 'kontrol').body, /^PASS \(checks\)/);
  db.close();
});

test('makine kontrolü kalırsa düzeltme turu çıktıyla açılır', async () => {
  const db = openDb();
  const task = { id: 'x', checks: JSON.stringify(['node -e "console.log(\'kırmızı\'); process.exit(1)"']) };
  const v = await reviewTask({ db: openDb(), task, llm: async () => 'KARAR: PASS', cwd: process.cwd() });
  assert.equal(v.pass, false);
  assert.match(v.feedback, /kırmızı/);
  db.close();
});

test('kontrolcüye ulaşılamazsa iş geçer', async () => {
  const db = openDb();
  const v = await reviewTask({ db, task: { id: 't', title: 'x', checks: null, result: null }, llm: async () => { throw new Error('limit'); }, cwd: '.' });
  assert.equal(v.pass, true);
  db.close();
});

test('yorum konuma bağlı bağlam olur ve bitmiş görevi uyandırır', async () => {
  const db = openDb();
  const goal = createGoal(db, { title: 'x' });
  const llm = fakeLlm([[/Sen yöneticisin/, json({ tasks: [{ key: 'a', prompt: 'iş', engine: 'codex', review: false }] })]]);
  await planGoal({ db, goalId: goal.id, llm });
  const codex = fake();
  await drive({ db, adapters: { codex }, llm, cwd: '.' });
  const [t] = goalTasks(db, goal.id);
  assert.equal(t.status, 'done');
  addComment(db, { entity: 'task', entityId: t.id, author: 'kullanıcı', body: 'başlık yanlış', anchor: { file: 'index.html', line: 3 } });
  assert.match(commentsAsContext(listComments(db, 'task', t.id)), /\[index\.html:3\]: başlık yanlış/);
  wakeWithComment(db, t.id);
  assert.equal(getGoal(db, goal.id).status, 'active');
  await drive({ db, adapters: { codex }, llm, cwd: '.' });
  assert.match(codex.calls[1].prompt, /başlık yanlış/);
  assert.equal(getTask(db, t.id).status, 'done');
  db.close();
});

test('belgeler sürümlenir, onay reddedilebilir', () => {
  const db = openDb();
  assert.equal(saveDocument(db, { entity: 'goal', entityId: 'g', name: 'spec', body: 'v1' }), 1);
  assert.equal(saveDocument(db, { entity: 'goal', entityId: 'g', name: 'spec', body: 'v2' }), 2);
  assert.equal(getDocument(db, 'goal', 'g', 'spec').body, 'v2');
  assert.equal(getDocument(db, 'goal', 'g', 'spec', 1).body, 'v1');
  const id = requestApproval(db, { action: 'git.push', entityId: 'b' });
  decideApproval(db, id, { approve: false, by: 'kullanıcı' });
  assert.equal(isApproved(db, 'git.push', 'b'), false);
  assert.throws(() => decideApproval(db, id, { approve: true, by: 'x' }), /bekleyen onay yok/);
  db.close();
});

test('createLlm limitte sıradaki motora geçer', async () => {
  const claude = fake(() => ({ ...ok(), final: null, text: '', error: 'usage limit reached' }));
  const codex = fake(() => ok('codex cevabı'));
  const llm = createLlm({ claude, codex }, { cwd: '.' });
  assert.equal(await llm({ prompt: 'p' }), 'codex cevabı');
  const bad = createLlm({ claude: fake(() => ({ ...ok(), final: null, error: 'sözdizimi' })), codex }, { cwd: '.' });
  await assert.rejects(bad({ prompt: 'p' }), /sözdizimi/);
});

test('konsey: isimsiz çapraz inceleme ve başkan kararı, yabancı bağlam görmez', async () => {
  const seen = [];
  const llm = async (i) => {
    seen.push(i);
    if (/Konsey başkanısın/.test(i.prompt)) return 'KARAR: SQLite kalsın';
    if (/isimsizdir/.test(i.prompt)) return 'SIRA: A, B';
    return i.persona ? `${i.persona.slice(0, 10)} önerisi` : 'yabancı önerisi';
  };
  const r = await runCouncil({ question: 'Veritabanı ne olsun?', context: 'GİZLİ BAĞLAM', llm });
  assert.equal(r.answers.length, 5);
  assert.equal(r.reviews.length, 5);
  assert.equal(r.decision, 'KARAR: SQLite kalsın');
  const outsider = seen.find((s) => !s.persona && /Soru:/.test(s.prompt) && !/isimsizdir/.test(s.prompt));
  assert.ok(!/GİZLİ BAĞLAM/.test(outsider.prompt));
  const review = seen.find((s) => /isimsizdir/.test(s.prompt));
  assert.ok(!/Mimar|Şüpheci/.test(review.prompt));
  assert.match(councilDocument('Veritabanı ne olsun?', r), /## Karar/);
});

test('konseyde cevap veremeyen danışman atlanır', async () => {
  let n = 0;
  const llm = async (i) => {
    if (/Konsey başkanısın/.test(i.prompt)) return 'karar';
    if (i.engine === 'antigravity') throw new Error('limit');
    return `cevap ${++n}`;
  };
  const r = await runCouncil({ question: 'q', llm });
  assert.equal(r.answers.length, 3);
});
