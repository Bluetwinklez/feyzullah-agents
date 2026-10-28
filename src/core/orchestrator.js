// Yönetici: hedefi planlar, görevleri zamanlayıcıya verir, biten işi önce makine kontrolüyle sonra gerekirse
// LLM kontrolcüsüyle inceler, düzeltme turlarını yürütür ve rapor yazar. Akış Ofis `admin.js` ile aynı, arayüzsüz.
import { goldfishPrompt, parsePlan, parseVerdict, planFixPrompt, planPrompt, reportPrompt, reviewPrompt, reworkPrompt, fixerPrompt } from '../prompts/manager.js';
import {
  commentsAsContext, decideApproval, getDocument, getGoal, goalProgress, goalTasks, listComments, requestApproval, saveDocument, setGoalStatus,
} from './board.js';
import { runChecks } from './checks.js';
import { tx } from './db.js';
import { append } from './events.js';
import { detectLimit } from './limits.js';
import { runReady } from './scheduler.js';
import { addDependency, closeReview, createTask, getTask, reopenTask } from './tasks.js';
import { lessonPrompt, parseLesson } from '../knowledge/noesis.js';
import { pickAgent } from '../agents/registry.js';

/** @typedef {import('node:sqlite').DatabaseSync} Db */
/** @typedef {(i: {prompt: string, persona?: string|null, engine?: string, cwd?: string}) => Promise<string>} Llm */

export const MAX_ROUNDS = 2;
// Düzeltici seçimi Ofis'teki sıra: Codex > agy > Claude (admin.js:209); görevin kendi motoru atlanır.
const FIXER_ORDER = ['codex', 'antigravity', 'claude'];

/**
 * Adaptörlerden LLM çağrısı: istenen motor limitteyse sıradakine geçer. Her çağrı yeni oturumdur.
 * @param {Record<string, import('../engines/adapter.js').Adapter>} adapters
 * @param {{cwd: string, order?: string[]}} o
 * @returns {Llm}
 */
export function createLlm(adapters, { cwd, order = ['claude', 'codex', 'antigravity'] }) {
  return async ({ prompt, persona = null, engine = 'claude', cwd: at = cwd }) => {
    const chain = [engine, ...order.filter((e) => e !== engine)].filter((e) => adapters[e]);
    let last = null;
    for (const e of chain) {
      const r = await adapters[e].execute({ prompt, persona, cwd: at });
      if (!r.error && r.final != null) return r.text;
      last = r.error ?? 'cevap yok';
      if (!detectLimit({ error: r.error, rate: r.rate }).limited) break;
    }
    throw new Error(`LLM çağrısı başarısız: ${last ?? 'motor yok'}`);
  };
}

/**
 * Hedefi görevlere böler. requireApproval ise görevler backlog'da bekler ve plan onayı istenir.
 * goldfish: plan, bağlamsız bir inceleyiciye okutulur; sorun bulursa bir kez yeniden planlanır.
 * @param {{db: Db, goalId: string, llm: Llm, agents?: any[], knowledge?: string, down?: Record<string, number>, requireApproval?: boolean, goldfish?: boolean}} o
 */
