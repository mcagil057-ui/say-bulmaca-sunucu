/*
 * Sayı Bulmaca — günün bulmacası (sunucu tarafı).
 *
 * Herkese aynı gizli sayı: tarihten ve gizli bir tuzdan hesaplanır, sunucu
 * yeniden başlasa da aynı kalır, telefona hiç gönderilmez.
 *
 * BİR CİHAZ = BİR OYUN: Android uygulaması ile tarayıcı aynı telefonda ayrı
 * hafıza kullanır, telefondaki kimlik (id) ikisinde farklıdır. Bu yüzden
 * oyuncu ayrıca bir "cihaz anahtarı" ile tanınır: ağ adresi + telefonun
 * değişmeyen özellikleri (ekran, işlemci, ekran kartı, saat dilimi). Kimlik
 * YA DA cihaz anahtarı eşleşirse aynı oyuncu sayılır; ilerleme sunucuda
 * durur, uygulamada başlanan bulmaca sitede kaldığı yerden görünür.
 * Sınır: aynı Wi-Fi'da AYNI MODEL iki telefon tek cihaz sayılabilir;
 * telefon mobil veriye geçince ağ adresi değişir ve yeni cihaz sayılabilir.
 *
 * Sıralama bellekte durur (ücretsiz Render'da disk yok); yeni sürüm
 * yayınlanırken disaAktar/iceAl ile yeni sunucuya devredilir.
 */
'use strict';
const crypto = require('crypto');
const Oyun = require('./public/oyun.js');

const AYAR = Oyun.ayarDuzelt({ basamak: 4 });
const TUZ = process.env.GUNLUK_TUZ || 'sayi-bulmaca-gunun-sayisi';
const gunler = new Map();   // gun -> [kayit]
// kayit: { idler: Set, cihazlar: Set, ad, tahminler: [string], cozuldu: zaman | null }

const temizAd = a => String(a || '').trim().slice(0, 16) || 'Oyuncu';

/** Türkiye saatine göre bugünün tarihi: 2026-11-17 */
function bugun() { return new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10); }

function gizli(gun) {
  const h = crypto.createHmac('sha256', TUZ).update(gun).digest();
  const tum = Oyun.tumSayilar(AYAR);
  return tum[h.readUInt32BE(0) % tum.length];
}

/**
 * Ağ adresi + telefonun izi -> kısa anahtar. İz yoksa (eski sürüm) null:
 * yalnızca ağ adresiyle eşleştirirsek aynı evdeki herkes tek kişi sayılırdı.
 */
function cihazAnahtari(istek, iz) {
  iz = String(iz || '').slice(0, 400);
  if (!iz) return null;
  let ip = String(istek.headers['x-forwarded-for'] || '').split(',')[0].trim() || istek.socket.remoteAddress || '';
  ip = ip.replace(/^::ffff:/, '');
  if (ip.includes(':')) ip = ip.split(':').slice(0, 4).join(':'); // IPv6: geçici adres değişse de aynı ağ
  return crypto.createHash('sha256').update(ip + '|' + iz).digest('hex').slice(0, 24);
}

function liste(gun) {
  if (!gunler.has(gun)) {
    gunler.set(gun, []);
    for (const g of [...gunler.keys()].sort().slice(0, -3)) gunler.delete(g); // son 3 gün yeter
  }
  return gunler.get(gun);
}
function bul(gun, id, cihaz) {
  return liste(gun).find(k => (id && k.idler.has(id)) || (cihaz && k.cihazlar.has(cihaz)));
}
function bagla(k, id, cihaz) { if (id) k.idler.add(id); if (cihaz) k.cihazlar.add(cihaz); }

/** Geçerli soru listesi mi? (geçerli sayılar, tekrar yok, gizli sayı yalnızca sonda) */
function gecerliListe(gun, l) {
  if (!Array.isArray(l) || !l.length || l.length > 200) return null;
  l = l.map(String);
  if (l.some(t => Oyun.sayiHatasi(t, AYAR)) || new Set(l).size !== l.length) return null;
  const i = l.indexOf(gizli(gun));
  if (i >= 0 && i !== l.length - 1) return null;
  return l;
}

