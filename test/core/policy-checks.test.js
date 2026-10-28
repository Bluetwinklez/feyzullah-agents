import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toolsFor, decide } from '../../src/core/policy.js';
import { runChecks } from '../../src/core/checks.js';

test('reverse yeteneği rea araçlarını ekler, codex boş liste alır', () => {
  const rev = toolsFor({ engine: 'claude', capabilities: ['reverse'] });
  assert.ok(rev.includes('mcp__rea'));
  assert.ok(rev.includes('Bash(git log:*)'));
  assert.deepEqual(toolsFor({ engine: 'codex', capabilities: ['reverse'] }), []);
  const base = toolsFor({ engine: 'claude' });
  assert.ok(base.includes('Bash(npm test:*)'));
  assert.ok(!base.includes('mcp__rea'));
});

test('roblox ve krea yetenekleri kendi araçlarını ekler', () => {
  const r = toolsFor({ engine: 'claude', capabilities: JSON.stringify(['roblox', 'krea']) });
  for (const t of ['Bash(rojo:*)', 'Bash(selene:*)', 'Bash(stylua:*)', 'Bash(lune:*)', 'Bash(rokit:*)', 'mcp__krea-ai']) assert.ok(r.includes(t), t);
});

test('hiçbir araç listesinde yıkıcı komut yok', () => {
  const all = toolsFor({ engine: 'claude', capabilities: ['reverse', 'krea', 'godot', 'roblox'] });
  assert.ok(!all.some((t) => /Bash\((rm|del|curl|git push|git reset)\b/.test(t)));
});

test('roblox.publish ask, secrets.read deny, bilinmeyen eylem ask', () => {
  assert.equal(decide('roblox.publish'), 'ask');
  assert.equal(decide('git.push'), 'ask');
  assert.equal(decide('secrets.read'), 'deny');
  assert.equal(decide('permissions.bypass'), 'deny');
  assert.equal(decide('fs.read'), 'allow');
  assert.equal(decide('bilinmeyen.eylem'), 'ask');
});

test('runChecks ilk hatada durur', async () => {
  const r = await runChecks(process.cwd(), ['node -e "process.exit(0)"', 'node -e "process.exit(3)"', 'node -e "process.exit(0)"']);
  assert.equal(r.ok, false);
  assert.equal(r.results.length, 2);
  assert.equal(r.results[1].code, 3);
  assert.equal(r.needsLlmReview, false);
});

test('komut yoksa ok ama LLM incelemesi gerekir', async () => {
  const r = await runChecks(process.cwd(), []);
  assert.equal(r.ok, true);
  assert.equal(r.needsLlmReview, true);
});

test('zaman aşımı timedOut true ve code null', async () => {
  const r = await runChecks(process.cwd(), ['node -e "setTimeout(() => {}, 20000)"'], { timeoutMs: 500 });
  assert.equal(r.ok, false);
  assert.equal(r.results[0].timedOut, true);
  assert.equal(r.results[0].code, null);
  assert.ok(r.results[0].ms < 10000);
});

test('runChecks Türkçe çıktıyı bozmaz', async () => {
  const r = await runChecks(process.cwd(), [`node -e "console.log('şğüİı')"`]);
  assert.equal(r.ok, true);
  assert.match(r.results[0].tail, /şğüİı/);
});