export async function planGoal({ db, goalId, llm, agents = [], knowledge = '', down = {}, requireApproval = false, goldfish = false }) {
  const goal = getGoal(db, goalId);
  if (!goal) throw new Error(`hedef yok: ${goalId}`);
  const agentIds = agents.map((a) => a.id);
  const ask = async (feedback = '') => {
    const prompt = planPrompt(goal, { agents, knowledge, down, feedback });
    let text = await llm({ prompt, engine: 'claude' });
    let plan = parsePlan(text, { agentIds });
    if (plan.error) {
      text = await llm({ prompt: `${prompt}\n\n${planFixPrompt(plan.error)}`, engine: 'claude' });
      plan = parsePlan(text, { agentIds });
    }
    if (plan.error) throw new Error(`plan okunamadı: ${plan.error}`);
    return plan;
  };
  let plan = await ask();
  if (goldfish) {
    const draft = JSON.stringify(plan.tasks.map(({ key, title, prompt, after }) => ({ key, title, prompt, after })), null, 2);
    // Japon balığı: yazarın bağlamını bilmeyen motor; claude dışını tercih et.
    const findings = await llm({ prompt: goldfishPrompt(`Hedef: ${goal.title}\n${draft}`), engine: 'codex' });
    saveDocument(db, { entity: 'goal', entityId: goalId, name: 'japon-baligi', body: findings, author: 'goldfish' });
    if (!/SORUN YOK/i.test(findings)) plan = await ask(findings.slice(0, 4000));
  }
  const status = requireApproval ? 'backlog' : 'todo';
  // Planlayıcı uzman seçmediyse havuzdan seçilir: departman iş metninden, motor plandaki motor.
  for (const t of plan.tasks) {
    if (!t.agent && agents.length) t.agent = pickAgent(db, { text: `${t.title}\n${t.prompt}`, engine: t.engine })?.id ?? null;
  }
  const created = tx(db, () => {
    const byKey = new Map();
    for (const t of plan.tasks) {
      // Bilgi arşivinden bağlam her göreve eklenir: uzman yöneticinin konuşmasını görmez.
      const prompt = knowledge ? `${t.prompt}\n\n---\nBilgi arşivinden ilgili notlar (⚠ işaretli araçları önce doğrula ya da kullanma):\n${knowledge.slice(0, 2500)}` : t.prompt;
      const task = createTask(db, {
        title: t.title, prompt, engine: t.engine, assigneeAgentId: t.agent, goalId, workspaceId: goal.workspace_id, status,
        needsReview: t.review, checks: t.checks, planKey: t.key,
      });
      saveDocument(db, { entity: 'task', entityId: task.id, name: 'talimat', body: prompt, author: 'manager' });
      byKey.set(t.key, task.id);
    }
    for (const t of plan.tasks) for (const a of t.after) addDependency(db, byKey.get(t.key), byKey.get(a));
    return [...byKey.values()];
  });
  saveDocument(db, { entity: 'goal', entityId: goalId, name: 'plan', body: JSON.stringify(plan, null, 2), author: 'manager' });
  let approvalId = null;
  if (requireApproval) {
    approvalId = requestApproval(db, { action: 'plan.approve', entity: 'goal', entityId: goalId, payload: { tasks: created.length } });
    setGoalStatus(db, goalId, 'awaiting_approval');
  } else {
    setGoalStatus(db, goalId, 'active');
  }
  return { reply: plan.reply, taskIds: created, approvalId };
}

/** Plan onayı: backlog görevleri kuyruğa girer. @param {Db} db @param {string} goalId @param {{approve?: boolean, by?: string}} [o] */
export function approvePlan(db, goalId, { approve = true, by = 'kullanıcı' } = {}) {
  const a = db.prepare("SELECT id FROM approvals WHERE action = 'plan.approve' AND entity_id = ? AND status = 'pending'").get(goalId);
  if (!a) throw new Error(`bekleyen plan onayı yok: ${goalId}`);
  tx(db, () => {
    decideApproval(db, a.id, { approve, by });
    if (approve) {
      db.prepare("UPDATE tasks SET status = 'todo' WHERE goal_id = ? AND status = 'backlog'").run(goalId);
      setGoalStatus(db, goalId, 'active');
    } else {
      db.prepare("UPDATE tasks SET status = 'cancelled' WHERE goal_id = ? AND status = 'backlog'").run(goalId);
      setGoalStatus(db, goalId, 'cancelled');
    }
  });
}

const resultText = (task) => { try { return JSON.parse(task.result ?? 'null')?.text ?? ''; } catch { return ''; } };
const originalPrompt = (db, task) => getDocument(db, 'task', task.id, 'talimat', 1)?.body ?? task.prompt ?? task.title;

/**
 * Makine kontrolü varsa o karar verir (geçerse LLM atlanır); yoksa LLM kontrolcüsü.
 * @param {{db: Db, task: any, llm: Llm, cwd: string}} o
 * @returns {Promise<{pass: boolean, feedback: string, by: 'checks'|'llm'}>}
 */
