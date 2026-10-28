# Aşama 1: Çekirdek Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Arayüzsüz, test edilmiş bir çekirdek kurmak. Görevleri SQLite'a yazar, bağımlılık sırasına göre motorlara (claude, codex, agy) dağıtır, kullanımı ve olayları kaydeder, sonucu önce makine kontrolünden geçirir.

**Architecture:** Tek süreç, Node 24 ESM. Kalıcı durum `node:sqlite` üzerinde WAL kipinde tutulur. Her değişiklik append-only `events` tablosuna da yazılır. Zamanlayıcı hazır görevleri (bağımlılıkları bitmiş, sahipsiz) atomik checkout ile alır. Görevleri motor başına sınırlı paralellikle adaptörlere verir. Adaptörler CLI süreci başlatır ve satır satır ayrıştırır. Ayrıştırıcılar Ofis'in `parseCliLine` mantığından taşınır.

**Tech Stack:** Node.js ≥ 24 (`node:sqlite`, `node:test`, `node:child_process`). JavaScript + JSDoc. Dış bağımlılık yok.

**Spec:** `docs/PLAN.md` (Aşama 1, §3.4 hız hedefleri) ve `docs/OZELLIK-HARITASI.md` (A1 satırları: 1, 2, 3, 4 veri, 5, 17 liste).

## Global Constraints

- Node `>=24`, `"type": "module"`, yalnız yerleşik modüller. `npm install` gerektiren paket yok.
- Testler: `node --test "test/**/*.test.js"`. Her test kendi geçici veritabanını açar: `:memory:` ya da `os.tmpdir()` altında bir dosya.
- Sırlar, `~/.feyzullah/*` içeriği ve API anahtarları repoya, olaylara ya da loglara yazılmaz.
- CLI çağrılarında `--dangerously-skip-permissions` ya da `--yolo` yok. Ofis'teki gibi izin listesiyle çalışılır.
- Çalışan Ofis'e (`feyzullah-ofis`) dokunulmaz. Kod oradan okunup yeniden yazılır.
- Paperclip'ten kod kopyalanırsa `THIRD_PARTY.md` dosyasına MIT bildirimi eklenir (commit `cff331f`).
- Olay ve görev durumları sabit küme: `todo | in_progress | done | failed | blocked | cancelled`.
- Bütçe: `warnPercent` varsayılan 80, `hardStop` varsayılan true. Birim token.
- Commit kimliği `144558175+Bluetwinklez@users.noreply.github.com`. Commit mesajı sonu: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- **Bağımlılık döngüsü:** A→B→A eklenmeye çalışılırsa hata atılmalı, tablo değişmemeli (Task 3 testi).
- **Aynı görevi iki çalışma birden alamaz:** İkinci `checkoutTask` `false` döner (Task 3 testi).
- **Motor CLI'ı bozuk ya da JSON olmayan satır basar:** Ayrıştırıcı çökmez, satırı `{}` olarak geçer (Task 4 testi).
- **Motor süreci hata koduyla çıkar ya da zaman aşar:** Görev `failed` olur, run kaydı `exit_code` ile kapanır, zamanlayıcı kalan görevlere devam eder (Task 7 testi).
- **Bütçe tam sınırda:** Kullanım tam %100'de `stop`, %80'de `warn` döner (Task 5 testi).

---

## Dosya yapısı

```
src/core/db.js          openDb + şema göçleri
src/core/events.js      append-only olay günlüğü
src/core/tasks.js       görev CRUD, bağımlılık, hazır görevler, checkout, run kaydı
src/core/costs.js       kullanım kaydı, bütçe durumu
src/core/policy.js      motor başına araç listesi, onay isteyen eylemler
src/core/checks.js      makine kontrolleri (test/lint/build)
src/core/scheduler.js   DAG zamanlayıcı, motor başına havuz
src/engines/parse.js    claude/codex/agy satır ayrıştırıcıları
src/engines/args.js     CLI argümanları ve ikili bulma
src/engines/adapter.js  createCliAdapter: süreç başlat, akış ayrıştır
src/cli.js              `fa` giriş noktası (init, add, run, status)
test/fixtures/engines/  gerçek motor çıktısından kısaltılmış satırlar (sır içermez)
```

