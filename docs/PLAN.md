# feyzullah-agents: plan

Durum: **aşama 1–7 main'de** (PR #2–#8). Tamamlama işleri (güvenlik kapısı, performans kapısı, Santral paneli, kurulum, ccusage): [PAKETLER.md](PAKETLER.md). Gerçek motor denemesi: [DENEME.md](DENEME.md).

## 1. Amaç

Her türlü işi yapabilen genel amaçlı bir çok ajanlı sistem. Kod, araştırma, tasarım ve görsel, oyun (Godot ve Roblox), içerik (feyzocode/Instagram), veri ve tahmin, ters mühendislik.

Sistem tek bir komut alır ve şu adımları izler:

1. Komutu netleştirir (Prompt Master).
2. Konuyla ilgili bilgiyi Noesis'ten çeker.
3. İşi parçalara böler ve her parçayı uygun uzmana verir.
4. Uzmanlar paralel çalışır, her iş kanıta dayanarak kontrol edilir.
5. Sonucu raporlar ve kalıcı değeri olan bilgiyi Noesis'e geri yazar.

## 2. Temel aldığımız şey: feyzullah-office

feyzullah-office'te bu fikir çalışır halde var. Ancak hepsi bir Electron arayüzüne ve köprüye bağlı. Yeni projede **çekirdek arayüzden ayrılır**:

| Office'teki parça | Ne yapıyor | Yeni projede |
|---|---|---|
| `src/agents/admin.js` | Yönetici: planlar, işe alır, çıkarır, görev dağıtır, Reality Checker döngüsü (en fazla 2 tur), bütünleşme kontrolü, rapor | `core/orchestrator`: aynı akış, ama arayüzsüz ve olay tabanlı |
| `src/agents/runner.js` | Ajan kuyruğu, geçmiş, izinli komut listesi (SAFE_BASH), limit dolunca yedek motor | `core/runner` + `core/policy` (izinler ayrı modül) |
| `src/agents/cli.js` | claude / codex / agy CLI çağrıları (`agy --mode accept-edits` dahil) | `engines/cli-*` |
| `src/agents/providers.js` | Anthropic, OpenAI uyumlu ve Gemini API'leri | `engines/api-*` |
| `src/agents/catalog.js` | agency-agents kataloğu (267 uzman) | `agents/catalog` (aynı kaynak, MIT) |
| `src/agents/prompt-master.md` | Ham isteği net prompta çevirme | `prompts/` |
| `src/gitwork.js` | `ofis/<grup>` dalları ve worktree'ler | `core/git` |
| `src/schedule.js`, `src/usage.js` | Zamanlanmış komutlar, kullanım ve limit takibi | `core/schedule`, `core/usage` |
| Pano (board) | Görev durumu: yapılıyor, kontrolde, düzeltiliyor, bitti | `core/board` (JSON yerine SQLite) |
| Piksel ofis arayüzü | Görselleştirme | Ayrı istemci; ileride Ofis bu çekirdeğe bağlanabilir |

Office'teki deneyimle oturmuş kurallar aynen korunur:

- **Beyin Claude.** Planlama, mimari, güvenlik ve sonuç kontrolü Claude'da.
- **Asıl iş yükü Codex'te** (kod, test, build), **agy'de** (belge, araştırma). agy terminal komutu çalıştıramaz; bu yüzden ona komut işi verilmez.
- Limit dolunca yedek motora otomatik geçilir. Ofis'teki sıra (`runner.js:58`):
  - codex → claude
  - antigravity (agy) → codex → claude
  - claude → codex

  "Codex > agy > Claude" sırası yalnız düzeltici seçiminde kullanılıyor (`admin.js:209`).
- Motor kimliği Ofis'teki gibi `antigravity`. `agy` yalnız komutun adı ve takma ad.
- Aynı klasördeki görevler sırayla ve aynı git dalında çalışır, farklı klasördekiler paralel.
- Kontrolcü iddiaya değil kanıta bakar. Belirsiz kararda iş geçer, sonsuz döngü olmasın.

## 3. Mimari (taslak)

