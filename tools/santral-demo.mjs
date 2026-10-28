// Santral önizlemesi: geçici veritabanı, sahte motorlar (gerçek CLI çağrılmaz, kredi harcanmaz).
// Kullanım: node tools/santral-demo.mjs [port]
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadAgents, syncAgents } from '../src/agents/registry.js';
import { requestApproval } from '../src/core/board.js';
import { openDb } from '../src/core/db.js';
import { createSantral } from '../src/server/http.js';

const db = openDb(join(mkdtempSync(join(tmpdir(), 'fa-demo-')), 'fa.db'));
syncAgents(db, loadAgents([join(import.meta.dirname, '..', 'agents')]));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const fake = (engine, ms) => ({
  engine,
  async execute(i) {
    for (let t = 0; t < ms && !i.signal?.aborted; t += 500) { i.onEvent?.({}); await wait(500); }
    const final = `Tamamlandı: ${i.prompt.split('\n')[0].slice(0, 80)}`;
    return { text: final, final, sessionId: null, usage: { input: 2400, cachedInput: 900, cacheWrite: 0, output: 600, known: true }, rate: null, error: null, exitCode: 0, timedOut: false, stderr: '' };
  },
});
const plan = {
  reply: 'Hedefi dört işe böldüm: veri ve araştırma paralel, grafik ve yazı veriden sonra.',
  tasks: [
    { key: 'veri', title: 'NBL verisi çek, temizle', prompt: 'NBL maç verisini çek ve temizle', engine: 'codex', review: false },
    { key: 'arastir', title: 'Sakatlık kaynakları', prompt: 'sakatlık kaynaklarını araştır', engine: 'antigravity', review: false },
    { key: 'grafik', title: 'Elo grafikleri', prompt: 'arayüz için elo grafikleri tasarla', engine: 'codex', after: ['veri'], review: false },
    { key: 'yaz', title: 'Bulguları yaz', prompt: 'rapor ve özet yaz', engine: 'antigravity', after: ['veri', 'arastir'], review: false },
  ],
};
const llm = async ({ prompt }) => {
  await wait(800);
  if (/Sen yöneticisin/.test(prompt)) return `\`\`\`json\n${JSON.stringify(plan)}\n\`\`\``;
  return 'NBL sezon raporu hazır.\n\nVeri 4.812 maçtan temizlendi; eksik oyuncu etkisi Elo farkının yaklaşık üçte biri kadar.\nGrafikler ve sakatlık kaynakları rapora eklendi.';
};
const s = createSantral({ db, adapters: { codex: fake('codex', 6000), antigravity: fake('antigravity', 4000), claude: fake('claude', 3000) }, llm, cwd: '.', port: Number(process.argv[2] ?? 4318) });
console.log(`Santral demo: ${await s.listen()}`);
requestApproval(db, { action: 'credits.spend', entity: 'task', entityId: 'krea', payload: { branch: 'Krea · ≈10 kredi' } });
