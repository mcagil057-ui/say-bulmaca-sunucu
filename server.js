/*
 * Sayı Bulmaca sunucusu — odaları tutar, iki oyuncuyu buluşturur.
 *
 * Hiçbir paket gerektirmez (yalnızca Node). Render'da `node server.js`.
 *
 *   GET  /api/bekle?kod=ABCD&id=..&surum=N   yeni durumu bekle (uzun bekleme)
 *   POST /api/oda    {id, ad}        yeni oda -> {kod}
 *   POST /api/katil  {kod, id, ad}   odaya gir
 *   POST /api/eylem  {kod, id, tur, ...}   (tur: mesaj = oyun içi sohbet)
 *   GET  /api/gunluk?id=..             günün bulmacası: gün, basamak, sıralama
 *   POST /api/gunluk/sor   {id, gun, tahmin}       -> {arti, eksi}
 *   POST /api/gunluk/bitti {id, ad, gun, tahminler} -> sıralamaya yazar
 *
 * Gizli sayılar YALNIZCA sunucuda durur; her oyuncuya kendi görmesi gereken
 * durum gönderilir. Rakibin sayısı oyun bitene kadar telefona hiç gelmez.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const Oyun = require('./public/oyun.js');

/**
 * Aynı Wi-Fi'daki telefonların açacağı adresler (ör. 192.168.1.20).
 * Sanal kartlar (VirtualBox, WSL) ve Tailscale (100.64.0.0/10) sona atılır:
 * telefon onlara ulaşamaz, ilk sırada görünürse yanlış adres yazdırır.
 */
function agAdresleri() {
  const sonuc = [];
  for (const [ad, liste] of Object.entries(os.networkInterfaces())) {
    for (const a of liste || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal || a.address.startsWith('169.254.')) continue;
      const [x, y] = a.address.split('.').map(Number);
      const yerel = x === 10 || (x === 192 && y === 168) || (x === 172 && y >= 16 && y <= 31);
      const sanal = /virtual|vbox|vmware|vethernet|wsl|hyper-v|docker|tailscale|zerotier/i.test(ad);
      sonuc.push({ adres: a.address, puan: (yerel ? 2 : 0) + (sanal ? -3 : 0) });
    }
  }
  return sonuc.sort((a, b) => b.puan - a.puan).map(a => a.adres);
}

const PORT = parseInt(process.env.PORT, 10) || 8080;
const KLASOR = path.join(__dirname, 'public');
const ODA_OMRU = 2 * 60 * 60 * 1000;   // 2 saat hareketsiz oda silinir
const HARFLER = 'ABCDEFGHJKLMNPRSTUVYZ23456789'; // karışan harfler (I, O, 0, 1) yok

const odalar = new Map();

function kodUret() {
  for (;;) {
    let k = '';
    for (let i = 0; i < 4; i++) k += HARFLER[crypto.randomInt(HARFLER.length)];
    if (!odalar.has(k)) return k;
  }
}
const temizAd = a => String(a || '').trim().slice(0, 16) || 'Oyuncu';
const temizId = a => String(a || '').slice(0, 64);

/*
 * Telefonlar durumu "uzun bekleme" ile alır: /api/bekle isteği, odada yeni
 * bir şey olunca hemen, olmazsa BEKLEME sonra cevaplanır; telefon hemen
 * yeniden sorar. Canlı akış (SSE) yerine bu yöntem seçildi çünkü
 * Cloudflare tüneli akışı biriktiriyor, telefon hiçbir şey alamıyordu
 * (ölçüldü: doğrudan 0,1 sn, tünelden 25 sn'de hiç veri yok).
 */
const BEKLEME = 25000;
const KOPMA = 12000;   // bu kadar süre sormayan oyuncu "bağlantı koptu" sayılır
const SOHBET_SINIR = 60;
const MESAJ_UZUNLUK = 120;

function oyuncuYap(id, ad) { return { id, ad, bekleyenler: new Set(), sonGorulme: Date.now() }; }
function bagliMi(o) { return o.bekleyenler.size > 0 || Date.now() - o.sonGorulme < KOPMA; }

