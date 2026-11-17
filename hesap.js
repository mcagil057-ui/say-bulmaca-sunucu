/*
 * Sayı Bulmaca — hesaplar ve mail ile giriş.
 *
 *  - Giriş: mail adresine 6 haneli kod gider (Brevo), kod 10 dakika geçerli,
 *    en çok 5 deneme. Kod ve oturum anahtarı veritabanında yalnızca özet
 *    (sha256) olarak durur.
 *  - Bir cihazda bir hesapla girildikten sonra o cihazda 14 gün başka hesapla
 *    girilemez. Cihaz şu izlerle tanınır (biri tutsa yeter):
 *      tel: telefonun/tarayıcının kendi rastgele kimliği
 *      and: Android uygulamasının gerçek cihaz kimliği (yeni APK'da)
 *      iz:  ağ adresi + telefonun değişmeyen özellikleri (uygulama ile
 *           tarayıcıda aynı). Sınır: aynı Wi-Fi'da aynı model iki telefon
 *           tek cihaz sayılabilir.
 *  - İsim en fazla 3 günde bir değiştirilir.
 */
'use strict';
const crypto = require('crypto');

const GUN = 24 * 3600 * 1000;
const CIHAZ_KILIDI = 14 * GUN;
const AD_ARALIGI = 3 * GUN;
const KOD_OMRU = 10 * 60 * 1000;

const ozet = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const temizMail = m => String(m || '').trim().toLowerCase().slice(0, 120);
const mailGecerli = m => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(m);
function adHatasi(ad) {
  ad = String(ad || '').trim();
  if (ad.length < 2) return 'Ad en az 2 harf olmalı';
  if (ad.length > 16) return 'Ad en fazla 16 harf olabilir';
  if (/[<>]/.test(ad)) return 'Adda < ve > kullanılamaz';
  return null;
}
function hata(mesaj, kod, ek) { return Object.assign(new Error(mesaj), { kod: kod || 400 }, ek || {}); }
/** a***@gmail.com — kilit mesajında kimin hesabı olduğu belli olsun ama tam görünmesin */
function maskele(m) { const [a, b] = m.split('@'); return a.slice(0, 1) + '***@' + b; }
function gunSay(ms) { return Math.max(1, Math.ceil(ms / GUN)); }

function istemciIp(istek) {
  let ip = String(istek.headers['x-forwarded-for'] || '').split(',')[0].trim() || istek.socket.remoteAddress || '';
  ip = ip.replace(/^::ffff:/, '');
  if (ip.includes(':')) ip = ip.split(':').slice(0, 4).join(':'); // IPv6: geçici adres değişse de aynı ağ
  return ip;
}

/** İstekten cihaz izleri. */
function cihazAnahtarlari(istek, v) {
  const l = [];
  const tel = String(v.tel || '').slice(0, 64);
  const and = String(v.cihazNo || '').slice(0, 64);
  const iz = String(v.iz || '').slice(0, 400);
  if (tel) l.push('tel:' + ozet(tel).slice(0, 24));
  if (and) l.push('and:' + ozet(and).slice(0, 24));
  if (iz) l.push('iz:' + ozet(istemciIp(istek) + '|' + iz).slice(0, 24));
  return l;
}

/** Brevo ile kod gönder. Anahtar yoksa (bilgisayarda deneme) kodu geri verir. */
async function mailGonder(mail, kod) {
  const anahtar = process.env.BREVO_API_KEY, gonderen = process.env.MAIL_GONDEREN;
  if (!anahtar || !gonderen) {
    if (process.env.RENDER) throw hata('Mail servisi henüz kurulmadı', 503);
    console.log(`[deneme] ${mail} giriş kodu: ${kod}`);
    return { deneme: kod };
  }
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': anahtar, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      sender: { email: gonderen, name: 'Sayı Bulmaca' },
      to: [{ email: mail }],
      subject: `Sayı Bulmaca giriş kodun: ${kod}`,
      htmlContent: `<div style="font-family:sans-serif;font-size:16px">
        <p>Sayı Bulmaca'ya giriş kodun:</p>
        <p style="font-size:34px;letter-spacing:8px;font-weight:bold">${kod}</p>
        <p>Kod 10 dakika geçerli. Bu girişi sen istemediysen bu maili yok sayabilirsin.</p></div>`,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) {
    console.error('Brevo hatası', r.status, (await r.text()).slice(0, 300));
    throw hata('Kod gönderilemedi, biraz sonra tekrar dene', 502);
  }
  return {};
}

