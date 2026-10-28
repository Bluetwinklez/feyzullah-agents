// Roblox "sokak oyunu" için kalan işler: kontrol-8 düzeltmeleri, kod sırası 9–14 ve asset/harita hazırlığı.
// Kaynak: roblox-sokak-oyunu belgeleri (uretim-sirasi, kapsam, oynanis-kurallari, teknik-kararlar) ve
// yapım kontrolü 8 bulguları (2026-10-21). Hiçbir iş kendiliğinden çalışmaz: `fa roblox backlog` bunları
// backlog olarak açar, sırayla `fa roblox next` ile açılır.

/**
 * @typedef {{key: string, title: string, agent: string, engine: 'codex'|'claude'|'antigravity', prompt: string, after?: string[],
 *   checks?: 'layers'|'none', review?: boolean}} Is
 * @typedef {{key: string, title: string, description: string, tasks: Is[]}} Hedef
 */

// Bütün işlere eklenen sabit kurallar (proje kuralları ve kullanıcı kararları).
const KURAL = [
  'Kurallar: AGENTS.md, CLAUDE.md ve docs/ okunur. Para, sahiplik, hasar ve ödül kararlarını sunucu verir; istemci yalnız girdi ve görsel geri bildirim.',
  'Açık sayısal değerler Config içinde "kullanıcı kararı bekliyor" notlu yer tutucu olur; denge doğrulanmış gibi sunulmaz.',
  'Studio, gerçek DataStore, Robux ve yayın gerektiren her şey "yapılmadı, kullanıcıya bırakıldı" diye kayda geçer; çalışıyormuş gibi yazılmaz.',
  'Kapsam dışı içerik eklenmez (kapsam.md). Her iddianın kanıtı tests/kanit/ altında komut çıktısıdır. Commit/merge yapma.',
].join('\n');

/** Bir kod adımının standart beş işi: tasarım → kod → test → Studio listesi → bağımsız kontrol. */
function adim({ n, k, ad, onceki, belge, tasarim, kod, test, studio, kontrol }) {
  const T = (s) => `${s}\n${KURAL}`;
  return {
    key: k,
    title: `${n}. adım: ${ad}`,
    description: `Kod geliştirme sırası ${n}. adım (${ad}). Önceki adımın bağımsız kontrolü geçmeden başlamaz.`,
    tasks: [
      { key: 'tasarim', title: `${ad}: tasarım belgesi`, agent: 'rb-game', engine: 'antigravity', checks: 'none', after: onceki ? [onceki] : [],
        prompt: T(`docs/${belge} dosyasını yaz (yalnız belge, kod yok). ${tasarim}\nkapsam.md ve oynanis-kurallari.md ile çelişme; çelişki bulursan belgeye "açık karar" olarak yaz.`) },
      { key: 'kod', title: `${ad}: sunucu kodu`, agent: 'rb-scripter', engine: 'codex', after: ['tasarim'],
        prompt: T(`${n}. adımı src/ içinde uygula, mevcut servis kalıplarını (Config, Net sözleşmesi, WithRollback, txnId) izle. ${kod}\ndocs/kod-temeli.md'ye bölüm ekle ve docs/uretim-sirasi.md ${n}. satırını "yapıldı, kontrol bekliyor" yap.`) },
      { key: 'test', title: `${ad}: başsız testler`, agent: 'rb-scripter', engine: 'codex', after: ['kod'],
        prompt: T(`tests/run-${k}.mjs ve tests/${k}.luau yaz, mevcut luau-runner ile çalıştır; önceki testleri bozma. ${test}\nTam çıktıyı tests/kanit/yapim-${n}-*.txt dosyalarına yaz. selene, stylua ve rojo build temiz olmalı.`) },
      { key: 'studio', title: `${ad}: Studio kontrol listesi`, agent: 'rb-test', engine: 'antigravity', checks: 'none', after: ['kod'],
        prompt: T(`tests/studio-checklist.md'ye ${ad} bölümü ekle: numaralı, tek tek yapılabilir adımlar, beklenen sonuç, "[ ] yapılmadı, kullanıcıya bırakıldı". ${studio}\nKodu değiştirme.`) },
      { key: 'kontrol', title: `${ad}: bağımsız kontrol`, agent: 'rb-reality', engine: 'codex', review: true, after: ['test', 'studio'],
        prompt: T(`Kod YAZMA. Bütün tests/run-*.mjs, selene, stylua ve rojo build'i kendin yeniden çalıştır; çıktıları tests/kanit/yapim-${n}-final-*.txt olarak yaz ve uzman çıktılarıyla karşılaştır. İstismar riskleri (çift ödül, istemciye güven, yarış durumu, çıkış kaçışı) ve belge-kod çelişkileri için kod satırı göster. ${kontrol}\nSonucu docs/inceleme/yapim-kontrol-${n}.md dosyasına yaz; son satır yalnız GEÇTİ ya da KALDI.`) },
    ],
  };
}

