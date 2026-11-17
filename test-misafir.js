// Mail ile giriş KAPALIYKEN (misafir modu) denetim:  node test-misafir.js
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const Oyun = require('./public/oyun.js');
const PORT = 8096;
const sunucu = spawn(process.execPath, [path.join(__dirname, 'server.js')], { env: Object.assign({}, process.env, { PORT: String(PORT), DATABASE_URL: '', MAIL_GIRIS: '' }) });
let kayit = '';
sunucu.stdout.on('data', d => { kayit += d; }); sunucu.stderr.on('data', d => { kayit += d; });
let hata = 0;
const esit = (a, b, ad) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) hata++; console.log(ok ? 'TAMAM' : 'HATA ', ad, ok ? '' : `beklenen ${JSON.stringify(b)} gelen ${JSON.stringify(a)}`); };
const bekle = ms => new Promise(c => setTimeout(c, ms));
function istemci(cihaz, ad) {
  const h = () => ({ 'Content-Type': 'application/json', 'X-Cihaz': cihaz, 'X-Ad': encodeURIComponent(ad.v) });
  return {
    ad,
    get: y => fetch(`http://localhost:${PORT}${y}`, { headers: h() }).then(async r => Object.assign({ durum: r.status }, await r.json())),
    post: (y, g) => fetch(`http://localhost:${PORT}${y}`, { method: 'POST', headers: h(), body: JSON.stringify(g || {}) }).then(async r => Object.assign({ durum: r.status }, await r.json())),
  };
}
(async () => {
  for (let i = 0; i < 40 && !/çalışıyor/.test(kayit); i++) await bekle(250);
  esit((await fetch(`http://localhost:${PORT}/api/mod`).then(r => r.json())).mailGiris, false, 'mail ile giriş kapalı');
  const kod = await fetch(`http://localhost:${PORT}/api/giris/kod`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  esit(kod.status, 404, 'kod isteği kapalı');
  const ali = istemci('a1b2c3d4e5f6a7b8c9d0e1f2', { v: 'Ali' });
  const ben = await ali.get('/api/ben');
  esit([ben.durum, ben.hesap.ad, ben.hesap.misafir, ben.hesap.mail], [200, 'Ali', true, null], 'girişsiz misafir hesap, mail gizli');
  ali.ad.v = 'Ali Can';
  esit((await ali.get('/api/ben')).hesap.ad, 'Ali Can', 'ad serbestçe değişiyor');
  esit((await istemci('kisa', { v: 'X' }).get('/api/ben')).durum, 400, 'telefon kimliği olmadan olmuyor');
  // Günün bulmacası misafirle de kalıcı ve tek
  const g = await ali.get('/api/gunluk');
  const ayar = Oyun.ayarDuzelt({ basamak: g.basamak });
  let gecmis = [];
  for (let i = 0; i < 20; i++) { const r = await ali.post('/api/gunluk/sor', { gun: g.gun, tahmin: Oyun.botTahmin('zor', ayar, gecmis) }); gecmis = r.tahminler; if (r.benim) break; }
  esit((await ali.get('/api/gunluk')).siralama.map(x => x.ad), ['Ali Can'], 'misafir sıralamada');
  esit((await ali.post('/api/gunluk/sor', { gun: g.gun, tahmin: '1234' })).durum, 409, 'aynı telefon ikinci kez oynayamıyor');
  // Oda
  const ayse = istemci('ffeeddccbbaa99887766554433', { v: 'Ayşe' });
  const oda = await ali.post('/api/oda');
  await ayse.post('/api/katil', { kod: oda.kod });
  esit((await ayse.get(`/api/bekle?kod=${oda.kod}&surum=-1`)).durum.oda.oyuncular.map(o => o.ad), ['Ali Can', 'Ayşe'], 'odada adlar');
  // Yarış: klasikte 3. kişi giremez, yarışta girer; ilk bulan kazanır
  const can = istemci('0011223344556677889900aa', { v: 'Can' });
  const oda2 = await ali.post('/api/oda');
  await ayse.post('/api/katil', { kod: oda2.kod });
  esit((await can.post('/api/katil', { kod: oda2.kod })).durum, 409, 'klasik odaya 3. kişi giremez');
  await ali.post('/api/eylem', { kod: oda2.kod, tur: 'ayar', ayar: { oyunTuru: 'yaris' } });
  esit((await can.post('/api/katil', { kod: oda2.kod })).durum, 200, 'yarış odasına 3. kişi girer');
  esit((await ali.post('/api/eylem', { kod: oda2.kod, tur: 'ayar', ayar: { oyunTuru: 'klasik' } })).durum, 400, '3 kişiyken klasiğe dönülmez');
  await ali.post('/api/eylem', { kod: oda2.kod, tur: 'basla' });
  const yd = (await ayse.get(`/api/bekle?kod=${oda2.kod}&surum=-1`)).durum.mac;
  esit([yd.tur, yd.gizli, yd.oyuncular.length], ['yaris', null, 3], 'yarış başladı, sayı gizli');
  const yayar = Oyun.ayarDuzelt({ basamak: yd.ayar.basamak });
  let yg = [];
  for (let i = 0; i < 20; i++) {
    await can.post('/api/eylem', { kod: oda2.kod, tur: 'tahmin', sayi: Oyun.botTahmin('zor', yayar, yg) });
    const m = (await can.get(`/api/bekle?kod=${oda2.kod}&surum=-1`)).durum.mac;
    yg = m.ben.sorular;
    if (m.faz === 'bitti') break;
  }
  const son = (await ali.get(`/api/bekle?kod=${oda2.kod}&surum=-1`)).durum;
  esit([son.mac.faz, son.mac.sonuc.kazanan, son.oda.oyuncular.find(o => o.ad === 'Can').galibiyet], ['bitti', 'Can', 1], 'yarışta ilk bulan kazandı, skora yazıldı');
  esit((await ayse.post('/api/eylem', { kod: oda2.kod, tur: 'tahmin', sayi: '123' })).durum, 400, 'yarış bitince soru yok');
  sunucu.kill();
  console.log(hata ? `\n${hata} HATA` : '\nMisafir denetimleri geçti');
  process.exit(hata ? 1 : 0);
})().catch(e => { console.error(e, kayit); sunucu.kill(); process.exit(1); });
