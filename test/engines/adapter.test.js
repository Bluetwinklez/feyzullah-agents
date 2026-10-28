import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCliAdapter } from '../../src/engines/adapter.js';
import { withPersona } from '../../src/engines/args.js';

const FAKE = join(import.meta.dirname, '..', 'fixtures', 'fake-engine.mjs');
const fake = (engine, env = {}) => createCliAdapter(engine, { bin: process.execPath, prefixArgs: [FAKE], env });

function tmp(t) {
  const dir = mkdtempSync(join(tmpdir(), 'fa-ad-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test('adaptör stdin ile prompt verir', async (t) => {
  const cwd = tmp(t);
  const r = await fake('claude').execute({ prompt: 'şğü merhaba', persona: 'K', cwd });
  assert.equal(r.final, 'şğü merhaba');
  assert.equal(r.text, 'şğü merhaba');
  assert.equal(r.sessionId, 'fake-claude');
  assert.equal(r.exitCode, 0);
  assert.equal(r.error, null);
  assert.deepEqual(r.usage, { input: 3, cachedInput: 0, cacheWrite: 0, output: 2, known: true });
});

test('codex mesajları birleşir ve persona stdin başına eklenir', async (t) => {
  const cwd = tmp(t);
  const r = await fake('codex').execute({ prompt: 'G', persona: 'K', cwd });
  assert.equal(r.final, `bir\n${withPersona('K', 'G')}`);
  assert.deepEqual(r.usage, { input: 6, cachedInput: 4, cacheWrite: 0, output: 1, known: true });
});

test('agy kısa prompt argümanla gider, kullanım bilinmez', async (t) => {
  const cwd = tmp(t);
  const r = await fake('antigravity').execute({ prompt: 'G', cwd });
  assert.equal(r.final, 'G');
  assert.equal(r.usage.known, false);
});

test('agy uzun prompt dosyaya yazılır ve iş sonunda silinir', async (t) => {
  const cwd = tmp(t);
  const long = 'x'.repeat(30_000);
  const r = await fake('antigravity').execute({ prompt: long, persona: 'K', cwd });
  assert.equal(r.final, `dosya:${withPersona('K', long).length}`);
  assert.equal(existsSync(join(cwd, '.fa-gorev.md')), false);
});

test('bulunamayan ikili hata döner, atmaz', async (t) => {
  const cwd = tmp(t);
  const r = await createCliAdapter('codex', { bin: join(cwd, 'yok.exe') }).execute({ prompt: 'p', cwd });
  assert.match(r.error, /başlatılamadı/);
});

test('adaptör iptalinde alt süreç ağacı ölür', async (t) => {
  const cwd = tmp(t);
  const pidFile = join(cwd, 'pid');
  const ctrl = new AbortController();
  const p = fake('codex', { FAKE_MODE: 'grandchild', FAKE_PIDFILE: pidFile }).execute({ prompt: 'p', cwd, signal: ctrl.signal });
  for (let i = 0; i < 100 && !existsSync(pidFile); i++) await new Promise((r) => setTimeout(r, 50));
  const pid = Number(readFileSync(pidFile, 'utf8'));
  assert.ok(alive(pid));
  ctrl.abort();
  const r = await p;
  assert.equal(r.error, 'durduruldu');
  for (let i = 0; i < 40 && alive(pid); i++) await new Promise((res) => setTimeout(res, 50));
  assert.equal(alive(pid), false);
});

test('zaman aşımında timedOut true', async (t) => {
  const cwd = tmp(t);
  const r = await createCliAdapter('codex', { bin: process.execPath, prefixArgs: [FAKE], timeoutMs: 400, env: { FAKE_MODE: 'grandchild', FAKE_PIDFILE: join(cwd, 'pid') } })
    .execute({ prompt: 'p', cwd });
  assert.equal(r.timedOut, true);
  const pid = Number(readFileSync(join(cwd, 'pid'), 'utf8'));
  for (let i = 0; i < 40 && alive(pid); i++) await new Promise((res) => setTimeout(res, 50));
  assert.equal(alive(pid), false);
});
