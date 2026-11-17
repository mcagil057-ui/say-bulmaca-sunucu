// Hesap ve giriş denetimi:  node test-hesap.js
// Sunucuyu ayrı bir kapıda (8095) bellekteki veritabanıyla açar, akışı HTTP ile dener.
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const Oyun = require('./public/oyun.js');

const PORT = 8095;
const sunucu = spawn(process.execPath, [path.join(__dirname, 'server.js')], { env: Object.assign({}, process.env, { PORT: String(PORT), DATABASE_URL: '', BREVO_API_KEY: '', RENDER: '' }) });
let kayit = '';
sunucu.stdout.on('data', d => { kayit += d; });
sunucu.stderr.on('data', d => { kayit += d; });

let hata = 0;
const esit = (a, b, ad) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) hata++;
  console.log(ok ? 'TAMAM' : 'HATA ', ad, ok ? '' : `beklenen ${JSON.stringify(b)} gelen ${JSON.stringify(a)}`);
};
const bekle = ms => new Promise(c => setTimeout(c, ms));

function istemci(tel, iz, ip) {
  let oturum = '';
  const basliklar = () => ({ 'Content-Type': 'application/json', 'X-Forwarded-For': ip, 'X-Oturum': oturum });
  const post = (yol, govde) => fetch(`http://localhost:${PORT}${yol}`, { method: 'POST', headers: basliklar(), body: JSON.stringify(Object.assign({ tel, iz }, govde)) })
    .then(async r => Object.assign({ durum: r.status }, await r.json()));
  const get = yol => fetch(`http://localhost:${PORT}${yol}`, { headers: basliklar() }).then(async r => Object.assign({ durum: r.status }, await r.json()));
  return {
    post, get,
    async gir(mail, ad) {
      const k = await post('/api/giris/kod', { mail });
      if (k.durum !== 200) return k;
      const d = await post('/api/giris/dogrula', { mail, kod: k.deneme, ad });
      if (d.oturum) oturum = d.oturum;
      return d;
    },
    oturumSil() { oturum = ''; },
    oturumKoy(o) { oturum = o; },
  };
}

(async () => {
  for (let i = 0; i < 40 && !/çalışıyor/.test(kayit); i++) await bekle(250);

  const tel1 = istemci('telefon-1-uygulama', 'v1|393x873|2.75|8|8|5|Linux|Europe/Istanbul|Mali', '88.1.1.1');
  esit((await tel1.get('/api/ben')).durum, 401, 'girişsiz istek reddediliyor');

  // Yeni hesap: önce ad sorulur, kod harcanmaz
  const k = await tel1.post('/api/giris/kod', { mail: 'Ali@Ornek.com' });
  esit([k.durum, k.yeni], [200, true], 'kod istendi, yeni hesap');
  const adsiz = await tel1.post('/api/giris/dogrula', { mail: 'ali@ornek.com', kod: k.deneme });
  esit([adsiz.durum, adsiz.adGerekli], [400, true], 'yeni hesapta ad isteniyor');
  const yanlis = await tel1.post('/api/giris/dogrula', { mail: 'ali@ornek.com', kod: '000000', ad: 'Ali' });
  esit(yanlis.durum, 400, 'yanlış kod reddediliyor');
  const tekrarKod = await tel1.post('/api/giris/kod', { mail: 'ali@ornek.com' });
  esit(tekrarKod.durum, 429, '1 dakika dolmadan yeni kod yok');

  // Bu testte yeni kod beklememek için doğru kodla gir
  const dg = await tel1.post('/api/giris/dogrula', { mail: 'ali@ornek.com', kod: k.deneme, ad: 'Ali' });
  esit([dg.durum, dg.hesap && dg.hesap.ad, !!dg.oturum], [200, 'Ali', true], 'hesap açıldı, oturum verildi');
  tel1.oturumKoy(dg.oturum);

  // Aynı telefon, tarayıcıdan (başka tel kimliği, aynı iz ve ağ) başka hesap: kilitli
  const tel1Site = istemci('telefon-1-chrome', 'v1|393x873|2.75|8|8|5|Linux|Europe/Istanbul|Mali', '88.1.1.1');
  const kilit = await tel1Site.post('/api/giris/kod', { mail: 'ikinci@ornek.com' });
  esit([kilit.durum, kilit.kilit], [403, true], 'aynı cihazda 14 gün başka hesap yok');
  console.log('      mesaj:', kilit.hata);
  // Aynı telefon tarayıcıdan AYNI hesapla girebilir
  const ayniHesap = istemci('telefon-1-chrome-2', 'v1|393x873|2.75|8|8|5|Linux|Europe/Istanbul|Mali', '88.1.1.1');
  esit((await ayniHesap.post('/api/giris/kod', { mail: 'ali@ornek.com' })).durum, 200, 'aynı telefon aynı hesapla tarayıcıdan da girebiliyor');

  // Aynı evde başka telefon: kendi hesabını açabilir
  const abla = istemci('telefon-2', 'v1|360x800|3.00|8|4|5|Linux|Europe/Istanbul|Adreno', '88.1.1.1');
  const ag = await abla.gir('abla@ornek.com', 'Abla');
  esit([ag.durum, ag.hesap && ag.hesap.ad], [200, 'Abla'], 'aynı evdeki başka telefon kendi hesabını açabiliyor');

  // İsim 3 günde bir
  const ad1 = await tel1.post('/api/ad', { ad: 'Ali Can' });
  esit(ad1.durum, 400, 'isim hemen değişmiyor (3 gün)');
  console.log('      mesaj:', ad1.hata);

  // Günün bulmacası hesaba bağlı
  const g = await tel1.get('/api/gunluk');
  const ayar = Oyun.ayarDuzelt({ basamak: g.basamak });
  let gecmis = [];
  for (let i = 0; i < 20; i++) {
    const r = await tel1.post('/api/gunluk/sor', { gun: g.gun, tahmin: Oyun.botTahmin('zor', ayar, gecmis) });
    gecmis = r.tahminler;
    if (r.benim) break;
  }
  const g2 = await tel1.get('/api/gunluk');
  esit([g2.toplam, g2.benim && g2.benim.ad], [1, 'Ali'], 'bulmaca çözüldü, sıralamada hesabın adı');
  const tekrar = await tel1.post('/api/gunluk/sor', { gun: g.gun, tahmin: '1234' });
  esit(tekrar.durum, 409, 'aynı hesap ikinci kez oynayamıyor');

  // Oda: oyuncu adı hesaptan gelir
  const oda = await tel1.post('/api/oda', {});
  await abla.post('/api/katil', { kod: oda.kod });
  const d = await abla.get(`/api/bekle?kod=${oda.kod}&surum=-1`);
  esit(d.durum.oda.oyuncular.map(o => o.ad), ['Ali', 'Abla'], 'odada adlar hesaptan');

  // Çıkış
  await tel1.post('/api/cikis', {});
  esit((await tel1.get('/api/ben')).durum, 401, 'çıkıştan sonra oturum geçersiz');

  sunucu.kill();
  console.log(hata ? `\n${hata} HATA` : '\nHesap denetimleri geçti');
  process.exit(hata ? 1 : 0);
})().catch(e => { console.error(e, kayit); sunucu.kill(); process.exit(1); });
