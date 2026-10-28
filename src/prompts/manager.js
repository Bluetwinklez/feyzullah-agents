// Yönetici, kontrolcü ve rapor istemleri. Biçim Ofis `src/agents/admin.js` ile uyumlu (KARAR: PASS / NEEDS WORK, son ```json bloğu).

export const MAX_TASKS = 12;
export const ENGINES = ['claude', 'codex', 'antigravity'];

/**
 * @param {{title: string, description?: string|null}} goal
 * @param {{agents?: {id: string, name: string, engine: string, department?: string|null}[], knowledge?: string, down?: Record<string, number>, feedback?: string}} [o]
 */
export function planPrompt(goal, { agents = [], knowledge = '', down = {}, feedback = '' } = {}) {
  const roster = agents.map((a) => `- ${a.id}: ${a.name} (${a.department ?? 'genel'}, motor: ${a.engine})`).join('\n');
  const downTxt = Object.entries(down).map(([e, t]) => `${e} (${new Date(t).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}'e kadar)`).join(', ');
  return `Sen yöneticisin. Hedefi bağımsız görevlere böl. Kod, test ve build işini codex'e, belge ve araştırmayı antigravity'ye ver;
antigravity terminal komutu çalıştıramaz. claude yalnız mimari, güvenlik ve inceleme içindir, ona kodlama verme.

Hedef: ${goal.title}
${goal.description ? `Ayrıntı:\n${goal.description}\n` : ''}${knowledge ? `\nBilgi arşivinden ilgili notlar:\n${knowledge}\n` : ''}${roster ? `\nEkip:\n${roster}\n` : ''}${downTxt ? `\nKAPALI MOTORLAR (limit dolu): ${downTxt}. Mümkünse açık motorlara ver.\n` : ''}${feedback ? `\nÖnceki planın eleştirisi (bunları gider):\n${feedback}\n` : ''}
Kurallar:
- Görevler yalnız gerçekten bağımlı oldukları görevi bekler ("after"); bağımsız işler paralel yürür.
- Her görevin talimatı tek başına anlaşılır olsun; uzman bu konuşmayı görmez.
- Doğrulanabilen işlerde "checks" alanına makine kontrolü yaz (ör. "npm test"). Yoksa boş bırak.
- En fazla ${MAX_TASKS} görev.

Cevabının SONUNDA tek bir \`\`\`json bloğu olmalı:
{"reply": "kullanıcıya kısa Türkçe özet",
 "tasks": [{"key": "kisa-ad", "title": "başlık", "prompt": "uzmana eksiksiz talimat", "engine": "codex|antigravity|claude", "agent": "isteğe bağlı ekip id", "after": ["key"], "checks": ["komut"], "review": true}]}`;
}

/** Son ```json bloğunu okur ve planı doğrular. @returns {{reply: string, tasks: any[]} | {error: string}} */
export function parsePlan(text, { agentIds = [] } = {}) {
  const blocks = [...String(text ?? '').matchAll(/```json\s*([\s\S]*?)```/g)];
  if (!blocks.length) return { error: 'json bloğu yok' };
  let j;
  try { j = JSON.parse(blocks.at(-1)[1]); } catch (e) { return { error: `json okunamadı: ${e.message}` }; }
  if (!j || typeof j !== 'object') return { error: 'json nesne değil' };
  const reply = [j.reply, j.summary].find((x) => typeof x === 'string' && x.trim()) ?? '';
  if (!Array.isArray(j.tasks) || !j.tasks.length) return { error: 'görev listesi boş' };
  if (j.tasks.length > MAX_TASKS) return { error: `en fazla ${MAX_TASKS} görev` };
  const keys = new Set();
  const tasks = [];
  for (const [i, t] of j.tasks.entries()) {
    const key = String(t?.key ?? `g${i + 1}`).trim();
    if (keys.has(key)) return { error: `tekrarlanan key: ${key}` };
    keys.add(key);
    const prompt = [t?.prompt, t?.task].find((x) => typeof x === 'string' && x.trim());
    if (!prompt) return { error: `talimat yok: ${key}` };
    const engine = ENGINES.includes(t.engine) ? t.engine : t.engine === 'agy' ? 'antigravity' : 'codex';
    const agent = agentIds.includes(t.agent) ? t.agent : null;
    tasks.push({
      key, title: String(t.title ?? prompt).slice(0, 160), prompt, engine, agent,
      after: (Array.isArray(t.after) ? t.after : []).map(String),
      checks: (Array.isArray(t.checks) ? t.checks : []).filter((c) => typeof c === 'string' && c.trim()),
      review: t.review !== false,
    });
  }
  for (const t of tasks) for (const a of t.after) if (!keys.has(a)) return { error: `bilinmeyen bağımlılık: ${t.key} → ${a}` };
  return { reply, tasks };
}