```
Kullanıcı (CLI · Ofis arayüzü · zamanlayıcı · köprü /say)
            │
     ┌──────▼───────┐
     │ Prompt Master│  ham istek → net görev
     └──────┬───────┘
     ┌──────▼───────┐     ┌────────────────────┐
     │  Yönetici    │◄───►│ Bilgi katmanı      │
     │ (Claude)     │     │ Noesis MCP · hafıza │
     └──────┬───────┘     └────────────────────┘
   görevler │ (pano)
 ┌──────────┼──────────┬───────────┬───────────┐
 ▼          ▼          ▼           ▼           ▼
Kod      Araştırma   Tasarım     Oyun       Ters müh.
(Codex)  (agy)       (Codex+Krea) (Codex+   (Claude+REA)
                                  Godot/Roblox)
 └──────────┴────┬─────┴───────────┴───────────┘
          ┌──────▼───────┐
          │ Kontrolcü    │  PASS / NEEDS WORK (en fazla 2 tur)
          └──────┬───────┘
          ┌──────▼───────┐
          │ Bütünleşme + │  test, uyum, rapor, Noesis'e geri yazma
          │ rapor        │
          └──────────────┘
```

### 3.1 Bilgi katmanı (yeni)

Office'te yoktu, bu projenin asıl farkı bu.

- **Okuma:** Yönetici her komutta Noesis'te anahtar kelimelerle arama yapar (Türkçe ve İngilizce) ve ilgili sayfaları görevlere bağlam olarak ekler. Kaynaklar: Instagram Arşivi, Yetenek envanteri, GitHub repolarım, konu klasörleri (Roblox vb.).
- **Uyarılar:** "önerilmez", "güvenlik riski" ya da "doğrulanmadı" diye işaretlenmiş araçlar ya kullanılmaz ya da önce doğrulama görevi açılır.
- **Yazma:** İş bittiğinde kalıcı değeri olan bilgi (yeni araç, karar, kurulum yolu) yeni bir Noesis sayfası olarak eklenir. Biçim: Kaynak, Özet, Ayrıntılar, Kurulum/komutlar, Değerlendirme, Durum. Mevcut sayfaları değiştirmek kullanıcı onayı ister.
- **Gizli bilgi filtresi:** Noesis'e ve GitHub'a giden her metin anahtar, jeton ve kişisel veri taramasından geçer.

### 3.2 Uzman havuzu