function odaKur(id, ad) {
  const oda = {
    kod: kodUret(),
    ayar: Oyun.ayarDuzelt({}),
    oyuncular: [oyuncuYap(id, ad)],
    mac: null,
    macSayisi: 0,
    skor: {},            // oyuncu kimliği -> galibiyet sayısı (rövanşlar boyunca)
    berabere: 0,
    sohbet: [],          // {no, id, ad, metin} — son SOHBET_SINIR mesaj
    mesajNo: 0,
    surum: 0,
    zamanlayici: null,
    sonHareket: Date.now(),
  };
  odalar.set(oda.kod, oda);
  return oda;
}

function sira(oda, id) { return oda.oyuncular.findIndex(o => o.id === id); }

function durum(oda, i) {
  return {
    oda: {
      kod: oda.kod,
      ayar: oda.ayar,
      kurucuBen: i === 0,
      macNo: oda.macSayisi,
      oyuncular: oda.oyuncular.map((o, k) => ({ ad: o.ad, bagli: bagliMi(o), ben: k === i, galibiyet: oda.skor[o.id] || 0 })),
      berabere: oda.berabere,
      faz: oda.mac ? 'mac' : 'lobi',
    },
    sohbet: oda.sohbet.map(x => ({ no: x.no, ad: x.ad, metin: x.metin, ben: x.id === oda.oyuncular[i].id })),
    mac: oda.mac ? oda.mac.gorunum(i) : null,
    simdi: Date.now(),
  };
}

function cevapla(oda, i, yanit) {
  json(yanit, 200, { surum: oda.surum, durum: durum(oda, i) });
}

/** Odada bir şey değişti: bekleyen bütün telefonlara yeni durumu gönder. */
/** Biten maçı oda skoruna bir kez yaz. */
function skorIsle(oda) {
  const m = oda.mac;
  if (!m || m.faz !== 'bitti' || m.skorlandi) return;
  m.skorlandi = true;
  const k = m.sonuc.kazanan;
  if (k === -1) oda.berabere++;
  else if (oda.oyuncular[k]) { const id = oda.oyuncular[k].id; oda.skor[id] = (oda.skor[id] || 0) + 1; }
}

function yayinla(oda) {
  skorIsle(oda);
  oda.surum++;
  oda.sonHareket = Date.now();
  oda.bagliAnahtar = oda.oyuncular.map(bagliMi).join();
  oda.oyuncular.forEach((o, i) => {
    for (const b of o.bekleyenler) {
      clearTimeout(b.saat);
      o.bekleyenler.delete(b);
      o.sonGorulme = Date.now();
      cevapla(oda, i, b.yanit);
    }
  });
  zamanla(oda);
}

// Bir oyuncu sormayı bıraktıysa (telefon kapandı, internet gitti) rakibi görsün
setInterval(() => {
  for (const oda of odalar.values()) {
    if (oda.oyuncular.map(bagliMi).join() !== oda.bagliAnahtar) yayinla(oda);
  }
}, 4000).unref();

/** Tur süresi dolunca maçı ilerletmek için tek bir zamanlayıcı. */
function zamanla(oda) {
  clearTimeout(oda.zamanlayici);
  const m = oda.mac;
  if (!m || m.faz !== 'oyun' || !m.bitis) return;
  oda.zamanlayici = setTimeout(() => {
    if (m.sureKontrol()) yayinla(oda); else zamanla(oda);
  }, Math.max(0, m.bitis - Date.now()) + 30);
}

function yeniMac(oda) {
  // İlk maçta başlayan rastgele, rövanşlarda sırayla değişir.
  const baslayan = oda.macSayisi === 0 ? crypto.randomInt(2) : (oda.mac ? 1 - oda.mac.baslayan : 0);
  oda.macSayisi++;
  oda.mac = new Oyun.Mac(oda.ayar, oda.oyuncular.map(o => o.ad), baslayan);
}

