// Kuralları ve botları denetler:  node test.js
const O = require('./public/oyun.js');
let hata = 0;
const esit = (a, b, ad) => {
  const s = JSON.stringify(a) === JSON.stringify(b);
  if (!s) { hata++; console.log('HATA', ad, 'beklenen', JSON.stringify(b), 'gelen', JSON.stringify(a)); }
};

// Kullanıcının verdiği örnekler
esit(O.puanla('426', '576'), { arti: 1, eksi: 0 }, '426/576');
esit(O.puanla('302', '203'), { arti: 1, eksi: 2 }, '302/203');
esit(O.puanla('426', '378'), { arti: 0, eksi: 0 }, '426/378');
const a3 = O.ayarDuzelt({});
esit(O.sayiHatasi('302', a3), null, 'geçerli');
esit(!!O.sayiHatasi('332', a3), true, 'tekrarlı rakam');
esit(!!O.sayiHatasi('012', a3), true, 'başta sıfır');
esit(O.sayiHatasi('012', O.ayarDuzelt({ basSifir: true })), null, 'başta sıfır serbest');
esit(O.tumSayilar(a3).length, 648, '3 basamak sayı adedi');

// Elle cevap modu: yanlış cevap hak düşürür, doğrusu kayda geçer
let saat = 0;
const m = new O.Mac({ turSure: 60, otoCevap: false }, ['A', 'B'], 0, () => saat);
m.gizliBelirle(0, '302'); m.gizliBelirle(1, '426');
esit(m.faz, 'oyun', 'oyun başladı');
esit(m.tahminEt(1, '576'), 'Sıra sende değil', 'sıra kontrolü');
m.tahminEt(0, '576');
m.cevapVer(1, 0, 1);                       // yanlış: doğrusu +1
esit(m.oyuncular[1].yanlis, 1, 'yanlış sayıldı');
esit(m.kayitlar[0].arti, 1, 'doğru cevap kayda geçti');
esit(m.kayitlar[0].verilen, { arti: 0, eksi: 1 }, 'verilen cevap saklandı');
m.tahminEt(1, '203'); m.cevapVer(0, 1, 2);
esit(m.oyuncular[0].yanlis, 0, 'doğru cevap hak düşürmez');
// Süre: soru süresi dolarsa sıra geçer
saat += 61000; m.sureKontrol();
esit(m.sira, 1, 'süre dolunca sıra geçti');
// Cevap süresi dolarsa yanlış sayılır
m.tahminEt(1, '378'); saat += 61000; m.sureKontrol();
esit(m.oyuncular[0].yanlis, 1, 'cevap süresi doldu = yanlış');
// Başlayan bulursa rakibe son şans; o da bulursa berabere
m.tahminEt(0, '426');
esit(m.sonSans, true, 'son şans');
m.tahminEt(1, '302');
esit(m.sonuc, { kazanan: -1, neden: 'berabere' }, 'berabere');

// 3 yanlışta kaybetme
const m2 = new O.Mac({ otoCevap: false }, ['A', 'B'], 0);
m2.gizliBelirle(0, '123'); m2.gizliBelirle(1, '456');
for (let k = 0; k < 3; k++) {
  m2.tahminEt(0, '789'); m2.cevapVer(1, 1, 0);
  if (m2.faz !== 'bitti') { m2.tahminEt(1, '789'); m2.cevapVer(0, 0, 0); }
}
esit(m2.sonuc, { kazanan: 0, neden: 'yanlis' }, '3 yanlışta kaybetti');

// Otomatik cevap (varsayılan): soru sorulunca cevap hemen yazılır, sıra geçer
esit(O.ayarDuzelt({}).otoCevap, true, 'varsayılan otomatik cevap');
const m3 = new O.Mac({}, ['A', 'B'], 0);
m3.gizliBelirle(0, '302'); m3.gizliBelirle(1, '426');
m3.tahminEt(0, '576');
esit([m3.kayitlar[0].arti, m3.kayitlar[0].eksi, m3.sira, m3.asama], [1, 0, 1, 'tahmin'], 'otomatik cevap +1');
esit(m3.cevapVer(1, 1, 0), 'Cevap beklenmiyor', 'otomatikte elle cevap yok');
m3.tahminEt(1, '203');
esit([m3.kayitlar[1].arti, m3.kayitlar[1].eksi], [1, 2], 'otomatik cevap +1 −2');
esit(m3.gorunum(0).gelenSorular.length, 1, 'gelen soru görünüyor');
esit(new O.Mac({}, ['A', 'B'], 0).id !== m3.id, true, 'her maçın kimliği ayrı');

// Maç analizi: Claude–Muhammed rövanşı (gizli 395)
const an = O.analizEt(O.ayarDuzelt({}), [['123', 0, 1], ['245', 1, 0], ['267', 0, 0], ['835', 1, 1], ['305', 2, 0], ['395', 3, 0]].map(([tahmin, arti, eksi]) => ({ tahmin, arti, eksi })));
esit(an.map(x => x.sonra), [228, 42, 12, 2, 1, 1], 'analiz: kalan ihtimaller');
esit(an.every(x => x.olabilirdi), true, 'analiz: hepsi tutarlı soru');
const an2 = O.analizEt(O.ayarDuzelt({}), [{ tahmin: '123', arti: 0, eksi: 0 }, { tahmin: '124', arti: 0, eksi: 0 }]);
esit(an2[1].olabilirdi, false, 'analiz: çelişkili soru yakalandı');

