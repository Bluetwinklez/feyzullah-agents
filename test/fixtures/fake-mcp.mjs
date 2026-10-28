// Testler için sahte Noesis MCP sunucusu (stdio, satır başına JSON-RPC). Çağrıları FAKE_MCP_LOG dosyasına ekler.
import { appendFileSync } from 'node:fs';

const PAGES = [
  { id: 'p1', title: 'Roblox Studio MCP', markdown: 'Studio gömülü MCP ile canlı oynatma ve ekran görüntüsü. Resmi, önerilen.' },
  { id: 'p2', title: 'ExecRobloxMCP', markdown: 'Executor tabanlı MCP. Güvenlik riski, önerilmez.' },
  { id: 'p3', title: 'Godot kurulumu', markdown: 'C:\\Tools\\godot altında başsız çalışır.' },
];
const created = [];
const log = (o) => { if (process.env.FAKE_MCP_LOG) appendFileSync(process.env.FAKE_MCP_LOG, `${JSON.stringify(o)}\n`); };
const reply = (id, result) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
const text = (id, o) => reply(id, { content: [{ type: 'text', text: typeof o === 'string' ? o : JSON.stringify(o) }] });

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => {
  buf += c;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const m = JSON.parse(line);
    if (m.method === 'initialize') reply(m.id, { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'sahte', version: '0' } });
    else if (m.method === 'tools/call') {
      const { name, arguments: a } = m.params;
      log({ name, args: a });
      if (name === 'search_notes') {
        const words = String(a.query).toLowerCase().split(/\s+/);
        text(m.id, [...PAGES, ...created].filter((p) => words.some((w) => `${p.title} ${p.markdown}`.toLowerCase().includes(w)))
          .map((p) => ({ kind: 'page', id: p.id, title: p.title, snippet: p.markdown.slice(0, 40) })));
      } else if (name === 'read_page') {
        const p = [...PAGES, ...created].find((x) => x.id === a.page_id);
        if (p) text(m.id, { ...p, path: [p.title] }); else reply(m.id, { isError: true, content: [{ type: 'text', text: 'yok' }] });
      } else if (name === 'create_page') {
        const p = { id: `new${created.length + 1}`, title: a.title, markdown: a.markdown };
        created.push(p);
        text(m.id, { id: p.id, title: p.title });
      } else reply(m.id, { isError: true, content: [{ type: 'text', text: `bilinmeyen araç ${name}` }] });
    }
  }
});