function durum(gun, id, cihaz) {
  const k = bul(gun, id, cihaz);
  const g = gizli(gun);
  const cozenler = liste(gun).filter(x => x.cozuldu)
    .map(x => ({ ad: x.ad, soru: x.tahminler.length, zaman: x.cozuldu, ben: x === k }))
    .sort((a, b) => a.soru - b.soru || a.zaman - b.zaman);
  return {
    gun, basamak: AYAR.basamak, basSifir: AYAR.basSifir,
    siralama: cozenler.slice(0, 50), toplam: cozenler.length, benim: cozenler.find(x => x.ben) || null,
    tahminler: k ? k.tahminler.map(t => Object.assign({ tahmin: t }, Oyun.puanla(g, t))) : [],
  };
}

/** Bir soru sor. Hata varsa {hata, kod}. */
function sor(gun, id, cihaz, ad, tahmin) {
  const t = String(tahmin || '');
  const h = Oyun.sayiHatasi(t, AYAR);
  if (h) return { hata: h, kod: 400 };
  let k = bul(gun, id, cihaz);
  if (k && k.cozuldu) { bagla(k, id, cihaz); return Object.assign({ hata: 'Bugünün bulmacası bu cihazda zaten çözüldü', kod: 409, cozuldu: true }, durum(gun, id, cihaz)); }
  if (!k) { k = { idler: new Set(), cihazlar: new Set(), ad: temizAd(ad), tahminler: [], cozuldu: null }; liste(gun).push(k); }
  bagla(k, id, cihaz);
  if (!k.tahminler.includes(t)) k.tahminler.push(t);
  if (t === gizli(gun)) { k.cozuldu = Date.now(); k.ad = temizAd(ad); }
  return durum(gun, id, cihaz);
}

/**
 * Telefonda kayıtlı soruları sunucuya geri yükle (sunucu yeniden kurulup
 * kayıt kaybolduysa). Sunucuda zaten kayıt varsa sunucudaki geçerlidir.
 */
function esitle(gun, id, cihaz, ad, tahminler) {
  let k = bul(gun, id, cihaz);
  if (!k) {
    const l = gecerliListe(gun, tahminler);
    if (!l) return { hata: 'Sonuç doğrulanamadı', kod: 400 };
    k = { idler: new Set(), cihazlar: new Set(), ad: temizAd(ad), tahminler: l, cozuldu: l[l.length - 1] === gizli(gun) ? Date.now() : null };
    liste(gun).push(k);
  }
  bagla(k, id, cihaz);
  return durum(gun, id, cihaz);
}

/** Yeni sürüme devretmek için bütün kayıtlar. */
function disaAktar() {
  const l = [];
  for (const [gun, kayitlar] of gunler) {
    for (const k of kayitlar) l.push({ gun, idler: [...k.idler], cihazlar: [...k.cihazlar], ad: k.ad, tahminler: k.tahminler, cozuldu: k.cozuldu });
  }
  return l;
}

/** Eski sürümden gelen kayıtları yeniden doğrulayarak al. Eski biçimi de ({id, zaman}) tanır. */
function iceAl(kayitlar) {
  let alinan = 0;
  for (const x of Array.isArray(kayitlar) ? kayitlar.slice(0, 20000) : []) {
    if (!x || typeof x.gun !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(x.gun) || x.gun > bugun()) continue;
    const l = gecerliListe(x.gun, x.tahminler);
    if (!l) continue;
    const bitti = l[l.length - 1] === gizli(x.gun);
    const cozuldu = bitti ? (+x.cozuldu || +x.zaman || Date.now()) : null;
    const idler = (Array.isArray(x.idler) ? x.idler : [x.id]).map(i => String(i || '').slice(0, 64)).filter(Boolean);
    const cihazlar = (Array.isArray(x.cihazlar) ? x.cihazlar : []).map(c => String(c).slice(0, 64));
    let k = liste(x.gun).find(y => idler.some(i => y.idler.has(i)) || cihazlar.some(c => y.cihazlar.has(c)));
    if (!k) { k = { idler: new Set(), cihazlar: new Set(), ad: temizAd(x.ad), tahminler: l, cozuldu }; liste(x.gun).push(k); }
    else if (!k.cozuldu && l.length > k.tahminler.length) { k.tahminler = l; k.cozuldu = cozuldu; }
    idler.forEach(i => k.idler.add(i));
    cihazlar.forEach(c => k.cihazlar.add(c));
    alinan++;
  }
  return alinan;
}

module.exports = { AYAR, bugun, gizli, cihazAnahtari, durum, sor, esitle, disaAktar, iceAl };
