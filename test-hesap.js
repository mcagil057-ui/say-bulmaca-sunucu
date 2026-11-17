// Hesap ve giriş denetimi:  node test-hesap.js
// Sunucuyu ayrı bir kapıda (8095) bellekteki veritabanıyla açar, akışı HTTP ile dener.
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const Oyun = require('./public/oyun.js');

const PORT = 8095;
const sunucu = spawn(process.execPath, [path.join(__dirname, 'server.js')], { env: Object.assign({}, process.env, { PORT: String(PORT), DATABASE_URL: '', BREVO_API_KEY: '', RENDER: '', YEREL_DENEME: '1', MAIL_GIRIS: '1' }) });
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
  esit([k.durum, 'yeni' in k], [200, false], 'kod istendi, hesap var mı yok mu söylenmiyor');
  const adsiz = await tel1.post('/api/giris/dogrula', { mail: 'ali@ornek.com', kod: k.deneme });
  esit([adsiz.durum, adsiz.adGerekli], [400, true], 'yeni hesapta ad isteniyor');
  const yanlis = await tel1.post('/api/giris/dogrula', { mail: 'ali@ornek.com', kod: '000000', ad: 'Ali' });
  esit(yanlis.durum, 400, 'yanlış kod reddediliyor');
  const tekrarKod = await tel1.post('/api/giris/kod', { mail: 'ali@ornek.com' });
  esit(tekrarKod.durum, 429, '1 dakika dolmadan yeni kod yok');

  // Aynı anda 300 tahmin: en çok 5'i kontrol edilmeli (deneme hakkı tek adımda düşer)
  const k2 = await tel1.post('/api/giris/kod', { mail: 'kurban@ornek.com' });
  const tahminler = Array.from({ length: 300 }, (_, i) => String(i).padStart(6, '0')).filter(t => t !== k2.deneme);
  const saldiri = await Promise.all(tahminler.map(kod => istemci('saldirgan', '', '7.7.7.7').post('/api/giris/dogrula', { mail: 'kurban@ornek.com', kod, ad: 'X' })));
  esit(saldiri.filter(r => /yanlış/i.test(r.hata || '')).length <= 5, true, 'aynı anda 300 tahminden en çok 5 tanesi kontrol ediliyor');
  const dogruKodSonra = await istemci('saldirgan', '', '7.7.7.7').post('/api/giris/dogrula', { mail: 'kurban@ornek.com', kod: k2.deneme, ad: 'X' });
  esit(!!dogruKodSonra.oturum, false, 'haklar bitince doğru kod da işe yaramıyor');

  // Bu testte yeni kod beklememek için doğru kodla gir
  const dg = await tel1.post('/api/giris/dogrula', { mail: 'ali@ornek.com', kod: k.deneme, ad: 'Ali' });
  esit([dg.durum, dg.hesap && dg.hesap.ad, !!dg.oturum], [200, 'Ali', true], 'hesap açıldı, oturum verildi');
  tel1.oturumKoy(dg.oturum);

  // Aynı tarayıcıda (aynı tel kimliği) başka hesap: kilitli
  const tel1Ayni = istemci('telefon-1-uygulama', 'v1|393x873|2.75|8|8|5|Linux|Europe/Istanbul|Mali', '88.1.1.1');
  const kilit = await tel1Ayni.post('/api/giris/kod', { mail: 'ikinci@ornek.com' });
  esit([kilit.durum, kilit.kilit], [403, true], 'aynı cihazda 14 gün başka hesap yok');
  // Aynı Wi-Fi'da AYNI MODEL başka telefon (aynı özellikler, başka tel kimliği): kilitlenmemeli
  const ikiz = istemci('ikiz-telefon', 'v1|393x873|2.75|8|8|5|Linux|Europe/Istanbul|Mali', '88.1.1.1');
  esit((await ikiz.post('/api/giris/kod', { mail: 'kardes@ornek.com' })).durum, 200, 'aynı evde aynı model telefon kilitlenmiyor');
  console.log('      mesaj:', kilit.hata);
  esit(/@/.test(kilit.hata), false, 'kilit mesajında başkasının maili yok');
  // Aynı telefon tarayıcıdan AYNI hesapla girebilir
  const ayniHesap = istemci('telefon-1-chrome-2', 'v1|393x873|2.75|8|8|5|Linux|Europe/Istanbul|Mali', '88.1.1.1');
  esit((await ayniHesap.post('/api/giris/kod', { mail: 'ali@ornek.com' })).durum !== 403, true, 'aynı telefon aynı hesapla tarayıcıdan girerken kilide takılmıyor');

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

  // Güvenlik: JSON dışı istek, başka siteden istek, girişsiz oda listesi, oda kodu tahmini, hesap başına tek oda
  const duz = await fetch(`http://localhost:${PORT}/api/giris/kod`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ mail: 'x@y.com', tel: 'a' }) });
  esit(duz.status, 415, 'JSON olmayan istek reddediliyor');
  const ops = await fetch(`http://localhost:${PORT}/api/giris/kod`, { method: 'OPTIONS' });
  esit([ops.status, ops.headers.get('access-control-allow-origin')], [405, null], 'başka sitelerden istek izni yok');
  esit((await fetch(`http://localhost:${PORT}/api/odalar`)).status, 401, 'oda listesi girişsiz görünmüyor');
  const sayfa = await fetch(`http://localhost:${PORT}/`);
  esit(/script-src 'self'/.test(sayfa.headers.get('content-security-policy') || '') && sayfa.headers.get('x-frame-options') === 'DENY', true, 'güvenlik başlıkları var');
  let sonKatil;
  for (let i = 0; i < 21; i++) sonKatil = await abla.post('/api/katil', { kod: 'ZZZ' + (i % 10) });
  esit(sonKatil.durum, 429, 'oda kodu tahmini sınırlı');
  const o1 = await tel1.post('/api/oda', {}), o2 = await tel1.post('/api/oda', {});
  esit((await tel1.post('/api/eylem', { kod: o1.kod, tur: 'basla' })).durum !== 200 && o1.kod !== o2.kod, true, 'yeni oda kurunca eski odadan çıkılıyor');

  // Çıkış
  await tel1.post('/api/cikis', {});
  esit((await tel1.get('/api/ben')).durum, 401, 'çıkıştan sonra oturum geçersiz');

  sunucu.kill();
  console.log(hata ? `\n${hata} HATA` : '\nHesap denetimleri geçti');
  process.exit(hata ? 1 : 0);
})().catch(e => { console.error(e, kayit); sunucu.kill(); process.exit(1); });
