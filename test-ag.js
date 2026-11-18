// Günlük bulmacada ağ izi denetimi:  node test-ag.js
'use strict';
const G = require('./gunluk-sunucu.js');
const { depoAc } = require('./depo.js');
let hata = 0;
const esit = (a, b, ad) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) hata++; console.log(ok ? 'TAMAM' : 'HATA ', ad, ok ? '' : `beklenen ${JSON.stringify(b)} gelen ${JSON.stringify(a)}`); };

(async () => {
  const ev = G.agIzi('2026-11-18', '88.230.1.5');
  esit(ev, G.agIzi('2026-11-18', '88.230.1.5'), 'aynı gün aynı ağ: aynı iz');
  esit(ev === G.agIzi('2026-11-18', '88.230.1.6'), false, 'başka ağ: başka iz');
  esit(ev === G.agIzi('2026-11-19', '88.230.1.5'), false, 'ertesi gün aynı ağ: başka iz (günler arası izlenemez)');
  esit([ev.length, ev.includes('88.230'), /^[0-9a-f]+$/.test(ev)], [12, false, true], 'iz kısa, onaltılık, IP içermiyor');
  esit(G.agSinirGun('2026-11-01'), '2026-10-31', 'saklama sınırı dün (ay dönümü)');

  const d = await depoAc('');
  await d.agKaydet('2026-11-17', 1, 'aaa', 10);
  await d.agKaydet('2026-11-18', 1, 'aaa', 20);
  await d.agKaydet('2026-11-18', 1, 'aaa', 30);   // aynı kayıt ikinci kez yazılmaz
  await d.agKaydet('2026-11-18', 2, 'aaa', 40);
  await d.agKaydet('2026-11-16', 3, 'bbb', 50);
  esit((await d.agKayitlari('2026-11-18')).map(x => [x.hesapId, x.ag, x.ilk]), [[1, 'aaa', 20], [2, 'aaa', 40]], 'aynı ağdan iki hesap görünüyor, ilk zaman korunuyor');
  await d.agTemizle(G.agSinirGun('2026-11-18'));
  esit([(await d.agKayitlari('2026-11-16')).length, (await d.agKayitlari('2026-11-17')).length], [0, 1], 'iki günden eski izler silindi, dün kaldı');

  console.log(hata ? `\n${hata} HATA` : '\nAğ izi denetimleri geçti');
  process.exit(hata ? 1 : 0);
})();
