// feyzullah-agents karakter seti: 16×16 piksel, ortak gövde + role göre aksesuar katmanı.
// Harfler palete karşılık gelir; '.' saydam. Katmanlardaki '.' alttaki pikseli korur.

const BODY = [
  '....OOOOOOOO....',
  '...OHHHHHHHHO...',
  '..OHHHHHHHHHHO..',
  '..OHSSSSSSSSHO..',
  '..OSSSSSSSSSSO..',
  '..OSEESSSSEESO..',
  '..OSSSSSSSSSSO..',
  '..OSSSSWWSSSSO..',
  '...OSSSSSSSSO...',
  '....OOOSSOOO....',
  '..OOCCCCCCCCOO..',
  '.OCCCCCAACCCCCO.',
  '.OCCCCCAACCCCCO.',
  '.OSCCCCCCCCCCSO.',
  '.OOCCCCCCCCCCOO.',
  '..OOOOOOOOOOOO..',
];

const CAT = [
  '................',
  '..OO.......OO...',
  '.OPPO.....OPPO..',
  '.OPPPOOOOOPPPO..',
  '.OPPPPPPPPPPPO..',
  'OPPPPPPPPPPPPPO.',
  'OPPWEPPPPPWEPPO.',
  'OPPWEPPPPPWEPPO.',
  'OPPPPPPNPPPPPPO.',
  'OLLPPPPWPPPPLLO.',
  '.OPPPPPPPPPPPO..',
  '..OPPPPAAPPPO...',
  '..OPPPPAAPPPO...',
  '..OPPOPPPOPPO...',
  '..OOO.OOO.OOO...',
  '................',
];

const LAYERS = {
  crown:     { 0: '...Y..Y..Y..Y...', 1: '...YYYYYYYYYY...' },
  glasses:   { 5: '..OGEEGGGGEEGO..' },
  headset:   { 0: '...KKKKKKKKKK...', 4: '.KK..........KK.', 5: '.KK..........KK.', 6: '.KK..........KKA' },
  cap:       { 0: '...CCCCCCCCC....', 1: '..CCCCCCCCCCC...', 2: '..OAAAAAAAAAAAAA' },
  beret:     { 0: '....BBBBBBBB....', 1: '..BBBBBBBBBBBB..', 2: '.BBBBBBBBBBBB...' },
  visor:     { 5: '..OVVVVVVVVVVO..' },
  goggles:   { 4: '..KKKKKKKKKKKK..', 5: '..KGGKKKKKKGGK..' },
  headband:  { 3: '..OAAAAAAAAAAO..' },
  hood:      { 1: '..CCOHHHHHHOCC..', 2: '.CCOHHHHHHHHOCC.', 3: '.CCHSSSSSSSSHCC.', 4: '.CCSSSSSSSSSSCC.' },
};

const BASE_PAL = { O: '#1b1512', E: '#1b1512', W: '#fff4e0', G: '#d9e4ee', K: '#2b2f3a', Y: '#ffcc4d', V: '#5ff3ff', N: '#ff8fb1', L: '#c9b8ff' };

/** Roller: motor rengi göğüs rozetinde (A). */
export const ENGINES = {
  claude: { name: 'Claude', color: '#ffb547', role: 'beyin' },
  codex: { name: 'Codex', color: '#3fd2b5', role: 'kod · test · build' },
  agy: { name: 'agy', color: '#ff7a5c', role: 'belge · araştırma' },
  noesis: { name: 'Noesis', color: '#b79bff', role: 'bilgi arşivi' },
};