---

### Task 1: Veritabanı ve şema

**Files:**
- Create: `src/core/db.js`
- Test: `test/core/db.test.js`

**Interfaces:**
- Produces: `openDb(path: string = ':memory:'): DatabaseSync`. WAL açık (dosya için), `foreign_keys = ON`, göçler uygulanmış. `schemaVersion(db): number`.

Tablolar (göç 1):
- `workspaces(id TEXT PK, name, root, created_at)`
- `agents(id TEXT PK, workspace_id, name, engine, model, department, reports_to, capabilities TEXT /*JSON*/, persona)`
- `tasks(id TEXT PK, workspace_id, title, prompt, status, assignee_agent_id, engine, parent_id, goal_id, checkout_run_id, locked_at, created_at, updated_at, result TEXT /*JSON*/)`
- `task_deps(task_id, depends_on, PRIMARY KEY(task_id, depends_on))`
- `runs(id TEXT PK, task_id, engine, status, session_before, session_after, exit_code, usage TEXT, started_at, finished_at, last_output_at, error)`
- `events(seq INTEGER PK AUTOINCREMENT, at, actor, type, entity, entity_id, data TEXT)`
- `usage(id INTEGER PK, run_id, agent_id, engine, model, input_tokens, cached_input_tokens, output_tokens, at)`
- `budgets(id TEXT PK, scope TEXT /*'global'|'agent'|'engine'*/, scope_id, window TEXT /*'month'|'day'*/, limit_tokens INTEGER, warn_percent INTEGER DEFAULT 80, hard_stop INTEGER DEFAULT 1)`
- `meta(key PK, value)`: `schema_version`

- [ ] **Step 1: Write the failing test**

```js
test('openDb şemayı kurar ve sürüm 1 döner', () => {
  const db = openDb(':memory:');
  assert.equal(schemaVersion(db), 1);
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
  for (const t of ['workspaces','agents','tasks','task_deps','runs','events','usage','budgets','meta']) assert.ok(names.includes(t), t);
});
test('dosya veritabanı WAL kipinde açılır ve ikinci açılış göçü tekrarlamaz', () => {
  const p = join(mkdtempSync(join(tmpdir(), 'fa-')), 'fa.db');
  const a = openDb(p); a.close();
  const b = openDb(p);
  assert.equal(b.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
  assert.equal(schemaVersion(b), 1);
});
```

- [ ] **Step 2: Run, expect FAIL** — `node --test test/core/db.test.js` → "Cannot find module".
- [ ] **Step 3: Implement** `openDb`, `schemaVersion` in `src/core/db.js`. Göçler: dizi `MIGRATIONS = [sql1]`. `meta.schema_version` değerinden büyük olanlar tek bir `BEGIN…COMMIT` içinde uygulanır.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `git add src/core/db.js test/core/db.test.js package.json && git commit -m "feat(core): SQLite şema ve göçler"`

### Task 2: Olay günlüğü

**Files:**
- Create: `src/core/events.js`
- Test: `test/core/events.test.js`

**Interfaces:**
- Consumes: `openDb` (Task 1).
- Produces:
  - `append(db, {actor, type, entity, entityId, data}): number` → seq
  - `since(db, seq: number, limit = 500): Event[]`
  - `Event = {seq, at, actor, type, entity, entityId, data}`. `data` nesne olarak döner.

`append` içinde `data` alanındaki şu anahtarlar `"[gizli]"` ile değiştirilir: `key`, `token`, `password`, `secret`, `apiKey` (büyük/küçük harf duyarsız, iç içe nesnelerde de).

- [ ] **Step 1: Failing test**