- Temel: agency-agents kataloğu.
- Yerel skill'lerden türeyen uzmanlar: roblox-* (28 skill), superpowers, security-audit, replica-skill, agent-reach (yalnız okuma), watch (video), REA.
- Her uzman için bir **profil** tutulur: motor, izinli araçlar, çalışma klasörü kuralı ve geçmiş başarı. Yönetici bu geçmişe göre seçim yapar (office'teki `stats` alanı).

### 3.3 Güvenlik ve izin politikası

- Komut izinleri office'teki gibi uzman başına beyaz listeyle verilir. `--dangerously-skip-permissions` kullanılmaz.
- Push, silme ve dış servise gönderme işleri her zaman kullanıcı onayına gider. Para ya da kredi harcayan işler de (Krea, Flow) onaya gider.
- API anahtarları repoya, SQLite'a ve loglara girmez. Yalnız Windows Kimlik Yöneticisi'nde ya da DPAPI ile şifreli dosyada durur.
  - Electron olmadığı için DPAPI'ye PowerShell `ProtectedData` köprüsüyle erişilir.
  - Anahtar sürece yalnız ortam değişkeni olarak verilir, komut satırına konmaz.
- Roblox Open Cloud anahtarları yalnız test place'ine yetkili, en az izinli anahtarlar olur. Yayın anahtarı her kullanımda onay ister. Ayrıntı: [`ROBLOX.md`](ROBLOX.md).
- CAPTCHA ve bot kontrolü atlatma yok. Noesis'in "önerilmeyen" listesindeki araçlar kullanılmaz.

### 3.4 Office'ten farkı: hız ve optimizasyon

Bu proje Office'in yeni bir kopyası olmayacak. Office'in kodunda ölçülen yavaş noktalar ve her birinin yerine gelecek çözüm:

| Office'te (kodda görülen) | Sorun | feyzullah-agents'ta |
|---|---|---|
| Durum `ofis-runtime.json` (433 KB) ve `ofis-board.json` (356 KB), her değişiklikte `JSON.stringify` ile baştan yazılıyor (`runner.js:95`) | Disk ve CPU yükü, dosya büyüdükçe yavaşlıyor, çökmede veri kaybı riski | SQLite WAL kipinde **yalnız eklenen olay kaydı** (append-only). Bir değişiklik tek satır yazar. Çökmeden sonra kaldığı yerden devam eder |
| Aynı klasördeki görevler sırayla, aynı dalda bekliyor | Paralel çalışabilecek işler birbirini bekliyor | **Bağımlılık grafiği (DAG) zamanlayıcısı.** Görev yalnız gerçekten bağımlı olduğu işi bekler. Bağımsız işler aynı projede de ayrı worktree'lerde paralel çalışır, sonra birleştirilir |
| Her kontrol bir LLM çağrısı (Reality Checker), en fazla 2 tur ve ardından düzeltici | Yavaş ve token harcıyor | **Önce makine kontrolü:** test, lint, build ve dosya varlığı. Bunlar geçerse LLM yalnız gereken yerde inceler. Basit işlerde LLM kontrolü atlanır |
| Uzman raporları 4000 ile 6000 karakterde kesiliyor (`admin.js`) | Bağlam kaybı, yönetici eksik bilgiyle karar veriyor | **Yapılandırılmış sonuç:** değişen dosyalar, test sonucu ve kısa özet. Ayrıntı gerektiğinde dosyadan okunur |
| Her görev için yeni CLI süreci, bağlam her seferinde baştan veriliyor | Tekrar eden bağlam token harcıyor | **Görev başına oturum** (Paperclip `agent_task_sessions`). Aynı görevin düzeltme turları `--resume` / `resume <id>` / `--conversation` ile devam eder. Kimlik metni ve bağlam dosyaları bayt bayt sabit tutulur, böylece sağlayıcı tarafında önbellek tutar. CLI süreci yine her seferinde soğuk başlar; "sıcak süreç" vaadi yok |
| Koordinasyon için LLM çağrısı (yönetici her adımda) | Token ve gecikme | **Deterministik zamanlayıcı** (Bernstein yaklaşımı). LLM yalnız planlama ve incelemede çağrılır, sıralama ve dağıtım kodla yapılır |
| Noesis yok, her seferinde bağlam elle veriliyor | Aynı bilgi tekrar tekrar aranıyor | **Bağlam önbelleği:** Noesis sonuçları sorguya göre SQLite FTS'te önbelleğe alınır, görevlere özet olarak verilir |
| Tek model seçimi, motor sabit | Küçük işte de büyük model çalışıyor | **İş boyutuna göre yönlendirme:** sınıflandırma ve kısa işler hızlı ve ucuz modele, mimari Claude'a. Claude API ajanlarında prompt önbelleği açık |
| Electron arayüz, durumun tamamı her güncellemede yeniden çiziliyor (`office-model.js`) | Ağır, bellek tüketiyor | **Arayüzsüz çekirdek** + tek dosyalık web arayüzü (60 KB altı). SSE ile yalnız değişen olay gönderilir |

#### Ölçülebilir hedefler

Hedefler aşama 2'den itibaren `fa bench` komutuyla ölçülecek. Office ile aynı görev setinde karşılaştırılacak.

| Ölçüt | Hedef |
|---|---|
| Çekirdek açılışı | 1 sn altı |
| Komuttan ilk görevin başlamasına | 10 sn altı |
| Aynı iş setinin toplam süresi | Office'e göre en az %40 kısa |
| Görev başına token | Office'e göre en az %30 az |
| Düzeltme turu oranı (NEEDS WORK) | Ölçülüp raporlanır, her sürümde düşmeli |
| Arayüz | 60 KB altı, ilk çizim 300 ms altı |

## 4. Teknik seçimler (önerilen)

| Konu | Seçim | Neden |
|---|---|---|
| Dil | Node 24, ESM, JavaScript (JSDoc tipleri) | Office ile aynı, kod taşınabilir |
| Test | `node --test` | Ofis'teki yaklaşık 177 testin yapısı örnek alınır |
| Durum | SQLite (`node:sqlite`), WAL kipi, append-only olay kaydı | Office'te JSON dosyaları 400 KB'a çıktı ve her seferinde baştan yazılıyordu |
| Zamanlama | DAG zamanlayıcı + motor başına işçi havuzu | Bağımsız işler paralel, bağımlılar sırayla |
| Arayüz | CLI (`fa run "<komut>"`) + yerel HTTP/SSE + tek dosyalık web arayüzü, Electron yok | Hafif, hızlı, telefondan da açılır |
| Noesis | MCP istemcisi (`noesis.exe --mcp`) | Zaten kurulu ve bağlı |
| Claude API | `@anthropic-ai/sdk`, en güncel modeller, `fallbacks` açık | Office'teki gibi |

## 5. Aşamalar

Her aşama bitince ayrı bir PR açılır, testler geçer, ardından main'e alınır.

| # | Aşama | Çıktı | Bitti sayılması için | Durum |
|---|---|---|---|---|
| 0 | **Plan ve ortam** (bu PR) | Belgeler, klasör iskeleti, kurallar | Plan onaylandı | bitti |
| 1 | Çekirdek | SQLite şema + olay günlüğü, görev DAG'i + atomik checkout, motor adaptörleri, kullanım ve bütçe verisi, politika, makine kontrolleri, `fa` komutu | `npm test` yeşil, `fa bench` 1 saniyenin altında, bir gerçek motor görevi bitiriyor. Ayrıntı: [Aşama 1 planı](superpowers/plans/2026-10-28-asama-1-cekirdek.md) | main'de, PR #2 |
| 2 | Yönetici ve pano | Yönetici + kontrolcü döngüsü, hedefler, uyandırma, yorum ve belgeler, plan onayı, **konsey kipi**, çalışma alanları | `fa run` ile bir hedef plandan bitişe gidiyor | main'de, PR #3 |
| 3 | Bilgi katmanı | Noesis okuma/yazma, FTS arama, gizli bilgi filtresi, "ne öğrendik" sayfaları | Görev Noesis bağlamıyla çalışıyor, sonuç arşive yazılıyor | main'de, PR #4 |
| 4 | Uzman havuzu | **5 departman** (Build, Design, Grow, Make, Run), org şeması, `agents/*.md`, skill bağları ve testleri, ajan başına model | Her departmandan bir örnek görev geçiyor | main'de, PR #5 |
| 5 | İşletim | worktree, rutinler (cron), bekçi ve kurtarma, onay kapıları, bütçe zorlama, sır kasası, yedek motor | Limit dolunca iş başka motorla bitiyor, push onaysız gitmiyor | main'de, PR #6 |
| 6 | Santral ve API | Yerel HTTP/SSE API, Santral arayüzü (`docs/tasarim/v2`), yöneticiyle sohbet, belgeye pasaj yorumu, mobil | Hedefler tablosundaki arayüz ölçütleri tutuyor | main'de, PR #7 |
| 7 | Paketler | **Roblox ilk paket** ([ROBLOX.md](ROBLOX.md)), diğer alan paketleri, içe/dışa aktarma, eklentiler, iş kuyruğu, işe alma önerileri | Her paketin örnek akışı belgeli | main'de, PR #8 |

Paperclip'in bütün özelliklerinin bu aşamalara nasıl dağıldığı: [`OZELLIK-HARITASI.md`](OZELLIK-HARITASI.md).

## 6. Açık sorular

1. ~~Ofis bu çekirdeğe mi geçecek?~~ Karar (2026-10-28): Proje Office'e benzemeyecek. Kendi arayüzü (Santral) olacak. Office ayrı yaşar.
2. Benzer projeler `docs/BENZER-PROJELER.md` içinde. Paperclip (MIT) bütçe ve onay kapıları için, hindsight ile codebase-memory-mcp hafıza için aday. Ruflo artık doğrulandı (ruvnet/ruflo, MIT). Öneri: aşama 3’ten önce kısa bir deneme görevi açılsın.
3. ~~Proje adı ve CLI komutunun adı (`fa`) uygun mu?~~ Karar (2026-10-28): `fa` kalıyor.