export const planFixPrompt = (error) => `Cevabın sözleşmeye uymadı (${error}). Aynı planı, sonunda geçerli tek bir \`\`\`json bloğuyla tekrar ver.`;

export function reviewPrompt(task, output, { checks = null, comments = '' } = {}) {
  return `Bir uzmanın işini kontrol et.
Görev:
${task.prompt ?? task.title}

Uzmanın raporu:
${String(output ?? '').slice(0, 6000)}
${checks ? `\nMakine kontrolleri:\n${checks}\n` : ''}${comments ? `\nKullanıcı yorumları:\n${comments}\n` : ''}
Çalışma klasöründeki dosyalara bakarak işin gerçekten yapılıp yapılmadığını doğrula (iddialara değil kanıta bak).
Kısa Türkçe değerlendirme yaz; eksik varsa maddeler halinde ne düzeltilmeli. Son satırın tam olarak şu ikisinden biri olsun:
KARAR: PASS
KARAR: NEEDS WORK`;
}

/** Kontrolcünün cevabı → { pass, feedback }. Belirsizse geçer: sonsuz döngü olmasın. */
export function parseVerdict(text) {
  const t = String(text ?? '');
  const m = [...t.matchAll(/(NEEDS[ _-]?WORK|\bPASS(?:ED)?\b)/gi)].at(-1);
  const pass = !m || !/NEEDS/i.test(m[1]);
  return { pass, feedback: t.replace(/KARAR\s*:\s*(NEEDS[ _-]?WORK|PASS)\s*$/i, '').trim().slice(0, 4000) };
}

export const reworkPrompt = (task, feedback) => `Kontrolcü işini kontrol etti ve düzeltme istedi:
${feedback}

Asıl görev:
${task.prompt ?? task.title}

Bu eksikleri gider ve ne değiştirdiğini kısaca raporla.`;

export const fixerPrompt = (task, output, feedback) => `Başka bir uzman bu görevi yaptı ama kontrolcü iki kez düzeltme istedi. Eksikleri sen gider.
Görev:
${task.prompt ?? task.title}

Uzmanın son raporu:
${String(output ?? '').slice(0, 3000)}

Kontrolcünün geri bildirimi:
${feedback}

Çalışma klasöründeki dosyaları düzelt ve ne değiştirdiğini kısaca raporla.`;

export function reportPrompt(goal, rows) {
  return `Hedef raporu: ${goal.title}
${rows.map((r) => `- ${r.title}: ${r.status}${r.verdict ? ` (kontrol: ${r.verdict})` : ''}\n  ${String(r.text ?? '').slice(0, 1500)}`).join('\n')}

Kullanıcıya kısa bir Türkçe özet yaz: ne yapıldı, ne eksik kaldı, sıradaki adım ne.`;
}

/** Fil ve japon balığı (EGM): hiç bağlam almamış inceleyici yalnız taslağı okur. */
export const goldfishPrompt = (draft) => `Aşağıdaki planı ilk kez görüyorsun; yazarı ve konuşmayı bilmiyorsun. Yalnız bu metne dayanarak:
1. Söylenmemiş varsayımları,
2. Belirsiz ya da çelişkili talimatları,
3. Eksik görünen adımları
madde madde yaz. Varsayım yoksa "SORUN YOK" yaz.

Plan:
${draft}`;