```js
test('append artan seq döner, since sıralı okur', () => {
  const db = openDb();
  const a = append(db, {actor:'system', type:'task.created', entity:'task', entityId:'t1', data:{title:'x'}});
  const b = append(db, {actor:'agent:k', type:'task.done', entity:'task', entityId:'t1', data:{}});
  assert.ok(b > a);
  assert.deepEqual(since(db, a).map(e => e.type), ['task.done']);
});
test('gizli anahtarlar maskelenir', () => {
  const db = openDb();
  append(db, {actor:'system', type:'x', entity:'e', entityId:'1', data:{nested:{apiKey:'sk-123'}, Token:'t'}});
  const [e] = since(db, 0);
  assert.equal(e.data.nested.apiKey, '[gizli]');
  assert.equal(e.data.Token, '[gizli]');
});
test('events tablosunda UPDATE ve DELETE engellenir', () => {
  const db = openDb(); append(db, {actor:'s', type:'x', entity:'e', entityId:'1', data:{}});
  assert.throws(() => db.exec('DELETE FROM events'), /append-only/);
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** `append`, `since`. Append-only kuralı Task 1'deki göçe eklenen iki trigger ile sağlanır: `BEFORE UPDATE` ve `BEFORE DELETE ON events` → `RAISE(ABORT,'append-only')`.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat(core): append-only olay günlüğü`

### Task 3: Görevler, bağımlılıklar, checkout, run kayıtları

**Files:**
- Create: `src/core/tasks.js`
- Test: `test/core/tasks.test.js`

**Interfaces:**
- Consumes: `openDb`, `append`.
- Produces:
  - `createTask(db, {title, prompt, engine?, assigneeAgentId?, parentId?, goalId?, workspaceId='default'}): Task`. Durum `todo`. `id` = `crypto.randomUUID()`.
  - `addDependency(db, taskId, dependsOn): void`. Döngü oluşursa `Error('döngü: …')` atar ve tabloyu değiştirmez.
  - `readyTasks(db, {limit=50}?): Task[]`. Koşullar: durum `todo`, `checkout_run_id IS NULL`, bütün bağımlılıklar `done`. Sıra: `created_at`.
  - `checkoutTask(db, taskId, runId): boolean`. Tek `UPDATE tasks SET checkout_run_id=?, locked_at=?, status='in_progress' WHERE id=? AND checkout_run_id IS NULL AND status='todo'`, ardından `changes === 1`.
  - `startRun(db, {taskId, engine, sessionBefore?}): Run`
  - `finishRun(db, runId, {status, exitCode?, sessionAfter?, usage?, error?, result?}): void`. Görevi `done` ya da `failed` yapar, checkout'u temizler.
  - `getTask(db, id): Task | undefined`
- Her durum değişikliği bir olay yazar: `task.created`, `task.checked_out`, `run.started`, `run.finished`, `task.done`, `task.failed`.

Döngü kontrolü: `dependsOn` görevinden başlayıp mevcut bağımlılıklar boyunca özyinelemeli CTE ile yürünür. Yolda `taskId` görülürse döngü vardır.

- [ ] **Step 1: Failing tests**

```js
test('bağımlılığı bitmemiş görev hazır değil', () => {
  const db = openDb();
  const a = createTask(db, {title:'a', prompt:'a'}); const b = createTask(db, {title:'b', prompt:'b'});
  addDependency(db, b.id, a.id);
  assert.deepEqual(readyTasks(db).map(t => t.id), [a.id]);
});
test('döngü reddedilir', () => {
  const db = openDb();
  const a = createTask(db, {title:'a', prompt:''}); const b = createTask(db, {title:'b', prompt:''});
  addDependency(db, b.id, a.id);
  assert.throws(() => addDependency(db, a.id, b.id), /döngü/);
  assert.equal(db.prepare('SELECT count(*) n FROM task_deps').get().n, 1);
});
test('aynı görevi ikinci run alamaz', () => {
  const db = openDb(); const t = createTask(db, {title:'t', prompt:''});
  assert.equal(checkoutTask(db, t.id, 'r1'), true);
  assert.equal(checkoutTask(db, t.id, 'r2'), false);
  assert.equal(getTask(db, t.id).checkout_run_id, 'r1');
});
test('finishRun done ise bağımlı görevi hazırlar', () => {
  const db = openDb();
  const a = createTask(db, {title:'a', prompt:''}); const b = createTask(db, {title:'b', prompt:''});
  addDependency(db, b.id, a.id);
  const run = startRun(db, {taskId:a.id, engine:'codex'}); checkoutTask(db, a.id, run.id);
  finishRun(db, run.id, {status:'done', exitCode:0});
  assert.deepEqual(readyTasks(db).map(t => t.id), [b.id]);
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** the functions above in `src/core/tasks.js`.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat(core): görevler, bağımlılık DAG'i, atomik checkout`

