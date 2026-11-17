/*
 * Sayı Bulmaca sunucusu — odaları tutar, iki oyuncuyu buluşturur.
 *
 * Render'da `node server.js`. Hesaplar Neon Postgres'te (DATABASE_URL),
 * giriş kodu maili Brevo ile (BREVO_API_KEY, MAIL_GONDEREN). Bunlar yoksa
 * (bilgisayarda deneme) hesaplar bellekte durur, kod sunucu penceresine yazılır.
 *
 * Giriş (oturum gerekmez):
 *   POST /api/giris/kod      {mail, tel, iz, cihazNo}          maile kod gönder
 *   POST /api/giris/dogrula  {mail, kod, ad?, tel, iz, cihazNo} -> {oturum, hesap}
 * Aşağıdakiler "X-Oturum" başlığı ister:
 *   GET  /api/ben                      hesabım
 *   POST /api/ad {ad}                  isim değiştir (3 günde bir)
 *   POST /api/cikis
 *   GET  /api/bekle?kod=ABCD&surum=N   odanın yeni durumunu bekle (uzun bekleme)
 *   POST /api/oda | /api/katil {kod} | /api/eylem {kod, tur, ...}
 *   GET  /api/gunluk                   günün bulmacası: ilerlemem + sıralama
 *   POST /api/gunluk/sor {gun, tahmin}
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
const Gunluk = require('./gunluk-sunucu.js');
const { depoAc } = require('./depo.js');
const { hesapModulu, yereldenMi, postaDurumu } = require('./hesap.js');
let Hesap, GunlukOyun, DEPO_TURU; // depo açılınca kurulur (aşağıda)

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

const ODA_SINIRI = 1000;   // sunucu geneli açık oda sınırı (belleği korumak için)
function kodUret() {
  for (let deneme = 0; deneme < 2000; deneme++) {
    let k = '';
    for (let i = 0; i < 4; i++) k += HARFLER[crypto.randomInt(HARFLER.length)];
    if (!odalar.has(k)) return k;
  }
  throw new Error('Boş oda kodu bulunamadı');
}

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

/*
 * Güvenlik başlıkları: sayfa yalnızca kendi betiklerini çalıştırır, başka bir
 * siteye çerçeve içinde gömülemez, dosya türü tahmin edilmez.
 */
const GUVENLIK = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '),
};

function json(yanit, kod, govde) {
  yanit.writeHead(kod, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, GUVENLIK));
  yanit.end(JSON.stringify(govde));
}

/** İstek gövdesi: yalnızca JSON, en çok 16 KB (oyunun hiçbir isteği bunu geçmez). */
function govdeOku(istek) {
  return new Promise((coz, red) => {
    if (!/^application\/json\b/i.test(String(istek.headers['content-type'] || ''))) return red(Object.assign(new Error('JSON bekleniyor'), { kod: 415 }));
    let s = '', bitti = false;
    const kes = e => { if (!bitti) { bitti = true; red(e); } };
    istek.on('data', p => { s += p; if (s.length > 16384) { kes(Object.assign(new Error('İstek çok büyük'), { kod: 413 })); istek.destroy(); } });
    istek.on('end', () => { if (bitti) return; bitti = true; try { coz(s ? JSON.parse(s) : {}); } catch (e) { red(Object.assign(new Error('Bozuk istek'), { kod: 400 })); } });
    istek.on('aborted', () => kes(new Error('İstek yarıda kesildi')));
    istek.on('error', kes);
  });
}

