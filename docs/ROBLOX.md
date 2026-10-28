# Roblox entegrasyonu

feyzullah-agents'ın ilk alan paketi Roblox. Amaç: Ofis'le yürütülen `roblox-sokak-oyunu` işini aynı kalitede, daha az elle müdahaleyle ve daha güvenli sürdürmek. Bunun için çalışma alanı türü `roblox` olarak tanımlanır.

## Kaynaklar

- **Yerel proje:** `Desktop\claude\roblox-sokak-oyunu`
  - Dosyalar: `rokit.toml` (rojo 7.4.4, selene 0.32.0, stylua 2.6.0), `default.project.json`, `selene.toml`, `stylua.toml`
  - Başsız testler: `tests/luau-runner.mjs` + `build/luau-0.743/luau.exe`, `tests/run-*.mjs`. Kanıtlar `tests/kanit/` altında.
  - `docs/uretim-sirasi.md`: 12 aşamalı kapı tablosu
  - `tests/studio-checklist.md`: Studio'da elle yapılacak kontroller
  - Remote: özel repo `Bluetwinklez/roblox-sokak-oyunu`. 28 Ekim 2026'da main ve bütün `ofis/*` dalları yedeklendi.
- **Durum** (bellek, 2026-10-21): 8. adımdan (Araç) sonra **durduruldu**. 9. adım (Çatışma) kullanıcı istemeden gönderilmeyecek. İçe aktarmada bu durum korunur.
- **Noesis:** "Roblox" kök sayfası (`0108e2a6-…`) ve 7 alt sayfası. İçerik: araç zinciri, kütüphaneler, MCP'ler, Open Cloud, asset'ler, önerilmeyenler.
- **Skill'ler:** `~/.claude/skills` ve `~/.codex/skills` altında 28 `roblox-*` skill.
- **Yeni araştırma** (28 Ekim 2026, GitHub API ve resmi belgeler): aşağıdaki tablolar.

## Doğrulama katmanları

Önce ucuz kontroller çalışır, en pahalısı en sona kalır. Her katman `checks.js` içinde bir komut listesidir.

| Katman | Araç | Komut | Gerektirdiği | Ne zaman |
|---|---|---|---|---|
| 1. Biçim ve lint | StyLua, selene | `stylua --check src`, `selene src` | `ROKIT_ROOT` | Her görevde |
| 2. Yapı | Rojo | `rojo build default.project.json -o build/game.rbxl` | – | Her görevde |
| 3. Tip | luau-lsp / `luau-analyze` | `luau-analyze src` | – | Her görevde |
| 4. Birim test (yerel) | Projenin luau-runner'ı | `node tests/run-*.mjs` | `luau.exe` | Her görevde |
| 5. Place dosyası dönüşümü | Lune (`@lune/roblox`) | `lune run scripts/<x>.luau` | Lune kurulumu (Rokit ile) | İsteğe bağlı |
| 6. Motor içi test | **rocale-cli** (resmi, MIT) + Jest-Lua | `rocale-cli run …` | Open Cloud anahtarı, **test place** | Birleştirmeden önce, **onaylı** |
| 7. Canlı oynatma | Studio'nun gömülü MCP'si | `start_stop_play`, `get_console_output`, `screen_capture` | Açık Studio | Elle ya da onaylı |
| 8. Performans | Lune ile `.rbxl` sayımı, Studio'da yükleme süresi | Part ve instance sayısı, `workspace` yükleme süresi | Lune / açık Studio | Harita ya da dünya değişince |

Performans kapısının nedeni: Bir Roblox strateji oyununda yaklaşık 15.000 Part dünyanın yüklenmesini 11 dakikaya çıkarmış. Geometri EditableMesh ile birleştirilince süre 15 saniyeye inmiş (Noesis: "Performans: binlerce Part yerine EditableMesh"). sokak-oyunu açık dünya olduğu için:
- Eşikler proje ayarında tutulur, örneğin `maxParts`, `maxLoadSeconds`.
- Eşik aşılırsa görev `in_review` olur ve `roblox-performance` rehberiyle düzeltme önerilir.

1–4 arası katmanlar bugün de makinede çalışıyor. 5 ve 6 için yeni kurulum ve anahtar gerekir.

Studio bu makinede kurulu (kullanıcı onayı, 28 Ekim 2026). Projenin README'sindeki "Studio yok" notu eskimiş. Bu yüzden 7. katman (Studio MCP ile canlı oynatma) A7'den **A5'e** çekildi:
- Studio açıksa birleştirme kapısında oynatma testi yapılır, konsol hatası ve ekran görüntüsü kanıt olarak kaydedilir.
- Studio kapalıysa kontrol `studio-checklist.md` desenine düşer ve "elle yapılacak" olarak işaretlenir.
- Bağlanmadan önce MCP'nin Assistant → Manage MCP Servers'tan açılması kullanıcıya bırakılır.

## Roller ve motorlar

Roller Ofis'teki ajanlardan ve `adim-gonder.mjs` dosyasındaki iş bölümünden gelir. Bu iş bölümü artık bir betiğin istem şablonunda değil, yapılandırmada durur.

| Departman | Rol | Motor | Skill'ler |
|---|---|---|---|
| Run | Yönetici | claude | roblox-architecture, roblox-game-design |
| Run | Prompt Master | claude | – |
| Build | Roblox Systems Scripter | codex | roblox-luau-*, roblox-networking, roblox-data, roblox-security |
| Build | Reality Checker | codex | roblox-publish-checklist, roblox-security |
| Build | Test yazarı | antigravity | roblox-tooling (yalnız test dosyası yazar, komut çalıştırmaz) |
| Design | UI Designer | codex | roblox-gui, roblox-input |
| Design | Game Designer | antigravity | roblox-game-design, roblox-player-psychology |
| Grow | Büyüme | antigravity | roblox-growth-design, roblox-analytics, roblox-monetization |
| Run | Ters Mühendis | claude | reverse-engineer-anything |

