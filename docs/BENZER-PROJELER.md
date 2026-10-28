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
