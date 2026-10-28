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
| 5 | performans kapısı (`perf.luau`) | `lune` ve `default.project.json` varsa |

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
- Performans kapısı (katman 5): `lune` varsa `rojo build` ile geçici klasöre yer dosyası üretilir, `perf.luau` Part ve instance sayar. Part sayısı `perf.maxParts` eşiğini aşarsa kontrol düşer. Sınır: yalnız Rojo ağacındaki nesneler sayılır. Çalışma anında kodla üretilen harita ve Studio'da elle kurulan yer sayılmaz (sokak-oyunu ölçümü: 48 instance, 0 Part). Yükleme süresi (`perf.maxLoadSeconds`) Studio gerektirdiği için kendiliğinden ölçülmez.

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

## Kalan işler (backlog)

`fa roblox backlog`, `roblox-sokak-oyunu` için kalan işleri açar (kaynak: `packages/roblox/kalan.js`). Sekiz hedef, 45 iş; hepsi `backlog`, hiçbiri kendiliğinden çalışmaz. Aynı komutu tekrar çalıştırmak çoğaltmaz.

| Hedef | İş | İçerik |
|---|---|---|
| 8. adım Araç: kontrol-8 düzeltmeleri | 10 | Engelleyici E1 (süreye bağlı adım sınırı) ve E2 (yatay/düşey hız), E3–E7 belge ve bayrak düzeltmeleri, üretim sırası tablosunu gerçek duruma getirme, yeniden kontrol |
| 9–14. adımlar (Çatışma, Soygun, Ekip ve işletme, Öğretici ve ayarlar, Kozmetik ve ödeme, Yayın desteği) | 5'er | Tasarım belgesi → sunucu kodu → başsız testler → Studio listesi → bağımsız kontrol |
| Asset ve harita hazırlığı | 5 | Asset kaydı denetimi, harita planı, performans bütçesi, 5. aşama Studio planı, kontrol |

- Her iş bir `rb-*` uzmanına atanır ve kabul ölçütüyle gelir. Kod işleri katman 1–4 kontrolleriyle koşar.
- Sıra bağımlılıkla zorlanır: 9. adımın tasarımı, 8. adımın yeniden kontrolü bitmeden açılamaz; her adım bir öncekinin bağımsız kontrolünden sonra başlar. `fa roblox next <hedef>` her seferinde tek iş açar.
- Her işin istemine proje kuralları eklenir: sunucu otoritesi, yer tutucu değerlerin "kullanıcı kararı bekliyor" notu, Studio/DataStore/yayın işlerinin "kullanıcıya bırakıldı" kaydı, kapsam dışı içerik yok.
- Yayın ve ödeme işleri gerçek anahtar, Open Cloud çağrısı ya da yayın komutu yazmaz; ödeme kodu sahte MarketplaceService ile test edilir.
- `fa roblox backlog --decisions` yapay zekânın veremeyeceği 12 kararı ve yapamayacağı işleri listeler (derecelendirme, StreamingEnabled, asset sahipliği, ortamlar, denge değerleri, Studio doğrulamaları, yayın onayı...).

## Santral paneli

Çalışma alanı türünün paketi panel sunuyorsa (Roblox sunar) Santral'ın sağ sütununda "Üretim sırası" bloğu çıkar: her hedefin adımları, "Sıradakini aç" düğmesi (önceki adım bitmeden kapalı) ve autopilot anahtarı. Autopilot açıksa Santral geçen adımdan sonra sıradakini kendisi açar.

## Güvenlik kapısı

`fa merge` birleştirmeden önce dalın getirdiği değişikliği tarar (dış araç gerekmez):

- **Engel:** eklenen satırlarda gizli bilgi; riskli dosya adları (`.env`, `*.pem`, `*.key`, `id_rsa`, `credentials.json`, `.npmrc`...). `.env.example` serbest.
- **Uyarı:** `eval`/`new Function`, şablon dizgili `exec`, Luau `loadstring`, `HttpService` istekleri, kapalı TLS doğrulaması, `--dangerously-skip-permissions`.
- `--audit`: `npm audit` da çalışır (bağımlılık listesini npm kayıt sunucusuna gönderir, bu yüzden isteğe bağlı).
- Elle tarama: `fa security [<görev>] [--base <ref>]`.

## Kurulum ve ayarlar

- `tools/kur.ps1` (Windows) ve `tools/kur.sh`: Node 24+, git, motorlar ve Roblox araçlarını denetler, hiçbir şey kurmaz. `-Link` / `--link` ile `fa` komutunu `npm link` ile ekler.
- `FA_PORT`: `fa serve` için varsayılan port (`--port` önceliklidir).
- `fa usage [--ccusage <dosya|->]`: günlük Claude kullanımı ve ccusage karşılaştırması. Ayrıntı: [DENEME.md](DENEME.md).

## Kapsam dışı

- Ayrı iş kuyruğu: görevler ve rutinler bu işi görüyor.
