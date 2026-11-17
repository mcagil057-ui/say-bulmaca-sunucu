/*
 * Sayı Bulmaca — günün bulmacası (sunucu tarafı).
 *
 * Herkese aynı gizli sayı: tarihten ve gizli bir tuzdan hesaplanır, telefona
 * hiç gönderilmez. Her HESAP günde bir kez oynar; ilerleme veritabanında
 * durur, aynı hesapla hangi cihazdan girilirse girilsin kaldığı yerden devam
 * eder. (Bir cihazda iki hesap açılmasını hesap.js'teki 14 günlük kilit önler.)
 */
'use strict';
const crypto = require('crypto');
const Oyun = require('./public/oyun.js');

const AYAR = Oyun.ayarDuzelt({ basamak: 4 });
const TUZ = process.env.GUNLUK_TUZ || 'sayi-bulmaca-gunun-sayisi';

/** Türkiye saatine göre bugünün tarihi: 2026-11-17 */
function bugun() { return new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10); }

function gizli(gun) {
  const h = crypto.createHmac('sha256', TUZ).update(gun).digest();
  const tum = Oyun.tumSayilar(AYAR);
  return tum[h.readUInt32BE(0) % tum.length];
}

function gunlukModulu(depo) {
  async function durum(gun, hesap) {
    const g = gizli(gun);
    const benimki = await depo.gunlukAl(gun, hesap.id);
    const cozenler = (await depo.gunlukCozenler(gun))
      .map(x => ({ ad: x.ad, soru: x.soru, zaman: x.zaman, ben: x.hesapId === hesap.id }))
      .sort((a, b) => a.soru - b.soru || a.zaman - b.zaman);
    return {
      gun, basamak: AYAR.basamak, basSifir: AYAR.basSifir,
      siralama: cozenler.slice(0, 50), toplam: cozenler.length, benim: cozenler.find(x => x.ben) || null,
      tahminler: benimki ? benimki.tahminler.map(t => Object.assign({ tahmin: t }, Oyun.puanla(g, t))) : [],
    };
  }

  async function sor(gun, hesap, tahmin) {
    const t = String(tahmin || '');
    const h = Oyun.sayiHatasi(t, AYAR);
    if (h) return { hata: h, kod: 400 };
    const k = (await depo.gunlukAl(gun, hesap.id)) || { tahminler: [], cozuldu: null };
    if (k.cozuldu) return Object.assign({ hata: 'Bugünün bulmacasını zaten çözdün', kod: 409, cozuldu: true }, await durum(gun, hesap));
    if (!k.tahminler.includes(t)) k.tahminler.push(t);
    if (t === gizli(gun)) k.cozuldu = Date.now();
    await depo.gunlukKoy(gun, hesap.id, k.tahminler, k.cozuldu);
    return durum(gun, hesap);
  }

  return { durum, sor };
}

module.exports = { AYAR, bugun, gizli, gunlukModulu };