function dosyaGonder(yanit, yol) {
  const tam = path.normalize(path.join(KLASOR, yol === '/' ? 'index.html' : yol));
  if (!tam.startsWith(KLASOR + path.sep)) { yanit.writeHead(403); return yanit.end(); }
  fs.readFile(tam, (h, veri) => {
    if (h) { yanit.writeHead(404); return yanit.end('Bulunamadı'); }
    yanit.writeHead(200, Object.assign({ 'Content-Type': TURLER[path.extname(tam)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }, GUVENLIK));
    yanit.end(veri);
  });
}

/** Oda kodu tahmin sınırı: hesap başına 10 dakikada 20 yanlış kod. */
const katilHata = new Map();
function katilHataSay(id) {
  const s = Date.now();
  const l = (katilHata.get(id) || []).filter(t => s - t < 10 * 60 * 1000);
  katilHata.set(id, l);
  return l;
}
setInterval(() => { for (const id of katilHata.keys()) if (!katilHataSay(id).length) katilHata.delete(id); }, 10 * 60 * 1000).unref();

const sunucu = http.createServer(async (istek, yanit) => {
  const url = new URL(istek.url, 'http://x');
  const yol = url.pathname;
  try {
    // Başka sitelerden gelen istekler (CORS) kabul edilmez: uygulama ve site aynı adresten açılır
    if (istek.method === 'OPTIONS') { yanit.writeHead(405); return yanit.end(); }
    if (yol === '/api/saglik') {
      return json(yanit, 200, { tamam: true, acilis: new Date(ACILIS).toISOString(), hazir: DEPO_TURU === 'postgres' && !!process.env.BREVO_API_KEY && !!process.env.MAIL_GONDEREN, mail: postaDurumu() });
    }

    // ---- giriş (oturumsuz)
    if (istek.method === 'POST' && (yol === '/api/giris/kod' || yol === '/api/giris/dogrula')) {
      const v = await govdeOku(istek);
      try {
        return json(yanit, 200, yol === '/api/giris/kod' ? await Hesap.kodIste(istek, v) : await Hesap.dogrula(istek, v));
      } catch (e) {
        if (!e.kod) throw e;
        return json(yanit, e.kod, { hata: e.message, kilit: !!e.kilit, adGerekli: !!e.adGerekli });
      }
    }

    // Aynı ağdakilerin açacağı adres: yalnızca oyunu kuran bilgisayarın kendisine söylenir
    if (yol === '/api/adres') {
      if (!yereldenMi(istek)) return json(yanit, 404, { hata: 'Yok' });
      return json(yanit, 200, { adresler: agAdresleri().map(a => `http://${a}:${PORT}/`) });
    }

    // ---- buradan sonrası giriş ister
    if (!yol.startsWith('/api/')) {
      if (istek.method === 'GET') return dosyaGonder(yanit, decodeURIComponent(yol));
      yanit.writeHead(405); return yanit.end();
    }
    const hesap = await Hesap.oturumdan(istek);
    if (!hesap) return json(yanit, 401, { hata: 'Giriş yapman gerekiyor', girisGerekli: true });
    const id = 'h' + hesap.id;   // odalarda oyuncu kimliği = hesap
    const ad = hesap.ad;

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

    if (yol === '/api/ben') return json(yanit, 200, { hesap: Hesap.goster(hesap) });

    if (yol === '/api/gunluk' && istek.method === 'GET') return json(yanit, 200, await GunlukOyun.durum(Gunluk.bugun(), hesap));

    // Uzun bekleme: telefonun bildiği sürüm eskiyse hemen, değilse değişince cevap ver
    if (yol === '/api/bekle' && istek.method === 'GET') {
      const oda = odalar.get(String(url.searchParams.get('kod') || '').toUpperCase());
      const i = oda ? sira(oda, id) : -1;
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

    if (istek.method === 'POST') {
      let v;
      try { v = await govdeOku(istek); } catch (e) { return json(yanit, e.kod || 400, { hata: e.message }); }

      if (yol === '/api/cikis') { await Hesap.cikis(istek); return json(yanit, 200, { tamam: true }); }
      if (yol === '/api/ad') {
        try {
          const h = await Hesap.adDegistir(hesap, v.ad);
          for (const oda of odalar.values()) { const o = oda.oyuncular.find(x => x.id === id); if (o) { o.ad = h.ad; yayinla(oda); } }
          return json(yanit, 200, { hesap: h });
        } catch (e) { if (!e.kod) throw e; return json(yanit, e.kod, { hata: e.message }); }
      }

      if (yol === '/api/gunluk/sor') {
        const gun = Gunluk.bugun();
        if (v.gun !== gun) return json(yanit, 409, { hata: 'Gün değişti, yeni bulmaca başladı', gun, gunDegisti: true });
        const r = await GunlukOyun.sor(gun, hesap, v.tahmin);
        return json(yanit, r.hata ? r.kod : 200, r);
      }

      if (yol === '/api/oda') {
        // Bir hesabın aynı anda tek odası olur: yeni oda kurulunca eskilerinden çıkar
        for (const eski of [...odalar.values()]) {
          const i = sira(eski, id);
          if (i < 0) continue;
          eylem(eski, i, { tur: 'ayril' });
          if (odalar.has(eski.kod)) yayinla(eski);
        }
        if (odalar.size >= ODA_SINIRI) return json(yanit, 503, { hata: 'Sunucu şu an çok dolu, biraz sonra dene' });
        const oda = odaKur(id, ad);
        return json(yanit, 200, { kod: oda.kod });
      }
      if (yol === '/api/katil' && katilHataSay(id).length >= 20) return json(yanit, 429, { hata: 'Çok fazla yanlış oda kodu, biraz sonra dene' });
      const oda = odalar.get(String(v.kod || '').toUpperCase());
      if (!oda) {
        if (yol === '/api/katil') katilHataSay(id).push(Date.now());
        return json(yanit, 404, { hata: 'Bu kodla bir oda yok' });
      }

      if (yol === '/api/katil') {
        const i = sira(oda, id);
        if (i >= 0) { oda.oyuncular[i].ad = ad; return json(yanit, 200, { kod: oda.kod }); }
        if (oda.oyuncular.length >= 2) return json(yanit, 409, { hata: 'Oda dolu' });
        oda.oyuncular.push(oyuncuYap(id, ad));
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
    return json(yanit, 404, { hata: 'Yok' });
  } catch (e) {
    if (e && e.kod && !yanit.headersSent) return json(yanit, e.kod, { hata: e.message });
    console.error(e);
    if (!yanit.headersSent) json(yanit, 500, { hata: 'Sunucu hatası' });
  }
});

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

// Veritabanını aç, sonra dinlemeye başla
depoAc(process.env.DATABASE_URL).then(depo => {
  DEPO_TURU = depo.tur;
  Hesap = hesapModulu(depo);
  GunlukOyun = Gunluk.gunlukModulu(depo);
  if (depo.tur === 'bellek') console.log('UYARI: DATABASE_URL yok, hesaplar bellekte (sunucu kapanınca silinir).');
  sunucu.listen(PORT, dinlemeBasladi);
}).catch(e => { console.error('Veritabanı açılamadı:', e.message); process.exit(1); });

function dinlemeBasladi() {
  console.log('Sayı Bulmaca sunucusu çalışıyor.');
  console.log('  Bu bilgisayarda:     http://localhost:' + PORT);
  const ag = agAdresleri();
  if (ag.length) console.log('  Aynı Wi-Fi\'dakiler:  http://' + ag[0] + ':' + PORT + '   <- telefonda bunu aç');
  for (const a of ag.slice(1)) console.log('                       http://' + a + ':' + PORT);
}
