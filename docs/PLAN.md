# feyzullah-agents: plan

Durum: **planlama**. Bu belgede yazılanların hiçbiri henüz kodlanmadı.

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
- Yedek motor sırası Codex > agy > Claude. Limit dolunca otomatik geçilir.
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
- API anahtarları yalnız DPAPI ile şifreli yerel dosyada durur, repoya ve loglara girmez.
- CAPTCHA ve bot kontrolü atlatma yok. Noesis'in "önerilmeyen" listesindeki araçlar kullanılmaz.

## 4. Teknik seçimler (önerilen)

| Konu | Seçim | Neden |
|---|---|---|
| Dil | Node 24, ESM, JavaScript (JSDoc tipleri) | Office ile aynı, kod taşınabilir |
| Test | `node --test` | Office'teki 158 testin yapısı korunur |
| Durum | SQLite (`node:sqlite`) | Pano, geçmiş ve istatistikler JSON dosyalarında büyüyordu |
| Arayüz | Önce CLI (`fa run "<komut>"`), sonra yerel HTTP API | Ofis ve diğer istemciler aynı API'ye bağlanır |
| Noesis | MCP istemcisi (`noesis.exe --mcp`) | Zaten kurulu ve bağlı |
| Claude API | `@anthropic-ai/sdk`, en güncel modeller, `fallbacks` açık | Office'teki gibi |

## 5. Aşamalar

Her aşama bitince ayrı bir PR açılır, testler geçer, ardından main'e alınır.

| # | Aşama | Çıktı | Bitti sayılması için |
|---|---|---|---|
| 0 | **Plan ve ortam** (bu PR) | Belgeler, klasör iskeleti, kurallar | Plan onaylandı |
| 1 | Çekirdek taşıma | `engines/`, `core/runner`, `core/policy`, office testleri | Office testlerinin karşılığı geçiyor |
| 2 | Yönetici ve pano | `core/orchestrator`, SQLite pano, kontrolcü döngüsü, CLI | `fa run` ile bir görev uçtan uca bitiyor |
| 3 | Bilgi katmanı | Noesis okuma/yazma, gizli bilgi filtresi | Görev Noesis bağlamıyla çalışıyor, sonuç arşive yazılıyor |
| 4 | Uzman havuzu | Katalog + yerel skill uzmanları + profiller | Her alandan bir örnek görev geçiyor |
| 5 | Git, zamanlama, limitler | worktree, zamanlanmış komut, yedek motor | Limit dolunca iş başka motorla bitiyor |
| 6 | HTTP API ve Ofis bağlantısı | Yerel API; Ofis'in istemci olarak bağlanması | Ofis görevleri bu çekirdekten izleniyor |
| 7 | Alan paketleri | Roblox, Godot, içerik, veri, araştırma şablonları | Her paketin örnek akışı belgeli |

## 6. Açık sorular

1. Ofis bu çekirdeğe mi geçecek, yoksa iki sistem ayrı mı yaşayacak? Öneri: aşama 6'da Ofis istemci olur.
2. Benzer projeler `docs/BENZER-PROJELER.md` içinde. Paperclip (MIT) bütçe ve onay kapıları için, hindsight ile codebase-memory-mcp hafıza için aday. Ruflo artık doğrulandı (ruvnet/ruflo, MIT). Öneri: aşama 3’ten önce kısa bir deneme görevi açılsın.
3. Proje adı ve CLI komutunun adı (`fa`) uygun mu?
