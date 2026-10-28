import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseLine, ENGINES } from '../../src/engines/parse.js';
import { cliArgs, normalizeEngine, promptVia, stdinText, withPersona } from '../../src/engines/args.js';
import { findBins } from '../../src/engines/bins.js';

const fixture = (name) => readFileSync(join(import.meta.dirname, '..', 'fixtures', 'engines', `${name}.jsonl`), 'utf8').split('\n').filter(Boolean);

test('codex kullanımı önbelleği ayırır', () => {
  const p = parseLine('codex', JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1000, cached_input_tokens: 800, output_tokens: 50 } }));
  assert.deepEqual(p.usage, { input: 200, cachedInput: 800, cacheWrite: 0, output: 50, known: true });
});

test('claude result kullanımı üç parçaya ayrılır', () => {
  const p = parseLine('claude', fixture('claude').at(-1));
  assert.deepEqual(p.usage, { input: 10, cachedInput: 900, cacheWrite: 40, output: 5, known: true });
  assert.equal(p.final, 'Merhaba dünya');
  assert.equal(p.sessionId, '11111111-1111-4111-8111-111111111111');
});

test('fixture: her motor oturum ve final verir', () => {
  for (const e of ENGINES) {
    const out = fixture(e).map((l) => parseLine(e, l));
    assert.ok(out.some((p) => p?.sessionId), e);
    assert.ok(out.some((p) => typeof p?.final === 'string'), e);
    assert.ok(!out.some((p) => p?.error), e);
  }
});

test('hata fixture\'ları error verir', () => {
  for (const e of ENGINES) assert.ok(fixture(`${e}-error`).map((l) => parseLine(e, l)).some((p) => p?.error), e);
  const claudeErr = parseLine('claude', fixture('claude-error').at(-1));
  assert.equal(claudeErr.usage.known, true);
});

test('claude rate olayı rate olarak döner', () => {
  assert.equal(parseLine('claude', fixture('claude')[1]).rate.status, 'allowed');
});

test('agy SUCCESS dışı ve boş cevap hatadır', () => {
  const r = (result) => parseLine('antigravity', JSON.stringify({ event: 'result', result }));
  assert.ok(r({ status: 'FAILED' }).error);
  assert.ok(r({ status: 'SUCCESS', response: '' }).error);
  assert.equal(r({ status: 'SUCCESS', response: ' ok ' }).final, 'ok');
});

test('agy usage bilinmez', () => {
  const p = parseLine('antigravity', fixture('antigravity').at(-1));
  assert.deepEqual(p.usage, { input: 0, cachedInput: 0, cacheWrite: 0, output: 0, known: false });
});

test('codex error satırı (yeniden bağlanma) hata sayılmaz', () => {
  assert.equal(parseLine('codex', JSON.stringify({ type: 'error', message: 'Reconnecting... 1/5' })), null);
});

test('bozuk satır null', () => {
  for (const e of ENGINES) {
    assert.equal(parseLine(e, 'x{'), null);
    assert.equal(parseLine(e, ''), null);
  }
});

test('cliArgs Ofis ile birebir', () => {
  assert.deepEqual(cliArgs('codex', { cwd: 'C:/w', prompt: 'p', resumeId: 's1', network: true }),
    ['exec', '--json', '-s', 'workspace-write', '-c', 'sandbox_workspace_write.network_access=true', '--skip-git-repo-check', '-C', 'C:/w', 'resume', 's1', '-']);
  assert.deepEqual(cliArgs('codex', { cwd: 'C:/w', prompt: 'p' }), ['exec', '--json', '-s', 'workspace-write', '--skip-git-repo-check', '-C', 'C:/w', '-']);
  assert.deepEqual(cliArgs('antigravity', { cwd: '.', persona: 'K', prompt: 'G', resumeId: 'c1' }),
    ['-p', 'G', '--output-format', 'stream-json', '--sandbox', '--mode', 'accept-edits', '--conversation', 'c1']);
  assert.deepEqual(cliArgs('antigravity', { cwd: '.', persona: 'K', prompt: 'G' }),
    ['-p', withPersona('K', 'G'), '--output-format', 'stream-json', '--sandbox', '--mode', 'accept-edits']);
  assert.deepEqual(cliArgs('claude', { cwd: '.', persona: 'K', prompt: 'G', resumeId: 'r', allowedTools: ['Read', 'Bash(git status:*)'] }),
    ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits', '--append-system-prompt', 'K', '--resume', 'r', '--allowedTools', 'Read', 'Bash(git status:*)']);
  assert.deepEqual(cliArgs('claude', { cwd: '.', personaFile: 'f.md', prompt: 'G' }),
    ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits', '--append-system-prompt-file', 'f.md']);
});

test('stdin metni Ofis ile aynı', () => {
  assert.equal(stdinText('claude', { persona: 'K', prompt: 'G' }), 'G');
  assert.equal(stdinText('codex', { persona: 'K', prompt: 'G' }), withPersona('K', 'G'));
  assert.equal(stdinText('codex', { persona: 'K', prompt: 'G', resumeId: 'x' }), 'G');
  assert.equal(stdinText('antigravity', { persona: 'K', prompt: 'G' }), null);
  assert.equal(promptVia('claude'), 'stdin');
  assert.equal(promptVia('codex'), 'stdin');
  assert.equal(promptVia('antigravity'), 'argv');
});

test('hiçbir motorda izin atlatma bayrağı yok', () => {
  for (const e of ENGINES) {
    const args = cliArgs(e, { cwd: '.', persona: 'K', prompt: 'G', resumeId: 'r', allowedTools: ['Read'], network: true });
    assert.ok(!args.some((a) => /dangerously|yolo|bypass/i.test(a)), e);
  }
});

test('normalizeEngine agy → antigravity', () => {
  assert.equal(normalizeEngine('agy'), 'antigravity');
  assert.equal(normalizeEngine('gemini'), 'antigravity');
  assert.equal(normalizeEngine('Codex'), 'codex');
  assert.throws(() => normalizeEngine('gpt'), /bilinmeyen motor/);
});

test('findBins .cmd döndürmez', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fa-bins-'));
  try {
    writeFileSync(join(dir, 'codex.cmd'), '@echo off');
    writeFileSync(join(dir, 'agy.cmd'), '@echo off');
    writeFileSync(join(dir, 'agy.exe'), '');
    const bins = await findBins({ PATH: dir, LOCALAPPDATA: join(dir, 'yok'), APPDATA: join(dir, 'yok') });
    assert.equal(bins.codex ?? null, null);
    assert.equal(bins.antigravity, join(dir, 'agy.exe'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
