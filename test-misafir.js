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
  esit((await ali.post('/api/ad', { ad: 'Ali Can' })).hesap.ad, 'Ali Can', 'misafir adını değiştirebiliyor');
  ali.ad.v = 'Ali Can';
  // Aynı adı iki kişi alamaz (büyük/küçük harf ve Türkçe harf farkı sayılmaz)
  const veli = istemci('9999888877776666aaaabbbb', { v: 'ALİ CAN' });
  const veliBen = (await veli.get('/api/ben')).hesap.ad;
  esit(/^Oyuncu-/.test(veliBen), true, 'alınmış adla gelen yeni misafire başka ad veriliyor');
  esit((await veli.post('/api/ad', { ad: 'ali can' })).durum, 400, 'alınmış ad seçilemiyor');
  esit((await veli.post('/api/ad', { ad: 'Veli' })).hesap.ad, 'Veli', 'boş ad seçilebiliyor');
  veli.ad.v = 'Veli';
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
  // Yarış rekoru: kazanan listede bir kez, en iyi süresiyle
  await bekle(300);
  let rek = await ali.get('/api/yaris-siralama?basamak=' + yd.ayar.basamak);
  esit([rek.liste.length, rek.liste[0].ad, rek.liste[0].kisi], [1, 'Can', 3], 'yarış rekoru kaydedildi');
  await ali.post('/api/eylem', { kod: oda2.kod, tur: 'rovans' });
  yg = [];
  for (let i = 0; i < 20; i++) {
    await can.post('/api/eylem', { kod: oda2.kod, tur: 'tahmin', sayi: Oyun.botTahmin('zor', yayar, yg) });
    const m = (await can.get(`/api/bekle?kod=${oda2.kod}&surum=-1`)).durum.mac;
    yg = m.ben.sorular;
    if (m.faz === 'bitti') break;
  }
  await bekle(300);
  rek = await can.get('/api/yaris-siralama?basamak=' + yd.ayar.basamak);
  esit([rek.liste.length, rek.liste[0].ben, rek.benim], [1, true, 1], 'iki kez kazanan listede yine bir kez');
  // "Yazıyor": sıradaki oyuncu yazınca rakip görür
  const oda3 = await ali.post('/api/oda');
  await ayse.post('/api/katil', { kod: oda3.kod });
  esit((await ali.post('/api/eylem', { kod: oda3.kod, tur: 'yaziyor' })).durum, 200, 'yazıyor bildirildi');
  const ay = (await ayse.get(`/api/bekle?kod=${oda3.kod}&surum=-1`)).durum.oda.oyuncular.find(o => !o.ben);
  esit(Date.now() - ay.yaziyor < 5000, true, 'rakip yazıyor bilgisini görüyor');
  // Meydan okuma: Ali sayı tutar, Ayşe bağlantıyla oynar; Ali sonuçları görür
  const md = await ali.post('/api/meydan/olustur', { basamak: 3, sayi: '472' });
  esit(typeof md.id, 'string', 'meydan okuma oluşturuldu');
  esit((await ali.post('/api/meydan/sor', { id: md.id, tahmin: '123' })).durum, 400, 'kendi meydan okumasını oynayamaz');
  const ilkBakis = await ayse.get('/api/meydan?id=' + md.id);
  esit([ilkBakis.gizli, ilkBakis.sonuclar, ilkBakis.sahip], [null, null, 'Ali Can'], 'oynayan sayıyı ve sonuçları başta görmez');
  await ayse.post('/api/meydan/sor', { id: md.id, tahmin: '123' });
  const mb = await ayse.post('/api/meydan/sor', { id: md.id, tahmin: '472' });
  esit([mb.tahminler.length, mb.gizli, mb.sonuclar.length, !!mb.cozuldu], [2, '472', 1, true], 'oynayan bulunca sayıyı ve sonuçları görür');
  esit((await ayse.post('/api/meydan/sor', { id: md.id, tahmin: '123' })).durum, 409, 'aynı meydan okuma bir kez');
  const sahipBakis = await ali.get('/api/meydan?id=' + md.id);
  esit([sahipBakis.sahipBen, sahipBakis.sonuclar[0].ad, sahipBakis.sonuclar[0].soru], [true, 'Ayşe', 2], 'meydan okuyan sonuçları görür');
  esit((await ali.get('/api/meydanlarim')).liste[0].cozen, 1, 'gönderdiklerim listesi');
  esit((await ayse.get('/api/meydan?id=yokboyle')).durum, 404, 'olmayan meydan okuma');

  // İzleyici: oynamadan izler, sayıları göremez, sohbete yazabilir, oynayamaz
  const izleyen = istemci('1234123412341234abcdabcd', { v: 'Seyirci' });
  await izleyen.post('/api/ad', { ad: 'Seyirci' });
  const oda4 = await ali.post('/api/oda');
  await ayse.post('/api/katil', { kod: oda4.kod });
  esit((await izleyen.post('/api/izle', { kod: oda4.kod })).durum, 200, 'izleyici odaya girdi');
  await ali.post('/api/eylem', { kod: oda4.kod, tur: 'basla' });
  await ali.post('/api/eylem', { kod: oda4.kod, tur: 'gizli', sayi: '123' });
  await ayse.post('/api/eylem', { kod: oda4.kod, tur: 'gizli', sayi: '456' });
  const iz = (await izleyen.get(`/api/bekle?kod=${oda4.kod}&surum=-1`)).durum;
  esit([iz.oda.izleyici, iz.mac.izleyici, iz.mac.oyuncular.map(p => p.gizli)], [true, true, [null, null]], 'izleyici sayıları görmüyor');
  esit((await izleyen.post('/api/eylem', { kod: oda4.kod, tur: 'tahmin', sayi: '789' })).durum, 403, 'izleyici oynayamaz');
  esit((await izleyen.post('/api/eylem', { kod: oda4.kod, tur: 'mesaj', metin: 'Hadi Ali!' })).durum, 200, 'izleyici sohbete yazar');
  const aliGorur = (await ali.get(`/api/bekle?kod=${oda4.kod}&surum=-1`)).durum;
  esit([aliGorur.izleyiciSayisi, aliGorur.sohbet.slice(-1)[0].ad], [1, '👀 Seyirci'], 'oyuncu izleyiciyi ve mesajını görür');
  await ali.post('/api/eylem', { kod: oda4.kod, tur: 'teslim' });
  const izBitti = (await izleyen.get(`/api/bekle?kod=${oda4.kod}&surum=-1`)).durum;
  esit([izBitti.mac.faz, izBitti.mac.oyuncular.map(p => p.gizli)], ['bitti', ['123', '456']], 'oyun bitince izleyici sayıları görür');
  sunucu.kill();
  console.log(hata ? `\n${hata} HATA` : '\nMisafir denetimleri geçti');
  process.exit(hata ? 1 : 0);
})().catch(e => { console.error(e, kayit); sunucu.kill(); process.exit(1); });