function hesapModulu(depo) {
  const ipSayac = new Map();    // ip -> [zaman] (kod isteği sınırı)
  const oturumBellek = new Map(); // anahtar -> {hesap, zaman}

  /** Bu cihaz son 14 günde başka bir hesaba bağlandıysa hata. */
  async function kilitDenetle(anahtarlar, hesapId) {
    const simdi = Date.now();
    for (const b of await depo.cihazBaglari(anahtarlar)) {
      if (b.hesapId === hesapId || simdi - b.zaman >= CIHAZ_KILIDI) continue;
      const diger = await depo.hesapId(b.hesapId);
      throw hata(`Bu cihazda ${diger ? maskele(diger.mail) : 'başka bir'} hesabı açılmış. Başka bir hesapla ${gunSay(b.zaman + CIHAZ_KILIDI - simdi)} gün sonra girebilirsin.`, 403, { kilit: true });
    }
  }

  return {
    /** 1. adım: maile kod gönder. */
    async kodIste(istek, v) {
      const mail = temizMail(v.mail);
      if (!mailGecerli(mail)) throw hata('Geçerli bir mail adresi yaz');
      const ip = istemciIp(istek), simdi = Date.now();
      const l = (ipSayac.get(ip) || []).filter(t => simdi - t < 3600 * 1000);
      if (l.length >= 10) throw hata('Çok fazla kod istendi, bir saat sonra tekrar dene', 429);
      const onceki = await depo.kodAl(mail);
      if (onceki && simdi - onceki.gonderim < 60 * 1000) throw hata('Yeni kod için 1 dakika bekle', 429);
      const hesap = await depo.hesapMail(mail);
      await kilitDenetle(cihazAnahtarlari(istek, v), hesap ? hesap.id : -1);
      const kod = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
      const sonuc = await mailGonder(mail, kod);
      await depo.kodKoy(mail, ozet(mail + '|' + kod), simdi + KOD_OMRU, simdi);
      l.push(simdi); ipSayac.set(ip, l);
      return Object.assign({ tamam: true, yeni: !hesap }, sonuc);
    },

    /** 2. adım: kodu doğrula, gerekirse hesap aç, oturum ver. */
    async dogrula(istek, v) {
      const mail = temizMail(v.mail);
      const k = await depo.kodAl(mail);
      if (!k || Date.now() > k.bitis) throw hata('Kodun süresi doldu, yeni kod iste');
      if (k.deneme >= 5) throw hata('Çok fazla yanlış deneme, yeni kod iste');
      if (ozet(mail + '|' + String(v.kod || '').trim()) !== k.kod) {
        await depo.kodDeneme(mail);
        throw hata(`Kod yanlış (${4 - k.deneme} hakkın kaldı)`);
      }
      let hesap = await depo.hesapMail(mail);
      if (!hesap) {
        const h = adHatasi(v.ad);
        if (h) throw hata(h, 400, { adGerekli: true }); // kod harcanmaz, ad yazılıp yeniden gönderilir
      }
      const anahtarlar = cihazAnahtarlari(istek, v);
      await kilitDenetle(anahtarlar, hesap ? hesap.id : -1);
      const simdi = Date.now();
      if (!hesap) hesap = await depo.hesapOlustur(mail, String(v.ad).trim(), simdi);
      await depo.kodSil(mail);
      await depo.cihazBagla(anahtarlar, hesap.id, simdi);
      const oturum = crypto.randomBytes(32).toString('hex');
      await depo.oturumEkle(ozet(oturum), hesap.id, simdi);
      return { oturum, hesap: this.goster(hesap) };
    },

    /** İstekteki oturumun hesabı (yoksa null). Kısa süre bellekte tutulur. */
    async oturumdan(istek) {
      const o = String(istek.headers['x-oturum'] || '');
      if (!/^[0-9a-f]{64}$/.test(o)) return null;
      const a = ozet(o);
      const b = oturumBellek.get(a);
      if (b && Date.now() - b.zaman < 5 * 60 * 1000) return b.hesap;
      const hesap = await depo.oturumHesap(a);
      if (hesap) oturumBellek.set(a, { hesap, zaman: Date.now() }); else oturumBellek.delete(a);
      return hesap;
    },
    async cikis(istek) {
      const o = String(istek.headers['x-oturum'] || '');
      if (!o) return;
      const a = ozet(o);
      oturumBellek.delete(a);
      await depo.oturumSil(a);
    },

    async adDegistir(hesap, ad) {
      const h = adHatasi(ad);
      if (h) throw hata(h);
      ad = String(ad).trim();
      const kalan = hesap.adDegisti + AD_ARALIGI - Date.now();
      if (ad === hesap.ad) return this.goster(hesap);
      if (kalan > 0) throw hata(`İsmini ${gunSay(kalan)} gün sonra değiştirebilirsin (3 günde bir)`);
      const simdi = Date.now();
      await depo.adDegistir(hesap.id, ad, simdi);
      hesap.ad = ad; hesap.adDegisti = simdi;
      for (const b of oturumBellek.values()) if (b.hesap.id === hesap.id) Object.assign(b.hesap, { ad, adDegisti: simdi });
      return this.goster(hesap);
    },

    /** Telefona gidecek hesap bilgisi. */
    goster(h) {
      return { mail: h.mail, ad: h.ad, adDegisebilir: Math.max(0, h.adDegisti + AD_ARALIGI - Date.now()) };
    },
  };
}

module.exports = { hesapModulu, cihazAnahtarlari, adHatasi, CIHAZ_KILIDI, AD_ARALIGI };