export const CHARACTERS = [
  { id: 'prompt', name: 'Prompt Master', title: 'İstek netleştirici', engine: 'claude', layers: ['headband'], pal: { H: '#3b2a4a', S: '#f2c9a0', C: '#4a3b6b', A: '#ffb547' },
    job: 'Ham isteği yöneticinin anlayacağı net bir göreve çevirir. İş yapmaz, yalnız yazar.' },
  { id: 'yonetici', name: 'Yönetici', title: 'Planlayıcı · koordinatör', engine: 'claude', layers: ['crown'], pal: { H: '#2a1d14', S: '#d9a77a', C: '#26324a', A: '#ffb547' },
    job: 'Noesis bağlamını okur, işi böler, uzman işe alır ya da çıkarır, sonunda rapor yazar.' },
  { id: 'arastirmaci', name: 'Araştırmacı', title: 'Bilgi keşfi', engine: 'agy', layers: ['glasses'], pal: { H: '#6b3a1f', S: '#f0c49b', C: '#2f4a3a', A: '#ff7a5c' },
    job: 'Web ve belge araştırması, doğrulama, kaynaklı özet. Terminal komutu çalıştırmaz.' },
  { id: 'kodcu', name: 'Kodcu', title: 'Uygulama', engine: 'codex', layers: ['hood', 'headset'], pal: { H: '#111318', S: '#c98f63', C: '#233a3a', A: '#3fd2b5' },
    job: 'Kod yazar, testleri çalıştırır, build alır. Her iş kendi git dalında.' },
  { id: 'veri', name: 'Veri Analisti', title: 'Veri ve tahmin', engine: 'codex', layers: ['cap'], pal: { H: '#3a2a1a', S: '#e6b48a', C: '#1f3d5c', A: '#3fd2b5' },
    job: 'Veri çeker, temizler, model kurar ve grafik üretir (ör. basketbol tahmin).' },
  { id: 'yazar', name: 'Yazar', title: 'Metin ve içerik', engine: 'agy', layers: ['beret'], pal: { H: '#8a4b2a', S: '#f5d0ab', C: '#5c2f3a', A: '#ff7a5c', B: '#c4453b' },
    job: 'Rapor, README, Instagram metni ve belge yazar. Bulguları okunur hale getirir.' },
  { id: 'tasarimci', name: 'Tasarımcı', title: 'Arayüz ve görsel', engine: 'codex', layers: ['beret', 'glasses'], pal: { H: '#e86a9a', S: '#f2c9a0', C: '#2d2a4a', A: '#3fd2b5', B: '#3fd2b5' },
    job: 'Arayüz, logo ve görsel üretir. Krea yalnız Codex üzerinden, kredi harcamadan önce onay ister.' },
  { id: 'kontrolcu', name: 'Kontrolcü', title: 'Reality Checker', engine: 'codex', layers: ['visor'], pal: { H: '#d8d2c4', S: '#c98f63', C: '#3a2f2a', A: '#3fd2b5' },
    job: 'İddiaya değil kanıta bakar. KARAR: PASS ya da NEEDS WORK. En fazla 2 düzeltme turu.' },
  { id: 'tersmuh', name: 'Ters Mühendis', title: 'Çözümleme (REA)', engine: 'claude', layers: ['goggles'], pal: { H: '#4a4a4a', S: '#e0b088', C: '#2a2a2a', A: '#ffb547' },
    job: 'Binary, uygulama ve web paketlerini yalnız okuyarak çözümler. Yalnız izinli hedefler.' },
  { id: 'arsivci', name: 'Feyzo', title: 'Noesis arşivcisi', engine: 'noesis', cat: true, pal: { P: '#8b5cf6', A: '#ffcc4d' },
    job: 'Her görevden önce arşivi tarar, iş bitince kalıcı bilgiyi yeni sayfa olarak geri yazar.' },
];

function grid(ch) {
  const g = (ch.cat ? CAT : BODY).map((r) => r.padEnd(16, '.').slice(0, 16).split(''));
  for (const name of ch.layers ?? []) {
    for (const [y, row] of Object.entries(LAYERS[name])) {
      [...row.padEnd(16, '.').slice(0, 16)].forEach((c, x) => { if (c !== '.') g[y][x] = c; });
    }
  }
  return g;
}

/** Karakterin SVG'si (piksel başına 1 birim; boyut CSS ile). */
export function sprite(ch, { size = 64, cls = '' } = {}) {
  const pal = { ...BASE_PAL, B: ch.pal.A, ...ch.pal };
  let rects = '';
  grid(ch).forEach((row, y) => row.forEach((c, x) => {
    if (c !== '.' && pal[c]) rects += `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${pal[c]}"/>`;
  }));
  return `<svg class="sprite ${cls}" viewBox="0 0 16 16" width="${size}" height="${size}" shape-rendering="crispEdges" role="img" aria-label="${ch.name}">${rects}</svg>`;
}

export const byId = Object.fromEntries(CHARACTERS.map((c) => [c.id, c]));