export async function reviewTask({ db, task, llm, cwd }) {
  const checks = task.checks ? JSON.parse(task.checks) : [];
  if (checks.length) {
    const r = await runChecks(cwd, checks);
    if (!r.ok) {
      const bad = r.results.at(-1);
      return { pass: false, by: 'checks', feedback: `Makine kontrolü geçmedi: ${bad.cmd} (çıkış ${bad.timedOut ? 'zaman aşımı' : bad.code})\n${bad.tail.slice(-1500)}` };
    }
    return { pass: true, by: 'checks', feedback: '' };
  }
  const comments = commentsAsContext(listComments(db, 'task', task.id));
  try {
    const text = await llm({ prompt: reviewPrompt({ ...task, prompt: originalPrompt(db, task) }, resultText(task), { comments }), engine: 'claude', cwd });
    return { ...parseVerdict(text), by: 'llm' };
  } catch (err) {
    // Kontrolcüye ulaşılamıyorsa iş geçer (Ofis: belirsiz karar sonsuz döngü yapmasın).
    append(db, { actor: 'reviewer', type: 'review.skipped', entity: 'task', entityId: task.id, data: { error: err.message } });
    return { pass: true, by: 'llm', feedback: '' };
  }
}

/**
 * İncelemedeki görevler için karar: geçti → done; değilse düzeltme turu; turlar bitti → başka motorla düzeltici;
 * düzelticiden sonra döngü kapanır.
 */
async function handleReview({ db, task, llm, cwd, maxRounds }) {
  const v = await reviewTask({ db, task, llm, cwd });
  saveDocument(db, { entity: 'task', entityId: task.id, name: 'kontrol', body: `${v.pass ? 'PASS' : 'NEEDS WORK'} (${v.by})\n${v.feedback}`, author: 'reviewer' });
  if (v.pass) return closeReview(db, task.id, { verdict: 'pass', feedback: v.feedback });
  const orig = { ...task, prompt: originalPrompt(db, task) };
  if (task.review_round < maxRounds) return reopenTask(db, task.id, { prompt: reworkPrompt(orig, v.feedback), reason: 'needs_work' });
  if (task.review_round === maxRounds) {
    const fixer = FIXER_ORDER.find((e) => e !== task.engine) ?? 'codex';
    return reopenTask(db, task.id, { prompt: fixerPrompt(orig, resultText(task), v.feedback), engine: fixer, reason: 'fixer' });
  }
  return closeReview(db, task.id, { verdict: 'needs_work', feedback: v.feedback });
}

/** Görevleri bitmiş hedefleri kapatır: hedef kontrolleri (bütünleşme), rapor, durum. */
async function finalizeGoals({ db, llm, cwd, goalId = null, knowledge = null, lessonParentId = null }) {
  const goals = goalId ? [getGoal(db, goalId)].filter((g) => g?.status === 'active') : db.prepare("SELECT * FROM goals WHERE status = 'active'").all();
  const out = [];
  for (const goal of goals) {
    const p = goalProgress(db, goal.id);
    const open = ['backlog', 'todo', 'in_progress', 'in_review', 'blocked'].reduce((n, s) => n + (p[s] ?? 0), 0);
    if (open) continue;
    let integration = null;
    const checks = goal.checks ? JSON.parse(goal.checks) : [];
    if (checks.length) {
      integration = await runChecks(cwd, checks);
      saveDocument(db, { entity: 'goal', entityId: goal.id, name: 'butunlesme', body: integration.results.map((r) => `${r.code === 0 ? 'OK' : 'HATA'} ${r.cmd}\n${r.tail.slice(-800)}`).join('\n'), author: 'checks' });
    }
    const rows = goalTasks(db, goal.id).map((t) => ({ title: t.title, status: t.status, text: resultText(t), verdict: getDocument(db, 'task', t.id, 'kontrol')?.body.split('\n')[0] ?? null }));
    let report = rows.map((r) => `- ${r.title}: ${r.status}`).join('\n');
    try { report = await llm({ prompt: reportPrompt(goal, rows), engine: 'claude', cwd }); } catch {}
    saveDocument(db, { entity: 'goal', entityId: goal.id, name: 'rapor', body: report, author: 'manager' });
    const ok = !p.failed && !p.cancelled && (!integration || integration.ok);
    setGoalStatus(db, goal.id, ok ? 'done' : 'failed');
    let lesson = null;
    if (ok && knowledge) {
      // "Ne öğrendik": kalıcı değeri varsa Noesis'e yeni sayfa (gizli bilgi filtresinden geçer).
      try {
        const parsed = parseLesson(await llm({ prompt: lessonPrompt(goal, report), engine: 'claude', cwd }));
        if (parsed) lesson = await knowledge.writeLesson({ ...parsed, parentId: lessonParentId });
      } catch (err) {
        append(db, { actor: 'knowledge', type: 'knowledge.write_failed', entity: 'goal', entityId: goal.id, data: { error: err.message } });
      }
    }
    out.push({ goalId: goal.id, status: ok ? 'done' : 'failed', report, lesson });
  }
  return out;
}

