# Aşama 1: Çekirdek Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Arayüzsüz, test edilmiş bir çekirdek. Çekirdeğin işleri:
- Görevleri SQLite'a yazar.
- Görevleri bağımlılık sırasına göre motorlara dağıtır: claude, codex, antigravity (agy).
- Kullanımı ve olayları kaydeder.
- Limite takılan işi bekletir; çöken çalışmadan sonra durumu kurtarır.
- Sonucu önce makine kontrolünden geçirir.

**Architecture:**
- Tek süreç, Node 24 ESM.
- Kalıcı durum `node:sqlite` üzerinde, WAL kipinde. `busy_timeout` var, yazmalar `BEGIN IMMEDIATE` ile yapılır.
- Her değişiklik append-only `events` tablosuna yazılır.
- Zamanlayıcı hazır görevi tek işlemde iki adımla alır: önce atomik checkout, sonra run kaydı. Görevleri motor başına sınırlı paralellikle adaptörlere verir.
- Adaptörler Ofis'in `src/agents/cli.js` dosyasındaki davranışı **birebir** taşır:
  - bayraklar
  - stdin ya da dosyayla verilen prompt
  - UTF-8 çözme
  - süreç ağacını öldürme
  - ikili dosya arama

**Tech Stack:** Node.js ≥ 24 (`node:sqlite` `DatabaseSync`, `node:test`, `node:child_process`, `node:string_decoder`). JavaScript + JSDoc. Dış bağımlılık yok.

**Spec:**
- `docs/PLAN.md` (Aşama 1 ve §3.4)
- `docs/OZELLIK-HARITASI.md` (A1 satırları)
- Ofis referans kodu (yalnız okunur):
  - `feyzullah-ofis/src/agents/cli.js`
  - `runner.js:27-71,151-197`
  - `admin.js:185`

## Global Constraints

- **Ortam ve test:**
  - Node `>=24`, `"type": "module"`, yalnız yerleşik modüller.
  - Testler: `node --test "test/**/*.test.js"`.
  - Fixture yolları `import.meta.dirname` ile kurulur.
  - Her test kendi veritabanını açar ve kapatır.
- **Motor kimlikleri:** `claude | codex | antigravity`. `agy` yalnız takma addır ve `normalizeEngine()` onu `antigravity` yapar. Ofis'in `ofis-agents.json` dosyası da bu kimlikleri kullanır.
- **Zaman:** Bütün zaman alanları epoch ms (`INTEGER`). Pencere hesabı yerel saatle yapılır ve ms'e çevrilir.
- **Görev durumları:** `backlog | todo | in_progress | in_review | blocked | done | failed | cancelled`.
- **Run durumları:** `queued | running | succeeded | failed | timed_out | interrupted | cancelled | limited`.
- **Kullanım biçimi:** `{input, cachedInput, cacheWrite, output, known:boolean}`.
  - `input` önbelleksiz girdidir.
  - Codex: `input = input_tokens - cached_input_tokens`.
  - Claude: `input_tokens`, `cache_read_input_tokens` ve `cache_creation_input_tokens` ayrı ayrı tutulur.
  - antigravity kullanım vermez: `known:false`, sayılar 0.
- **Bütçe:** Birim token. `used = input + cacheWrite + output`. `warnPercent` 80, `hardStop` true.
- **İzin ve güvenlik:**
  - Hiçbir motor argümanında `--dangerously-skip-permissions`, `--yolo` ya da `bypass` yok.
  - Sırlar, `~/.feyzullah/*` içeriği ve API anahtarları repoya, olaylara ya da loglara yazılmaz.
  - Çalışan Ofis'e dokunulmaz. Kod okunur ve yeniden yazılır.