function eylem(oda, i, v) {
  const m = oda.mac;
  switch (v.tur) {
    case 'ayar':
      if (i !== 0) return 'Ayarları odayı kuran değiştirir';
      if (m) return 'Maç sürerken ayar değişmez';
      oda.ayar = Oyun.ayarDuzelt(Object.assign({}, oda.ayar, v.ayar));
      return null;
    case 'basla':
      if (i !== 0) return 'Oyunu odayı kuran başlatır';
      if (oda.oyuncular.length < 2) return 'Rakip bekleniyor';
      if (m && m.faz !== 'bitti') return 'Maç zaten sürüyor';
      yeniMac(oda);
      return null;
    case 'rovans':
      if (!m || m.faz !== 'bitti') return 'Maç bitmedi';
      if (oda.oyuncular.length < 2) return 'Rakip odadan çıktı';
      yeniMac(oda);
      return null;
    case 'lobi':
      if (m && m.faz !== 'bitti') return 'Maç sürüyor';
      oda.mac = null;
      return null;
    case 'gizli': return m ? m.gizliBelirle(i, String(v.sayi)) : 'Maç yok';
    case 'tahmin': return m ? m.tahminEt(i, String(v.sayi)) : 'Maç yok';
    case 'cevap': return m ? m.cevapVer(i, v.arti, v.eksi) : 'Maç yok';
    case 'teslim': return m ? m.teslim(i) : 'Maç yok';
    case 'mesaj': {
      const o = oda.oyuncular[i];
      const metin = String(v.metin || '').replace(/\s+/g, ' ').trim().slice(0, MESAJ_UZUNLUK);
      if (!metin) return 'Mesaj boş';
      if (Date.now() - (o.sonMesaj || 0) < 600) return 'Biraz yavaş :)';
      o.sonMesaj = Date.now();
      oda.sohbet.push({ no: ++oda.mesajNo, id: o.id, ad: o.ad, metin });
      if (oda.sohbet.length > SOHBET_SINIR) oda.sohbet.shift();
      return null;
    }
    case 'ayril':
      if (m && m.faz !== 'bitti') m.teslim(i);
      for (const b of oda.oyuncular[i].bekleyenler) { clearTimeout(b.saat); json(b.yanit, 404, { hata: 'Odadan çıktın' }); }
      oda.oyuncular.splice(i, 1);
      oda.mac = null;
      if (!oda.oyuncular.length) { clearTimeout(oda.zamanlayici); odalar.delete(oda.kod); }
      return null;
    default: return 'Bilinmeyen eylem';
  }
}

// ------------------------------------------------------------------ HTTP
const TURLER = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.apk': 'application/vnd.android.package-archive' };

