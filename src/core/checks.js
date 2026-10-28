// Makine kontrolleri: test, lint, build komutları sırayla çalışır, ilk hatada durur.
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { killTree, WIN } from './process.js';

const TAIL = 2000;

/**
 * @typedef {{cmd: string, code: number|null, timedOut: boolean, ms: number, tail: string}} CheckResult
 */

/** @param {string} cwd @param {string} cmd @param {{timeoutMs: number, env?: Record<string,string>}} o @returns {Promise<CheckResult>} */
function runOne(cwd, cmd, { timeoutMs, env }) {
  return new Promise((resolve) => {
    const started = Date.now();
    // chcp 65001: Windows konsol araçları UTF-8 bassın. Verbatim olmazsa Node tırnakları kaçışlar ve cmd bozar.
    const child = WIN
      ? spawn('cmd.exe', ['/d', '/s', '/c', `"chcp 65001>nul & ${cmd}"`], { cwd, env: { ...process.env, ...env }, windowsHide: true, windowsVerbatimArguments: true })
      : spawn('sh', ['-c', cmd], { cwd, env: { ...process.env, ...env }, detached: true });
    const dec = new StringDecoder('utf8');
    let tail = '';
    const add = (c) => { tail = (tail + dec.write(c)).slice(-TAIL); };
    child.stdout.on('data', add);
    child.stderr.on('data', add);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, timeoutMs);
    const done = (code) => {
      clearTimeout(timer);
      resolve({ cmd, code: timedOut ? null : code, timedOut, ms: Date.now() - started, tail: (tail + dec.end()).slice(-TAIL) });
    };
    child.on('error', (err) => { tail += `\nbaşlatılamadı: ${err.message}`; done(null); });
    child.on('close', (code) => done(code));
  });
}

/**
 * Komut yoksa makine kontrolü yapılamaz; sonuç ok olsa da LLM incelemesi gerekir (needsLlmReview).
 * @param {string} cwd
 * @param {string[]} commands
 * @param {{timeoutMs?: number, env?: Record<string,string>}} [o]
 * @returns {Promise<{ok: boolean, results: CheckResult[], needsLlmReview: boolean}>}
 */
export async function runChecks(cwd, commands, { timeoutMs = 120_000, env } = {}) {
  const results = [];
  for (const cmd of commands) {
    const r = await runOne(cwd, cmd, { timeoutMs, env });
    results.push(r);
    if (r.code !== 0) return { ok: false, results, needsLlmReview: false };
  }
  return { ok: true, results, needsLlmReview: commands.length === 0 };
}
