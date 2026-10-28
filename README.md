# feyzullah-agents

Genel amaçlı, çok ajanlı (multi-agent) yapay zekâ çalışma ortamı. Kod, araştırma, tasarım, oyun, içerik, veri ve ters mühendislik işlerini bir ajan ekibine dağıtır. [feyzullah-office](https://github.com/Bluetwinklez/feyzullah-office) temel alınarak geliştirilir.

## Nasıl çalışacak

1. Tek bir komut verirsin.
2. **Prompt Master** komutu netleştirir.
3. **Yönetici (Claude)** Noesis bilgi arşivinden bağlam çeker, işi parçalar ve uzmanlara dağıtır.
4. Uzmanlar paralel çalışır. Kod, test ve build işleri **Codex**'te, belge ve araştırma işleri **agy**'de.
5. **Kontrolcü** her işi kanıta bakarak denetler. Sonuç raporlanır, kalıcı bilgi arşive yazılır.

## Durum

**Aşama 0: plan ve ortam.** Henüz çalışan kod yok.

- [Plan ve aşamalar](docs/PLAN.md)
- [Veri kaynakları](docs/KAYNAKLAR.md)
- [Kararlar](docs/KARARLAR.md)
- [Benzer projeler](docs/BENZER-PROJELER.md)
- [Arayüz tasarımı: Santral](docs/tasarim/v2/README.md)
- Ajan kuralları: [CLAUDE.md](CLAUDE.md) / [AGENTS.md](AGENTS.md)

## Lisans

MIT
