# Benzer projeler (28 Ekim 2026)

Yıldız sayıları ve lisanslar GitHub'dan bu tarihte okundu. Kod kopyalamadan önce lisansa bakılır: MIT ve Apache serbesttir. GPL ve AGPL kodu bu repoya (MIT) **kopyalanmaz**, yalnızca fikir alınır.

## Doğrudan ilgili

| Repo | ★ | Lisans | Ne alınabilir |
|---|---|---|---|
| [paperclipai/paperclip](https://github.com/paperclipai/paperclip) | 108k | MIT | Ajan başına **bütçe** ve maliyet takibi, **onay kapıları**, organizasyon şeması, hedef → görev hizalaması, "heartbeat" ile ajan bağlama (adaptör modeli). Node + React. Planın aşama 2 ve 5'i için en güçlü referans |
| [ruvnet/ruflo](https://github.com/ruvnet/ruflo) | 80k | MIT | Sürü (swarm) koordinasyonu, model yönlendirme. Noesis'teki "Ruflow" notunda "doğrulanmadı" yazıyordu; repo artık doğrulandı. Önce incelenir, sonra fikir alınır |
| [BloopAI/vibe-kanban](https://github.com/BloopAI/vibe-kanban) | 28k | Apache-2.0 | Kanban pano, ajan başına workspace (dal + terminal + dev sunucu), diff üzerinde satır içi yorumla ajana geri bildirim. **Proje kapanıyor (sunsetting)**, bağımlılık olarak kullanılmaz |
| [pixel-agents-hq/pixel-agents](https://github.com/pixel-agents-hq/pixel-agents) | 10k | MIT | Piksel ofis, Feyzullah Ofis ile aynı fikir ve aynı MetroCity karakterleri. Ofis düzeni editörü, alanlar (klasör → masa), `HookProvider` arayüzü (yeni CLI eklemek tek klasör), limit ve bütçe için "can barı" fikri |
| [stravu/crystal](https://github.com/stravu/crystal) (Nimbalyst) | 3k | MIT | Aynı işi paralel worktree'lerde birden çok ajana yaptırıp sonuçları karşılaştırma |
| [disler/claude-code-hooks-multi-agent-observability](https://github.com/disler/claude-code-hooks-multi-agent-observability) | 1.6k | yok | Claude Code hook olaylarıyla canlı izleme. Lisansı yok, yalnızca fikir alınır |
| [majiayu000/harness](https://github.com/majiayu000/harness) | 86 | MIT | Claude Code ve Codex için politika ve yönetişim katmanı (Rust) |

## Hafıza ve bilgi katmanı (aşama 3)

| Repo | ★ | Lisans | Not |
|---|---|---|---|
| [vectorize-io/hindsight](https://github.com/vectorize-io/hindsight) | 55k | MIT | Öğrenen ajan hafızası. Noesis'in yanında oturumlar arası hafıza için aday |
| [DeusData/codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp) | 48k | MIT | Kod, belge ve altyapıyı kalıcı bir grafa bağlıyor. Kod uzmanlarına bağlam vermek için aday |

## Fikir alınır, kod alınmaz

- [siteboon/claudecodeui](https://github.com/siteboon/claudecodeui) (14k, AGPL): Claude Code ve Codex'i telefondan ve webden kullanma. Aşama 6 için mobil arayüz fikri.
- [smtg-ai/claude-squad](https://github.com/smtg-ai/claude-squad) (8.7k, AGPL): Terminalde birden çok ajanı yönetme.
- [phinn/KinetAios](https://github.com/phinn/KinetAios) (12, GPL-3): Claude Code, Codex ve ReAct tek pencerede.

## Uygun bulunmayan

- [Lokesh-shiva/Agent-Dashboard](https://github.com/Lokesh-shiva/Agent-Dashboard) (8★): Veri analitiği paneli (FastAPI + React). Konusu farklı, lisansı yok. Ayrıca repoda `.env` dosyası commit edilmiş, bu kötü bir örnek.

## Plana etkisi

1. **Bütçe ve onay kapıları** (Paperclip) aşama 5'e eklenecek: ajan başına token ve kredi bütçesi, kredi harcayan işlerde onay.
2. **Diff üzerinde satır içi geri bildirim** (vibe-kanban) aşama 6 arayüzüne eklenecek.
3. **Motor bağdaştırıcısı arayüzü** (pixel-agents `HookProvider`, Paperclip adaptörleri) aşama 1'de `engines/` için örnek alınacak: yeni CLI eklemek tek dosya olmalı.
4. **Hafıza:** hindsight ve codebase-memory-mcp aşama 3'ten önce denenecek.

## Ek tarama (28 Ekim 2026)

Kaynaklar: GitHub araması ve [Augment'in açık kaynak orkestratör karşılaştırması](https://www.augmentcode.com/tools/open-source-agent-orchestrators). Makale araçları dört ölçütle karşılaştırıyor: yalıtım, ajan desteği, koordinasyon derinliği ve arayüz. Ortak görüş: yalıtım için git worktree kullanılıyor, araçları asıl ayıran şey koordinasyon.

| Repo | ★ | Lisans | Alınacak |
|---|---|---|---|
| [sipyourdrink-ltd/bernstein](https://github.com/sipyourdrink-ltd/bernstein) | – | Apache-2.0 | Görev grafiğini LLM planlar. Sıralama ve dağıtım deterministik, LLM token'ı harcamaz. Birleştirmeden önce "Janitor" lint, tip ve test kontrolü yapar. Olay kaydı HMAC zincirli. **A1 zamanlayıcı ve A5 kapı için ana örnek** |
| [ComposioHQ/agent-orchestrator](https://github.com/ComposioHQ/agent-orchestrator) (yeni adı Untrivial-ai) | 13.8k | Apache-2.0 | issue → worktree → ajan → PR yaşam döngüsü, ayrı inceleyici ajan, CI hatasını kendi düzeltme. Makaledeki ders: ajanlar onay beklerken 90 saniyeden fazla boşta kaldı. Bu yüzden onay bekleyen iş kuyruğu bloklamamalı |
| [generalaction/emdash](https://github.com/generalaction/emdash) | – | Apache-2.0 | Worktree başına `setup/run/teardown` betikleri ve port enjeksiyonu (`$EMDASH_PORT`), böylece paralel işler port çakıştırmaz. Bilet sistemlerinden iş alma |
| [microsoft/conductor](https://github.com/microsoft/conductor) | – | MIT | YAML ile tanımlı iş akışları: paralel gruplar, alt akışlar, koşullu dallanma. A2 hedef şablonları için örnek |
| [mraza007/baton](https://github.com/mraza007/baton) | – | MIT | Poller, Dispatcher ve Reconciler ayrımı, tek `WORKFLOW.md` dosyası. A7 iş kuyruğu için örnek |
| [kbwo/ccmanager](https://github.com/kbwo/ccmanager) | 1.3k | MIT | CLI çıktısından durum algılama (boşta / meşgul / girdi bekliyor), worktree oluşturma, birleştirme ve silme |
| [ryoppippi/ccusage](https://github.com/ryoppippi/ccusage) | 19.2k | MIT (doğrulanacak) | Claude Code ve Codex JSONL loglarından token ve maliyet. `--json` çıktısı A5'te çapraz kontrol için kullanılır |
| [promptfoo/promptfoo](https://github.com/promptfoo/promptfoo) | 26.5k | MIT | Ajan değerlendirmesi: YAML testleri, LLM hakem. A4'te skill ve ajan testleri için |
| [harbor-framework/harbor](https://github.com/harbor-framework/harbor) | 6.6k | Apache-2.0 | Görev biçimi: talimat + ortam + doğrulayıcı betik. `fa bench` görev seti bu biçimde yazılır |
| [openworkflowdev/openworkflow](https://github.com/openworkflowdev/openworkflow) | 1.3k | Apache-2.0 | Kalıcı adım ve tekrar oynatma semantiği. Kod alınmaz, zamanlayıcıya fikir olarak |
| [musistudio/claude-code-router](https://github.com/musistudio/claude-code-router) | 37.9k | MIT | Görev türüne göre model yönlendirme tablosu. Proxy trafiği gördüğü için kurulmaz, yalnız fikir |

Yalnız fikir alınacaklar:
- preset-io/agor (BSL 1.1): Tuval arayüzü.
- appsoftwareltd/vscode-agent-kanban (ELv2): Her turda bağlamın `AGENTS.md` dosyasıyla yeniden verilmesi.
- S4US/Roqer (AGPL).

Kullanılmayacaklar:
- stravu/crystal: Şubat 2026'da bırakıldı.
- vibe-kanban: Şirket kapattı, topluluk sürdürüyor.

Roblox araçları: [`ROBLOX.md`](ROBLOX.md).

## Instagram arşivinden (28 Ekim 2026)

| Repo | ★ | Lisans | Alınacak |
|---|---|---|---|
| [headroomlabs-ai/headroom](https://github.com/headroomlabs-ai/headroom) | 78k | Apache-2.0 | Log, JSON ve araç çıktısı sıkıştırma (kütüphane, proxy ya da MCP). A3'te denenecek |
| [cloudflare/security-audit-skill](https://github.com/cloudflare/security-audit-skill) | 50.7k | MIT | Çok aşamalı güvenlik denetimi, doğrulanmış bulgular. A5 güvenlik kapısı |
| [latent-spaces/brag](https://github.com/latent-spaces/brag) | 19.2k | MIT | Projeden lansman videosu. A7 içerik paketi |
| [nightly-labs/openbot](https://github.com/nightly-labs/openbot) | 2.8k | Belirsiz | Yalnız fikir: ajan başına iş kuyruğu, dosya paylaşımı |
| [cheaper-inference/OmniRoute](https://github.com/cheaper-inference/OmniRoute) | 82k | MIT | **Kullanılmaz:** istemler üçüncü taraf sağlayıcılara gidiyor |
