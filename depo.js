/*
 * Sayı Bulmaca — kalıcı kayıtlar (hesaplar, oturumlar, cihaz bağları,
 * giriş kodları, günün bulmacası).
 *
 * Render'da DATABASE_URL (Neon Postgres) ile çalışır. DATABASE_URL yoksa
 * (bilgisayarda deneme) aynı SQL bellekteki sahte Postgres'te (pg-mem)
 * çalışır: kod tek, denemeler gerçeğe yakın. Bellekte olan her şey sunucu
 * kapanınca silinir.
 */
'use strict';

const TABLOLAR = `
CREATE TABLE IF NOT EXISTS hesaplar (
  id SERIAL PRIMARY KEY,
  mail TEXT UNIQUE NOT NULL,
  ad TEXT NOT NULL,
  ad_degisti BIGINT NOT NULL,
  olusturma BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS oturumlar (
  anahtar TEXT PRIMARY KEY,
  hesap_id INTEGER NOT NULL,
  olusturma BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS cihaz_baglari (
  anahtar TEXT PRIMARY KEY,
  hesap_id INTEGER NOT NULL,
  zaman BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS giris_kodlari (
  mail TEXT PRIMARY KEY,
  kod TEXT NOT NULL,
  bitis BIGINT NOT NULL,
  deneme INTEGER NOT NULL,
  gonderim BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS gunluk (
  gun TEXT NOT NULL,
  hesap_id INTEGER NOT NULL,
  tahminler TEXT NOT NULL,
  cozuldu BIGINT,
  PRIMARY KEY (gun, hesap_id)
);
CREATE TABLE IF NOT EXISTS gunluk_ag (
  gun TEXT NOT NULL,
  hesap_id INTEGER NOT NULL,
  ag TEXT NOT NULL,
  ilk BIGINT NOT NULL,
  PRIMARY KEY (gun, hesap_id, ag)
);
CREATE TABLE IF NOT EXISTS istatistik (
  hesap_id INTEGER PRIMARY KEY,
  mac INTEGER NOT NULL,
  galibiyet INTEGER NOT NULL,
  yaris_galibiyet INTEGER NOT NULL,
  gunluk_cozum INTEGER NOT NULL,
  seri INTEGER NOT NULL,
  en_uzun_seri INTEGER NOT NULL,
  gunluk_son TEXT
);
CREATE TABLE IF NOT EXISTS meydan (
  id TEXT PRIMARY KEY,
  sahip_id INTEGER NOT NULL,
  gizli TEXT NOT NULL,
  basamak INTEGER NOT NULL,
  olusturma BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS meydan_oyun (
  meydan_id TEXT NOT NULL,
  hesap_id INTEGER NOT NULL,
  tahminler TEXT NOT NULL,
  baslangic BIGINT NOT NULL,
  cozuldu BIGINT,
  PRIMARY KEY (meydan_id, hesap_id)
);
CREATE TABLE IF NOT EXISTS yaris_rekor (
  id SERIAL PRIMARY KEY,
  hesap_id INTEGER NOT NULL,
  sure BIGINT NOT NULL,
  soru INTEGER NOT NULL,
  kisi INTEGER NOT NULL,
  basamak INTEGER NOT NULL,
  zaman BIGINT NOT NULL
);`;