// Emoji tepkisi: yalnızca rakibin sorusuna, aynı emoji tekrar basılınca kalkar
const mt = new O.Mac({}, ['A', 'B'], 0);
mt.gizliBelirle(0, '123'); mt.gizliBelirle(1, '456'); mt.tahminEt(0, '789');
esit(mt.tepki(0, 1, '😮'), 'Kendi sorana tepki veremezsin', 'tepki: kendi sorusuna olmaz');
esit([mt.tepki(1, 1, '😮'), mt.kayitlar[0].tepki], [null, '😮'], 'tepki: rakibin sorusuna verildi');
esit(mt.tepki(1, 1, '💩'), 'Bu tepki yok', 'tepki: listede olmayan emoji olmaz');
mt.tepki(1, 1, '😮');
esit(mt.kayitlar[0].tepki, null, 'tepki: aynı emoji tekrar basılınca kalkar');
esit(O.ayarDuzelt({ turSure: 15 }).turSure, 15, 'hızlı mod: 15 sn tur');

// Yarış: 3 kişi, tek sayı, aynı anda; ilk bulan kazanır, oyun hemen biter
let ys = 0;
const y = new O.Yaris({ basamak: 3 }, [{ id: 'a', ad: 'Ali' }, { id: 'b', ad: 'Ayşe' }, { id: 'c', ad: 'Can' }], () => ys);
const g0 = y.gorunum('a');
esit([g0.gizli, g0.oyuncular.length, g0.ayar.oyunTuru], [null, 3, 'yaris'], 'yarış: sayı gizli, 3 oyuncu');
const yanlisSayi = O.tumSayilar(y.ayar).find(t => O.puanla(y.gizli, t).arti < 3);
ys = 5000; y.tahminEt('b', yanlisSayi);
esit(y.gorunum('a').oyuncular.find(o => o.ad === 'Ayşe'), { ad: 'Ayşe', ben: false, soru: 1, cekildi: false, sorular: null }, 'yarış: başkasının yalnızca soru sayısı görünür');
esit(y.tahminEt('b', yanlisSayi), 'Bu sayıyı zaten sordun', 'yarış: aynı sayı iki kez sorulmaz');
ys = 12000; y.tahminEt('c', y.gizli);
const gb = y.gorunum('a');
esit([gb.faz, gb.sonuc.kazanan, gb.sonuc.sure, gb.gizli === y.gizli], ['bitti', 'Can', 12000, true], 'yarış: ilk bulan kazanır, süre tutulur');
esit(y.tahminEt('a', yanlisSayi), 'Oyun bitti', 'yarış: bitince soru yok');
esit(gb.oyuncular.find(o => o.ad === 'Ayşe').sorular.length, 1, 'yarış: bitince herkesin soruları görünür');
esit(y.gorunum('c').sonuc.kazanan, 'ben', 'yarış: kazanana "ben"');
const y2 = new O.Yaris({}, [{ id: 'a', ad: 'A' }, { id: 'b', ad: 'B' }]);
y2.cekil('a'); y2.cekil('b');
esit([y2.faz, y2.sonuc.kazanan], ['bitti', null], 'yarış: herkes çekilirse kazanan yok');

// Rozetler: 10 Bronz, 50 Gümüş, 100 Altın, 250 Elmas, 500 Efsane
const R = require('./public/rozet.js');
esit([R.seviye(9), R.seviye(10), R.seviye(49), R.seviye(50), R.seviye(500)], [-1, 0, 0, 1, 4], 'rozet basamakları');
const rz = R.rozetler({ galibiyet: 12, mac: 60, enUzunSeri: 0, yarisGalibiyet: 0 });
esit([rz[0].rozet.ad, rz[0].kalan, rz[1].rozet.ad, rz[2].rozet], ['Bronz', 38, 'Gümüş', null], 'rozet durumu ve kalan');
esit(R.enIyi({ galibiyet: 12, mac: 60 }), '🥈', 'adın yanındaki en iyi rozet');
esit(R.enIyi({}), '', 'rozet yoksa boş');

// Botlar: kaç soruda buluyorlar?
function botOlc(seviye, ayar, n) {
  ayar = O.ayarDuzelt(ayar);
  let top = 0, enCok = 0;
  const t0 = Date.now();
  for (let k = 0; k < n; k++) {
    const gizli = O.rastgeleSayi(ayar);
    const gecmis = [];
    for (;;) {
      const t = O.botTahmin(seviye, ayar, gecmis);
      const p = O.puanla(gizli, t);
      gecmis.push({ tahmin: t, arti: p.arti, eksi: p.eksi });
      if (p.arti === ayar.basamak) break;
      if (gecmis.length > 200) { hata++; console.log('HATA bot bitiremedi', seviye); break; }
    }
    top += gecmis.length; enCok = Math.max(enCok, gecmis.length);
  }
  const ms = (Date.now() - t0) / n;
  console.log(`${ayar.basamak} basamak ${seviye.padEnd(5)}: ortalama ${(top / n).toFixed(2)} soru, en çok ${enCok}, maç başı ${ms.toFixed(0)} ms`);
}
for (const s of ['kolay', 'orta', 'zor']) botOlc(s, { basamak: 3 }, s === 'zor' ? 100 : 300);
for (const s of ['orta', 'zor']) botOlc(s, { basamak: 4 }, 30);
botOlc('zor', { basamak: 5 }, 5);

console.log(hata ? `\n${hata} HATA` : '\nTüm denetimler geçti');
process.exit(hata ? 1 : 0);
