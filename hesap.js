/*
 * Sayı Bulmaca — hesaplar ve mail ile giriş.
 *
 *  - Giriş: mail adresine 6 haneli kod gider (Brevo), kod 10 dakika geçerli,
 *    en çok 5 deneme. Kod ve oturum anahtarı veritabanında yalnızca özet
 *    (sha256) olarak durur. Oturum 90 gün geçerli.
 *  - Deneme hakkı veritabanında TEK ADIMDA düşülür (UPDATE ... RETURNING):
 *    aynı anda yüzlerce tahmin gönderilse de en çok 5'i kontrol edilir.
 *  - Kod gönderme sınırları (mail kotasını ve başkalarının gelen kutusunu
 *    korumak için): bir adrese dakikada 1 / saatte 5, bir ağdan saatte 10,
 *    sunucu geneli günde 150 mail.
 *  - Bir cihazda bir hesapla girildikten sonra o cihazda 14 gün başka hesapla
 *    girilemez. Cihaz şu izlerle tanınır (biri tutsa yeter):
 *      tel: telefonun/tarayıcının kendi rastgele kimliği
 *      and: Android uygulamasının gerçek cihaz kimliği (yeni APK'da)
 *    "Ağ adresi + telefonun özellikleri" izi 17.11'de kullanıcı isteğiyle
 *    KALDIRILDI: aynı Wi-Fi'daki aynı model iki telefonu (ör. iki aynı iPhone)
 *    tek cihaz sanıp masum birini 14 gün kilitleyebiliyordu. Bedeli: aynı
 *    telefonda uygulama ile tarayıcı ayrı cihaz sayılır.
 *  - İsim en fazla 3 günde bir değiştirilir.
 */
'use strict';
const crypto = require('crypto');

