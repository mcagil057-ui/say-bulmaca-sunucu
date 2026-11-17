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
);`;

/** Bağlantı havuzu: Neon ya da bellekte sahte Postgres. */
async function depoAc(adres) {
  let havuz, tur;
  if (adres) {
    const { Pool } = require('pg');
    havuz = new Pool({ connectionString: adres, ssl: { rejectUnauthorized: false }, max: 5, idleTimeoutMillis: 30000 });
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

    // ---- oturumlar (anahtar = oturum kodunun özeti; kodun kendisi saklanmaz)
    async oturumEkle(anahtar, hesapId, zaman) { await q('INSERT INTO oturumlar (anahtar, hesap_id, olusturma) VALUES ($1, $2, $3)', [anahtar, hesapId, zaman]); },
    async oturumHesap(anahtar) {
      return hesapYap((await q('SELECT h.* FROM oturumlar o JOIN hesaplar h ON h.id = o.hesap_id WHERE o.anahtar = $1', [anahtar]))[0]);
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
    async kodDeneme(mail) { await q('UPDATE giris_kodlari SET deneme = deneme + 1 WHERE mail = $1', [mail]); },
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
    async gunlukCozenler(gun) {
      return (await q(`SELECT g.hesap_id, g.tahminler, g.cozuldu, h.ad FROM gunluk g JOIN hesaplar h ON h.id = g.hesap_id
                       WHERE g.gun = $1 AND g.cozuldu IS NOT NULL`, [gun]))
        .map(r => ({ hesapId: Number(r.hesap_id), ad: r.ad, soru: JSON.parse(r.tahminler).length, zaman: sayi(r.cozuldu) }));
    },
  };
}

module.exports = { depoAc };
