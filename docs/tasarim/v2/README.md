# Tasarım 02: Santral

Office'e benzemeyen yeni arayüz. Piksel ofis ve karakterler yok. Ana ekran bir **zaman çizelgesi**: her ajan bir satır, her görev bir çubuk. Hangi işin paralel yürüdüğü, hangisinin neyi beklediği ve nerede zaman kaybedildiği tek bakışta görülür.

- **Bağımlılık çizgileri:** DAG zamanlayıcının kurduğu sıra.
- **Makine kontrolü:** Önce test, lint ve dosya kontrolü yapılır. Gerekmiyorsa LLM incelemesi atlanır ve bu çizelgede görünür.
- **Onay kapıları:** Çizelgede elmas işaretiyle gösterilir (ör. Krea kredisi).
- **Noesis bağlamı:** Önbellekten gelen ya da riskli olduğu için elenen notlar.
- **Kazanç şeridi:** Süre ve token kazancı, `fa bench` ölçümünden gelecek.
- **Roller:** Piksel karakter yerine tek çizgili geometrik simgeler.
- **Motor renkleri:** Claude turuncu, Codex yeşil, agy kırmızı, Noesis mor.
- **Tema:** Açık ve koyu tema sistem ayarını izler.

**Boyut:** Tek dosya, yaklaşık 18 KB, harici JS yok. Yalnız çalışan görevler hareket eder. Bağımlılık çizgileri yalnız yerleşim değişince yeniden çizilir.

Önizleme: `node tools/tasarim-sunucu.mjs`, ardından http://127.0.0.1:4173/v2/santral.html

Tasarım 01 (`../dashboard.html`, piksel ofis) arşivde kalıyor ama ana yön artık Santral.
