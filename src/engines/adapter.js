// CLI motor adaptörü. Davranış Ofis `src/agents/cli.js` cliChat/runCli ile aynı; farkı hata atmak yerine
// sonucu (error, exitCode, timedOut) döndürmesi: kararı zamanlayıcı verir.
import { spawn } from 'node:child_process';
import { unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { killTree, WIN, withExtraPath } from '../core/process.js';
import { cliArgs, stdinText, withPersona } from './args.js';
import { parseLine } from './parse.js';

// Windows komut satırı en fazla ~32.767 karakter: uzun prompt dosyayla gider.
export const MAX_ARG = 24_000;
export const TASK_FILE = '.fa-gorev.md';

/**
 * @typedef {import('./parse.js').Usage} Usage
 * @typedef {{prompt: string, persona?: string|null, cwd: string, resumeId?: string|null, allowedTools?: string[], network?: boolean, model?: string|null,
 *   signal?: AbortSignal, onEvent?: (ev: import('./parse.js').ParsedLine) => void}} ExecuteInput
 * usage: motor kullanım satırı basmadıysa null (ör. limite takılıp hemen çıkan codex).
 * @typedef {{text: string, final: string|null, sessionId: string|null, usage: Usage|null, rate: any, error: string|null, exitCode: number|null,
 *   timedOut: boolean, stderr: string}} ExecuteResult
 * @typedef {{engine: string, execute: (i: ExecuteInput) => Promise<ExecuteResult>}} Adapter
 */

const addUsage = (a, b) => ({ input: a.input + b.input, cachedInput: a.cachedInput + b.cachedInput, cacheWrite: a.cacheWrite + b.cacheWrite,
  output: a.output + b.output, known: a.known && b.known });

let fileSeq = 0;

/**
 * @param {'claude'|'codex'|'antigravity'} engine
 * @param {{bin: string, timeoutMs?: number, spawnImpl?: typeof spawn, extraPath?: string|null, prefixArgs?: string[], env?: Record<string,string>}} o
 *   prefixArgs: motor argümanlarından önce verilir (testte sahte motor betiği).
 * @returns {Adapter}
 */
export function createCliAdapter(engine, { bin, timeoutMs = 60 * 60_000, spawnImpl = spawn, extraPath = null, prefixArgs = [], env = {} }) {
  /** @param {ExecuteInput & {personaFile?: string|null}} i @returns {Promise<ExecuteResult>} */
  function run({ prompt, persona = null, personaFile = null, cwd, resumeId = null, allowedTools = [], network = false, model = null, signal, onEvent = () => {} }) {
    return new Promise((resolve) => {
      const args = [...prefixArgs, ...cliArgs(engine, { cwd, persona, personaFile, prompt, resumeId, allowedTools, network, model })];
      // FEYZULLAH_AGENTS: kullanıcının hook'ları bu süreçlerde susabilsin.
      const childEnv = withExtraPath({ ...process.env, ...env, FEYZULLAH_AGENTS: '1' }, extraPath);
      let child;
      try {
        child = spawnImpl(bin, args, { cwd, windowsHide: true, env: childEnv, detached: !WIN });
      } catch (err) {
        resolve({ text: '', final: null, sessionId: resumeId, usage: null, rate: null,
          error: `başlatılamadı: ${err.message}`, exitCode: null, timedOut: false, stderr: '' });
        return;
      }
      let sessionId = resumeId;
      /** @type {Usage|null} */
      let usage = null;
      let streamed = '';
      let final = null;
      let error = null;
      let rate = null;
      let stderr = '';
      let buf = '';
      let timedOut = false;
      let settled = false;
      const dec = new StringDecoder('utf8');
      const handle = (line) => {
        if (!line.trim()) return;
        const ev = parseLine(engine, line);
        if (!ev) return;
        try { onEvent(ev); } catch {}
        if (ev.rate) { rate = ev.rate; return; }
        if (ev.usage) usage = usage ? addUsage(usage, ev.usage) : ev.usage;
        if (ev.sessionId) sessionId = ev.sessionId;
        // Codex'in agent_message'ı tam mesajdır ve birden çok gelebilir; claude/agy metni parça parça gelir.
        if (ev.text && engine !== 'codex') streamed += ev.text;
        if (ev.final != null) {
          final = engine === 'codex' && streamed ? `${streamed}\n${ev.final}` : ev.final;
          if (engine === 'codex') streamed = final;
        }
        if (ev.error) error = ev.error;
      };
      child.stdout.on('data', (c) => { const lines = (buf + dec.write(c)).split('\n'); buf = lines.pop(); lines.forEach(handle); });
      child.stderr.on('data', (c) => { stderr = (stderr + c).slice(-2000); });
      child.stdin.on('error', () => {});
      const input = stdinText(engine, { persona, prompt, resumeId });
      if (input == null) child.stdin.end(); else child.stdin.end(input);
      const timer = timeoutMs > 0 ? setTimeout(() => { timedOut = true; killTree(child); }, timeoutMs) : null;
      const onAbort = () => { error = 'durduruldu'; killTree(child); };
      if (signal?.aborted) onAbort(); else signal?.addEventListener('abort', onAbort, { once: true });
      const finish = (exitCode) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        resolve({ text: (final ?? streamed).trim(), final, sessionId, usage, rate, error, exitCode, timedOut, stderr: stderr.trim() });
      };
      child.on('error', (err) => { error = `başlatılamadı: ${err.message}`; finish(null); });
      const drain = (code) => { if (settled) return; handle(buf + dec.end()); buf = ''; finish(code); };
      child.on('close', drain);
      // Arka planda kalan torun süreç stdout'u açık tutarsa close gelmez: exit'ten sonra kısa bekleyip bitir.
      child.on('exit', (code) => setTimeout(() => drain(code), 2000));
    });
  }

  return {
    engine,
    async execute(i) {
      if (engine === 'antigravity') {
        const full = i.resumeId ? i.prompt : withPersona(i.persona, i.prompt);
        if (full.length > MAX_ARG) {
          // agy kum havuzunda çalışır: dosya çalışma klasöründe durur ve iş bitince silinir (git dalına girmesin).
          const f = join(i.cwd, TASK_FILE);
          await writeFile(f, full);
          const short = `Talimatın ve kimliğin bu klasördeki ${TASK_FILE} dosyasında (komut satırına sığmadı). Önce o dosyayı oku, oradaki görevi uygula; dosyayı silme ya da değiştirme.`;
          try { return await run({ ...i, persona: null, prompt: short }); } finally { await unlink(f).catch(() => {}); }
        }
      }
      if (engine === 'claude' && i.persona && i.persona.length > MAX_ARG) {
        const f = join(tmpdir(), `fa-kimlik-${process.pid}-${Date.now()}-${++fileSeq}.md`);
        await writeFile(f, i.persona);
        try { return await run({ ...i, persona: null, personaFile: f }); } finally { await unlink(f).catch(() => {}); }
      }
      return run(i);
    },
  };
}
