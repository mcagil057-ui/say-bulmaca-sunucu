/*
 * Sayı Bulmaca — meydan okuma bağlantısı.
 *
 * Biri bir sayı tutar (ya da uygulama rastgele tutar) ve bağlantı gönderir:
 * "Bakalım kaç soruda bulacaksın". Bağlantıyı açan herkes o sayıyı kendi
 * başına bulmaya çalışır; sayı yalnızca sunucuda durur. Meydan okuyan,
 * kimin kaç soruda ve ne kadar sürede bulduğunu görür. Her kişi bir kez oynar.
 */
'use strict';
const crypto = require('crypto');
const Oyun = require('./public/oyun.js');

const GUNLUK_SINIR = 20;   // bir hesap günde en çok bu kadar meydan okuma açar

function meydanModulu(depo) {
  const yeniKimlik = () => crypto.randomBytes(6).toString('base64').replace(/[+/=]/g, '').slice(0, 8);

  async function durum(m, hesap) {
    const ayar = Oyun.ayarDuzelt({ basamak: m.basamak });
    const sahip = await depo.hesapId(m.sahipId);
    const oyunlar = await depo.meydanOyunlari(m.id);
    const benim = oyunlar.find(o => o.hesapId === hesap.id);
    const sahipBen = m.sahipId === hesap.id;
    const cozdum = !!(benim && benim.cozuldu);
    const sonuclar = oyunlar.map(o => ({
      ad: o.ad, soru: o.tahminler.length, cozuldu: !!o.cozuldu,
      sure: o.cozuldu ? o.cozuldu - o.baslangic : null, ben: o.hesapId === hesap.id,
    })).sort((a, b) => (b.cozuldu - a.cozuldu) || a.soru - b.soru || (a.sure || 0) - (b.sure || 0));
    return {
      id: m.id, basamak: m.basamak, basSifir: ayar.basSifir, sahip: sahip ? sahip.ad : '?', sahipBen,
      gizli: sahipBen || cozdum ? m.gizli : null,
      tahminler: benim ? benim.tahminler.map(t => Object.assign({ tahmin: t }, Oyun.puanla(m.gizli, t))) : [],
      baslangic: benim ? benim.baslangic : null, cozuldu: benim ? benim.cozuldu : null,
      // Sonuçları meydan okuyan her zaman, oynayan ise bulduktan sonra görür
      sonuclar: sahipBen || cozdum ? sonuclar : null, oynayan: oyunlar.length,
    };
  }

  return {
    async olustur(hesap, v) {
      const basamak = [3, 4].includes(Number(v.basamak)) ? Number(v.basamak) : 3;
      const ayar = Oyun.ayarDuzelt({ basamak });
      let gizli = String(v.sayi || '');
      if (gizli) { const h = Oyun.sayiHatasi(gizli, ayar); if (h) return { hata: h, kod: 400 }; }
      else gizli = Oyun.rastgeleSayi(ayar);
      const simdi = Date.now();
      if ((await depo.meydanSay(hesap.id, simdi - 24 * 3600 * 1000)) >= GUNLUK_SINIR) return { hata: 'Bugün çok fazla meydan okuma açtın', kod: 429 };
      const id = yeniKimlik();
      await depo.meydanEkle(id, hesap.id, gizli, basamak, simdi);
      return { id };
    },
    async getir(hesap, id) {
      const m = await depo.meydanAl(String(id || '').slice(0, 16));
      if (!m) return { hata: 'Bu meydan okuma bulunamadı', kod: 404 };
      return durum(m, hesap);
    },
    async sor(hesap, id, tahmin) {
      const m = await depo.meydanAl(String(id || '').slice(0, 16));
      if (!m) return { hata: 'Bu meydan okuma bulunamadı', kod: 404 };
      if (m.sahipId === hesap.id) return { hata: 'Kendi meydan okumanı oynayamazsın', kod: 400 };
      const ayar = Oyun.ayarDuzelt({ basamak: m.basamak });
      const t = String(tahmin || '');
      const h = Oyun.sayiHatasi(t, ayar);
      if (h) return { hata: h, kod: 400 };
      const simdi = Date.now();
      const o = (await depo.meydanOyunAl(m.id, hesap.id)) || { tahminler: [], baslangic: simdi, cozuldu: null };
      if (o.cozuldu) return Object.assign({ hata: 'Bu meydan okumayı zaten çözdün', kod: 409 }, await durum(m, hesap));
      if (!o.tahminler.includes(t)) o.tahminler.push(t);
      if (t === m.gizli) o.cozuldu = simdi;
      await depo.meydanOyunKoy(m.id, hesap.id, o.tahminler, o.baslangic, o.cozuldu);
      return durum(m, hesap);
    },
    /** Benim açtığım son meydan okumalar. */
    async benimkiler(hesap) {
      return (await depo.meydanlarim(hesap.id)).map(m => ({ id: m.id, basamak: m.basamak, olusturma: m.olusturma, oynayan: m.oynayan, cozen: m.cozen }));
    },
  };
}

module.exports = { meydanModulu };
