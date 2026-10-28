# Gerçek motor denemesi (2026-10-28)

Geçici bir git deposunda (`mat.js`, tek fonksiyon) üç gerçek motorla küçük işler çalıştırıldı. Amaç: sahte adaptörlerle yazılmış testlerin gerçek CLI'larla da tuttuğunu görmek.

## Sonuçlar

| Motor | İş | Süre | Token (girdi / önbellek okuma / önbellek yazma / çıktı) | Sonuç |
|---|---|---|---|---|
| codex | `mat.js`'e `carp(a, b)` ekle (`fa run --worktree`) | 38,5 sn | 7.552 / 54.528 / 0 / 420 | Doğru, yalnız `mat.js` değişti |
| claude | `mat.js`'i incele, dosya değiştirme | 32 sn | 6 / 111.117 / 59.667 / 718 | Doğru; bir sorun buldu (aşağıda) |
| agy | Üç satırlık açıklama yaz | 52 sn | bilinmiyor | Doğru |

Akış uçtan uca çalıştı:

1. Görev kendi worktree'sinde ve `fa/<id>` dalında çalıştı.
2. Adım commit'lendi.
3. `fa merge` önce onay kartı açtı. Onaydan sonra güvenlik taraması temiz geçti, `carp(3,4) === 12` kontrolü koştu ve birleştirme yapıldı.
4. `fa verify` olay zincirinin sağlam olduğunu gösterdi.

## Bulgular ve yapılanlar

- **Aynı başlıklı iki commit.** Claude incelemesi, adım commit'i ile birleştirme commit'inin aynı mesajı taşıdığını yakaladı. Düzeltildi: birleştirme commit'i artık `fa: birleştir — <başlık>`.
- **agy token bildirmiyor.** Kullanım `known = 0` olarak kaydediliyor ve `fa status` "bilinmeyen kullanım: 1" gösteriyor. Bütçe sınırı agy için tahmine dayanıyor, kesin değil.
- **Claude'un önbellek yazımı büyük.** Küçük bir işte bile yaklaşık 60 bin token önbelleğe yazılıyor (sistem istemi ve araç tanımları). Bütçe bunu "kullanılan" sayıyor. Bu bilinçli bir seçim: ilk çağrı gerçekten bu kadar faturalanıyor.
- **Noesis izni.** Claude görevi Noesis'te arama yapmak istedi ama izin olmadığı için atladı. Bağlam zaten `fa` tarafından görev istemine ekleniyor, sorun değil.

## ccusage

`fa usage --ccusage <dosya|->` karşılaştırması yazıldı ve test edildi. ccusage'ı `npx` ile otomatik indirip çalıştırma girişimi bu oturumda izin denetimine takıldı. Elle çalıştırmak için:

```bash
npx ccusage@20.0.45 daily --json > ccusage.json
fa usage --ccusage ccusage.json
```

ccusage MIT lisanslı (npm kaydından doğrulandı). Makinedeki bütün Claude Code kullanımını saydığı için `fa`'nınkinden büyük çıkması normal. Bir gün `fa` ccusage'ı geçerse sayım hatası vardır.
