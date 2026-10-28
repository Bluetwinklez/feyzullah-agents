# Özellik haritası: Paperclip, departmanlar, konsey

Kaynak: [paperclipai/paperclip](https://github.com/paperclipai/paperclip) (MIT, commit `cff331f`, 28 Ekim 2026). Okunan dosyalar: `README.md`, `ROADMAP.md`, `doc/PRODUCT.md`, `docs/start/architecture.md`, `skills/paperclip/SKILL.md` ve `packages/db/src/schema/*` (issues, agents, budget_policies, approvals, heartbeat_runs, goals, routines, issue_watchdogs, cost_events).

Kullanıcı kararı (2026-10-28): Paperclip uygulama olarak kurulmayacak. **Fikirleri ve dosyaları kaynak olarak kullanılacak, bütün özellikleri plana girecek.**

## Paperclip'ten neyi nasıl alıyoruz

- **Fikir ve veri modeli:** Serbestçe alınır. Tablo alanları bizim SQLite şemamıza uyarlanır.
- **Kod:** MIT lisanslı. Bir dosyadan kod kopyalanırsa `THIRD_PARTY.md` dosyasına kaynak, commit ve MIT bildirimi eklenir. Paperclip TypeScript, biz JavaScript yazıyoruz. Bu yüzden genelde kopyalamak yerine yeniden yazıyoruz.
- **Almadıklarımız:**
  - PostgreSQL: Bu makinede Administrator hesabıyla açılmıyor. Yerine `node:sqlite` kullanıyoruz.
  - React, Express ve pnpm monorepo: Hız hedefimize aykırı.
  - Çok kullanıcılı ve bulut katmanı: Tek kullanıcıyız.

## Eşleme tablosu

A1–A7 kısaltmaları `PLAN.md` dosyasındaki aşamalar.

| # | Paperclip özelliği | Paperclip'te nasıl | feyzullah-agents'ta | Aşama |
|---|---|---|---|---|
| 1 | Bring Your Own Agent | Adaptör: `execute()` + çıktı ayrıştırıcı + CLI biçimleyici. claude_local, codex_local, process, http | `src/engines/`: claude, codex ve agy (Ofis'te kanıtlanmış ayrıştırıcılar). process ve http adaptörleri sonra gelecek | A1, A5 |
| 2 | Atomik checkout, tek sorumlu | `issues.checkoutRunId`, `executionLockedAt` | `checkoutTask()`: tek SQL `UPDATE … WHERE checkout_run IS NULL` | A1 |
| 3 | Run kayıtları | `heartbeat_runs`: durum, çıkış kodu, kullanım, oturum öncesi ve sonrası, son çıktı zamanı | `runs` tablosu, sadeleştirilmiş: status, engine, session_before/after, usage, exit_code, last_output_at | A1 |
| 4 | Maliyet kontrolü | `budget_policies` (kapsam, pencere, tutar, warnPercent, hardStopEnabled), `cost_events` | `budgets` ve `usage` tabloları. Abonelik CLI'larında ücret çoğu zaman 0 olduğu için birim **token**. %80'de uyarı, %100'de durdurma. Krea kredisi ayrı bir sayaç | A1 (veri), A5 (zorlama) |
| 5 | Etkinlik kaydı ve sorumlu atama | `activity_log` | Append-only `events` tablosu. Her değişiklik bir olay; aktör ajan, kullanıcı ya da sistem | A1 |
| 6 | Hedef hizalaması | `goals` (seviye, üst hedef), her görev zinciri hedefe bağlanır | `goals` tablosu + görevde `goal_id`. Yönetici her göreve "neden" zinciri ekler | A2 |
| 7 | Heartbeat ve uyandırma | Zamanlayıcı, atama ya da yorumla uyanan kısa çalışmalar. `agent_wakeup_requests` | DAG zamanlayıcı + uyandırma nedenleri: atama, bağımlılık bitti, yorum, rutin | A2 |
| 8 | Görev konuları | Yorumlar, görev belgeleri, ekler, iş ürünleri | `comments` ve `documents` (sürümlü). İş ürünleri: değişen dosyalar, dal, test sonucu | A2 |
| 9 | Derin planlama | Planlama kipi, sürümlü planlar, plan onayı | Yönetici planı bir belge olarak yazar, büyük işlerde plan onaya gider. **Konsey kipi** burada (aşağıda) | A2 |
| 10 | Yönetişim, onaylar | `approvals` (tür, payload, karar notu), inceleme kapıları | `approvals` tablosu. Türler: `git.merge`, `git.push`, `credits.spend`, `external.send`, `fs.delete`, `plan` | A2 (veri), A5 (kapılar) |
| 11 | Org şeması | `agents.reportsTo`, `role`, `capabilities` | Ajanda `department`, `reports_to`, `capabilities`. **5 departman** (aşağıda) | A4 |
| 12 | Skills ve Skill Studio | Şirket skill'leri, GitHub kaynakları, sürüm geçmişi, kayıtlı test girdileri | Yerel skill'ler (`~/.claude/skills`, `~/.codex/skills`) taranır, ajan profiline bağlanır. Skill testleri: kayıtlı girdi → beklenen çıktı | A4 |
| 13 | AGENTS.md ile ajan tanımı | Repo içi yapılandırma | `agents/*.md` dosyaları (ön bilgi alanları + kimlik metni). agency-agents biçimiyle uyumlu | A4 |
| 14 | Hazır ekipler | Takım kataloğu | Alan paketleri: Roblox, Godot, içerik, veri, araştırma | A7 |
| 15 | Zamanlanmış rutinler | `routines` (cron, saat dilimi, eşzamanlılık ve kaçırılan çalışma politikası, sürümler) | `routines` tablosu. Cron, `concurrency: skip` ya da `queue`, `catch_up: latest` ya da `none` | A5 |
| 16 | Bekçiler ve kurtarma | `issue_watchdogs`, sınırlı yeniden deneme, kurtarma eylemleri | Takılan görev bekçisi (çıktısız N dakika). En fazla 2 yeniden deneme, ardından kullanıcıya kurtarma kartı | A5 |
| 17 | MCP araç geçidi | Eylem başına İzinli / Önce sor / Kapalı | `policy.js`: araç ve eylem başına `allow`, `ask` ya da `deny`. Ofis'teki SAFE_BASH listesi temel alınır | A1 (liste), A5 (geçit) |
| 18 | Gizli bilgi yönetimi | Ajan başına bağlama, denetimli çözümleme | Windows DPAPI ile şifreli kasa, ajan başına izin. Değerler loglara ve olaylara asla yazılmaz | A5 |
| 19 | Çok model, çok koşum | Ajan başına model ve harness seçimi | Ajan başına motor + model. İş boyutuna göre yönlendirme | A4 |
| 20 | Hafıza ve bilgi | Mem0, Zep vb. bağlantılar (deneysel) | **Noesis** + bağlam önbelleği (FTS). hindsight denenecek | A3 |
| 21 | Şirket içi arama | Görev, yorum, belge, ajan araması | SQLite FTS5: görevler, yorumlar, belgeler, Noesis önbelleği | A3 |
| 22 | Otomatik kurumsal öğrenme (yol haritasında) | Biten işten tekrar kullanılabilir bilgi | İş bitince Noesis'e "ne öğrendik" sayfası yazılır (kalıcı değeri varsa) | A3 |
| 23 | Belgeler ve geri bildirim | Pasaja yorum, revizyon geçmişi, geri yükleme | Belge revizyonları A2'de, pasaj yorumu Santral'da | A2, A6 |
| 24 | Ajan sohbeti | Kalıcı sohbet, plan, ardından görevlere devretme | Santral'da yöneticiyle sohbet. Onaylanan plan göreve dönüşür | A6 |
| 25 | Mobil uyum | Telefondan yönetim | Santral duyarlı tasarım (`docs/tasarim/v2`) | A6 |
| 26 | Şirket içe ve dışa aktarma | zip paketi | `fa export` / `fa import`: ajanlar, rutinler ve skill bağları. Anahtar içermez | A7 |
| 27 | Eklenti sistemi | İnce çekirdek, eklentiler | Motor ve alan paketleri eklenti klasörü olarak yüklenir | A7 |
| 28 | Çoklu şirket | Kesin şirket sınırları | Tek kullanıcı, çok **çalışma alanı** (proje). Her kayıtta `workspace_id` | A2 |
| 29 | İş kuyrukları (yol haritasında) | Sürekli iş alımı | Gelen kutusu kuyruğu: Noesis görevleri ve zamanlanmış komutlar | A7 |
| 30 | Kendi kendini örgütleme (yol haritasında) | Ajanlar yapı değişikliği önerir | Yönetici işe alma ve çıkarma önerir (Ofis'te vardı). Öneriler onaya gider | A7 |
| 31 | Bilet sistemi köprüsü (yol haritasında) | Asana, Linear, Jira | İsteğe bağlı. Bağlayıcılar yetkilendirilirse | Sonra |
| 32 | Çok kullanıcı, paylaşılan hesaplar, bulut, sandbox sağlayıcıları, masaüstü uygulaması | Ekip ve bulut kurulumu | **Kapsam dışı.** Tek kullanıcı, yerel worktree, web arayüzü | — |

## Gönderilerden gelen ek özellikler

### Beş departman (Charlie Hills, Noesis: "42 Things to Install in Claude")

Her ajan bir departmana bağlı. Yönetici CEO konumunda. Santral'da satırlar departmana göre gruplanır.

| Departman | Kapsam | Örnek ajanlar | Varsayılan motor |
|---|---|---|---|
| **Build** | Kod, test, yayın | Kodcu, Kontrolcü, Ters Mühendis | Codex |
| **Design** | Arayüz, görsel, video | Tasarımcı, Grafikçi | Codex (+ Krea) |
| **Grow** | Araştırma, pazarlama metni | Araştırmacı, Yazar | agy |
| **Make** | İçerik üretimi (carousel, Reel, ses) | İçerikçi | Codex |
| **Run** | Ofis işleri, rapor, arşiv | Arşivci (Noesis), Raporcu | agy / Claude |

### Konsey kipi (Noesis: "LLM Council skill")

Önemli kararlar (mimari, `plan` onayı isteyen işler) için Yönetici konseyi toplar. Akış:

1. **5 danışman paralel cevap verir:**
   - Karşı görüş: fikri öldürecek şeyi arar.
   - İlk ilkeler: doğru problemi mi çözüyoruz, onu sorar.
   - Büyütücü: kaçırılan fırsatı bulur.
   - Yabancı: bağlam verilmez, gözden kaçanı yakalar.
   - Uygulayıcı: yalnız bir sonraki somut adıma bakar.
2. **İsimsiz çapraz inceleme:** Cevaplar A–E olarak karıştırılır, her danışman diğerlerini puanlar.
3. **Başkan kararı:** Claude; anlaşma ve çatışma noktalarını, kör noktaları, öneriyi ve "önce yapılacak tek şey"i yazar.

Maliyet yaklaşık 11 model çağrısı. Danışmanlar Codex ya da agy'de, başkan Claude'da çalışır. Yalnız `council: true` işaretli kararlarda devreye girer. Kod kendimiz yazılır: Karpathy'nin reposunda ve skill reposunda lisans yok. Aşama: A2.

## İnceleme sonrası eklenenler (28 Ekim 2026)

Plan Ofis'in koduyla, Paperclip ile ve yeni repolarla karşılaştırıldı. Ayrıntı: `BENZER-PROJELER.md` "Ek tarama".

### Ofis'te olup ilk planda unutulanlar

| # | Özellik | Ofis'te | Aşama |
|---|---|---|---|
| 33 | Uzun prompt: stdin ya da dosya (24.000 karakter sınırı) | `cli.js:70-93` | A1 |
| 34 | Limit algılama, kota açılma saati, yedek motor | `runner.js:57-71,168-197`, `cli.js:54` | **A1**. Limitteki görev `blocked` olur, `failed` olmaz |
| 35 | Hata semantiği: çıkış 0 olsa bile `is_error`, `turn.failed`, agy boş cevap | `cli.js:38-61` | A1 |
| 36 | Windows ikili arama (Claude masaüstü, MSIX, agy, Codex konumları) ve `.cmd` dışlama | `cli.js:160-198` | A1 |
| 37 | Ajana göre izin listesi (ters mühendislik → rea, görsel → Krea, Godot yolları) | `runner.js:27-31,116-123` | A1 |
| 38 | Kimlik metnine eklenen ipuçları (Krea, Godot, kısa yazım stili) | `runner.js:124-135` | A4 |
| 39 | Prompt Master ve Claude limiti yüksekken onu atlama | `main.js:58-86`, `usage.js:50,107` | A2 |
| 40 | Git akışı: grup dalı, her turdan sonra commit, `merge --no-ff` + kirli depo kontrolü, `revertMerge`, birleştirme sonrası test, 7 günlük worktree temizliği, `worktreeFate` | `gitwork.js`, `main.js:276-412` | A5 |
| 41 | Yönetici: işe alma ve çıkarma, esnek cevap ayrıştırma + bir kez düzeltme isteği, bütünleşme kontrolü, kartta yeniden dene ve iptal | `admin.js:127-370` | A2 |
| 42 | Uzman istatistikleri yöneticiye verilir | `stats.js` | A4 |
| 43 | Zamanlanmış komutta "limit açılınca çalış" seçeneği | `schedule.js:18` | A5 |
| 44 | Günlük rapor, ses, telefon köprüsü | `main.js:108,437` | A6 |

### Paperclip'ten düzeltilen ya da eklenenler

| # | Özellik | Not | Aşama |
|---|---|---|---|
| 45 | Ayrı görev ve run durum kümeleri (`in_review`, `timed_out`, `interrupted`) | Kontrolcü döngüsü ve kurtarma bunlara dayanır | A1 |
| 46 | Çökme kurtarma (`reapOrphanedRuns`) | `recoverStale` açılışta çalışır | A1 |
| 47 | Görev başına oturum (`agent_task_sessions`) | "Sıcak oturum havuzu" fikrinin yerine geldi | A1 |
| 48 | Bilinmeyen oturumda oturumsuz yeniden deneme | `isClaudeUnknownSessionError` | A1 |
| 49 | Uyandırma birleştirme (`coalescedCount`, `idempotencyKey`) | Aynı görev için üst üste gelen uyandırmalar tek çalışmaya iner | A2 |

### Yeni repolardan

| # | Özellik | Kaynak | Aşama |
|---|---|---|---|
| 50 | Deterministik koordinasyon: sıralama kodla, LLM yalnız plan ve incelemede | Bernstein | A1 |
| 51 | Birleştirme öncesi kapı: lint + tip + test | Bernstein Janitor | A5 |
| 52 | HMAC zincirli olay kaydı (kurcalama tespiti) | Bernstein | A5 |
| 53 | Worktree başına setup/run/teardown betikleri ve port enjeksiyonu (`FA_PORT`) | Emdash | A5 |
| 54 | Onay bekleyen iş kuyruğu bloklamaz, ajan başka işe geçer | agent-orchestrator dersi | A5 |
| 55 | CLI çıktısından durum algılama (boşta, meşgul, girdi bekliyor) | ccmanager | A6 |
| 56 | `fa bench` görev seti: talimat + ortam + doğrulayıcı betik | harbor | A2 |
| 57 | Ajan ve skill değerlendirmesi (YAML, LLM hakem) | promptfoo | A4 |
| 58 | Kullanımın ccusage ile çapraz kontrolü | ccusage | A5 |
| 59 | YAML iş akışı şablonları (paralel grup, koşul) | microsoft/conductor | A2 |

### Roblox paketi

Ayrıntı [`ROBLOX.md`](ROBLOX.md) dosyasında.

| # | Özellik | Aşama |
|---|---|---|
| 60 | `roblox` çalışma alanı türü, araç zinciri izinleri, `roblox.*` onay eylemleri | A1 |
| 61 | `uretim-sirasi.md` → hedef ve görev zinciri, durdurulmuş durumun korunması | A2 |
| 62 | Noesis Roblox kök sayfası + creator-docs bağlamı | A3 |
| 63 | Roblox rolleri + 28 skill | A4 |
| 64 | Doğrulama katmanları 1–4, ff-only autopilot, engelli liste | A5 |
| 65 | Santral Roblox paneli | A6 |
| 66 | rocale-cli motor içi test, Studio MCP adaptörü, Mantle ile onaylı yayın | A7 |

### Instagram arşivinden (28 Ekim 2026, ikinci parti)

| # | Özellik | Kaynak | Aşama |
|---|---|---|---|
| 67 | **Bağlam sıkıştırma:** Test ve build logları, motor çıktıları ve Noesis sonuçları ajana verilmeden önce sıkıştırılır | headroomlabs-ai/headroom (Apache-2.0, ~78k) | A3 |
| 68 | **Silme etkisi önizlemesi:** `fs.delete` onay kartında silinecek dosya sayısı ve boyutu gösterilir | Claude Code mod örneği "Blast radius" | A5 |
| 69 | **Takip önerileri:** Görev bitince en fazla 3 takip görevi önerilir; kullanıcı seçer | Mod örneği "Next steps" | A2 |
| 70 | **Bütçe tahmini:** Son çalışmalara göre "bu hızla limit ne zaman dolar" tahmini | Mod örneği "Token weather" | A5 |
| 71 | **Adım adım diff inceleme:** Bir turdaki düzenlemeler önceki ve sonraki adımlarla gezilir | Mod örneği "Replay theater" | A6 |
| 72 | **Claude Code içinde `fa` paneli:** `fa status` bilgisi ve onay kartları Claude Code mod'u olarak gösterilir. Santral'ın yanında ikinci bir yüz | claude.dev/mods, `plugin-authoring` skill'i | A6 |
| 73 | **Güvenlik kapısı:** Birleştirmeden önce güvenlik denetimi; bulgular bağımsız doğrulanır | cloudflare/security-audit-skill (MIT), Claude Security eklentisi, yerel `security-audit` skill'i | A5 |
| 74 | **Lansman videosu ve video şablonları:** Proje ya da demo bitince tanıtım videosu üretilir. Şablonlarda süre, çözünürlük, fps, sahne zamanlaması ve stil bloğu ayrı tutulur | latent-spaces/brag (MIT), HyperFrames prompt yapısı | A7 |
| 75 | **Roblox performans kapısı:** Part ve instance sayısı ile yükleme süresi eşikleri | Clarion Studios (EditableMesh) | A5 |

Değerlendirilip alınmayanlar:
- **OmniRoute:** Kod üçüncü taraf sağlayıcılara gidiyor, yedek motor olarak kullanılmaz.
- **openbot:** Lisans belirsiz, yalnız fikir alınır: ajan başına iş kuyruğu ve dosya paylaşımı.
- **Graphify ve Understand Anything:** Doğrulanmadı. A3'te codebase-memory-mcp ile birlikte denenecek adaylar.

## Kapsam özeti

| Aşama | Paperclip maddeleri | Ek |
|---|---|---|
| A1 Çekirdek | 1, 2, 3, 4 (veri), 5, 17 (liste), 33–37, 45–48, 50, 60 | Ofis'le birebir motor adaptörleri, DAG, makine kontrolü, limitte yedek motor |
| A2 Yönetici | 6, 7, 8, 9, 10, 23, 28, 39, 41, 49, 56, 59, 61, 69 | Konsey kipi |
| A3 Bilgi | 20, 21, 22, 62, 67 | Noesis |
| A4 Uzmanlar | 11, 12, 13, 19, 38, 42, 57, 63 | 5 departman |
| A5 İşletim | 4 (zorlama), 10 (kapılar), 15, 16, 17 (geçit), 18, 40, 43, 51–54, 58, 64, 68, 70, 73, 75 | Git akışı, birleştirme kapısı |
| A6 Santral | 23 (pasaj yorumu), 24, 25, 44, 55, 65, 71, 72 | Zaman çizelgesi arayüzü |
| A7 Paketler | 14, 26, 27, 29, 30, 66, 74 | Roblox ilk paket |
