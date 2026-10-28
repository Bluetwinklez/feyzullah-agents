// Konsey kipi: önemli kararlarda 5 danışman ayrı ayrı cevap verir, cevaplar isimsiz olarak çapraz incelenir,
// başkan (Claude) son kararı yazar. "Yabancı" danışman hiç bağlam almaz (fil ve japon balığı fikri).

/** @typedef {import('./orchestrator.js').Llm} Llm */

export const DEFAULT_ADVISORS = [
  { key: 'mimar', name: 'Mimar', engine: 'claude', persona: 'Sen bir yazılım mimarısın. Uzun vadeli bakım, sadelik ve risk açısından değerlendir.' },
  { key: 'supheci', name: 'Şüpheci', engine: 'codex', persona: 'Sen şüphecisin. Önerinin neden başarısız olabileceğini, gizli maliyetleri ve kanıt eksiklerini ara.' },
  { key: 'kullanici', name: 'Kullanıcı savunucusu', engine: 'antigravity', persona: 'Sen kullanıcının avukatısın. Kullanıcıya etkisini, hızı ve anlaşılırlığı değerlendir.' },
  { key: 'uygulayici', name: 'Uygulayıcı', engine: 'codex', persona: 'Sen uygulayıcısın. En kısa çalışan yolu ve somut adımları öner.' },
  { key: 'yabanci', name: 'Yabancı', engine: 'antigravity', persona: null, outsider: true },
];

const LABELS = 'ABCDEFGH';

/**
 * @param {{question: string, context?: string, llm: Llm, advisors?: typeof DEFAULT_ADVISORS, chairEngine?: string}} o
 * @returns {Promise<{answers: {label: string, advisor: string, text: string}[], reviews: {advisor: string, text: string}[], decision: string}>}
 */
export async function runCouncil({ question, context = '', llm, advisors = DEFAULT_ADVISORS, chairEngine = 'claude' }) {
  const ask = (a, prompt) => llm({ prompt, persona: a.persona, engine: a.engine }).then((text) => text, (err) => null);
  // 1. Bağımsız cevaplar. Yabancı bağlamı görmez.
  const firstPrompt = (a) => `${a.outsider || !context ? '' : `Bağlam:\n${context}\n\n`}Soru: ${question}\n\nKısa ve gerekçeli bir öneri yaz (en fazla 15 satır).`;
  const raw = await Promise.all(advisors.map((a) => ask(a, firstPrompt(a))));
  const answers = advisors.map((a, i) => ({ advisor: a.name, text: raw[i] })).filter((x) => x.text)
    .map((x, i) => ({ label: LABELS[i], ...x }));
  if (!answers.length) throw new Error('konsey: hiçbir danışman cevap veremedi');
  const anon = answers.map((x) => `Cevap ${x.label}:\n${x.text}`).join('\n\n');
  // 2. İsimsiz çapraz inceleme: kimse hangi cevabın kimden geldiğini bilmez.
  const rawReviews = await Promise.all(advisors.map((a) => ask(a, `Soru: ${question}\n\nAşağıdaki cevaplar isimsizdir. Her birinin en güçlü ve en zayıf yanını tek satırda yaz, sonra en iyiden kötüye sırala (ör. "SIRA: B, A, C").\n\n${anon}`)));
  const reviews = advisors.map((a, i) => ({ advisor: a.name, text: rawReviews[i] })).filter((x) => x.text);
  // 3. Başkan kararı.
  const decision = await llm({
    engine: chairEngine,
    prompt: `Konsey başkanısın. Soru: ${question}\n${context ? `\nBağlam:\n${context}\n` : ''}\nDanışman cevapları:\n${anon}\n\nÇapraz incelemeler:\n${reviews.map((r, i) => `İnceleme ${i + 1}:\n${r.text}`).join('\n\n')}\n\nSon kararı yaz: KARAR (tek cümle), GEREKÇE (madde madde), RİSKLER, SONRAKİ ADIM.`,
  });
  return { answers, reviews, decision };
}

/** Konsey sonucunu belge metnine çevirir. */
export function councilDocument(question, r) {
  return `# Konsey: ${question}\n\n## Karar\n${r.decision}\n\n## Cevaplar\n${r.answers.map((a) => `### ${a.label} (${a.advisor})\n${a.text}`).join('\n\n')}\n\n## Çapraz inceleme\n${r.reviews.map((x) => `### ${x.advisor}\n${x.text}`).join('\n\n')}\n`;
}
