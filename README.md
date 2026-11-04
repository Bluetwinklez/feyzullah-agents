<p align="center"><img src="docs/logo/santral.svg" width="96" alt="Santral"></p>

# feyzullah-agents

Genel amaçlı, çok ajanlı (multi-agent) yapay zekâ çalışma ortamı. Kod, araştırma, tasarım, oyun, içerik, veri ve ters mühendislik işlerini bir ajan ekibine dağıtır. [feyzullah-office](https://github.com/Bluetwinklez/feyzullah-office) temel alınarak geliştirilir.

## Nasıl çalışacak

1. Tek bir komut verirsin.
2. **Prompt Master** komutu netleştirir.
3. **Yönetici (Claude)** Noesis bilgi arşivinden bağlam çeker, işi parçalar ve uzmanlara dağıtır.
4. Uzmanlar paralel çalışır. Kod, test ve build işleri **Codex**'te, belge ve araştırma işleri **agy**'de.
5. **Kontrolcü** her işi kanıta bakarak denetler. Sonuç raporlanır, kalıcı bilgi arşive yazılır.

## Durum

**Aşama 1–7 kodlandı** (çekirdek, yönetici, bilgi, uzmanlar, işletim, Santral, paketler). Kurulum denetimi: `tools/kur.ps1` (Windows) ya da `tools/kur.sh`. Testler: `npm test`. Komut: `fa` (`bin/fa.js`).

- [Paketler ve örnek akışlar](docs/PAKETLER.md)
- [Gerçek motor denemesi](docs/DENEME.md)

- [Plan ve aşamalar](docs/PLAN.md)
- [Veri kaynakları](docs/KAYNAKLAR.md)
- [Kararlar](docs/KARARLAR.md)
- [Benzer projeler](docs/BENZER-PROJELER.md)
- [Arayüz tasarımı: Santral](docs/tasarim/v2/README.md)
- Ajan kuralları: [CLAUDE.md](CLAUDE.md) / [AGENTS.md](AGENTS.md)

## Lisans

MIT