/** @type {Hedef[]} */
export const KALAN = [
  {
    key: 'arac-duzeltme',
    title: '8. adım Araç: kontrol-8 düzeltmeleri',
    description: 'Yapım kontrolü 8 sonucu KALDI (2026-10-21). Engelleyici E1 ve E2, ardından belge düzeltmeleri; sonunda yeniden kontrol.',
    tasks: [
      { key: 'e1', title: 'E1 araç: süreye bağlı adım sınırı', agent: 'rb-scripter', engine: 'codex',
        prompt: `VehicleService sanity kontrolünde sunucu takılması meşru sürücüyü cezalandırıyor. elapsed = clock() - record.lastSampleAt hesapla; izinli mesafe = maxSpeed * (1 + VehicleSpeedTolerance) * elapsed + Config.VehicleStepSlack olsun. Yeni Config.VehicleStepSlack (örnek 8 stud) "kullanıcı kararı bekliyor" notlu. Sabit adım sınırı kalkar. Adaptör testi: yoğun döngüyle taklit edilen 2 sn takılmadan sonra yanlış alarm yok.\n${KURAL}` },
      { key: 'e2', title: 'E2 araç: yatay ve düşey hız ayrımı', agent: 'rb-scripter', engine: 'codex', after: ['e1'],
        prompt: `Hız denetimi yalnız yatay bileşene bakmalı; düşey hız için ayrı Config.VehicleMaxVerticalSpeed ("kullanıcı kararı bekliyor") ya da yalnız sınır kontrolü. Bugün izinli hızın üç katı fark edilmeden geçiyor: kapat. Mevcut "production graybox builder with explicit engine objects" ile adaptör testi: yatay 64 + düşey -60 ihlal sayılmaz, yatay 81 ihlal sayılır, 8 stud'luk kenardan tam hızda düşüş uyarı vermez.\n${KURAL}` },
      { key: 'e6', title: 'E6 araç: gri kutu sabitleri notu', agent: 'rb-scripter', engine: 'codex',
        prompt: `PhysicsAdapter.luau:42-45, 69, 84 satırlarındaki gri kutu ölçü, sürtünme, esneklik ve koltuk yerleşimi sabitlerini ya tanım tablosuna taşı ya da yanlarına "yer tutucu ayar" notu düşür. Davranış değişmez; testler aynı sayıda geçmeli.\n${KURAL}` },
      { key: 'e4', title: 'E4 araç: çağırma girişi açık karar', agent: 'rb-game', engine: 'antigravity', checks: 'none',
        prompt: `araclar.md ve uretim-sirasi.md 8. satırına açık karar yaz: oyuncunun aracı nasıl çağıracağı (tuş, ProximityPrompt, arayüz) tanımsız; VehicleController.RequestSpawn'u çağıran bir giriş yok; "kullanıcı kararı bekliyor". Üç seçeneği artı/eksileriyle ve mobil/gamepad etkisiyle listele. Config.VehicleSpawnInput = "None" bayrağını öner (uygulamayı Scripter yapar).\n${KURAL}` },
      { key: 'e4-kod', title: 'E4 araç: VehicleSpawnInput bayrağı', agent: 'rb-scripter', engine: 'codex', after: ['e4'],
        prompt: `Config.VehicleSpawnInput = "None" bayrağını ekle ("kullanıcı kararı bekliyor" notlu); "None" iken çağırma yolu yalnız Server Command Bar'dır ve belgeye öyle yazılır. Test: bayrak "None" iken hiçbir istemci girişi spawn tetiklemez.\n${KURAL}` },
      { key: 'e5', title: 'E5 araç: yolcu sahipliği belgesi', agent: 'rb-game', engine: 'antigravity', checks: 'none',
        prompt: `araclar.md "Sahiplik ve sürüş" bölümüne yolcu karakterinin sürücünün sahip olduğu montajın parçası olduğunu ve sürücü istemcisinde simüle edildiğini yaz. studio-checklist.md madde 63'e gözlem ekle: yolcu indikten sonra p2.Character.HumanoidRootPart:GetNetworkOwner() == p2 mi.\n${KURAL}` },
      { key: 'e7', title: 'E7 işler: alım-teslim asgari mesafesi', agent: 'rb-game', engine: 'antigravity', checks: 'none',
        prompt: `isler.md'ye haritada alım ve teslim noktası arası en az yaklaşık 110 stud olması gerektiğini yaz (yoksa meşru araçlı teslim TooFast alır). Alternatif: JobService.luau:214'te etkileşim menzili kadar pay düşmek, Config kararı olarak öner.\n${KURAL}` },
      { key: 'e3', title: 'E3 araç: sağlamlık belgeleri', agent: 'rb-game', engine: 'antigravity', checks: 'none', after: ['e1', 'e2'],
        prompt: `kod-temeli.md:1298-1299, 1356 ve araclar.md "Sağlamlık" bölümünü yeni kurala göre güncelle (süreye bağlı adım sınırı, yatay hız). 80 stud/sn iddiasını yalnız kodun gerçekten sağladığı biçimde yaz. studio-checklist.md madde 65'e iki alt adım ekle: tam hızda 8 stud'luk kenardan düşüşte uyarı çıkmamalı; Server Command Bar'da kısa yoğun döngüyle (yaklaşık 2 sn) sunucu takılması taklit edildikten sonra sürüşte yanlış alarm olmamalı. Durum "[ ] yapılmadı, kullanıcıya bırakıldı".\n${KURAL}` },
      { key: 'tablo', title: 'Üretim sırası tablosunu gerçek duruma getir', agent: 'rb-game', engine: 'antigravity', checks: 'none',
        prompt: `docs/uretim-sirasi.md kod sırası tablosunda 6. ve 7. satır "yapıldı, kontrol bekliyor" duruyor; yapım-kontrol-6 ve yapim-kontrol-7 sonuçlarını oku. 7 için karar GEÇTİ (2026-10-21), tabloyu buna göre güncelle; 6 için raporun gerçek kararını yaz, eksik/uyuşmaz olanı uydurma. 8. satırı 8–14 satırından ayırıp "kontrol-8: KALDI, düzeltmeler sürüyor" yaz.\n${KURAL}` },
      { key: 'kontrol', title: '8. adım Araç: yeniden kontrol', agent: 'rb-reality', engine: 'codex', review: true, after: ['e1', 'e2', 'e3', 'e4-kod', 'e5', 'e6', 'e7', 'tablo'],
        prompt: `Kod YAZMA. Bütün tests/run-*.mjs, selene, stylua, rojo build'i yeniden çalıştır. E1 ve E2'yi sahte motorla yeniden dene: meşru sürüşte yanlış alarm yok, hız hilesi (izinli hızın üç katı) yakalanıyor. E3–E7 belgelerinin yapıldığını satır satır doğrula. Sonucu docs/inceleme/yapim-kontrol-8.md dosyasına ekle; son satır yalnız GEÇTİ ya da KALDI.\n${KURAL}` },
    ],
  },

  adim({ n: 9, k: 'catisma', ad: 'Çatışma', onceki: 'arac-duzeltme/kontrol', belge: 'catisma.md',
    tasarim: 'Kapsam: temel yakın dövüş ve sınırlı silah sistemi (ana döngüyü destekleyen, güvenli alanlarla sınırlı). Doğma noktasında ve temel hizmet alanlarında saldırı engellenir; başlangıç koruması kısa süreli ve oyuncu saldırıya katılınca biter; ölümde kalıcı eşya kaybı yok, devam eden riskli görev başarısız olabilir; yeniden doğma süresi. İçerik derecelendirmesi kararı bekliyor: silah ve şiddet düzeyini en düşük makul seviyede tut, kararı açık karar olarak yaz. Hasar tablosu, bekleme süreleri ve menzil Config yer tutucusu.',
    kod: 'CombatService: yakın dövüş (tek vuruş türü, bekleme süresi, menzil) ve tek sınırlı silah (sunucuda raycast; mermi/şarjör tüketimi envanterden). Saldırı isteği hedef taşımaz; sunucu hedefi mesafe ve görüş hattıyla doğrular. Güvenli alan etiketi ve başlangıç koruması sunucuda. Hasar, ölüm ve yeniden doğma sunucuda; ölümde eşya kaybı yok. AttackRequest için hız sınırı ve Validator. Hata durumunda ara durum kaydedilmez.',
    test: 'Senaryolar: güvenli alanda saldırı reddi, koruma süresi ve saldırıda bitişi, menzil/görüş hattı dışı vuruş reddi, hız sınırı, ölüm ve yeniden doğma, silah mermisinin tek sefer tüketimi, ölümde eşya kaybı olmaması.',
    studio: 'Telefon ve PC saldırı girdisi, güvenli alan sınırında davranış, iki oyunculu gerçek ağ gecikmesiyle vuruş, ölüm/yeniden doğma, yeniden giriş.',
    kontrol: 'Özellikle: istemciden gelen hedef/hasar değeri, güvenli alan kaçışı, koruma süresi istismarı, ölüm anında çift ödül/ceza, derecelendirme açık kararının kayıtlı olması.' }),

  adim({ n: 10, k: 'soygun', ad: 'Soygun', onceki: 'catisma/kontrol', belge: 'soygun.md',
    tasarim: 'Kapsam: tek market soygunu. Akış: hazırlık → etkileşim → kaçış → doğrulama → ödül. İlk sürümde süreli suç durumu (aranma); ayrıntılı polis simülasyonu sonraya kalır. Soygun ödülü yasal işlerle karşılaştırılacak ("?" kararı, Config yer tutucu). Oyundan çıkış kuralı: ödülü iki kez almaya ya da cezadan kaçmaya izin verilmez. Boş sunucuda da tek oyuncuyla oynanabilir olmalı. Derecelendirme açık kararına atıf yap.',
    kod: 'RobberyService durum makinesi (Prepared, Interacting, Escaping, Verifying, Rewarded/Failed) JobService/StateMachine kalıbıyla. Ödül Economy.Earn ile aynı txnId üzerinden tek sefer. Suç durumu sunucuda süreli, kalıcı bekleme/ceza kaydı v-sonraki şema göçüyle; oyuncu çıkıp girse ceza sürer (SubscribeBeforeRelease). Soygun noktası etiketi ve etkileşim doğrulaması (CanReach). Kaçış doğrulaması sunucuda ölçülen mesafe ve süreyle.',
    test: 'Senaryolar: çift ödül yok, yarım kalan soygunda çıkış cezadan kurtarmıyor, kaçış doğrulaması başarısız/başarılı, suç durumu süresi dolumu, ödül hatasında geri alma, hız sınırı ve Validator, tek oyuncu.',
    studio: 'Gerçek market noktası etiketleri, kaçış rotası, iki oyunculu etkileşim, çıkış/kapanış sırasında soygun, suç durumu göstergesi.',
    kontrol: 'Özellikle: çıkışla ceza kaçışı, ödül tekrarı, istemciden gelen kaçış/konum bilgisi, soygunun yasal işlerden anlamsız derecede kârlı olmaması (yer tutucu uyarısı).' }),

  adim({ n: 11, k: 'ekip', ad: 'Ekip ve işletme', onceki: 'soygun/kontrol', belge: 'ekip-isletme.md',
    tasarim: 'Kapsam: oturum içi basit ekip kurma ve ortak işletme görevi (işletmeye kalıcı ortak sahiplik sonraya). Akış: malzeme teslim et → stok doldur → görevi bitir → katkıya göre ödül. Liderin ayrılması: liderlik devredilir, devam eden görev güvenle sürer ya da kapanır. Tek başına oynamak da mümkün. Oyuncular arası para/eşya transferi kapsam dışı.',
    kod: 'TeamService (oluştur, katıl, ayrıl, lider devri, boyut sınırı) ve BusinessTaskService. Katkı sunucuda sayılır (teslim edilen malzeme/stok birimi); ödül dağıtımı tek WithRollback diliminde ve işlem kimliğiyle, çift dağıtım yok. Lider/üye çıkışında ödül ve ceza kuralı belgeye göre. İstemci yalnız istek gönderir; takım ve görev durumu sunucuda.',
    test: 'Senaryolar: lider ayrılınca devir, son oyuncu ayrılınca görev kapanışı, katkıya göre orantılı ödül ve toplamın sabit kalması, çift dağıtım yok, ödeme hatasında geri alma, tek oyunculu tamamlama, davet/katılma hız sınırı.',
    studio: 'İki ve üç gerçek oyuncu, lider çıkışı, ağ gecikmesi, kapanışta devam eden görev.',
    kontrol: 'Özellikle: katkı şişirme (aynı eşyayı iki kez sayma), ayrılıp dönerek ödül çoğaltma, para/eşya transferinin dolaylı yoldan açılması.' }),

  adim({ n: 12, k: 'ogretici', ad: 'Öğretici ve ayarlar', onceki: 'ekip/kontrol', belge: 'ogretici.md',
    tasarim: 'Kapsam: öğretici, ayarlar. Amaç: ilk oyun dakikalarında ana döngü (iş al → teslim et → para → satın al → kayıt) eksiksiz öğretilir. Atlanabilir, mobil/PC/gamepad girdisine uygun, İngilizce metinler ve çeviri yapısı (LocalizationService anahtarları). Ayarlar: ses, kontrol, titreşim, kalıcı. roblox-game-design ve roblox-player-psychology kurallarına göre ilk dakika denetimi yaz.',
    kod: 'Öğretici durum makinesi sunucuda (ilerleme PlayerData şemasında, göçle) ve istemci iskeleti: işlevsel, son arayüz değil. Ayarlar kalıcı ve sunucuda sınır doğrulamalı. Metinler anahtarla, İngilizce. GUI için roblox-gui ve roblox-input kurallarını izle (güvenli alan, dokunmatik hedef boyutu).',
    test: 'Senaryolar: öğretici ilerlemesi kalıcı, atlama, tekrar giriş, geçersiz ayar değeri reddi, ödül tekrarı yok (öğretici ödülü varsa), eski şemadan göç.',
    studio: 'Telefon, tablet, PC ve gamepad ile öğretici; metin taşması; küçük ekranda UI; yeniden giriş.',
    kontrol: 'Özellikle: öğretici ödülünün tekrar alınması, istemciden gelen ilerleme değeri, çeviri anahtarı eksikleri, mobilde erişilebilirlik.' }),

  adim({ n: 13, k: 'odeme', ad: 'Kozmetik ve ödeme (ProcessReceipt)', onceki: 'ogretici/kontrol', belge: 'kozmetik-odeme.md',
    tasarim: 'Kapsam: temel kozmetikler ve araç görünümleri (gelir modeli yalnız kozmetik). Developer Product ve GamePass tanımları, fiyatlar ve ID\'ler yer tutucu (gerçek ID yok). roblox-monetization kuralları: ödüllü rastgele ürün (paid random item) politikasına uygunluk, iade/telafi akışı, satın alma sonrası verme. Pay-to-win yok. Karar bekleyenleri (fiyat, ürün listesi) açık karar olarak yaz.',
    kod: 'CosmeticService (sahiplik, giyme, envanter entegrasyonu) ve PurchaseService. ProcessReceipt: PurchaseId ile idempotent, başarısızlıkta NotProcessedYet, başarıda tek sefer verme ve kayıt; oyuncu çıkmışsa sonra giriş yapınca yeniden denenir. Gerçek MarketplaceService çağrısı yok: sahte MarketplaceService ile test. Fiyat ve ID Config\'te "kullanıcı kararı bekliyor". Robux tutarı hiçbir istemci mesajıyla belirlenmez.',
    test: 'Senaryolar: aynı PurchaseId iki kez gelirse tek verme, verme hatasında NotProcessedYet ve sonra başarı, çıkmış oyuncu, sahip olunan kozmetiği tekrar verme, istemci sahte alım mesajı reddi, kayıt şeması göçü.',
    studio: 'Roblox test ortamında Developer Product/GamePass ile gerçek ProcessReceipt akışı (yalnız test universe\'inde ve kullanıcının yaptığı deneme), iade/telafi akışı, mobilde satın alma penceresi.',
    kontrol: 'Özellikle: ProcessReceipt çift verme, PurchaseId günlüğünün kalıcılığı, istemciye güven, paid random item uyumu, gerçek ID veya anahtarın depoya girmemesi (gizli bilgi taraması).' }),

  adim({ n: 14, k: 'yayin', ad: 'Yayın desteği', onceki: 'odeme/kontrol', belge: 'yayin.md',
    tasarim: 'Kapsam: yayına hazırlık, yayının kendisi değil. Ortam ayrımı (dev/test/live ayrı experience\'lar), roblox-publish-checklist kapıları, sürüm geri dönüşü, yedekten kurtarma, Open Cloud anahtar politikası (en az yetki, yalnız test place, anahtar yalnız işletim sistemi kasasında, depoya asla), analitik olay planı (ilk dakika hunisi, ekonomi akışı, rate limit), yerelleştirme hazırlığı, büyüme paketi (küçük resim, ilk 30 saniye vaadi). Her yayın ve her Open Cloud çağrısı kullanıcı onayı ister; belgeye açıkça yaz.',
    kod: 'AnalyticsService (AnalyticsService olayları: ilk dakika hunisi, ekonomi kaynak/harcama, iş tamamlama; olay başına hız sınırı, kişisel veri yok), ortam bayrağı (Config.Environment dev/test/live; live\'da test yardımcıları kapalı), sürüm/şema sürümü bilgisi. Hiçbir Open Cloud çağrısı, anahtar ya da yayın komutu yazılmaz.',
    test: 'Senaryolar: live ortamında test kancalarının kapalı olduğu, analitik olay şeması ve hız sınırı, kişisel veri içermemesi, ortam bayrağı yanlış değerde başlangıçta açık hata.',
    studio: 'Boş sunucu ve 16 oyuncuyla ilk dakika, ortam bayrağı, sürüm geri dönüşü denemesi (kullanıcı yapar), referans telefonda 30 FPS ve PC\'de 60 FPS ölçümü.',
    kontrol: 'Özellikle: depoda anahtar/jeton/ID sızıntısı (fa security ile de çalıştır), live ortamında test kancası, yayın komutu yazılmamış olması, publish-checklist maddelerinin her birine kanıt ya da "kullanıcıya bırakıldı".' }),

  {
    key: 'harita-hazirlik',
    title: 'Asset ve harita hazırlığı (üretim sırası 4–7)',
    description: 'Yapay zekânın belge ve doğrulama düzeyinde yapabileceği hazırlıklar. Modelleme, harita kurma ve Studio doğrulaması kullanıcıya/modelleyiciye kalır.',
    tasks: [
      { key: 'kayit', title: 'asset-kayit.csv tutarlılık denetimi', agent: 'rb-scripter', engine: 'codex',
        prompt: `art/asset-kayit.csv için Node betiği yaz (tools/ ya da tests/): 14 sütun adı ve sırası korunmuş mu, her yol diskte var mı, lisans ve kaynak dolu mu, kimlikler benzersiz mi, "izinli kaynak sözlüğü"ne (Krea / GPT Image / Gemini) uyuyor mu. Hataları satır numarasıyla listele; CSV'yi değiştirme. Çıktıyı tests/kanit/ altına yaz.\n${KURAL}` },
      { key: 'harita-plan', title: 'Harita yerleşim planı', agent: 'rb-game', engine: 'antigravity', checks: 'none',
        prompt: `docs/harita-plani.md: küçük ve yoğun mahalle (market, garaj, benzinlik, işletme, apartman çevresi), ana rotalar yürüyerek ve araç ölçüsüyle, alım-teslim çiftleri arası en az ~110 stud, soygun noktası ve kaçış rotası, güvenli alanlar, 16 oyuncu yoğunluğu, StreamingEnabled bölümlemesi (karar bekliyor, iki seçenekle yaz). Görsel referanslar docs/stil-rehberi.md ve art/concepts/. Harita dosyasına ve src/'ye dokunma.\n${KURAL}` },
      { key: 'butce', title: 'Performans bütçesi', agent: 'rb-scripter', engine: 'codex', after: ['harita-plan'],
        prompt: `docs/performans-butcesi.md: referans telefonda 30 FPS, referans PC'de 60 FPS, 16 oyuncu hedefleri için Part/MeshPart/instance sayısı, çizim çağrısı, doku belleği, kod tarafı (Heartbeat işleri, ağ trafiği) bütçeleri. Statik tekrar eden geometri için birleşik mesh/EditableMesh yaklaşımı (Noesis: "Performans: binlerce Part yerine EditableMesh"). roblox-performance kuralları. Rojo ağacındaki sayım perf.luau ile ölçülür; Studio ölçümleri "kullanıcıya bırakıldı". Kod değiştirme.\n${KURAL}` },
      { key: 'studio-5', title: '5. aşama Studio doğrulama planı', agent: 'rb-test', engine: 'antigravity', checks: 'none',
        prompt: `tests/studio-checklist.md 5. aşama bölümünü ölçülebilir hale getir: kapı geçişi, basamak yüksekliği, dar alanda kamera, modüler birleşme, araç ölçüsü, ışık altında kaplamalar, çoklu kopya performansı. Her madde için sayısal kabul eşiği (stud, FPS, ms) ve nasıl ölçüleceği. Hepsi "[ ] yapılmadı, kullanıcıya bırakıldı".\n${KURAL}` },
      { key: 'kontrol', title: 'Hazırlık belgelerinin bağımsız kontrolü', agent: 'rb-reality', engine: 'codex', review: true, after: ['kayit', 'harita-plan', 'butce', 'studio-5'],
        prompt: `Kod YAZMA. Üç belgeyi ve kayıt denetim çıktısını kapsam.md, teknik-kararlar.md ve stil-rehberi.md ile karşılaştır; çelişki, uydurma sayı ve kapsam dışı içerik bul. Sonucu docs/inceleme/harita-hazirlik-kontrol.md dosyasına yaz; son satır GEÇTİ ya da KALDI.\n${KURAL}` },
    ],
  },
];