- **Windows'ta süreç:** `.cmd` ve `.bat` doğrudan spawn edilmez; Node'da EINVAL verir (CVE-2024-27980). İptal ve zaman aşımında `taskkill /pid <pid> /T /F` kullanılır.
- **Zaman aşımı:** Run başına varsayılan 60 dakika (Ofis `runner.js:151`).
- **Lisanslı kod:** Paperclip'ten kod kopyalanırsa `THIRD_PARTY.md` dosyasına MIT bildirimi eklenir (commit `cff331f`). Paperclip'in claude adaptörü `dangerouslySkipPermissions` varsayılanını açık tutar; o kısım alınmaz.
- **Commit:** Kimlik `144558175+Bluetwinklez@users.noreply.github.com`. Mesaj sonu: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- **Kullanım limiti:** Görev `failed` olmaz. `blocked` olur ve `retry_at` alır. Bağımlıları kilitlenmez; `retry_at` geçince görev yeniden hazır olur (Task 7).
- **Süreç çökmesi ya da elle kapatma:** Açılışta `recoverStale` takılı run'ları `interrupted` yapar ve görevleri `todo`'ya döndürür (Task 3).
- **Çıkış kodu 0 ama iş hatalı:** agy `status != SUCCESS` ya da boş cevap, claude `is_error`, codex `turn.failed` durumlarında görev `failed` olur (Task 4, Task 7).
- **Uzun prompt:** 24.000 karakterden uzun prompt komut satırına konmaz. claude ve codex stdin'den alır, agy dosyadan alır (Task 6).
- **İki süreç aynı anda checkout yapar:** Yalnız biri kazanır, kaybeden yetim run bırakmaz (Task 3).

---

## Dosya yapısı

```
src/core/db.js          openDb, göçler, tx (BEGIN IMMEDIATE)
src/core/events.js      append-only olay günlüğü, sır maskeleme
src/core/tasks.js       görev, bağımlılık, claimTask, finishRun, recoverStale, görev oturumları
src/core/costs.js       kullanım ve bütçe
src/core/policy.js      ajan başına araç listesi, onay isteyen eylemler
src/core/checks.js      makine kontrolleri
src/core/limits.js      limit algılama (LIMIT_RE + rate olayı) ve retry_at hesabı
src/core/scheduler.js   DAG zamanlayıcı
src/engines/parse.js    satır ayrıştırıcıları
src/engines/args.js     cliArgs, normalizeEngine
src/engines/bins.js     findBins (Windows konumları)
src/engines/adapter.js  createCliAdapter
src/cli.js, bin/fa.js   fa komutu
test/fixtures/          motor çıktıları (sır yok), fake-engine.mjs
```

---

### Task 1: Veritabanı, şema, işlem yardımcısı

**Files:** Create `src/core/db.js`. Test `test/core/db.test.js`.

**Interfaces:**
- Produces:
  - `openDb(path = ':memory:'): DatabaseSync`. Ayarlar:
    - `journal_mode=WAL` (dosyada)
    - `busy_timeout=5000`
    - `foreign_keys=ON`
    - göçler uygulanmış
  - `tx(db, fn): T`. `BEGIN IMMEDIATE` açar, `fn()` çalıştırır, `COMMIT` eder; hata olursa `ROLLBACK` yapıp hatayı yeniden atar. `node:sqlite` bunu hazır vermez.
  - `schemaVersion(db): number`
  - `now(): number`. `Date.now()` döner; testte değiştirilebilsin diye tek yerden gelir.

Göç 1'deki tablolar:
- `workspaces(id PK, name, root, kind /*'generic'|'roblox'|…*/, created_at)`
- `agents(id PK, workspace_id REFERENCES workspaces, name, engine, model, department, reports_to REFERENCES agents, capabilities /*JSON*/, persona)`
- `tasks(id PK, workspace_id REFERENCES workspaces, title, prompt, status, engine, assignee_agent_id REFERENCES agents, parent_id REFERENCES tasks, goal_id, checkout_run_id, locked_at, retry_at, attempts INTEGER DEFAULT 0, created_at, updated_at, result /*JSON*/)`
- `task_deps(task_id REFERENCES tasks, depends_on REFERENCES tasks, PK(task_id, depends_on), CHECK(task_id <> depends_on))`
- `runs(id PK, task_id REFERENCES tasks, engine, status, session_before, session_after, exit_code, signal, error, error_code, stdout_excerpt, usage /*JSON*/, started_at, finished_at, last_output_at, pid)`
- `task_sessions(agent_key, engine, task_key, session_id, updated_at, PK(agent_key, engine, task_key))`
  - Paperclip'teki `agent_task_sessions` karşılığı.
  - Oturum görev başına tutulur. "Sıcak süreç" diye bir şey yok.
