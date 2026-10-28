# Paketler

Paket, bir iş alanına (ör. Roblox) özel uzmanları, doğrulama kontrollerini ve içe aktarma araçlarını bir araya getirir. Çalışma alanının türü (`fa init --kind <tür>`) hangi paketin devreye gireceğini belirler.

## Yapı

```
packages/<ad>/
  paket.json      ad, açıklama, kinds, agents (klasör), module (JS), alan ayarları
  agents/*.md     pakete özel uzmanlar (agents/ ile aynı biçim)
  index.js        alan komutları (yalnız paketle gelenlerde)
```

- **Paketle gelen** paketler (`packages/`) JS modülü yükleyebilir.
- **Çalışma alanı paketleri** (`.feyzullah-agents/packages/`) yalnız bildirimseldir: uzman ekler, kod çalıştıramaz. Aynı adlı paketle geleni ezemez.
- `fa packages` yüklü paketleri, `fa agents --sync` çalışma alanı türüne göre paket uzmanlarını listeler.

## Roblox paketi

Ayrıntılar ve rol tablosu: [ROBLOX.md](ROBLOX.md). Pakette 9 `rb-*` uzman var. Hepsi engelli araç listesini bilir. Doğrulama katmanları:

| Katman | Komut | Ne zaman eklenir |
|---|---|---|
| 1 | `stylua --check`, `selene` | `stylua.toml` / `selene.toml` varsa |
| 2 | `rojo build ... -o build/game.rbxl` | `default.project.json` varsa |
| 3 | `luau-analyze` | araç PATH'te varsa |
| 4 | `node tests/run-*.mjs` | `tests/` altında varsa |

Windows'ta Rokit kökü bulunursa komutlar `set "ROKIT_ROOT=..."&&` ile başlar.

### Örnek akış

```bash
fa init --kind roblox          # çalışma alanı + 11 genel + 9 Roblox uzmanı
fa roblox layers               # projede hangi katmanların çalışacağını gösterir
fa roblox import               # docs/uretim-sirasi.md → her tablo bir hedef, her satır bir adım
fa goals                       # hedef kimliklerini gör
fa roblox next <hedef>         # sıradaki tek adımı açar (önceki bitmediyse açmaz)
fa run --worktree              # adım ayrı worktree'de çalışır, katman 1–4 kontrolleri koşar
fa merge <görev>               # onay kapısından geçer
```

Güvenlik:

- İçe aktarma **hiçbir adımı çalıştırmaz**. Bitmiş satırlar `done`, kalanlar `backlog` olur. Durdurulmuş bir proje kendiliğinden ilerlemez.
- `fa roblox autopilot on` açılmadıkça adımlar yalnız `fa roblox next` ile tek tek açılır. Autopilot kapalı gelir.
- Open Cloud anahtarları yalnız sır kasasında (`fa secret set`) durur ve ortam değişkeni olarak verilir. Yayınlama her seferinde onay ister.
- Performans kapısı (`perf.maxParts`, `perf.maxLoadSeconds`) manifestte tanımlı, ancak Lune ölçüm betiği henüz yok (ertelendi).

## Genel akış (paketsiz)

```bash
fa init
fa goal "README'ye kurulum bölümü ekle"   # yönetici planlar, uzman atanır
fa approve <plan onayı>
fa run
fa status
```

## Taşıma ve işe alma

- `fa export [--out dosya.json]`: hedefler, görevler, belgeler, yorumlar, rutinler, bütçeler ve uzmanlar. Sır kasası, olay günlüğü, çalışma kayıtları ve yerel yollar dışarı çıkmaz. Metinler gizli bilgi filtresinden geçer.
- `fa import <dosya>`: kimlikleri korur, var olan kayıtları ezmez. İkinci aktarım bir şey eklemez.
- `fa hire`: son işlere bakıp eksik departman/motor ya da zorlanan uzman için öneri verir. `fa hire --write <id>` önerilen uzman dosyasını yazar.

## Ertelenenler

- Kurulum betikleri ve `FA_PORT` (#53), ccusage çapraz kontrolü (#58), güvenlik kapısı (#73, şimdilik `merge --check`), Roblox performans kapısı (#75), PoC bulguları (#80).
- Ayrı iş kuyruğu (görevler + rutinler bu işi görüyor) ve Santral'da Roblox paneli.
