/*
 * Sayı Bulmaca — günün bulmacası (sunucu tarafı).
 *
 * Gizli sayı tarihten ve gizli bir tuzdan hesaplanır, telefona hiç gönderilmez.
 * 19 Kasım 2026'dan itibaren HER HESABIN SAYISI KENDİNE ÖZEL (hesap no da
 * karışır): iki tarayıcıyla oynayan biri, birinde topladığı bilgiyi öbüründe
 * kullanamaz. Ondan önceki günlerde sayı herkese aynıydı. Her HESAP günde bir kez oynar; ilerleme veritabanında
 * durur, aynı hesapla hangi cihazdan girilirse girilsin kaldığı yerden devam
 * eder. (Bir cihazda iki hesap açılmasını hesap.js'teki 14 günlük kilit önler.)
 */
'use strict';
const crypto = require('crypto');
const Oyun = require('./public/oyun.js');

const AYAR = Oyun.ayarDuzelt({ basamak: 4 });
/*
 * Günün sayısını üreten gizli anahtar. Açık depodaki bir sabit OLAMAZ (herkes
 * bugünün cevabını hesaplardı): GUNLUK_TUZ yoksa yalnızca sunucunun bildiği
 * veritabanı adresinden türetilir. Not: Neon şifresi değiştirilirse o günün
 * sayısı da değişir.
 */
const TUZ = process.env.GUNLUK_TUZ
  || (process.env.DATABASE_URL ? crypto.createHash('sha256').update('gunun-sayisi|' + process.env.DATABASE_URL).digest('hex') : 'yerel-deneme');

/** Türkiye saatine göre bugünün tarihi: 2026-11-17 */
function bugun() { return new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10); }

/*
 * Ağ izi: aynı ağdan kaç hesabın bulmacayı oynadığını görmek için (iki
 * tarayıcıyla oynama). IP'nin kendisi saklanmaz; gizli anahtar + gün ile
 * karıştırılmış kısa bir iz saklanır. Anahtar her gün değiştiği için iz
 * yalnızca o günün kayıtları arasında karşılaştırılabilir, kişi günler
 * boyunca izlenemez. Kayıtlar 2 gün sonra silinir.
 */
const AG_TUZ = crypto.createHash('sha256').update('ag-izi|' + TUZ).digest('hex');
function agIzi(gun, ip) { return crypto.createHmac('sha256', AG_TUZ).update(gun + '|' + ip).digest('hex').slice(0, 12); }
/** Saklanacak en eski gün (dün). */
function agSinirGun(gun) { return new Date(Date.parse(gun + 'T00:00:00Z') - 24 * 3600 * 1000).toISOString().slice(0, 10); }

/** Bu günden itibaren her hesaba ayrı sayı (kullanıcı kararı, 18.11.2026: "bugüne elleme"). */
const AYRI_SAYI_BASLANGIC = '2026-11-19';
const ortakMi = gun => gun < AYRI_SAYI_BASLANGIC;

function gizli(gun, hesapId) {
  const h = crypto.createHmac('sha256', TUZ).update(ortakMi(gun) ? gun : gun + '|' + hesapId).digest();
  const tum = Oyun.tumSayilar(AYAR);
  return tum[h.readUInt32BE(0) % tum.length];
}

/**
 * rozetBul: async (hesap no listesi) -> Map(hesap no -> en iyi rozet simgesi)
 * cozuldu: (hesap, gün) -> bulmaca ilk kez çözülünce çağrılır (günlük seri için)
 */
function gunlukModulu(depo, rozetBul, cozuldu) {
  async function durum(gun, hesap) {
    const g = gizli(gun, hesap.id);
    const benimki = await depo.gunlukAl(gun, hesap.id);
    const ham = await depo.gunlukCozenler(gun);
    const rozet = rozetBul ? await rozetBul(ham.map(x => x.hesapId)) : new Map();
    const cozenler = ham
      .map(x => ({ ad: x.ad, rozet: rozet.get(x.hesapId) || '', soru: x.soru, zaman: x.zaman, ben: x.hesapId === hesap.id }))
      .sort((a, b) => a.soru - b.soru || a.zaman - b.zaman);
    return {
      gun, basamak: AYAR.basamak, basSifir: AYAR.basSifir, ortak: ortakMi(gun),
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
    if (t === gizli(gun, hesap.id)) k.cozuldu = Date.now();
    await depo.gunlukKoy(gun, hesap.id, k.tahminler, k.cozuldu);
    if (k.cozuldu && cozuldu) await cozuldu(hesap, gun);
    return durum(gun, hesap);
  }

  return { durum, sor };
}

module.exports = { AYAR, AYRI_SAYI_BASLANGIC, bugun, gizli, gunlukModulu, agIzi, agSinirGun };