/**
 * Yapay zekânın veremeyeceği kararlar ve yapamayacağı işler. Görev değil; kullanıcıya liste olarak gösterilir.
 * @type {{konu: string, secenekler: string, ne_zaman: string}[]}
 */
export const KARARLAR = [
  { konu: 'Araçla çağırma girişi', secenekler: 'Tuş / ProximityPrompt / arayüz düğmesi / yalnız komut çubuğu', ne_zaman: '8. adım yeniden kontrolünden önce (kod "None" ile geçer)' },
  { konu: 'İçerik derecelendirmesi', secenekler: 'Hedef yaş ve derece', ne_zaman: 'Çatışma (9) ve soygun (10) tasarımından önce' },
  { konu: 'StreamingEnabled', secenekler: 'Açık (öneri) / Kapalı', ne_zaman: 'Harita kurulmadan önce' },
  { konu: 'Asset sahipliği', secenekler: 'Kişisel hesap / Roblox grubu', ne_zaman: 'İlk asset yüklemesinden önce' },
  { konu: 'Ortamlar', secenekler: 'Ayrı dev / test / live experience\'lar (öneri)', ne_zaman: 'Yayın desteği (14) ve gerçek DataStore denemesinden önce' },
  { konu: 'Gri kutu prototip', secenekler: 'Evet / hayır', ne_zaman: 'Tam asset üretiminden önce (onay bekliyor)' },
  { konu: 'Denge değerleri', secenekler: 'Ödül, süre, bekleme, hız, aktif iş limiti, oturumlar arası iş, koruma ve suç durumu süreleri, fiyatlar', ne_zaman: 'Oynanabilir prototip testinden sonra' },
  { konu: 'Büyük kaynak dosyaları', secenekler: 'Git LFS / ayrı sürümlü depo', ne_zaman: 'Asset üretimi başlamadan' },
  { konu: 'Oyunun adı', secenekler: 'Çalışma adı: Sokak Oyunu', ne_zaman: 'Yayından önce' },
  { konu: 'Studio doğrulamaları', secenekler: 'Studio checklist\'lerinin tamamı (yapay zekâ yapamaz)', ne_zaman: 'Her adım kontrolünden sonra' },
  { konu: 'Gerçek DataStore ve ödeme denemesi', secenekler: 'Test ortamında kullanıcının yürüteceği deneme', ne_zaman: 'Ortamlar kararından sonra' },
  { konu: 'Yayın ve Open Cloud anahtarı', secenekler: 'Her yayın ve her anahtar kullanımı ayrı onay; anahtar yalnız işletim sistemi kasasında', ne_zaman: 'Yayın aşaması' },
];
