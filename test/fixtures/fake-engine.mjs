// Testlerde gerçek motorun yerine geçer. Hangi motor olduğunu argümanlardan anlar, davranışı FAKE_MODE belirler:
//   echo (varsayılan): aldığı prompt'u final olarak geri basar
//   grandchild: bir torun süreç başlatır, pid'ini FAKE_PIDFILE'a yazar ve bekler
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const engine = args[0] === 'exec' ? 'codex' : args[1] === '--output-format' ? 'claude' : 'antigravity';
const mode = process.env.FAKE_MODE ?? 'echo';
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);

function readStdin() {
  return new Promise((resolve) => {
    let s = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { s += c; });
    process.stdin.on('end', () => resolve(s));
  });
}

if (mode === 'grandchild') {
  const g = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  writeFileSync(process.env.FAKE_PIDFILE, String(g.pid));
  out(engine === 'codex' ? { type: 'thread.started', thread_id: 'g' } : engine === 'claude' ? { type: 'system', subtype: 'init', session_id: 'g' } : { event: 'init', conversation_id: 'g' });
  setInterval(() => {}, 1000);
} else if (engine === 'claude') {
  const input = await readStdin();
  out({ type: 'system', subtype: 'init', session_id: 'fake-claude' });
  out({ type: 'assistant', message: { content: [{ type: 'text', text: input }] } });
  out({ type: 'result', is_error: false, session_id: 'fake-claude', result: input, usage: { input_tokens: 3, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 2 } });
} else if (engine === 'codex') {
  const input = await readStdin();
  out({ type: 'thread.started', thread_id: 'fake-codex' });
  out({ type: 'item.completed', item: { type: 'agent_message', text: 'bir' } });
  out({ type: 'item.completed', item: { type: 'agent_message', text: input } });
  out({ type: 'turn.completed', usage: { input_tokens: 10, cached_input_tokens: 4, output_tokens: 1 } });
} else {
  const prompt = args[args.indexOf('-p') + 1];
  const file = join(process.cwd(), '.fa-gorev.md');
  const response = existsSync(file) ? `dosya:${readFileSync(file, 'utf8').length}` : prompt;
  out({ event: 'init', conversation_id: 'fake-agy' });
  out({ event: 'result', result: { status: 'SUCCESS', response } });
}