/**
 * Hazır işleri çalıştırır, incelemeleri yürütür ve biten hedefleri kapatır; yapılacak iş kalmayınca döner.
 * @param {{db: Db, adapters: Record<string, any>, llm: Llm, cwd: string, goalId?: string|null, maxRounds?: number, maxParallel?: any, fallback?: any,
 *   signal?: AbortSignal, network?: boolean, knowledge?: any, lessonParentId?: string|null, cwdFor?: (task: any) => string,
 *   onSucceeded?: (task: any, cwd: string) => void, vault?: any, watchdog?: any}} o
 *   cwdFor: görev başına worktree; görev kontrolleri de orada koşar.
 */
export async function drive({ db, adapters, llm, cwd, goalId = null, maxRounds = MAX_ROUNDS, maxParallel, fallback, signal, network, knowledge = null, lessonParentId = null,
  cwdFor = null, onSucceeded = null, vault = null, watchdog }) {
  const totals = { done: 0, failed: 0, blocked: 0, skippedBudget: 0, reviews: 0 };
  for (let guard = 0; guard < 100 && !signal?.aborted; guard++) {
    const r = await runReady({ db, adapters, cwd, signal, network, cwdFor, onSucceeded, vault, ...(watchdog ? { watchdog } : {}), ...(maxParallel ? { maxParallel } : {}), ...(fallback ? { fallback } : {}) });
    for (const k of ['done', 'failed', 'skippedBudget']) totals[k] += r[k];
    totals.blocked = r.blocked;
    const inReview = db.prepare(`SELECT * FROM tasks WHERE status = 'in_review' ${goalId ? 'AND goal_id = ?' : ''} ORDER BY created_at`).all(...(goalId ? [goalId] : []));
    if (!inReview.length) break;
    await Promise.all(inReview.map((t) => handleReview({ db, task: t, llm, cwd: cwdFor ? cwdFor(t) : cwd, maxRounds })));
    totals.reviews += inReview.length;
  }
  const finished = await finalizeGoals({ db, llm, cwd, goalId, knowledge, lessonParentId });
  return { ...totals, goals: finished };
}

/** Görev yorumla uyandırılır: bitmiş göreve yorum düzeltme talimatı olarak gider. */
export function wakeWithComment(db, taskId) {
  const task = getTask(db, taskId);
  const comments = commentsAsContext(listComments(db, 'task', taskId).slice(-5));
  reopenTask(db, taskId, { prompt: `Kullanıcı bu işe yorum bıraktı:\n${comments}\n\nAsıl görev:\n${originalPrompt(db, task)}\n\nYorumlara göre düzelt ve kısaca raporla.`, reason: 'comment' });
  if (task.goal_id && getGoal(db, task.goal_id)?.status === 'done') setGoalStatus(db, task.goal_id, 'active');
}
