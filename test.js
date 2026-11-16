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

// Maç akışı: yanlış cevap hak düşürür, doğrusu kayda geçer
let saat = 0;
const m = new O.Mac({ turSure: 60 }, ['A', 'B'], 0, () => saat);
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
const m2 = new O.Mac({}, ['A', 'B'], 0);
m2.gizliBelirle(0, '123'); m2.gizliBelirle(1, '456');
for (let k = 0; k < 3; k++) {
  m2.tahminEt(0, '789'); m2.cevapVer(1, 1, 0);
  if (m2.faz !== 'bitti') { m2.tahminEt(1, '789'); m2.cevapVer(0, 0, 0); }
}
esit(m2.sonuc, { kazanan: 0, neden: 'yanlis' }, '3 yanlışta kaybetti');

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
