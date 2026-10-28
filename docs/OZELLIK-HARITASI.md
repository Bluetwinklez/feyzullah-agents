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

## Kapsam özeti

| Aşama | Paperclip maddeleri | Ek |
|---|---|---|
| A1 Çekirdek | 1, 2, 3, 4 (veri), 5, 17 (liste) | Office'ten motor ayrıştırıcıları, DAG, makine kontrolü |
| A2 Yönetici | 6, 7, 8, 9, 10, 23, 28 | Konsey kipi |
| A3 Bilgi | 20, 21, 22 | Noesis |
| A4 Uzmanlar | 11, 12, 13, 19 | 5 departman |
| A5 İşletim | 4 (zorlama), 10 (kapılar), 15, 16, 17 (geçit), 18 | Kullanım limitinde yedek motor |
| A6 Santral | 23 (pasaj yorumu), 24, 25 | Zaman çizelgesi arayüzü |
| A7 Paketler | 14, 26, 27, 29, 30 | Alan paketleri |