function json(yanit, kod, govde) {
  yanit.writeHead(kod, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
  yanit.end(JSON.stringify(govde));
}

function govdeOku(istek) {
  return new Promise((coz, red) => {
    let s = '';
    istek.on('data', p => { s += p; if (s.length > 2000000) { red(new Error('çok büyük')); istek.destroy(); } });
    istek.on('end', () => { try { coz(s ? JSON.parse(s) : {}); } catch (e) { red(e); } });
  });
}

function dosyaGonder(yanit, yol) {
  const tam = path.normalize(path.join(KLASOR, yol === '/' ? 'index.html' : yol));
  if (!tam.startsWith(KLASOR)) { yanit.writeHead(403); return yanit.end(); }
  fs.readFile(tam, (h, veri) => {
    if (h) { yanit.writeHead(404); return yanit.end('Bulunamadı'); }
    yanit.writeHead(200, { 'Content-Type': TURLER[path.extname(tam)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    yanit.end(veri);
  });
}

const sunucu = http.createServer(async (istek, yanit) => {
  const url = new URL(istek.url, 'http://x');
  const yol = url.pathname;
  try {
    if (istek.method === 'OPTIONS') {
      yanit.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET, POST' });
      return yanit.end();
    }
    if (yol === '/api/saglik') return json(yanit, 200, { tamam: true, oda: odalar.size, acilis: new Date(ACILIS).toISOString() });

    if (yol === '/api/gunluk' && istek.method === 'GET') return json(yanit, 200, gunlukDurum(temizId(url.searchParams.get('id'))));

    // Aynı ağdakilerin açacağı adres (oyunu kuran bilgisayarda gösterilir)
    if (yol === '/api/adres') {
      return json(yanit, 200, { adresler: agAdresleri().map(a => `http://${a}:${PORT}/`) });
    }

    // Rakip bekleyen odalar: yalnızca kimin oda açtığı görünür; girmek için kod gerekir (kod gönderilmez)
    if (yol === '/api/odalar') {
      const liste = [];
      for (const oda of odalar.values()) {
        const kurucu = oda.oyuncular[0];
        if (oda.oyuncular.length === 1 && !oda.mac && bagliMi(kurucu)) {
          liste.push({ ad: kurucu.ad, basamak: oda.ayar.basamak, turSure: oda.ayar.turSure });
        }
      }
      return json(yanit, 200, { odalar: liste.slice(0, 20) });
    }

    // Uzun bekleme: telefonun bildiği sürüm eskiyse hemen, değilse değişince cevap ver
    if (yol === '/api/bekle' && istek.method === 'GET') {
      const oda = odalar.get(String(url.searchParams.get('kod') || '').toUpperCase());
      const i = oda ? sira(oda, temizId(url.searchParams.get('id'))) : -1;
      if (i < 0) return json(yanit, 404, { hata: 'Oda bulunamadı' });
      const o = oda.oyuncular[i];
      const dondu = !bagliMi(o);           // bir süre kopmuştu, şimdi geri geldi
      o.sonGorulme = Date.now();
      if (parseInt(url.searchParams.get('surum'), 10) !== oda.surum) return cevapla(oda, i, yanit);
      const b = { yanit };
      b.saat = setTimeout(() => {
        o.bekleyenler.delete(b);
        o.sonGorulme = Date.now();
        cevapla(oda, i, yanit);
      }, BEKLEME);
      o.bekleyenler.add(b);
      istek.on('close', () => { clearTimeout(b.saat); o.bekleyenler.delete(b); });
      if (dondu) yayinla(oda);            // rakip "bağlandı" görsün
      return;
    }

    if (istek.method === 'POST' && yol === '/api/gunluk/devir') {
      // Her kayıt yeniden doğrulanır; uydurma sonuç sıralamaya giremez.
      const v = await govdeOku(istek);
      let alinan = 0;
      for (const k of Array.isArray(v.kayitlar) ? v.kayitlar.slice(0, 5000) : []) {
        if (k && typeof k.gun === 'string' && gunlukEkle(k.gun, temizId(k.id), k.ad, k.tahminler, +k.zaman || Date.now())) alinan++;
      }
      return json(yanit, 200, { alinan, acilis: ACILIS });
    }

    if (istek.method === 'POST' && yol.startsWith('/api/')) {
      const v = await govdeOku(istek);
      const id = temizId(v.id);
      if (!id) return json(yanit, 400, { hata: 'Kimlik yok' });

      if (yol === '/api/gunluk/sor') {
        const gun = bugun();
        if (v.gun !== gun) return json(yanit, 409, { hata: 'Gün değişti, yeni bulmaca başladı', gun });
        const t = String(v.tahmin || '');
        const h = Oyun.sayiHatasi(t, GUNLUK_AYAR);
        if (h) return json(yanit, 400, { hata: h });
        return json(yanit, 200, Oyun.puanla(gunlukGizli(gun), t));
      }
      if (yol === '/api/gunluk/bitti') {
        const gun = bugun();
        if (v.gun !== gun) return json(yanit, 409, { hata: 'Gün değişti', gun });
        if (!gunlukEkle(gun, id, v.ad, v.tahminler, Date.now())) return json(yanit, 400, { hata: 'Sonuç doğrulanamadı' });
        return json(yanit, 200, gunlukDurum(id));
      }

      if (yol === '/api/oda') {
        const oda = odaKur(id, temizAd(v.ad));
        return json(yanit, 200, { kod: oda.kod });
      }
      const oda = odalar.get(String(v.kod || '').toUpperCase());
      if (!oda) return json(yanit, 404, { hata: 'Bu kodla bir oda yok' });

      if (yol === '/api/katil') {
        const i = sira(oda, id);
        if (i >= 0) { oda.oyuncular[i].ad = temizAd(v.ad) || oda.oyuncular[i].ad; return json(yanit, 200, { kod: oda.kod }); }
        if (oda.oyuncular.length >= 2) return json(yanit, 409, { hata: 'Oda dolu' });
        oda.oyuncular.push(oyuncuYap(id, temizAd(v.ad)));
        yayinla(oda);
        return json(yanit, 200, { kod: oda.kod });
      }
      if (yol === '/api/eylem') {
        const i = sira(oda, id);
        if (i < 0) return json(yanit, 403, { hata: 'Bu odada değilsin' });
        const h = eylem(oda, i, v);
        if (h) return json(yanit, 400, { hata: h });
        if (odalar.has(oda.kod)) yayinla(oda);
        return json(yanit, 200, { tamam: true });
      }
      return json(yanit, 404, { hata: 'Yok' });
    }

    if (istek.method === 'GET') return dosyaGonder(yanit, decodeURIComponent(yol));
    yanit.writeHead(405); yanit.end();
  } catch (e) {
    console.error(e);
    if (!yanit.headersSent) json(yanit, 500, { hata: 'Sunucu hatası' });
  }
});

// ------------------------------------------------------------------ günün bulmacası
/*
 * Herkese aynı gizli sayı. Sayı tarihten ve gizli bir tuzdan hesaplanır:
 * sunucu yeniden başlasa da aynı kalır, telefona hiç gönderilmez.
 *
 * Sıralama bellekte durur; ücretsiz Render'da kalıcı disk yok. Kaybolmasın
 * diye iki yol var:
 *  1. Yeni sürüm yayınlanırken Render önce yeni sunucuyu açar, trafiği ona
 *     verir, sonra eskisine SIGTERM gönderir. Eski sunucu kapanmadan bütün
 *     kayıtları (soruları dahil) genel adrese, yani YENİ sunucuya gönderir.
 *  2. Telefon uygulama açılınca bugünkü sonucu sıralamada yoksa yeniden
 *     gönderir (sorular telefonda saklı, sunucu yeniden doğrular).
 */
const GUNLUK_AYAR = Oyun.ayarDuzelt({ basamak: 4 });
const GUNLUK_TUZ = process.env.GUNLUK_TUZ || 'sayi-bulmaca-gunun-sayisi';
const gunlukKayit = new Map();   // gun -> Map(id -> {ad, soru, zaman, tahminler})

/** Türkiye saatine göre bugünün tarihi: 2026-11-17 */
function bugun() { return new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10); }

function gunlukGizli(gun) {
  const h = crypto.createHmac('sha256', GUNLUK_TUZ).update(gun).digest();
  const tum = Oyun.tumSayilar(GUNLUK_AYAR);
  return tum[h.readUInt32BE(0) % tum.length];
}

function gunlukSonuclar(gun) {
  if (!gunlukKayit.has(gun)) {
    gunlukKayit.set(gun, new Map());
    for (const g of [...gunlukKayit.keys()].sort().slice(0, -3)) gunlukKayit.delete(g); // son 3 gün yeter
  }
  return gunlukKayit.get(gun);
}

/** Doğrulanmış bir çözümü sıralamaya ekle. Geçersizse false. */
function gunlukEkle(gun, id, ad, tahminler, zaman) {
  if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(gun) || gun > bugun()) return false;
  const liste = Array.isArray(tahminler) ? tahminler.map(String).slice(0, 200) : [];
  // Sunucu kendisi denetler: son tahmin gerçekten günün sayısı mı?
  if (!liste.length || liste[liste.length - 1] !== gunlukGizli(gun) || liste.some(t => Oyun.sayiHatasi(t, GUNLUK_AYAR))) return false;
  const sonuclar = gunlukSonuclar(gun);
  const eski = sonuclar.get(id);
  if (!eski) sonuclar.set(id, { ad: temizAd(ad), soru: liste.length, zaman, tahminler: liste });
  else if (zaman < eski.zaman) eski.zaman = zaman; // devirde ilk çözüm zamanı korunur
  return true;
}

/** Kapanırken sıralamayı genel adrese (yeni sürüme) gönder. */
async function siralamayiDevret() {
  const taban = (process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
  const kayitlar = [];
  for (const [gun, m] of gunlukKayit) for (const [id, x] of m) kayitlar.push({ gun, id, ad: x.ad, zaman: x.zaman, tahminler: x.tahminler });
  if (!taban || !kayitlar.length || typeof fetch !== 'function') return;
  // Trafik yeni sunucuya geçmemişse istek kendimize gelir: o zaman bekleyip yeniden dene.
  for (let deneme = 0; deneme < 8; deneme++) {
    try {
      const r = await fetch(taban + '/api/gunluk/devir', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kayitlar }),
        signal: AbortSignal.timeout(5000),
      }).then(x => x.json());
      if (r.acilis !== ACILIS) { console.log(`Sıralama yeni sürüme devredildi: ${r.alinan}/${kayitlar.length}`); return; }
    } catch (e) { /* yeni sunucu henüz hazır değil */ }
    await new Promise(c => setTimeout(c, 2500));
  }
  console.log('Sıralama devredilemedi');
}