### Task 4: Motor ayrıştırıcıları ve CLI argümanları

**Files:**
- Create: `src/engines/parse.js`, `src/engines/args.js`, `test/fixtures/engines/{claude,codex,agy}.jsonl`
- Test: `test/engines/parse.test.js`, `test/engines/args.test.js`

**Interfaces:**
- Produces:
  - `parseLine(engine: 'claude'|'codex'|'agy', line: string): ParsedLine`. `ParsedLine = {sessionId?, text?, final?, error?, usage?: {input, cachedInput, output}, rate?}`. Ofis `src/agents/cli.js` → `parseCliLine` ile aynı anlam. Alan adları burada sabitlenir: `usage.input`, `usage.cachedInput`, `usage.output`.
  - `cliArgs(engine, {persona?, prompt, resumeId?, allowedTools?, model?}): string[]`. Ofis `cliArgs` mantığı: claude `-p --output-format stream-json --verbose`, codex `exec --json`, agy `-p --mode accept-edits`. Hiçbir zaman `--dangerously-skip-permissions` içermez.
  - `findBin(engine): string | null`. `PATH` üzerinde `claude`, `codex`, `agy` (Windows'ta `.cmd` ve `.exe` de denenir).

Fixture dosyaları: Ofis testlerindeki örnek satırlardan alınır, her motor için 4–6 satır: init/oturum, metin, araç, sonuç ve kullanım. Oturum kimlikleri sahte UUID'lerle değiştirilir.

- [ ] **Step 1: Failing tests**

```js
for (const engine of ['claude','codex','agy']) {
  test(`${engine}: fixture oturum, metin ve kullanım üretir`, () => {
    const out = readFileSync(`test/fixtures/engines/${engine}.jsonl`,'utf8').trim().split('\n').map(l => parseLine(engine, l));
    assert.ok(out.some(p => p.sessionId));
    assert.ok(out.some(p => p.final && typeof p.text === 'string'));
    const u = out.find(p => p.usage)?.usage;
    assert.ok(u && Number.isInteger(u.input) && Number.isInteger(u.output));
  });
  test(`${engine}: bozuk satır çökmez`, () => {
    assert.deepEqual(parseLine(engine, 'not json {'), {});
    assert.deepEqual(parseLine(engine, ''), {});
  });
}
test('cliArgs hiçbir motorda izin atlatma bayrağı içermez', () => {
  for (const e of ['claude','codex','agy']) {
    const a = cliArgs(e, {prompt:'x'}).join(' ');
    assert.doesNotMatch(a, /dangerously|yolo|bypass/);
  }
});
test('resumeId claude için --resume ekler', () => {
  assert.ok(cliArgs('claude', {prompt:'x', resumeId:'abc'}).join(' ').includes('--resume abc'));
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** Ofis'teki `parseCliLine` ve `cliArgs` okunup aynı davranışla yeniden yazılır. Ofis dosyasına dokunulmaz.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat(engines): claude, codex, agy ayrıştırıcı ve argümanları`

### Task 5: Kullanım ve bütçe

**Files:**
- Create: `src/core/costs.js`
- Test: `test/core/costs.test.js`

**Interfaces:**
- Consumes: `openDb`, `append`.
- Produces:
  - `recordUsage(db, {runId, agentId?, engine, model?, usage:{input, cachedInput, output}}): void`. Bir `usage.recorded` olayı da yazar.
  - `setBudget(db, {id, scope, scopeId?, window, limitTokens, warnPercent=80, hardStop=true}): void`
  - `budgetStatus(db, {engine?, agentId?, now=new Date()}): {state:'ok'|'warn'|'stop', used:number, limit:number|null, budgetId:string|null}`
    - Uygun bütçelerin (global + engine + agent) en kötü durumu döner.
    - `used` = penceredeki `input + output` toplamı. Önbellekli girdi sayılmaz, bilgi için ayrı tutulur.
    - Pencere: `month` için takvim ayının başı, `day` için gün başı. Yerel saat kullanılır.
    - Kurallar: `used >= limit` ve `hardStop` → `stop`. `used >= limit*warnPercent/100` → `warn`.

- [ ] **Step 1: Failing tests**

```js
test('%80 uyarı, %100 durdurma', () => {
  const db = openDb();
  setBudget(db, {id:'g', scope:'global', window:'month', limitTokens:1000});
  recordUsage(db, {runId:'r', engine:'codex', usage:{input:700, cachedInput:500, output:99}});
  assert.equal(budgetStatus(db, {}).state, 'ok');
  recordUsage(db, {runId:'r', engine:'codex', usage:{input:1, cachedInput:0, output:0}});
  assert.equal(budgetStatus(db, {}).state, 'warn');
  recordUsage(db, {runId:'r', engine:'codex', usage:{input:200, cachedInput:0, output:0}});
  assert.deepEqual(budgetStatus(db, {}), {state:'stop', used:1000, limit:1000, budgetId:'g'});
});
test('hardStop kapalıysa sınır aşılsa da warn', () => { /* limit 10, hardStop:false, 20 token → 'warn' */ });
test('motor bütçesi yalnız o motoru durdurur', () => { /* engine:'codex' bütçesi doldu → codex stop, claude ok */ });
test('bütçe yoksa ok ve limit null', () => { assert.deepEqual(budgetStatus(openDb(), {}), {state:'ok', used:0, limit:null, budgetId:null}); });
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** `src/core/costs.js`.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat(core): kullanım kaydı ve token bütçeleri`

### Task 6: Politika ve makine kontrolleri

**Files:**
- Create: `src/core/policy.js`, `src/core/checks.js`
- Test: `test/core/policy.test.js`, `test/core/checks.test.js`

**Interfaces:**
- Produces:
  - `toolsFor(engine, {role?:'writer'|'reader', network?:boolean}): string[]`. Ofis `runner.js` içindeki `SAFE_BASH` ve `toolsFor` ile aynı liste. `reader` yazma araçlarını içermez.
  - `ACTIONS_NEEDING_APPROVAL = ['git.push','git.merge','fs.delete','credits.spend','external.send']`
  - `decide(action: string): 'allow'|'ask'|'deny'`. Listedekiler `ask`. `secrets.read` ve `permissions.bypass` her zaman `deny`. Diğerleri `allow`.
  - `runChecks(cwd, commands: string[], {timeoutMs=120000}?): Promise<{ok:boolean, results:{cmd, code, ms, tail:string}[], needsLlmReview:boolean}>`
    - Komutlar sırayla `spawn` ile çalışır, `shell: true`.
    - `tail` çıktının son 2000 karakteri.
    - İlk başarısızlıkta durur.
    - `needsLlmReview` = `ok`. Makine kontrolü düşerse LLM incelemesine gerek yok, görev doğrudan geri döner.

- [ ] **Step 1: Failing tests**

```js
test('onay isteyen eylemler ask, sır okuma deny', () => {
  assert.equal(decide('git.push'), 'ask');
  assert.equal(decide('secrets.read'), 'deny');
  assert.equal(decide('fs.read'), 'allow');
});
test('reader rolü yazma aracı almaz', () => {
  assert.ok(!toolsFor('claude', {role:'reader'}).some(t => /^(Write|Edit)/.test(t)));
});
test('runChecks ilk hatada durur ve LLM incelemesi istemez', async () => {
  const r = await runChecks(process.cwd(), ['node -e "process.exit(0)"', 'node -e "process.exit(3)"', 'node -e "console.log(1)"']);
  assert.equal(r.ok, false); assert.equal(r.results.length, 2); assert.equal(r.results[1].code, 3); assert.equal(r.needsLlmReview, false);
});
test('runChecks zaman aşımında kod null ve ok false', async () => {
  const r = await runChecks(process.cwd(), ['node -e "setTimeout(()=>{},5000)"'], {timeoutMs:200});
  assert.equal(r.ok, false); assert.equal(r.results[0].code, null);
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** Zaman aşımında süreç ağacı öldürülür: Windows'ta `taskkill /pid <pid> /T /F`, diğer sistemlerde `kill('SIGKILL')`.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat(core): araç politikası ve makine kontrolleri`

### Task 7: Adaptör ve zamanlayıcı

**Files:**
- Create: `src/engines/adapter.js`, `src/core/scheduler.js`, `test/fixtures/fake-engine.mjs`
- Test: `test/engines/adapter.test.js`, `test/core/scheduler.test.js`

**Interfaces:**
- Consumes: `parseLine`, `cliArgs` (Task 4); `readyTasks`, `checkoutTask`, `startRun`, `finishRun` (Task 3); `recordUsage`, `budgetStatus` (Task 5); `append` (Task 2).
- Produces:
  - `Adapter = {engine, execute({prompt, cwd, resumeId?, signal?, onEvent?}): Promise<{text, sessionId, usage, exitCode}>}`
  - `createCliAdapter(engine, {bin?, timeoutMs=1800000, spawnArgs?}): Adapter`
    - `bin` ve `spawnArgs` testte fake-engine'e yönlendirmek için kullanılır.
    - stdout satır satır `parseLine`'a gider, her `ParsedLine` `onEvent`'e iletilir.
    - `final.text` döner. `final` yoksa son `text` döner.
    - Çıkış kodu sıfır değilse `execute` hata atmaz, `exitCode` ile döner.
  - `runReady({db, adapters: Record<string, Adapter>, maxParallel: Record<string, number> = {claude:1, codex:3, agy:2}, cwd}): Promise<{started:number, done:number, failed:number, skippedBudget:number}>`
    - Döngü: `readyTasks` → her görev için motor (`task.engine`, yoksa `codex`) → `budgetStatus({engine})`.
      - Sonuç `stop` ise görev `blocked` olur, `budget.blocked` olayı yazılır, görev atlanır.
    - Görev başına: `startRun` → `checkoutTask` (false ise atla) → `adapter.execute` → `recordUsage` → `finishRun`. `exitCode===0` ise `done`, değilse `failed`.
    - Motor başına eşzamanlı çalışma `maxParallel[engine]` değerini aşmaz.
    - Bir görev bitince yeni hazır olanlar aynı çağrıda alınır. Hazır görev ve çalışan iş kalmayınca fonksiyon döner.

`fake-engine.mjs`: Argümanlarından `--lines <dosya>` ve `--exit <n>` okur. Dosyadaki satırları 5 ms arayla basar, sonra `n` koduyla çıkar. `--sleep <ms>` verilirse çıkmadan önce bekler.

- [ ] **Step 1: Failing tests**

```js
test('adaptör fixture akışından metin, oturum ve kullanım döner', async () => {
  const a = createCliAdapter('claude', {bin: process.execPath, spawnArgs: () => ['test/fixtures/fake-engine.mjs','--lines','test/fixtures/engines/claude.jsonl','--exit','0']});
  const events = []; const r = await a.execute({prompt:'x', cwd:'.', onEvent: e => events.push(e)});
  assert.equal(r.exitCode, 0); assert.ok(r.sessionId); assert.ok(r.text.length > 0); assert.ok(events.length >= 3);
});
test('zamanlayıcı DAG sırasına uyar ve paralelliği sınırlar', async () => {
  const db = openDb(); let live = 0, peak = 0; const order = [];
  const fake = {engine:'codex', async execute({prompt}) { live++; peak = Math.max(peak, live); await sleep(20); order.push(prompt); live--; return {text:'ok', sessionId:'s', usage:{input:1,cachedInput:0,output:1}, exitCode:0}; }};
  const a = createTask(db,{title:'a',prompt:'a',engine:'codex'}), b = createTask(db,{title:'b',prompt:'b',engine:'codex'}), c = createTask(db,{title:'c',prompt:'c',engine:'codex'}), d = createTask(db,{title:'d',prompt:'d',engine:'codex'});
  addDependency(db, d.id, a.id); addDependency(db, d.id, b.id); addDependency(db, d.id, c.id);
  const r = await runReady({db, adapters:{codex:fake}, maxParallel:{codex:2}, cwd:'.'});
  assert.equal(r.done, 4); assert.equal(peak, 2); assert.equal(order.at(-1), 'd');
});
test('başarısız görev bağımlısını bekletir, diğerleri sürer', async () => { /* a exitCode 1 → a failed, b (a'ya bağlı) todo kalır, c done */ });
test('motor bütçesi dolunca görev blocked olur', async () => { /* setBudget engine codex 1 token, usage 1 → task blocked, skippedBudget 1 */ });
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** `createCliAdapter` (`node:child_process.spawn`, `readline`, `AbortSignal` ile iptal) ve `runReady`. Havuz: motor başına sayaç ve bir `Promise.race` döngüsü.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat(core): CLI adaptörü ve DAG zamanlayıcı`

### Task 8: `fa` komutu ve hız ölçümü

**Files:**
- Create: `src/cli.js`, `bin/fa.js`
- Modify: `package.json`. `"bin": {"fa": "bin/fa.js"}` ve `"scripts": {"bench": "node bin/fa.js bench"}` eklenir.
- Test: `test/cli.test.js`

**Interfaces:**
- Consumes: Task 1–7'nin hepsi.
- Produces: `main(argv: string[], {dbPath?, stdout?}): Promise<number>` (çıkış kodu). Komutlar:
  - `fa init`: `./.fa/fa.db` oluşturur.
  - `fa add "<başlık>" [--engine codex] [--after <id>]...`: görev ekler ve id basar.
  - `fa run [--parallel codex=3,claude=1]`: `runReady` gerçek adaptörlerle çalışır, olaylar tek satırlık özetlerle basılır.
  - `fa status`: görev sayıları duruma göre, son 10 olay, bütçe durumu.
  - `fa bench`: `openDb` + 1000 görev ekleme + `readyTasks` sürelerini ölçer, ms olarak basar. Hedef: çekirdek açılışı 1 saniyenin altında (PLAN §3.4).

- [ ] **Step 1: Failing tests**

```js
test('init, add, status uçtan uca', async () => {
  const dir = mkdtempSync(join(tmpdir(),'fa-')); const dbPath = join(dir,'fa.db'); const out = [];
  const stdout = {write: s => out.push(s)};
  assert.equal(await main(['init'], {dbPath, stdout}), 0);
  assert.equal(await main(['add','merhaba','--engine','agy'], {dbPath, stdout}), 0);
  await main(['status'], {dbPath, stdout});
  assert.match(out.join(''), /todo\s+1/);
});
test('bilinmeyen komut 2 döner', async () => { assert.equal(await main(['uç'], {stdout:{write(){}}}), 2); });
test('bench 1000 görevde 1 saniyenin altında', async () => {
  const out = []; await main(['bench'], {dbPath:':memory:', stdout:{write: s => out.push(s)}});
  const ms = Number(out.join('').match(/toplam (\d+) ms/)[1]); assert.ok(ms < 1000, `${ms} ms`);
});
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** `main`. Argümanlar `node:util.parseArgs` ile ayrıştırılır. `bin/fa.js` yalnızca `process.exit(await main(process.argv.slice(2)))` çağırır.
- [ ] **Step 4: Run the full suite** — `npm test` → hepsi PASS.
- [ ] **Step 5: Gerçek motorla duman testi (elle):**
  1. `node bin/fa.js init`
  2. `node bin/fa.js add "README'deki başlığı oku ve tek cümleyle özetle" --engine agy`
  3. `node bin/fa.js run`

  Beklenen: görev `done` olur, `status` içinde kullanım görünür. Motor yoksa ya da limit doluysa görev `failed` olur ve hata olayda yazılıdır.
- [ ] **Step 6: Commit** — `feat: fa komutu (init, add, run, status, bench)`

---

## Aşama 1 bitti sayılır, eğer

- `npm test` yeşil, dış bağımlılık yok.
- `fa bench` 1000 görevde 1 saniyenin altında.
- Duman testinde en az bir gerçek motor (agy ya da codex) görevi bitirip kullanımı yazmış.
- `OZELLIK-HARITASI.md` dosyasındaki A1 maddeleri (1, 2, 3, 4 veri, 5, 17 liste) karşılanmış.