- `events(seq INTEGER PK AUTOINCREMENT, at, actor, type, entity, entity_id, data)` + `BEFORE UPDATE` / `BEFORE DELETE` trigger'ları → `RAISE(ABORT,'append-only')`.
  - Göçler gerekirse aynı işlem içinde trigger'ı önce düşürüp sonra yeniden kurar.
- `usage(id PK, run_id, agent_id, engine, model, input, cached_input, cache_write, output, known, at)`
- `budgets(id PK, scope /*'global'|'engine'|'agent'*/, scope_id, window /*'day'|'month'*/, limit_tokens, warn_percent DEFAULT 80, hard_stop DEFAULT 1)`
- `meta(key PK, value)`

Göç 1 `default` çalışma alanını da ekler (`kind='generic'`, `root=NULL`). `tasks.workspace_id` yabancı anahtar olduğu için bu satır olmadan `createTask` hata verir. `fa init` bu satırın `root` ve `kind` alanlarını günceller.

- [ ] **Step 1: Failing tests**
  - `'şema kurulur ve sürüm 1'`: 11 tablo da var.
  - `'dosya veritabanı WAL ve busy_timeout 5000, ikinci açılış göç tekrarlamaz'`:
    - Her iki bağlantı da `close()` edilir.
    - `:memory:` için journal_mode beklenmez.
  - `'tx hata atınca geri alır'`: `tx(db, () => { insert; throw })` → satır yok.
  - `'öz bağımlılık CHECK ile reddedilir'`
- [ ] **Step 2:** `node --test test/core/db.test.js` → FAIL.
- [ ] **Step 3: Implement.** `MIGRATIONS` dizisinde `meta.schema_version` değerinden yeni olan göçler `tx` içinde uygulanır.
- [ ] **Step 4:** PASS.
- [ ] **Step 5: Commit** — `feat(core): SQLite şema, göçler ve işlem yardımcısı`

### Task 2: Olay günlüğü

**Files:** Create `src/core/events.js`. Test `test/core/events.test.js`.

**Interfaces:**
- Produces:
  - `append(db, {actor, type, entity, entityId, data}): number` → seq.
  - `since(db, seq, limit = 500): Event[]`. `data` ayrıştırılmış nesne olarak döner.
  - `redact(obj): obj`. Anahtar adı `/key|token|password|secret|authorization|cookie/i` ile eşleşirse değer `"[gizli]"` yapılır. İç içe nesnelere ve dizilere de uygulanır.

- [ ] **Step 1: Failing tests**
  - `'append artan seq döner, since sıralı okur'`
  - `'iç içe ve dizideki gizli anahtarlar maskelenir'`: `{a:[{apiKey:'x'}], Authorization:'y'}`
  - `'DELETE ve UPDATE append-only hatası verir'`
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** — `feat(core): append-only olay günlüğü`

### Task 3: Görevler, checkout, run kayıtları, kurtarma, görev oturumları

**Files:** Create `src/core/tasks.js`. Test `test/core/tasks.test.js`.