let kapaniyor = false;
process.on('SIGTERM', async () => {
  if (kapaniyor) return;
  kapaniyor = true;
  await siralamayiDevret();
  process.exit(0);
});

function gunlukDurum(id) {
  const gun = bugun();
  const liste = [...gunlukSonuclar(gun).entries()]
    .map(([k, x]) => ({ ad: x.ad, soru: x.soru, zaman: x.zaman, ben: k === id }))
    .sort((a, b) => a.soru - b.soru || a.zaman - b.zaman);
  return { gun, basamak: GUNLUK_AYAR.basamak, basSifir: GUNLUK_AYAR.basSifir, siralama: liste.slice(0, 50), toplam: liste.length, benim: liste.find(x => x.ben) || null };
}

// ------------------------------------------------------------------ uyanık kalma
/*
 * Render'ın ücretsiz sunucusu 15 dk istek gelmezse uyur; ilk açılış ~1 dk
 * sürer ve bellekteki odalar/sıralama kaybolur. Sunucu 10 dakikada bir
 * kendi genel adresini yoklar: istek Render'ın dışından dolaşıp geldiği için
 * "trafik var" sayılır. Yerelde (RENDER_EXTERNAL_URL yoksa) çalışmaz.
 */
const ACILIS = Date.now();
if (process.env.RENDER_EXTERNAL_URL && typeof fetch === 'function') {
  const adres = process.env.RENDER_EXTERNAL_URL.replace(/\/$/, '') + '/api/saglik';
  setInterval(() => { fetch(adres).catch(() => { /* bir sonrakinde */ }); }, 10 * 60 * 1000).unref();
}

// Terk edilmiş odaları temizle
setInterval(() => {
  const sinir = Date.now() - ODA_OMRU;
  for (const [k, oda] of odalar) {
    const bagli = oda.oyuncular.some(bagliMi);
    if (!bagli && oda.sonHareket < sinir) { clearTimeout(oda.zamanlayici); odalar.delete(k); }
  }
}, 10 * 60 * 1000).unref();

sunucu.listen(PORT, () => {
  console.log('Sayı Bulmaca sunucusu çalışıyor.');
  console.log('  Bu bilgisayarda:     http://localhost:' + PORT);
  const ag = agAdresleri();
  if (ag.length) console.log('  Aynı Wi-Fi\'dakiler:  http://' + ag[0] + ':' + PORT + '   <- telefonda bunu aç');
  for (const a of ag.slice(1)) console.log('                       http://' + a + ':' + PORT);
});
