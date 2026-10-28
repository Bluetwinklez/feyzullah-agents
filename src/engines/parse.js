// Motorların stream-json satırlarını ortak biçime çevirir. Kurallar Ofis `src/agents/cli.js` parseCliLine ile aynı;
// farkı kullanımın {input, cachedInput, cacheWrite, output, known} olarak normalize edilmesi.

export const ENGINES = /** @type {const} */ (['claude', 'codex', 'antigravity']);

/**
 * @typedef {{input: number, cachedInput: number, cacheWrite: number, output: number, known: boolean}} Usage
 * @typedef {{sessionId?: string, text?: string, final?: string, error?: string, usage?: Usage, rate?: any}} ParsedLine
 */

/** @returns {Usage} */
export const emptyUsage = (known = true) => ({ input: 0, cachedInput: 0, cacheWrite: 0, output: 0, known });

/**
 * Tek JSON satırı → ParsedLine | null. Bozuk ya da tanınmayan satırda null.
 * @param {'claude'|'codex'|'antigravity'} engine
 * @param {string} line
 * @returns {ParsedLine|null}
 */
export function parseLine(engine, line) {
  let j;
  try { j = JSON.parse(line); } catch { return null; }
  if (!j || typeof j !== 'object') return null;
  if (engine === 'codex') {
    if (j.type === 'thread.started') return { sessionId: j.thread_id };
    if (j.type === 'item.completed' && j.item?.type === 'agent_message') return { text: j.item.text, final: j.item.text };
    if (j.type === 'turn.failed') return { error: j.error?.message ?? 'Codex turu başarısız' };
    if (j.type === 'error') return { error: j.message ?? 'Codex hatası' };
    if (j.type === 'turn.completed' && j.usage) {
      // Codex'te cached_input_tokens, input_tokens'ın içindedir.
      const cached = j.usage.cached_input_tokens ?? 0;
      return { usage: { input: Math.max(0, (j.usage.input_tokens ?? 0) - cached), cachedInput: cached, cacheWrite: 0, output: j.usage.output_tokens ?? 0, known: true } };
    }
    return null;
  }
  if (engine === 'antigravity') {
    if (j.event === 'init') return { sessionId: j.conversation_id };
    if (j.event === 'step_update' && j.step_update?.step_type === 'agent_response' && j.step_update.text_delta) return { text: j.step_update.text_delta };
    if (j.event === 'result') {
      // agy kullanım vermez.
      const usage = emptyUsage(false);
      if (j.result?.status !== 'SUCCESS') return { error: `agy: ${j.result?.status ?? '?'}`, usage };
      const final = String(j.result.response ?? '').trim();
      // Boş cevap genelde reddedilen bir araç izni demek: iş yapılmamışken "bitti" görünmesin.
      return final ? { final, usage } : { error: 'agy boş cevap döndü (araç izni reddedilmiş olabilir)', usage };
    }
    return null;
  }
  if (j.type === 'system' && j.subtype === 'init') return { sessionId: j.session_id };
  if (j.type === 'rate_limit_event') return j.rate_limit_info ? { rate: j.rate_limit_info } : null;
  if (j.type === 'assistant') {
    const text = (j.message?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('');
    return text ? { text } : null;
  }
  if (j.type === 'result') {
    const usage = j.usage
      ? { input: j.usage.input_tokens ?? 0, cachedInput: j.usage.cache_read_input_tokens ?? 0, cacheWrite: j.usage.cache_creation_input_tokens ?? 0, output: j.usage.output_tokens ?? 0, known: true }
      : undefined;
    if (j.is_error) return { error: j.result || 'Claude hatası', ...(usage ? { usage } : {}) };
    return { sessionId: j.session_id, final: j.result ?? '', ...(usage ? { usage } : {}) };
  }
  return null;
}
