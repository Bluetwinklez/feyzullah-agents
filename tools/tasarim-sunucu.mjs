// docs/tasarim önizlemesi: yalnız 127.0.0.1, yalnız bu klasörün içi. Kullanım: node tools/tasarim-sunucu.mjs [port]
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../docs/tasarim', import.meta.url)));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const port = Number(process.argv[2]) || 4173;

createServer(async (req, res) => {
  let file = join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (file !== ROOT && !file.startsWith(ROOT + sep)) return res.writeHead(403).end();
  if (file === ROOT || file.endsWith(sep)) file = join(file, 'dashboard.html');
  let body;
  try { body = await readFile(file); } catch { return res.writeHead(404).end(); }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
}).listen(port, '127.0.0.1', () => console.log(`tasarım önizleme: http://127.0.0.1:${port}/`));
