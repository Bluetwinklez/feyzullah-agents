# Tasarım 01: kontrol odası ve ajan karakterleri

- `dashboard.html`: çok ajanlı kontrol odası. Komut kutusu (Prompt Master), ekip listesi, akış (istek → Noesis → yönetici → uzmanlar → kontrol → rapor), görev panosu, motor bütçeleri, onay kapıları, Noesis bağlamı, olay kaydı.
- `karakterler.html`: 10 rol karakteri, durumlar (çalışıyor / izin / dinleniyor), çizim kuralları ve motor paleti.
- `sprites.js`: 16×16 piksel karakterler kodla çiziliyor. Yeni rol eklemek tek satır.
- `tema.css`: ortak renkler ve yazı tipleri (Pixelify Sans, Bricolage Grotesque, JetBrains Mono).

Veriler örnektir. Gerçek veriler aşama 2'de çekirdekten gelecek.

## Önizleme

```
node tools/tasarim-sunucu.mjs
```

Ardından http://127.0.0.1:4173/ (dashboard) ve http://127.0.0.1:4173/karakterler.html adreslerini aç.

## Tasarım kararları

- **Gece vardiyası:** espresso zemin, CRT tarama çizgileri, piksel gölgeler. Ofis'in piksel mirasını sürdürüyor ama standart "neon mor" AI görünümünden kaçınıyor.
- **Motor renkleri sabit:** Claude amber, Codex turkuaz, agy mercan, Noesis lavanta. Karakter rozeti, kart kenarı ve bütçe barı aynı rengi kullanıyor.
- **Noesis arşivcisi Feyzo:** feyzocode'un mor kedi maskotu.
- **Bütçe "can barı" gibi:** fikir pixel-agents'tan. Onay kapıları fikri Paperclip'ten.