/** Bağlantı havuzu: Neon ya da bellekte sahte Postgres. */
async function depoAc(adres) {
  let havuz, tur;
  if (adres) {
    const { Pool } = require('pg');
    // Neon'un sertifikası doğrulanır (araya giren sahte sunucuya bağlanılmasın)
    const u = new URL(adres);
    u.searchParams.delete('sslmode'); u.searchParams.delete('channel_binding');
    havuz = new Pool({ connectionString: u.toString(), ssl: { rejectUnauthorized: true }, max: 5, idleTimeoutMillis: 30000 });
    tur = 'postgres';
  } else {
    const { newDb } = require('pg-mem');
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    havuz = new Pool();
    tur = 'bellek';
  }
  for (const komut of TABLOLAR.split(';').map(x => x.trim()).filter(Boolean)) await havuz.query(komut);
  const q = async (sql, p) => (await havuz.query(sql, p)).rows;
  const sayi = r => (r == null ? r : Number(r));
  const istatYap = r => ({
    mac: r ? Number(r.mac) : 0, galibiyet: r ? Number(r.galibiyet) : 0, yarisGalibiyet: r ? Number(r.yaris_galibiyet) : 0,
    gunlukCozum: r ? Number(r.gunluk_cozum) : 0, seri: r ? Number(r.seri) : 0, enUzunSeri: r ? Number(r.en_uzun_seri) : 0,
    gunlukSon: r ? r.gunluk_son : null,
  });
  const hesapYap = r => r && { id: Number(r.id), mail: r.mail, ad: r.ad, adDegisti: sayi(r.ad_degisti), olusturma: sayi(r.olusturma) };

  return {
    tur,
    kapat: () => havuz.end(),

    // ---- hesaplar
    async hesapMail(mail) { return hesapYap((await q('SELECT * FROM hesaplar WHERE mail = $1', [mail]))[0]); },
    async hesapId(id) { return hesapYap((await q('SELECT * FROM hesaplar WHERE id = $1', [id]))[0]); },
    async hesapOlustur(mail, ad, zaman) {
      return hesapYap((await q('INSERT INTO hesaplar (mail, ad, ad_degisti, olusturma) VALUES ($1, $2, $3, $3) RETURNING *', [mail, ad, zaman]))[0]);
    },
    async adDegistir(id, ad, zaman) { await q('UPDATE hesaplar SET ad = $2, ad_degisti = $3 WHERE id = $1', [id, ad, zaman]); },
    /** Bütün adlar (aynı ad kuralı için; aile ölçeğinde birkaç yüz satır). */
    async adlar() { return (await q('SELECT id, ad FROM hesaplar')).map(r => ({ id: Number(r.id), ad: r.ad })); },

    // ---- oturumlar (anahtar = oturum kodunun özeti; kodun kendisi saklanmaz)
    async oturumEkle(anahtar, hesapId, zaman) { await q('INSERT INTO oturumlar (anahtar, hesap_id, olusturma) VALUES ($1, $2, $3)', [anahtar, hesapId, zaman]); },
    async oturumHesap(anahtar) {
      const r = (await q('SELECT h.*, o.olusturma AS oturum_zamani FROM oturumlar o JOIN hesaplar h ON h.id = o.hesap_id WHERE o.anahtar = $1', [anahtar]))[0];
      const h = hesapYap(r);
      if (h) h.oturumZamani = sayi(r.oturum_zamani);
      return h;
    },
    async oturumSil(anahtar) { await q('DELETE FROM oturumlar WHERE anahtar = $1', [anahtar]); },

    // ---- cihaz bağları (bir cihaz 14 gün tek hesap)
    async cihazBaglari(anahtarlar) {
      if (!anahtarlar.length) return [];
      const yer = anahtarlar.map((_, i) => '$' + (i + 1)).join(', ');
      return (await q(`SELECT * FROM cihaz_baglari WHERE anahtar IN (${yer})`, anahtarlar))
        .map(r => ({ anahtar: r.anahtar, hesapId: Number(r.hesap_id), zaman: sayi(r.zaman) }));
    },
    async cihazBagla(anahtarlar, hesapId, zaman) {
      for (const a of anahtarlar) {
        await q(`INSERT INTO cihaz_baglari (anahtar, hesap_id, zaman) VALUES ($1, $2, $3)
                 ON CONFLICT (anahtar) DO UPDATE SET hesap_id = EXCLUDED.hesap_id, zaman = EXCLUDED.zaman`, [a, hesapId, zaman]);
      }
    },

    // ---- giriş kodları (kodun özeti saklanır)
    async kodAl(mail) {
      const r = (await q('SELECT * FROM giris_kodlari WHERE mail = $1', [mail]))[0];
      return r && { mail: r.mail, kod: r.kod, bitis: sayi(r.bitis), deneme: Number(r.deneme), gonderim: sayi(r.gonderim) };
    },
    async kodKoy(mail, kod, bitis, zaman) {
      await q(`INSERT INTO giris_kodlari (mail, kod, bitis, deneme, gonderim) VALUES ($1, $2, $3, 0, $4)
               ON CONFLICT (mail) DO UPDATE SET kod = EXCLUDED.kod, bitis = EXCLUDED.bitis, deneme = 0, gonderim = EXCLUDED.gonderim`, [mail, kod, bitis, zaman]);
    },
    /**
     * Bir deneme hakkını TEK ADIMDA kullan: hak kaldıysa ve süre dolmadıysa
     * sayacı artırıp kodun özetini döner, yoksa null. Aynı anda gelen
     * tahminler sırayla hak düşer; 5'ten fazlası hiç kontrol edilmez.
     */
    async kodHakKullan(mail, simdi) {
      const r = (await q(`UPDATE giris_kodlari SET deneme = deneme + 1
                          WHERE mail = $1 AND deneme < 5 AND bitis > $2 RETURNING kod, deneme`, [mail, simdi]))[0];
      return r ? { kod: r.kod, deneme: Number(r.deneme) } : null;
    },
    async kodIade(mail) { await q('UPDATE giris_kodlari SET deneme = deneme - 1 WHERE mail = $1 AND deneme > 0', [mail]); },
    async kodSil(mail) { await q('DELETE FROM giris_kodlari WHERE mail = $1', [mail]); },

    // ---- günün bulmacası
    async gunlukAl(gun, hesapId) {
      const r = (await q('SELECT * FROM gunluk WHERE gun = $1 AND hesap_id = $2', [gun, hesapId]))[0];
      return r ? { tahminler: JSON.parse(r.tahminler), cozuldu: sayi(r.cozuldu) } : null;
    },
    async gunlukKoy(gun, hesapId, tahminler, cozuldu) {
      await q(`INSERT INTO gunluk (gun, hesap_id, tahminler, cozuldu) VALUES ($1, $2, $3, $4)
               ON CONFLICT (gun, hesap_id) DO UPDATE SET tahminler = EXCLUDED.tahminler, cozuldu = EXCLUDED.cozuldu`,
        [gun, hesapId, JSON.stringify(tahminler), cozuldu]);
    },
    // ---- günlük bulmacada ağ izi (IP'nin kendisi değil; 2 gün saklanır)
    async agKaydet(gun, hesapId, ag, zaman) {
      await q(`INSERT INTO gunluk_ag (gun, hesap_id, ag, ilk) VALUES ($1, $2, $3, $4)
               ON CONFLICT (gun, hesap_id, ag) DO NOTHING`, [gun, hesapId, ag, zaman]);
    },
    async agTemizle(enEskiGun) { await q('DELETE FROM gunluk_ag WHERE gun < $1', [enEskiGun]); },
    async agKayitlari(gun) {
      return (await q('SELECT * FROM gunluk_ag WHERE gun = $1', [gun])).map(r => ({ hesapId: Number(r.hesap_id), ag: r.ag, ilk: Number(r.ilk) }));
    },

    // ---- istatistik (rozetler için)
    async istatAl(hesapId) {
      const r = (await q('SELECT * FROM istatistik WHERE hesap_id = $1', [hesapId]))[0];
      return istatYap(r);
    },
    async istatlar(ids) {
      if (!ids.length) return new Map();
      const yer = ids.map((_, i) => '$' + (i + 1)).join(', ');
      const m = new Map(ids.map(id => [id, istatYap(null)]));
      for (const r of await q(`SELECT * FROM istatistik WHERE hesap_id IN (${yer})`, ids)) m.set(Number(r.hesap_id), istatYap(r));
      return m;
    },
    async istatYaz(hesapId, i) {
      await q(`INSERT INTO istatistik (hesap_id, mac, galibiyet, yaris_galibiyet, gunluk_cozum, seri, en_uzun_seri, gunluk_son)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
               ON CONFLICT (hesap_id) DO UPDATE SET mac = EXCLUDED.mac, galibiyet = EXCLUDED.galibiyet, yaris_galibiyet = EXCLUDED.yaris_galibiyet,
                 gunluk_cozum = EXCLUDED.gunluk_cozum, seri = EXCLUDED.seri, en_uzun_seri = EXCLUDED.en_uzun_seri, gunluk_son = EXCLUDED.gunluk_son`,
        [hesapId, i.mac, i.galibiyet, i.yarisGalibiyet, i.gunlukCozum, i.seri, i.enUzunSeri, i.gunlukSon]);
    },

    // ---- meydan okuma
    async meydanEkle(id, sahipId, gizli, basamak, zaman) {
      await q('INSERT INTO meydan (id, sahip_id, gizli, basamak, olusturma) VALUES ($1, $2, $3, $4, $5)', [id, sahipId, gizli, basamak, zaman]);
    },
    async meydanAl(id) {
      const r = (await q('SELECT * FROM meydan WHERE id = $1', [id]))[0];
      return r && { id: r.id, sahipId: Number(r.sahip_id), gizli: r.gizli, basamak: Number(r.basamak), olusturma: sayi(r.olusturma) };
    },
    async meydanSay(sahipId, sonra) {
      return (await q('SELECT id FROM meydan WHERE sahip_id = $1 AND olusturma > $2', [sahipId, sonra])).length;
    },
    async meydanOyunAl(meydanId, hesapId) {
      const r = (await q('SELECT * FROM meydan_oyun WHERE meydan_id = $1 AND hesap_id = $2', [meydanId, hesapId]))[0];
      return r && { tahminler: JSON.parse(r.tahminler), baslangic: sayi(r.baslangic), cozuldu: sayi(r.cozuldu) };
    },
    async meydanOyunKoy(meydanId, hesapId, tahminler, baslangic, cozuldu) {
      await q(`INSERT INTO meydan_oyun (meydan_id, hesap_id, tahminler, baslangic, cozuldu) VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT (meydan_id, hesap_id) DO UPDATE SET tahminler = EXCLUDED.tahminler, cozuldu = EXCLUDED.cozuldu`,
        [meydanId, hesapId, JSON.stringify(tahminler), baslangic, cozuldu]);
    },
    async meydanOyunlari(meydanId) {
      return (await q(`SELECT o.*, h.ad FROM meydan_oyun o JOIN hesaplar h ON h.id = o.hesap_id WHERE o.meydan_id = $1`, [meydanId]))
        .map(r => ({ hesapId: Number(r.hesap_id), ad: r.ad, tahminler: JSON.parse(r.tahminler), baslangic: sayi(r.baslangic), cozuldu: sayi(r.cozuldu) }));
    },
    async meydanlarim(sahipId) {
      const l = (await q('SELECT * FROM meydan WHERE sahip_id = $1', [sahipId]))
        .map(r => ({ id: r.id, basamak: Number(r.basamak), olusturma: sayi(r.olusturma) }))
        .sort((a, b) => b.olusturma - a.olusturma).slice(0, 10);
      for (const m of l) {
        const o = await this.meydanOyunlari(m.id);
        m.oynayan = o.length; m.cozen = o.filter(x => x.cozuldu).length;
      }
      return l;
    },

    // ---- yarış rekorları (yalnızca arkadaşlarla oynanan yarışların kazananları)
    async yarisKaydet(hesapId, sure, soru, kisi, basamak, zaman) {
      await q('INSERT INTO yaris_rekor (hesap_id, sure, soru, kisi, basamak, zaman) VALUES ($1, $2, $3, $4, $5, $6)', [hesapId, sure, soru, kisi, basamak, zaman]);
    },
    async yarisKayitlari(basamak) {
      return (await q(`SELECT r.hesap_id, r.sure, r.soru, r.kisi, r.zaman, h.ad FROM yaris_rekor r JOIN hesaplar h ON h.id = r.hesap_id
                       WHERE r.basamak = $1`, [basamak]))
        .map(r => ({ hesapId: Number(r.hesap_id), sure: sayi(r.sure), soru: Number(r.soru), kisi: Number(r.kisi), zaman: sayi(r.zaman), ad: r.ad }));
    },

    async gunlukCozenler(gun) {
      return (await q(`SELECT g.hesap_id, g.tahminler, g.cozuldu, h.ad FROM gunluk g JOIN hesaplar h ON h.id = g.hesap_id
                       WHERE g.gun = $1 AND g.cozuldu IS NOT NULL`, [gun]))
        .map(r => ({ hesapId: Number(r.hesap_id), ad: r.ad, soru: JSON.parse(r.tahminler).length, zaman: sayi(r.cozuldu) }));
    },
  };
}

module.exports = { depoAc };