Görev şablonu: `uretim-sirasi.md` dosyasındaki aşamalar bir **hedef** (A2 `goals`) altında, sıralı görev zinciri olarak içe aktarılır. Her görevin kabul ölçütü o aşamanın kapı satırıdır.

## Otomatik ilerleme (autopilot)

Bellekteki kural koda dönüşür:

- Adım GEÇTİ olursa dal `--ff-only` ile main'e alınır ve sıradaki adım başlar.
- KALDI olursa bir düzeltme turu yapılır.
- Çalışma alanında `autopilot: false | true`. İçe aktarmada `false` gelir, çünkü proje durdurulmuş durumda.
- Onay yalnız güvenlik, ToS, Robux ya da kredi harcayan ve geri alınamaz işlerde istenir.

## Güvenlik kuralları

- **Open Cloud anahtarları:**
  - Ayrı ve en az izinli olurlar, yalnız test place'ine/universe'üne yetkilidir, IP kısıtlıdır.
  - Gereken kapsamlar: `universe.place.luau-execution-session:write`, ve test yüklemek için `universe-places:write`.
  - Windows Kimlik Yöneticisi'nde durur, sürece `ROBLOX_API_KEY` ortam değişkeniyle verilir. `--apiKey` komut satırına yazılmaz; süreç listesinde ve loglarda görünür.
  - Belge uyarısı: yazma izni eksik bir anahtar, değişikliği uygulamadan "başarılı" dönebilir. Değişiklik okunarak doğrulanır.
- **Yayın:** Mantle, rbxcloud ve Open Cloud ile yayın `roblox.publish` eylemidir ve her seferinde onaya gider. Yayın anahtarı ajanlara verilmez.
- **Studio MCP:** Açık place'i okuyup değiştirebilir. Riskli araçları onay ister:
  - `execute_luau` → `roblox.cloud_exec`
  - `insert_asset` → `roblox.insert_asset`

  Toolbox ve marketplace asset'lerinde gizli script olabilir; eklemeden önce `roblox-security` ile taranır.
- **Engelli liste** (`policy.js`, Noesis "Önerilmeyenler" sayfası):
  - executor MCP'leri (notpoiu, ExecRobloxMCP)
  - roblox-ai-bypass-plugin
  - adamenrem-jpg/Roblox-Live-Bridge-MCP
  - obfuscated 6xvl/robloxstudio-mcp
  - ZeroScript (tarayıcı köprüsü, GPL)
  - lisansı olmayan forge-context-engine ve RobloxForge-Intelligence
- **Yedek:** Özel repo `Bluetwinklez/roblox-sokak-oyunu`. Repo özel kalır, herkese açık yapılmaz. Ajanların push'u yine `git.push` onayına tabidir.

## Araç tablosu

| Araç | Lisans | Durum | Kullanım |
|---|---|---|---|
| Studio gömülü MCP | Roblox | Resmi, önerilen | Canlı oynatma, ekran görüntüsü, konsol |
| Chrrxs/robloxstudio-mcp | MIT | Aktif (342★) | Çok oyunculu test, çalışma anında hata ayıklama (isteğe bağlı) |
| Roblox/studio-rust-mcp-server, boshyxd/robloxstudio-mcp | MIT | **Arşivlenmiş** | Kullanılmaz |
| Rojo, Rokit, selene, StyLua, Lune, Wally | MPL-2.0 / MIT | Aktif | Araç zinciri |
| Roblox/rocale-cli | MIT | Resmi | Başsız motor içi test |
| Roblox/jest-roblox | MIT | Aktif | Motor içi birim test (TestEZ'in yerine) |
| Mantle | MIT | Aktif | Kod olarak altyapı, yayın (onaylı) |
| rbxcloud | MIT | Yavaşlamış | DataStore ve mesajlaşma (onaylı) |
| run-in-roblox | MIT | Eski | Kullanılmaz, rocale-cli tercih edilir |
| S4US/Roqer | AGPL-3.0 | – | Yalnız fikir: inşa, script ve playtest döngüsü |
| ProfileStore, zap, Fusion, jecs… | – | Noesis'te | Bilgi kartı olarak bağlama girer |

## Aşamalara dağılım

| Aşama | Roblox işi |
|---|---|
| A1 | `fa init --kind roblox`. Politika `roblox` yeteneği: rojo, selene, stylua, lune, rokit komut kalıpları. `ROKIT_ROOT` ortamı. `roblox.*` onay eylemleri |
| A2 | `uretim-sirasi.md` → hedef ve görev zinciri. Kapı satırları kabul ölçütü olur. Durdurulmuş durum korunur |
| A3 | Noesis Roblox kök sayfası ve creator-docs proje bilgi kaynağı olur. Kütüphane kartları FTS önbelleğine girer |
| A4 | Yukarıdaki rol tablosu `agents/roblox/*.md` olarak yazılır, 28 skill bağlanır |
| A5 | Doğrulama katmanları 1–4 ve Studio açıksa 7 (canlı oynatma) birleştirme kapısında çalışır. Autopilot (ff-only) ve engelli liste devreye girer |
| A6 | Santral'da Roblox paneli: aşama tablosu, kapı sonuçları, Studio kontrol listesi |
| A7 | rocale-cli ve test place (anahtar kullanıcıdan, onaylı). Mantle ile onaylı yayın |