const GUN = 24 * 3600 * 1000;
const SAAT = 3600 * 1000;
const CIHAZ_KILIDI = 14 * GUN;
const AD_ARALIGI = 3 * GUN;
const KOD_OMRU = 10 * 60 * 1000;
const OTURUM_OMRU = 90 * GUN;
const GUNLUK_MAIL_SINIRI = 150;

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
function gunSay(ms) { return Math.max(1, Math.ceil(ms / GUN)); }
function esitMi(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/**
 * İsteği yapanın ağ adresi.
 * Render'da ölçüldü (17.11.2026): X-Forwarded-For = "<telefonun yazdığı>, <gerçek>,
 * <Cloudflare>, <Render iç adresi 10.x>" — en soldakini telefon uydurabilir,
 * en sağdaki herkes için aynı. CF-Connecting-IP'yi Render'ın önündeki
 * Cloudflare kendisi koyar; sahte değer gönderilince Cloudflare ya ezer ya
 * isteği reddeder (ölçüldü). Bilgisayardaki denemede ilk X-Forwarded-For.
 */
function istemciIp(istek) {
  let ip = '';
  if (process.env.RENDER) ip = String(istek.headers['cf-connecting-ip'] || '').trim();
  if (!ip) ip = String(istek.headers['x-forwarded-for'] || '').split(',')[0].trim() || istek.socket.remoteAddress || '';
  ip = ip.replace(/^::ffff:/, '');
  if (ip.includes(':')) ip = ip.split(':').slice(0, 4).join(':'); // IPv6: geçici adres değişse de aynı ağ
  return ip;
}
/** İstek bu bilgisayarın kendisinden mi (bilgisayardaki deneme sunucusu)? */
function yereldenMi(istek) {
  const a = String(istek.socket.remoteAddress || '');
  return !istek.headers['x-forwarded-for'] && (a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1');
}

/** İstekten cihaz izleri. */
function cihazAnahtarlari(istek, v) {
  const l = [];
  const tel = String(v.tel || '').slice(0, 64);
  const and = String(v.cihazNo || '').slice(0, 64);
  if (tel) l.push('tel:' + ozet(tel).slice(0, 24));
  if (and) l.push('and:' + ozet(and).slice(0, 24));
  return l;
}

/**
 * Mail sağlığı (düzenli kontrol için, gizli bilgi yok): son başarılı gönderim
 * ve son hata zamanı + Brevo'nun durum kodu. Sunucu yeniden başlayınca sıfırlanır.
 */
const posta = { sonBasari: 0, sonHata: 0, sonHataKodu: null };
function postaDurumu() {
  const s = Date.now();
  const yeniHata = posta.sonHata && s - posta.sonHata < GUN && posta.sonHata > posta.sonBasari;
  return { sorun: !!yeniHata, sonHataKodu: yeniHata ? posta.sonHataKodu : null,
    sonBasari: posta.sonBasari ? new Date(posta.sonBasari).toISOString() : null };
}

/**
 * Brevo ile kod gönder. Mail servisi kurulu değilse kod YALNIZCA bu
 * bilgisayardan gelen isteğe geri verilir (deneme); başka her yerde hata.
 */
async function mailGonder(istek, mail, kod) {
  const anahtar = process.env.BREVO_API_KEY, gonderen = process.env.MAIL_GONDEREN;
  if (!anahtar || !gonderen) {
    // Kod yalnızca bu bilgisayardaki denemede geri verilir (testler için YEREL_DENEME=1); Render'da asla
    if (process.env.RENDER || !(yereldenMi(istek) || process.env.YEREL_DENEME === '1')) throw hata('Mail servisi henüz kurulmadı', 503);
    console.log(`[deneme] ${mail} giriş kodu: ${kod}`);
    return { deneme: kod };
  }
  let r;
  try {
    r = await fetch('https://api.brevo.com/v3/smtp/email', {
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
  } catch (e) {
    posta.sonHata = Date.now(); posta.sonHataKodu = 'baglanti';
    console.error('Brevo bağlantı hatası', e.message);
    throw hata('Kod gönderilemedi, biraz sonra tekrar dene', 502);
  }
  if (!r.ok) {
    posta.sonHata = Date.now(); posta.sonHataKodu = r.status;
    console.error('Brevo hatası', r.status, (await r.text()).slice(0, 300));
    throw hata('Kod gönderilemedi, biraz sonra tekrar dene', 502);
  }
  posta.sonBasari = Date.now();
  return {};
}

/** Zaman pencereli sayaç: anahtar başına son olayların zamanları. */
function sayac(pencere) {
  const m = new Map();
  return {
    say(k, simdi) { const l = (m.get(k) || []).filter(t => simdi - t < pencere); m.set(k, l); return l.length; },
    ekle(k, simdi) { const l = m.get(k) || []; l.push(simdi); m.set(k, l); },
    temizle(simdi) { for (const [k, l] of m) if (!l.some(t => simdi - t < pencere)) m.delete(k); },
  };
}

function hesapModulu(depo) {
  const oturumBellek = new Map(); // anahtar -> {hesap, zaman}
  const ipKod = sayac(SAAT);         // ağ başına kod isteği
  const mailKodSaat = sayac(SAAT);   // adres başına kod (saatte 5)
  const mailKodDakika = sayac(60 * 1000);
  const mailHata = sayac(GUN);       // adres başına yanlış kod (günde 20)
  const ipHata = sayac(SAAT);        // ağ başına yanlış kod (saatte 50)
  let gunlukMail = { gun: '', sayi: 0 };
  setInterval(() => {
    const s = Date.now();
    [ipKod, mailKodSaat, mailKodDakika, mailHata, ipHata].forEach(x => x.temizle(s));
    for (const [k, b] of oturumBellek) if (s - b.zaman > 5 * 60 * 1000) oturumBellek.delete(k);
  }, 10 * 60 * 1000).unref();

  /** Bu cihaz son 14 günde başka bir hesaba bağlandıysa hata. */
  async function kilitDenetle(anahtarlar, hesapId) {
    const simdi = Date.now();
    for (const b of await depo.cihazBaglari(anahtarlar)) {
      if (b.hesapId === hesapId || simdi - b.zaman >= CIHAZ_KILIDI) continue;
      throw hata(`Bu cihazda başka bir hesap açık. Başka bir hesapla ${gunSay(b.zaman + CIHAZ_KILIDI - simdi)} gün sonra girebilirsin.`, 403, { kilit: true });
    }
  }

  return {
    /** 1. adım: maile kod gönder. Hesabın olup olmadığını SÖYLEMEZ. */
    async kodIste(istek, v) {
      const mail = temizMail(v.mail);
      if (!mailGecerli(mail)) throw hata('Geçerli bir mail adresi yaz');
      if (!v.tel) throw hata('Cihaz bilgisi eksik, sayfayı yenile');
      const ip = istemciIp(istek), simdi = Date.now();
      const gun = new Date(simdi).toISOString().slice(0, 10);
      if (gunlukMail.gun !== gun) gunlukMail = { gun, sayi: 0 };
      // Sınırlar beklemeden (await) ÖNCE denetlenip yazılır: aynı anda gelen istekler de sayılır
      if (gunlukMail.sayi >= GUNLUK_MAIL_SINIRI) throw hata('Bugün çok fazla kod gönderildi, yarın tekrar dene', 429);
      if (mailKodDakika.say(mail, simdi) >= 1) throw hata('Yeni kod için 1 dakika bekle', 429);
      if (mailKodSaat.say(mail, simdi) >= 5) throw hata('Bu adrese çok fazla kod gönderildi, bir saat sonra dene', 429);
      if (ipKod.say(ip, simdi) >= 10) throw hata('Çok fazla kod istendi, bir saat sonra tekrar dene', 429);
      mailKodDakika.ekle(mail, simdi); mailKodSaat.ekle(mail, simdi); ipKod.ekle(ip, simdi); gunlukMail.sayi++;

      const hesap = await depo.hesapMail(mail);
      await kilitDenetle(cihazAnahtarlari(istek, v), hesap ? hesap.id : -1);
      const kod = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
      const sonuc = await mailGonder(istek, mail, kod);
      await depo.kodKoy(mail, ozet(mail + '|' + kod), simdi + KOD_OMRU, simdi);
      return Object.assign({ tamam: true }, sonuc);
    },

    /** 2. adım: kodu doğrula, gerekirse hesap aç, oturum ver. */
    async dogrula(istek, v) {
      const mail = temizMail(v.mail);
      const ip = istemciIp(istek), simdi = Date.now();
      if (!v.tel) throw hata('Cihaz bilgisi eksik, sayfayı yenile');
      if (mailHata.say(mail, simdi) >= 20 || ipHata.say(ip, simdi) >= 50) throw hata('Çok fazla yanlış deneme, daha sonra tekrar dene', 429);
      // Deneme hakkını tek adımda düş; hak yoksa ya da süre dolduysa satır gelmez
      const k = await depo.kodHakKullan(mail, simdi);
      if (!k) throw hata('Kod geçersiz ya da süresi doldu, yeni kod iste');
      if (!esitMi(ozet(mail + '|' + String(v.kod || '').trim()), k.kod)) {
        mailHata.ekle(mail, simdi); ipHata.ekle(ip, simdi);
        const kalan = 5 - k.deneme;
        throw hata(kalan > 0 ? `Kod yanlış (${kalan} hakkın kaldı)` : 'Kod yanlış, yeni kod iste');
      }
      let hesap = await depo.hesapMail(mail);
      if (!hesap) {
        const h = adHatasi(v.ad);
        if (h) { await depo.kodIade(mail); throw hata(h, 400, { adGerekli: true }); } // doğru kod: hak geri verilir, ad yazılıp yeniden gönderilir
      }
      const anahtarlar = cihazAnahtarlari(istek, v);
      await kilitDenetle(anahtarlar, hesap ? hesap.id : -1);
      if (!hesap) hesap = await depo.hesapOlustur(mail, String(v.ad).trim(), simdi);
      await depo.kodSil(mail);
      await depo.cihazBagla(anahtarlar, hesap.id, simdi);
      const oturum = crypto.randomBytes(32).toString('hex');
      await depo.oturumEkle(ozet(oturum), hesap.id, simdi);
      return { oturum, hesap: this.goster(hesap) };
    },

    /** İstekteki oturumun hesabı (yoksa ya da 90 günü geçtiyse null). Kısa süre bellekte tutulur. */
    async oturumdan(istek) {
      const o = String(istek.headers['x-oturum'] || '');
      if (!/^[0-9a-f]{64}$/.test(o)) return null;
      const a = ozet(o);
      const b = oturumBellek.get(a);
      if (b && Date.now() - b.zaman < 5 * 60 * 1000) return b.hesap;
      const hesap = await depo.oturumHesap(a);
      if (hesap && Date.now() - hesap.oturumZamani > OTURUM_OMRU) { await depo.oturumSil(a); oturumBellek.delete(a); return null; }
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

module.exports = { hesapModulu, cihazAnahtarlari, istemciIp, yereldenMi, adHatasi, postaDurumu, CIHAZ_KILIDI, AD_ARALIGI };
