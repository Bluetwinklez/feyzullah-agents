// Küçük MCP istemcisi (stdio, satır başına bir JSON-RPC mesajı). Noesis `noesis.exe --mcp` için.
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { killTree } from '../core/process.js';

/**
 * @param {{command: string, args?: string[], env?: Record<string,string>, timeoutMs?: number, spawnImpl?: typeof spawn}} o
 */
export function createMcpClient({ command, args = [], env = {}, timeoutMs = 30_000, spawnImpl = spawn }) {
  let child = null;
  let ready = null;
  let seq = 0;
  const pending = new Map();
  let buf = '';
  const dec = new StringDecoder('utf8');

  const fail = (err) => { for (const p of pending.values()) p.reject(err); pending.clear(); child = null; ready = null; };
  function request(method, params) {
    const id = ++seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`MCP zaman aşımı: ${method}`)); }, timeoutMs);
      pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) })}\n`);
    });
  }
  function start() {
    child = spawnImpl(command, args, { windowsHide: true, env: { ...process.env, ...env } });
    child.stdout.on('data', (c) => {
      const lines = (buf + dec.write(c)).split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        let m;
        try { m = JSON.parse(line); } catch { continue; }
        const p = m.id != null && pending.get(m.id);
        if (!p) continue;
        pending.delete(m.id);
        if (m.error) p.reject(new Error(`MCP hatası: ${m.error.message ?? JSON.stringify(m.error)}`));
        else p.resolve(m.result);
      }
    });
    child.stdin.on('error', () => {});
    child.on('error', (err) => fail(new Error(`MCP başlatılamadı: ${err.message}`)));
    child.on('exit', () => fail(new Error('MCP süreci kapandı')));
    return request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'feyzullah-agents', version: '0.1.0' } })
      .then((r) => { child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`); return r; });
  }

  return {
    /** Aracı çağırır; metin içeriği JSON ise ayrıştırılmış döner. */
    async callTool(name, args = {}) {
      if (!ready) ready = start();
      await ready;
      const r = await request('tools/call', { name, arguments: args });
      const text = (r?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
      if (r?.isError) throw new Error(`${name}: ${text}`);
      try { return JSON.parse(text); } catch { return text; }
    },
    close() { if (child) { killTree(child); child = null; ready = null; } },
  };
}
