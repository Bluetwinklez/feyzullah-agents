# Veri kaynakları

Bu belge projenin hangi verileri nereden alacağını ve hangilerinin **repoya asla girmeyeceğini** listeler.

## 1. GitHub

| Repo | Kullanım |
|---|---|
| [Bluetwinklez/feyzullah-office](https://github.com/Bluetwinklez/feyzullah-office) | Ana kaynak kod: yönetici, çalıştırıcı, motorlar, katalog, git akışı, testler |
| [msitarzewski/agency-agents](https://github.com/msitarzewski/agency-agents) (MIT) | Uzman kataloğu. Repoya eklenmez, `catalog/` altına klonlanır |
| Bluetwinklez/noesis | Bilgi katmanının MCP arayüzü (kurulu uygulama) |
| Bluetwinklez/desktop-ai-agents, minecraf-ai-agent | Önceki ajan denemeleri; aşama 4'te göz atılacak |

## 2. Bu bilgisayardaki veriler

| Yer | İçerik | Kural |
|---|---|---|
| `Desktop\claude\feyzullah-ofis` | Ofis'in kullanılan sürümü. Office'te henüz yayınlanmamış düzeltmeler var: `findBins` PATH yedeği, "ajan yok" düzeltmesi, `engineFor` ve `fixerFor` değişiklikleri, agy `accept-edits` | Kod buradan alınır (office'ten daha güncel). Çalışan Ofis'in dosyalarına dokunulmaz, yalnızca kopyalanır |
| `~/.feyzullah/ofis-agents.json` | Kayıtlı ajanlar ve motorları. **DPAPI ile şifreli API anahtarları içerir** | Repoya **girmez**. Yalnızca içe aktarma aracıyla, anahtarsız okunur |
| `~/.feyzullah/ofis-board.json`, `ofis-history.json`, `ofis-report.json` | Geçmiş görevler, raporlar, başarı istatistikleri | Repoya girmez. Uzman başarı geçmişi için içe aktarılabilir |
| `~/.feyzullah/ofis-schedule.json`, `ofis-usage.json` | Zamanlanmış komutlar, kullanım ve limit kaydı | Repoya girmez |
| `~/.feyzullah/token` | Köprü jetonu | **Asla** okunup yazdırılmaz, repoya girmez |
| `~/.codex/config.toml` | Codex ayarı (Krea onay modu) | Kurulum belgesinde anlatılır, dosya kopyalanmaz |
| `~/.claude/skills`, `~/.codex/skills`, `~/.gemini/config/skills` | roblox-brain ve diğer skill'ler | Uzman profilleri bunlara yol olarak bağlanır |
| `C:\Tools\godot`, `~/.rokit/bin` | Godot 4.7.2, Roblox araç zinciri | Oyun uzmanlarının ortamı |
| `Desktop\claude\*` projeleri (goc, basketbol-tahmin, roblox-sokak-oyunu, noesis-gh…) | Örnek çalışma alanları | Alan paketlerinde örnek olarak kullanılır |

## 3. Noesis arşivi

Yönetici çalışma anında okur. Planlamada kullanılan sayfalar:

- **Yetenek envanteri** (28 Ekim 2026): kurulu CLI'lar, skill'ler, MCP'ler, öğrenilmiş iş akışları (Krea yalnız Codex üzerinden, Flow, video izleme, carousel), önerilmeyen araçlar, değişmez kurallar.
- **Instagram Arşivi** (yaklaşık 130 gönderi). Ajan konusunda adaylar:
  - Paperclip: ajanları şirket gibi yönetme, bütçe, biletler, onay kapıları.
  - hindsight: oturumlar arası hafıza.
  - codebase-memory-mcp.
  - OpenHuman: yerel hafıza ve orkestratör.
  - G-Stack.
  - Agency Agents.
  - Ruflo: "doğrulanmadı" diye işaretli.
- **Konu klasörleri:** Roblox, GitHub repolarım, GitHub trend.

## 4. Repoya girmeyecekler (özet)

- API anahtarları, jetonlar, şifreler, `.env` dosyaları.
- `~/.feyzullah/` altındaki her şey.
- Kişisel veriler (e-posta, hesap kimlikleri, Krea hesap kimliği).
- Klonlanan kataloglar ve üçüncü taraf paketler (`catalog/`, `node_modules/`).