**Interfaces:**
- Consumes: `openDb`, `tx`, `now`, `append`.
- Produces:
  - `createTask(db, {title, prompt, engine?, assigneeAgentId?, parentId?, goalId?, workspaceId='default', status='todo'}): Task`
  - `addDependency(db, taskId, dependsOn): void`
    - Döngü varsa `Error('döngü: …')` atar.
    - Kontrol: `dependsOn` görevinden başlayan özyinelemeli CTE, `taskId`'ye ulaşıyor mu?
  - `readyTasks(db, {limit=50, at=now()}?): Task[]`. Koşullar:
    - durum `todo`, ya da durum `blocked` ve `retry_at <= at`
    - `checkout_run_id IS NULL`
    - bütün bağımlılıklar `done`
    - sıra `created_at`
  - `claimTask(db, taskId, {engine, sessionBefore?}): Run | null`
    - Tek `tx` içinde önce `UPDATE tasks SET checkout_run_id=?, locked_at=?, status='in_progress', attempts=attempts+1 WHERE id=? AND checkout_run_id IS NULL AND status IN ('todo','blocked')` çalışır.
    - `changes === 1` ise `runs` satırı `running` olarak eklenir.
    - Checkout kaybedilirse `null` döner ve run kaydı oluşmaz.
  - `finishRun(db, runId, {status, exitCode?, signal?, error?, errorCode?, sessionAfter?, usage?, result?, retryAt?, stdoutExcerpt?}): void`. Görev durumu run durumuna göre değişir:
    - `succeeded` → `done`
    - `limited` → `blocked`, `retry_at` yazılır
    - `failed`, `timed_out` → `failed`
    - `cancelled` → `cancelled`
    - Her durumda checkout boşaltılır.
  - `recoverStale(db): number`
    - `running` kalan run'ları `interrupted` yapar.
    - Görevlerini `todo`'ya döndürür, checkout'u boşaltır.
    - Kurtarılan sayıyı döner. Açılışta bir kez çağrılır.
  - `getSession(db, {agentKey, engine, taskKey}): string|null`, `saveSession(db, {...}, sessionId): void`
  - `getTask(db, id)`
  - `blockTask(db, taskId, {retryAt, reason}): void`. Claim edilmemiş görevi `blocked` yapar, `retry_at` yazar, `task.blocked` olayı ekler. Bütçe engeli için kullanılır.
- Olaylar: `task.created`, `task.claimed`, `run.finished`, `task.done`, `task.failed`, `task.blocked`, `run.recovered`.

- [ ] **Step 1: Failing tests**
  - `'bağımlılığı bitmemiş görev hazır değil'`
  - `'döngü reddedilir ve tablo değişmez'`
  - `'aynı görevi ikinci claim alamaz ve yetim run kalmaz'`
    ```js
    assert.ok(claimTask(db, t.id, {engine:'codex'}));
    assert.equal(claimTask(db, t.id, {engine:'codex'}), null);
    assert.equal(db.prepare('SELECT count(*) n FROM runs').get().n, 1);
    ```
  - `'finishRun succeeded bağımlıyı hazırlar'`
  - `'limited görev retry_at gelince yeniden hazır'`:
    - `retryAt = 1000`
    - `readyTasks({at:999})` boş döner.
    - `readyTasks({at:1000})` görevi döner.
  - `'recoverStale takılı run'ı interrupted, görevi todo yapar'`
  - `'görev oturumu kaydedilir ve okunur'`
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** — `feat(core): görevler, atomik claim, kurtarma, görev oturumları`

### Task 4: Ayrıştırıcılar, argümanlar, ikili arama

**Files:**
- Create `src/engines/parse.js`, `src/engines/args.js`, `src/engines/bins.js`, `test/fixtures/engines/{claude,codex,antigravity}.jsonl`.
- Test `test/engines/*.test.js`.

**Interfaces:**
- Produces:
  - `normalizeEngine(name): 'claude'|'codex'|'antigravity'`
    - `agy` ve `gemini` → `antigravity`.
    - Bilinmeyen ad hata atar.
  - `parseLine(engine, line): ParsedLine | null`
    - `ParsedLine = {sessionId?, text?, final?, error?, usage?, rate?}`. `usage` Global Constraints'teki biçimdedir.
    - Bozuk ya da boş satırda `null` döner, Ofis ile aynı. Kurallar `cli.js:32-64` ile aynıdır.
    - Bilinçli farklar:
      - **Codex:** Birden çok `agent_message` gelebilir; adaptör bunları Ofis'teki gibi `
