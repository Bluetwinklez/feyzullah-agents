# feyzullah-agents: ajan talimatları

Bu repoda çalışan her ajan (Claude, Codex, agy) için kurallar. Codex ve agy aynı içeriği `AGENTS.md` dosyasından okur.

## Durum
Proje **planlama aşamasında**. Plan: `docs/PLAN.md`. Veri kaynakları: `docs/KAYNAKLAR.md`. Kararlar: `docs/KARARLAR.md`.
Bir aşamanın kodunu yazmaya ancak plan o aşama için onaylandıysa başla.

## Değişmez kurallar
- API anahtarı, jeton, şifre ya da kişisel veri repoya, loglara ve Noesis'e yazılmaz. `~/.feyzullah/` altından hiçbir dosya kopyalanmaz.
- `--dangerously-skip-permissions` kullanılmaz. İzinler hedefli verilir.
- CAPTCHA ve bot kontrolü atlatılmaz. Noesis'te "önerilmez" diye işaretlenmiş araçlar kullanılmaz.
- Push, silme, dış servise gönderme ve kredi harcama işleri kullanıcı onayı ister.
- Çalışan Ofis'in (`Desktop\claude\feyzullah-ofis`) dosyaları düzenlenmez, yalnızca okunur.

## Kod düzeni (aşama 1'den itibaren)
- Node 24, ESM, JavaScript + JSDoc. Testler `node --test`, `test/**/*.test.js`.
- Yorumlar ve kullanıcıya dönük metinler Türkçe. Office'teki stil korunur.
- Her aşama ayrı dalda ve ayrı PR'da. Testler geçmeden main'e alınmaz.
- Commit kimliği: `Bluetwinklez <144558175+Bluetwinklez@users.noreply.github.com>`.

## İş bölümü
- Claude: planlama, mimari, güvenlik, inceleme, son kontrol.
- Codex: kod, test, build, Krea görselleri.
- agy: belge ve araştırma (terminal komutu çalıştıramaz).