` ile birleştirir. Birden çok `turn.completed` gelirse kullanım toplanır. `turn.completed.usage` normalize edilir: `input = input_tokens - (cached_input_tokens ?? 0)`, `cachedInput = cached_input_tokens`.
      - **Claude:** `result` satırında `input = input_tokens`, `cachedInput = cache_read_input_tokens`, `cacheWrite = cache_creation_input_tokens`. `is_error` ise `{error, usage}` döner.
      - **antigravity:** `result.status !== 'SUCCESS'` ya da boş `response` olursa `{error}` döner.
  - `cliArgs(engine, {cwd, persona?, personaFile?, prompt, resumeId?, allowedTools=[], network=false}): string[]`. **`cli.js:17-29` birebir taşınır:**
    - **codex:** `exec --json -s workspace-write [-c sandbox_workspace_write.network_access=true] --skip-git-repo-check -C <cwd> [resume <id>] -`. Prompt stdin'den verilir.
    - **antigravity:** `-p <persona+görev> --output-format stream-json --sandbox --mode accept-edits [--conversation <id>]`
    - **claude:** `-p --output-format stream-json --verbose --permission-mode acceptEdits [--append-system-prompt <p> | --append-system-prompt-file <f>] [--resume <id>] [--allowedTools …]`. Prompt stdin'den verilir.
  - `promptVia(engine): 'stdin'|'argv'`. claude ve codex → `stdin`, antigravity → `argv`.
  - `stdinText(engine, {persona, prompt, resumeId}): string|null`. `cli.js:131` ile aynı:
    - claude → `prompt` (persona `--append-system-prompt` ile gider)
    - codex → `resumeId` varsa `prompt`, yoksa `withPersona(persona, prompt)`
    - antigravity → `null` (stdin hemen kapatılır)
    - `withPersona = persona ? `${persona}

---

Görev:
${prompt}` : prompt`. antigravity'de `resumeId` varsa persona eklenmez.
  - `findBins(): {claude?, codex?, antigravity?}`. `cli.js:160-198` taşınır. Bakılan yerler:
    - PATH'teki `.exe` dosyaları
    - claude için Roaming, Claude-Data ve MSIX Packages altındaki `claude.exe`
    - `%LOCALAPPDATA%\OpenAI\Codex\bin`
    - `%LOCALAPPDATA%\agy\bin`
    - `.cmd` ve `.bat` dosyaları elenir.

Fixture: Her motor için 5–6 satır: oturum, metin, araç, sonuç ve kullanım. Ayrıca bir hata dosyası: `*-error.jsonl`. Oturum kimlikleri sahte UUID'dir.

- [ ] **Step 1: Failing tests**
  ```js
  test('codex kullanımı önbelleği ayırır', () => {
    const p = parseLine('codex', JSON.stringify({type:'turn.completed', usage:{input_tokens:1000, cached_input_tokens:800, output_tokens:50}}));
    assert.deepEqual(p.usage, {input:200, cachedInput:800, cacheWrite:0, output:50, known:true});
  });
  test('claude result kullanımı üç parçaya ayrılır', () => { /* input 10, cache_read 900, cache_creation 40 → {input:10, cachedInput:900, cacheWrite:40, …} */ });
  test('fixture: her motor oturum ve final verir', () => { /* out.some(p => p?.sessionId) && out.some(p => typeof p?.final === 'string') */ });
  test('agy SUCCESS dışı ve boş cevap hatadır', () => { /* status:'FAILED' → error; status:'SUCCESS', response:'' → error */ });
  test('bozuk satır null', () => { for (const e of ENGINES) assert.equal(parseLine(e, 'x{'), null); });
  test('cliArgs Ofis ile birebir', () => {
    assert.deepEqual(cliArgs('codex', {cwd:'C:/w', prompt:'p', resumeId:'s1', network:true}),
      ['exec','--json','-s','workspace-write','-c','sandbox_workspace_write.network_access=true','--skip-git-repo-check','-C','C:/w','resume','s1','-']);
    assert.deepEqual(cliArgs('antigravity', {cwd:'.', persona:'K', prompt:'G', resumeId:'c1'}),
      ['-p','G','--output-format','stream-json','--sandbox','--mode','accept-edits','--conversation','c1']);
  });
  test('hiçbir motorda izin atlatma bayrağı yok', () => { /* /dangerously|yolo|bypass/ */ });
  test('normalizeEngine agy → antigravity', () => {});
  test('findBins .cmd döndürmez', () => { /* sahte PATH dizininde a.cmd ve a.exe → .exe seçilir */ });
  ```
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** — `feat(engines): Ofis ile birebir argümanlar, normalize kullanım, ikili arama`

### Task 5: Kullanım, bütçe, limit algılama

**Files:**
- Create `src/core/costs.js`, `src/core/limits.js`.
- Test `test/core/costs.test.js`, `test/core/limits.test.js`.

**Interfaces:**
- `costs.js`:
  - `recordUsage(db, {runId, agentId?, engine, model?, usage}): void`
  - `setBudget(db, {id, scope, scopeId?, window, limitTokens, warnPercent=80, hardStop=true})`
  - `budgetStatus(db, {engine?, agentId?, at=now()}): {state:'ok'|'warn'|'stop', used, limit, budgetId, unknownRuns:number, resetAt:number|null}`
    - Pencere yerel saatle: `day` bugünün 00:00'ından başlar, `resetAt` yarın 00:00. `month` ayın 1'inden başlar, `resetAt` gelecek ayın 1'i.
    - Sonuç: uygun bütçelerin en kötüsü.
    - `used = input + cacheWrite + output`. `cachedInput` sayılmaz.
    - `unknownRuns`: penceredeki `known=0` kayıt sayısı. agy bu sayede görünür olur.
- `limits.js`:
  - `detectLimit({error?, rate?, text?}): {limited:boolean, retryAt:number|null}`
    - `LIMIT_RE` Ofis `runner.js:57`'den taşınır.
    - claude `rate_limit_event.rate_limit_info.resetsAt` (saniye) ms'e çevrilir.
    - Metin yolu Ofis `runner.js:57-71` ile aynı: `LIMIT_RE` eşleşirse `limitUntil(msg)` "try again at 7:52 AM" saatini okur (geçtiyse ertesi gün), saat yoksa `now() + 60 dk`.
    - `rate` yalnız `status === 'rejected'` ise limittir. Ofis'te `rate_limit_event` her istekte gelir ve çoğu `allowed`; bunu limit saymak her claude görevini durdururdu.
  - `limitUntil(msg, now): number` dışa açılır.

- [ ] **Step 1: Failing tests**
  - `'%80 uyarı, %100 durdurma'`: Değerler önceki planla aynı; `cacheWrite` kullanılır.
  - `'cachedInput bütçeye girmez'`
  - `'motor bütçesi yalnız o motoru durdurur'`
  - `'agy kayıtları unknownRuns olarak sayılır'`
  - `'hardStop kapalıysa sınır aşılsa da warn'`
  - `'bütçe yoksa ok ve limit null'`
  - `'detectLimit usage limit metnini yakalar'`: Ofis'teki limit mesajı örnekleri, `turn.failed` metni ve `is_error` metni.
  - `'rate resetsAt saatini kullanır, allowed olay limit değildir'`
  - `'try again at saati okunur, geçtiyse ertesi gün'`
  - `'günlük bütçe resetAt ertesi gece yarısı'`
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** — `feat(core): kullanım, token bütçesi, limit algılama`

### Task 6: Politika, makine kontrolleri, adaptör

**Files:**
- Create `src/core/policy.js`, `src/core/checks.js`, `src/engines/adapter.js`, `test/fixtures/fake-engine.mjs`.
- Test her biri için ayrı.

**Interfaces:**
- **`policy.js`:**
  - `toolsFor(agent: {engine, department?, capabilities?}, {network?}): string[]`. `runner.js:27-31,116-123` mantığı taşınır:
    - claude dışı motorlar `[]` alır, sandbox'a güvenilir.
    - claude için temel liste `SAFE_BASH` ve dosya araçlarıdır.
    - `capabilities` içinde varsa eklenenler:
      - `reverse` → `READ_BASH` + `mcp__rea__*`
      - `krea` → `mcp__krea-ai__*`
      - `godot` → Godot komut kalıpları
      - `roblox` → `rojo`, `selene`, `stylua`, `lune`, `rokit` komut kalıpları
  - `decide(action): 'allow'|'ask'|'deny'`. Listede olmayan eylem `ask` döner (güvenli varsayılan).
    - `ask`: `git.push`, `git.merge`, `fs.delete`, `credits.spend`, `external.send`, `roblox.publish`, `roblox.cloud_exec`, `roblox.insert_asset`
    - `deny`: `secrets.read`, `permissions.bypass`
- **`checks.js`:**
  - `runChecks(cwd, commands, {timeoutMs=120000, env?}?): Promise<{ok, results:{cmd, code, timedOut, ms, tail}[], needsLlmReview}>`
    - Komut `cmd.exe /d /s /c "chcp 65001>nul & <cmd>"` ile çalışır (Windows'ta UTF-8 çıktı). `windowsVerbatimArguments: true` gerekir, yoksa Node tırnakları bozar. Windows dışında `sh -c`.
    - Zaman aşımında `taskkill /T /F` çalışır, `code:null` ve `timedOut:true` yazılır.
    - İlk hatada durur.
- **`adapter.js`:**
  - `createCliAdapter(engine, {bin, timeoutMs=3600000, spawnImpl?, extraPath?}): Adapter`
  - `Adapter.execute({prompt, persona?, cwd, resumeId?, allowedTools?, network?, signal?, onEvent?}) → {text, final, sessionId, usage, rate, error, exitCode, timedOut}`
    - Ortam: `FEYZULLAH_AGENTS=1` (hook'lar susar), `extraPath` PATH'in önüne eklenir.
    - Prompt verme yolu:
      - stdin motorlarında prompt stdin'e yazılıp kapatılır.
      - antigravity'de persona + görev 24.000 karakteri aşarsa `<cwd>/.fa-gorev.md` dosyasına yazılır, kısa bir yönlendirme gider, dosya iş bitince silinir.
      - claude persona'sı 24.000 karakteri aşarsa geçici dosyaya yazılır ve `--append-system-prompt-file` ile verilir.
    - Çıktı okuma: stdout `StringDecoder('utf8')` ile satırlara bölünür ve her satır `parseLine`'a verilir. Ayrıca `last_output_at` güncellenir.
    - İptal (`signal`) ya da zaman aşımında Windows'ta `taskkill /pid /T /F`, diğer sistemlerde `kill(-pid)` çalışır (süreç `detached` başlatılır).
    - Çıkış kodu 0 değilse hata atılmaz; sonuçta döner. Başlatılamazsa (`error` olayı) `{error:'başlatılamadı: …'}` döner.

- [ ] **Step 1: Failing tests**
  - `'reverse yeteneği rea araçlarını ekler, codex boş liste alır'`
  - `'roblox.publish ask, secrets.read deny, bilinmeyen eylem ask'`
  - `'runChecks ilk hatada durur'`
  - `'zaman aşımı timedOut true ve code null'`
  - `'runChecks Türkçe çıktıyı bozmaz'`: `node -e "console.log('şğüİı')"` → tail içinde aynen.
  - `'adaptör stdin ile prompt verir'`: fake-engine stdin'i okuyup `{"type":"result","result":<stdin>}` basar.
  - `'agy uzun prompt dosyaya yazılır ve iş sonunda silinir'`
  - `'adaptör iptalinde alt süreç ağacı ölür'`: fake-engine bir torun süreç başlatır; iptalden sonra torun pid'i yaşamaz.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** — `feat: politika, makine kontrolleri, CLI adaptörü`

### Task 7: Zamanlayıcı

**Files:** Create `src/core/scheduler.js`. Test `test/core/scheduler.test.js`.

**Interfaces:**
- Consumes: Task 3 (`readyTasks`, `claimTask`, `finishRun`, `getSession`, `saveSession`), Task 5 (`recordUsage`, `budgetStatus`, `detectLimit`), Task 6 (`Adapter`).
- Produces: `runReady({db, adapters, maxParallel = {claude:1, codex:3, antigravity:2}, cwd, fallback = {codex:['claude'], antigravity:['codex','claude'], claude:['codex']}}): Promise<{done, failed, blocked, skippedBudget}>`

Döngü, her hazır görev için:
1. Motor seçilir: `task.engine ?? 'codex'`.
2. `budgetStatus` `stop` dönerse `blockTask(…, {retryAt: resetAt})` çalışır ve `budget.blocked` olayı yazılır. `retry_at` boş kalsaydı görev sonsuza dek beklerdi.
3. `claimTask` ile görev alınır.
4. `getSession` ile oturum varsa `resumeId` olarak verilir.
5. `execute` çalışır, sonra `recordUsage`.
6. Run durumu belirlenir (sıra önemli):
   - `timedOut` → `timed_out`.
   - `!error && final != null` → `succeeded`. Ofis gibi: çıkış kodu 0 değilse ama final geldiyse iş bitmiş sayılır.
   - `detectLimit` sınır bulursa → `limited` ve `retryAt`. `fallback[engine]` içinde limiti olmayan motor varsa görev **aynı turda** o motorla yeniden kuyruğa girer (Ofis'teki yedek motor davranışı).
   - Diğer durumlar → `failed`.

Motor kapanma kaydı: limite takılan motor `down[engine] = retryAt` olur ve `meta.engine_down` içine yazılır; sonraki `fa run` de o saate kadar bu motoru atlar. Yedek motor yalnız `adapters` içinde varsa denenir (Ofis'te `bins[e]` kontrolü). Oturum `task_sessions` anahtarında motor olduğu için yedek motora eski oturum gitmez.
7. Oturum kaydedilir.

Resume hatası (bilinmeyen oturum) olursa oturum silinir ve görev bir kez oturumsuz denenir (Paperclip `isClaudeUnknownSessionError`).

- [ ] **Step 1: Failing tests**
  - `'DAG sırası ve paralellik sınırı'`: `peak == 2`, son `d`.
  - `'başarısız görevin bağımlısı bekler, diğerleri sürer'`
  - `'exit 0 ama error varsa failed'`
  - `'limitte görev yedek motora geçer'`: codex sahte adaptörü limit hatası döner, claude sahte adaptörü başarılı → görev `done` olur, iki run vardır (biri `limited`).
  - `'yedek yoksa blocked ve retry_at dolu'`
  - `'bütçe dolu motor blocked'`
  - `'ikinci çalıştırmada görev oturumu resumeId olarak gider'`
  - `'bilinmeyen oturum hatasında oturumsuz bir kez yeniden dener'`
  - `'kapalı motor sonraki çalıştırmada atlanır'`
  - `'bütçe engeli retry_at olarak pencere sonunu yazar'`
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** — `feat(core): DAG zamanlayıcı, yedek motor, görev başına oturum`

### Task 8: `fa` komutu ve hız ölçümü

**Files:**
- Create `src/cli.js`, `bin/fa.js`.
- Modify `package.json`: `bin`, `scripts.bench` eklenir.
- Test `test/cli.test.js`.

**Interfaces:**
- `main(argv, {dbPath?, stdout?, cwd?}): Promise<number>`. Veritabanı yolu: `dbPath` ?? `FA_DB` ortamı ?? `<cwd>/.feyzullah-agents/fa.db` (dizin `.gitignore`'da). Açılışta `recoverStale` çağrılır. Komutlar:
  - `fa init [--kind generic|roblox]`
  - `fa add "<başlık>" [--engine] [--after <id>]… [--prompt-file <f>]`
  - `fa run [--parallel codex=3,claude=1]`
  - `fa status`: duruma göre sayılar, son 10 olay, bütçe, `unknownRuns`.
  - `fa bins`: bulunan motor yolları.
  - `fa bench`: 1000 görev + `readyTasks` süresi.

- [ ] **Step 1: Failing tests**
  - `'init, add, status uçtan uca'`
  - `'bilinmeyen komut 2 döner'`
  - `'bench 1000 görevde 1 saniyenin altında'`
  - `'açılışta takılı run kurtarılır'`
- [ ] **Step 2–4:** FAIL → implement → PASS (`npm test` hepsi).
- [ ] **Step 5: Duman testi (elle)**
  1. `fa bins`
  2. `fa init`
  3. `fa add "README başlığını tek cümleyle özetle" --engine antigravity`
  4. `fa run`
  5. `fa status`

  Beklenen: görev `done` olur ve `unknownRuns 1` görünür. Aynısı `--engine codex` ile tekrarlanır; bu sefer kullanım sayıları dolu gelir.
- [ ] **Step 6: Commit** — `feat: fa komutu`

---

## Aşama 1 bitti sayılır, eğer

- `npm test` yeşil.
- `fa bench` 1 saniyenin altında.
- Gerçek antigravity ve codex görevleri bitmiş.
- Limit testinde yedek motora geçiş çalışıyor.
- Süreç öldürülüp yeniden açılınca `recoverStale` görevi kurtarıyor.
