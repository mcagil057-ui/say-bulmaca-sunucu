/*
 * Sayı Bulmaca — telefondaki/tarayıcıdaki arayüz.
 *
 * İki kaynak aynı biçimde "durum" üretir, arayüz ikisini ayırt etmez:
 *   Cevrimici : sunucudaki odaya bağlanır (arkadaşla oyun)
 *   YerelOda  : maç telefonda döner, rakip bot (internet gerekmez)
 */
'use strict';

const API = (window.SB_SUNUCU || '').replace(/\/$/, '');
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const depo = {
  al(k, v) { try { const x = localStorage.getItem(k); return x == null ? v : x; } catch (e) { return v; } },
  koy(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* gizli sekme */ } },
};
function jsonAl(k, v) { try { return JSON.parse(depo.al(k, '')) || v; } catch (e) { return v; } }

let ID = depo.al('sb_id');
if (!ID) {
  ID = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join('');
  depo.koy('sb_id', ID);
}

const SEVIYE_AD = { kolay: 'Kolay', orta: 'Orta', zor: 'Zor' };

const S = {
  alt: null,                 // giriş ekranında açık bölüm: null | 'katil' | 'bot'
  kaynak: null,              // Cevrimici | YerelOda
  d: null,                   // son gelen durum
  girdi: '',                 // yazılmakta olan sayı
  cevap: { arti: 0, eksi: 0 },
  tablo: new Array(10).fill(0), // 0 boş, 1 yok (çizili), 2 var (yeşil)
  tabloAnahtar: null,
  ofset: 0,                  // sunucu saati - telefon saati
  sonOlay: 0,
  sonucKapali: false,
  kurallar: false,
  baglanti: true,
  mesgul: false,
  botSeviye: depo.al('sb_bot', 'orta'),
  botAyar: Oyun.ayarDuzelt(jsonAl('sb_botayar', {})),
  botMod: 'klasik',          // 'klasik' (1 bot) | 'yaris' (1–3 bot) — yarış şimdilik kapalı (BOT_YARIS_ACIK)
  botYaris: jsonAl('sb_botyaris', { kolay: 0, orta: 1, zor: 0 }),
  botHiz: depo.al('sb_bothiz', 'uyumlu'),
  katilKod: '',
  acikOdalar: [],
  agAdres: null,             // aynı Wi-Fi'dakilerin açacağı adres
  sohbetAcik: false,
  sohbetSon: null,           // gördüğüm son mesaj numarası (null = oda yeni açıldı)
  sohbetOkunan: 0,           // okuduğum son mesaj numarası
  hesap: null,               // giriş yapılmış hesap {mail, ad, adDegisebilir}
  giris: null,               // giriş ekranının durumu
  adModal: false,
  cevrimdisi: false,
  analiz: null,              // maç analizi açık mı: null | 'ben' | 'rakip'
  g: null,                   // günün bulmacası
  gSiralama: false,
};

const HAZIR_MESAJLAR = ['Selam! 👋', 'İyi şanslar!', 'Hadi sıra sende', 'Güzel soru 👏', 'Çok yaklaştın!',
  'Bunu bulamazsın 😏', 'Bir dakika…', 'Tebrikler 🎉', 'Rövanş?', 'İyi oyundu 🤝'];
const EMOJILER = ['😀', '😂', '😎', '🤔', '😮', '😅', '😡', '😭', '👏', '🔥', '🎉', '👍', '❤️', '🙈'];

// Oyun bu bilgisayarda "localhost" ile açıldıysa başkaları o adresi
// kullanamaz; sunucudan Wi-Fi adresini öğreniyoruz.
const YEREL_ACILIS = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
async function agAdresiOgren() {
  if (!YEREL_ACILIS) { S.agAdres = location.origin + '/'; return; }
  try {
    const r = await fetch(API + '/api/adres').then(x => x.json());
    S.agAdres = (r.adresler && r.adresler[0]) || null;
  } catch (e) { S.agAdres = null; }
}

// ------------------------------------------------------------ yardımcılar
function adim() { return (S.hesap && S.hesap.ad) || 'Oyuncu'; }

let bildirimZaman;
function bildir(metin, tur) {
  const b = $('#bildirim');
  b.textContent = metin;
  b.className = 'goster ' + (tur || '');
  clearTimeout(bildirimZaman);
  bildirimZaman = setTimeout(() => { b.className = ''; }, tur === 'kotu' ? 4200 : 3000);
}
function titret(ms) { try { navigator.vibrate && navigator.vibrate(ms || 60); } catch (e) { /* yok */ } }

async function istek(yol, govde) {
  const r = await fetch(API + yol, {
    method: 'POST',
    body: JSON.stringify(Object.assign({ id: ID }, govde)),
    headers: basliklar({ 'Content-Type': 'application/json' }),
  });
  let v = {};
  try { v = await r.json(); } catch (e) { /* boş */ }
  if (r.status === 401 && v.girisGerekli) { girisGerekli(); throw Object.assign(new Error('Yeniden giriş yapman gerekiyor'), { kod: 401 }); }
  if (!r.ok) throw Object.assign(new Error(v.hata || ('Sunucu ' + r.status)), { kod: r.status });
  return v;
}

function cevapHTML(a, e) {
  if (!a && !e) return '<span class="c sifir">0</span>';
  return (a ? `<span class="c arti">+${a}</span>` : '') + (e ? `<span class="c eksi">−${e}</span>` : '');
}
function cevapMetin(a, e) {
  if (!a && !e) return '0';
  return [a ? '+' + a : '', e ? '−' + e : ''].filter(Boolean).join(' ');
}
/**
 * Sayıyı rakam rakam yazar. renkli=true ise eleme tablosunda işaretlediğim
 * rakamlar soluk/yeşil görünür — bu yalnızca KENDİ sorduğum sorular için;
 * rakibin soruları ve kendi sayım tablodan etkilenmez.
 */
function sayiHTML(s, renkli, tablo) {
  const t = tablo || S.tablo;
  return '<span class="sayi">' + String(s).split('').map(c =>
    `<i class="r${renkli ? (t[+c] || 0) : 0}">${c}</i>`).join('') + '</span>';
}
/** Oda skoru: "Ben 2 – 1 Ali · 1 berabere" */
function skorHTML(d) {
  const o = d.oda;
  if (!o || !o.oyuncular || o.oyuncular.length < 2) return '';
  const ben = o.oyuncular.find(x => x.ben), rakip = o.oyuncular.find(x => !x.ben);
  const g1 = ben.galibiyet || 0, g2 = rakip.galibiyet || 0, b = o.berabere || 0;
  if (!g1 && !g2 && !b) return '';
  return `<div class="skor-serit"><span>${esc(ben.ad)}</span><b>${g1} – ${g2}</b><span>${esc(rakip.ad)}</span>${b ? `<small>${b} berabere</small>` : ''}</div>`;
}
function haklar(yanlis, toplam, oto) {
  if (oto) return ''; // otomatik cevapta yanlış cevap olmaz
  let s = '';
  for (let i = 0; i < toplam; i++) s += `<b class="${i < yanlis ? 'gitti' : ''}"></b>`;
  return `<span class="haklar" title="Yanlış cevap: ${yanlis}/${toplam}">${s}</span>`;
}

/** Şu an hamle sırası bende mi (sayı seçmek, soru sormak ya da cevap vermek)? */
function hamleBende(d) {
  const m = d && d.mac;
  if (!m) return false;
  if (m.tur === 'yaris') return m.faz === 'oyun' && !m.ben.cekildi;
  if (m.faz === 'gizli') return !m.ben.hazir;
  if (m.faz !== 'oyun') return false;
  return m.asama === 'tahmin' ? m.siraBende : !m.siraBende;
}

// ------------------------------------------------------------ kaynaklar
class Cevrimici {
  constructor(kod) {
    this.kod = kod;
    this.surum = -1;
    this.hata = 0;
    depo.koy('sb_oda', kod);
    this.dongu();
  }
  /**
   * Uzun bekleme döngüsü: "sürüm N'den yenisi var mı?" diye sorar, sunucu
   * bir şey değişince hemen ya da 25 sn sonra cevaplar, hemen yeniden sorar.
   * (Canlı akış Cloudflare tünelinde takılıyordu; bu her yerden geçer.)
   */
  async dongu() {
    while (!this.kapandi) {
      this.iptal = new AbortController();
      const saat = setTimeout(() => this.iptal.abort(), 40000);
      try {
        const r = await fetch(`${API}/api/bekle?kod=${encodeURIComponent(this.kod)}&surum=${this.surum}`,
          { signal: this.iptal.signal, cache: 'no-store', headers: basliklar() });
        clearTimeout(saat);
        if (this.kapandi) return;
        if (r.status === 401) { girisGerekli(); return; }
        if (r.status === 404) { anaMenu(); bildir('Oda kapanmış (sunucu yeniden başlamış olabilir).', 'kotu'); return; }
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const v = await r.json();
        this.hata = 0;
        const dondu = !S.baglanti;
        S.baglanti = true;
        if (v.surum !== this.surum) { this.surum = v.surum; durumGeldi(v.durum); }
        else if (dondu) ciz();
      } catch (e) {
        clearTimeout(saat);
        if (this.kapandi) return;
        this.hata++;
        if (this.hata >= 2 && S.baglanti) { S.baglanti = false; ciz(); }
        await new Promise(c => setTimeout(c, Math.min(5000, 600 * this.hata)));
      }
    }
  }
  async eylem(tur, veri) {
    await istek('/api/eylem', Object.assign({ kod: this.kod, tur }, veri || {}));
  }
  kapat() {
    this.kapandi = true;
    this.iptal && this.iptal.abort();
    depo.koy('sb_oda', null);
  }
}

class YerelOda {
  constructor(seviye, ayar) {
    this.seviye = seviye;
    this.kisilik = BOT_KISILIK[seviye];
    this.ayar = Oyun.ayarDuzelt(ayar);
    this.macNo = 0;
    this.mac = null;
    this.sohbet = [];
    this.mesajNo = 0;
    this.saatler = [];
    this.skor = { ben: 0, bot: 0, berabere: 0 };
    this.yeniMac();
    this.botYaz(this.sec('basla'), 1200);
  }
  yeniMac() {
    const baslayan = this.mac ? 1 - this.mac.baslayan : (Math.random() < 0.5 ? 0 : 1);
    this.macNo++;
    this.mac = new Oyun.Mac(this.ayar, [adim(), this.kisilik.simge + ' ' + this.kisilik.ad], baslayan);
    this.mac.gizliBelirle(1, Oyun.rastgeleSayi(this.ayar));
    this.gorulen = 0; // yorum yapılan son kayıt
    this.yayinla();
  }
  durum() {
    return {
      oda: {
        kod: null, bot: this.seviye, ayar: this.ayar, kurucuBen: true, macNo: this.macNo, faz: 'mac', berabere: this.skor.berabere,
        oyuncular: [{ ad: adim(), bagli: true, ben: true, galibiyet: this.skor.ben }, { ad: this.mac.oyuncular[1].ad, bagli: true, ben: false, galibiyet: this.skor.bot }],
      },
      mac: this.mac.gorunum(0),
      sohbet: this.sohbet.slice(),
      simdi: Date.now(),
    };
  }
  sec(tur) { const l = this.kisilik[tur]; return l[Math.floor(Math.random() * l.length)]; }
  /** Bot sohbete yazar (biraz bekleyip, insan gibi). */
  botYaz(metin, gecikme) {
    this.saatler.push(setTimeout(() => {
      if (this.kapandi) return;
      this.sohbet.push({ no: ++this.mesajNo, ad: this.mac.oyuncular[1].ad, metin, ben: false });
      durumGeldi(this.durum());
    }, gecikme || 1000 + Math.random() * 1200));
  }
  /** Yeni cevaplara ve maç sonuna göre bot ara sıra yorum yapar. */
  yorumla() {
    const m = this.mac, N = m.ayar.basamak;
    if (m.faz === 'bitti' && !m.skorlandi) {
      m.skorlandi = true;
      const k = m.sonuc.kazanan;
      if (k === -1) { this.skor.berabere++; this.botYaz(this.sec('berabere'), 900); }
      else if (k === 1) { this.skor.bot++; this.botYaz(this.sec('buldum'), 900); }
      else { this.skor.ben++; this.botYaz(this.sec('kaybettim'), 900); }
      return;
    }
    const yeni = m.kayitlar.slice(this.gorulen);
    this.gorulen = m.kayitlar.length;
    const k = yeni[yeni.length - 1];
    if (!k || !k.tahmin || k.arti === N) return;
    const bot = k.kim === 1;
    if (k.arti + k.eksi === 0 && Math.random() < 0.45) this.botYaz(this.sec(bot ? 'benSifir' : 'senSifir'));
    else if (k.arti >= N - 1 && Math.random() < 0.6) this.botYaz(this.sec(bot ? 'benYakin' : 'senYakin'));
  }
  yayinla() {
    this.yorumla();
    durumGeldi(this.durum());
    this.zamanla();
    this.botOyna();
  }
  zamanla() {
    clearTimeout(this.saat);
    const m = this.mac;
    if (m.faz !== 'oyun' || !m.bitis) return;
    this.saat = setTimeout(() => { if (m.sureKontrol()) this.yayinla(); else this.zamanla(); },
      Math.max(0, m.bitis - Date.now()) + 30);
  }
  botOyna() {
    clearTimeout(this.botSaat);
    const m = this.mac;
    if (m.faz !== 'oyun') return;
    if (m.sira === 1 && m.asama === 'tahmin') {
      this.botSaat = setTimeout(() => {
        const gecmis = m.kayitlar.filter(k => k.kim === 1 && k.tahmin).map(k => ({ tahmin: k.tahmin, arti: k.arti, eksi: k.eksi }));
        m.tahminEt(1, Oyun.botTahmin(this.seviye, m.ayar, gecmis));
        this.yayinla();
      }, 1300 + Math.random() * 1700);
    } else if (m.sira === 0 && m.asama === 'cevap') {
      this.botSaat = setTimeout(() => {
        const p = Oyun.puanla(m.oyuncular[1].gizli, m.bekleyen);
        m.cevapVer(1, p.arti, p.eksi);
        this.yayinla();
      }, 900 + Math.random() * 1100);
    }
  }
  async eylem(tur, v) {
    v = v || {};
    const m = this.mac;
    let h = null;
    switch (tur) {
      case 'gizli': h = m.gizliBelirle(0, v.sayi); break;
      case 'tahmin': h = m.tahminEt(0, v.sayi); break;
      case 'cevap': h = m.cevapVer(0, v.arti, v.eksi); break;
      case 'teslim': h = m.teslim(0); break;
      case 'mesaj': {
        const metin = String(v.metin || '').replace(/\s+/g, ' ').trim().slice(0, 120);
        if (!metin) return;
        this.sohbet.push({ no: ++this.mesajNo, ad: adim(), metin, ben: true });
        durumGeldi(this.durum());
        this.botYaz(botCevapla(this.seviye, metin), 1200 + Math.random() * 1500);
        return;
      }
      case 'rovans': this.yeniMac(); return;
      case 'ayril': case 'lobi': this.kapat(); anaMenu('bot'); return;
      default: h = 'Bilinmeyen eylem';
    }
    if (h) throw new Error(h);
    this.yayinla();
  }
  kapat() { this.kapandi = true; clearTimeout(this.saat); clearTimeout(this.botSaat); this.saatler.forEach(clearTimeout); this.mac.faz = 'bitti'; }
}

/**
 * Botlarla YARIŞ: telefonda döner, internet gerekmez. Sen + 1–3 bot aynı
 * sayıyı aynı anda ararsınız; her bot kendi hızında "düşünüp" sorar
 * (kisilik.js: botDusunmeSuresi). İlk bulan kazanır.
 */
class YerelYaris {
  constructor(seviyeler, ayar, hiz) {
    this.ayar = Oyun.ayarDuzelt(Object.assign({}, ayar, { oyunTuru: 'yaris' }));
    this.hiz = hiz;                 // 'uyumlu' | 'yavas' | 'normal' | 'hizli'
    this.seviyeler = seviyeler.slice();
    this.uyumNot = null;
    const say = {};
    this.botlar = seviyeler.map((sv, i) => {
      say[sv] = (say[sv] || 0) + 1;
      const k = BOT_KISILIK[sv];
      const coklu = seviyeler.filter(x => x === sv).length > 1;
      return { id: 'bot' + i, seviye: sv, ad: k.simge + ' ' + k.ad + (coklu ? ' ' + say[sv] : '') };
    });
    this.macNo = 0; this.skor = {}; this.sohbet = []; this.mesajNo = 0;
    this.saatler = []; this.botSaat = {};
    this.yeniMac();
    this.botYaz(this.rastgeleBot(), 'basla', 1200);
  }
  rastgeleBot() { return this.botlar[Math.floor(Math.random() * this.botlar.length)]; }
  sec(b, tur) { const l = BOT_KISILIK[b.seviye][tur]; return l[Math.floor(Math.random() * l.length)]; }
  yeniMac() {
    Object.values(this.botSaat).forEach(clearTimeout);
    // Uyumlu hızda çarpan her yarışın başında güncel değerden alınır
    this.carpan = this.hiz === 'uyumlu' ? uyumCarpani() : (BOT_HIZ.hiz[this.hiz] || 1);
    this.uyumNot = null;
    this.macNo++;
    this.mac = new Oyun.Yaris(this.ayar, [{ id: 'ben', ad: adim() }].concat(this.botlar.map(b => ({ id: b.id, ad: b.ad }))));
    this.yayinla();
    this.botlar.forEach(b => this.botPlanla(b, true));
  }
  durum() {
    return {
      oda: {
        kod: null, bot: 'yaris', ayar: this.ayar, kurucuBen: true, macNo: this.macNo, faz: 'mac', berabere: 0, uyumNot: this.uyumNot,
        oyuncular: [{ ad: adim(), bagli: true, ben: true, galibiyet: this.skor.ben || 0 }]
          .concat(this.botlar.map(b => ({ ad: b.ad, bagli: true, ben: false, galibiyet: this.skor[b.id] || 0 }))),
      },
      mac: this.mac.gorunum('ben'),
      sohbet: this.sohbet.slice(),
      simdi: Date.now(),
    };
  }
  yayinla() { this.sonuclandir(); durumGeldi(this.durum()); }
  /** Yarış bitince: skor + botlardan biri konuşur. */
  sonuclandir() {
    const m = this.mac;
    if (m.faz !== 'bitti' || m.skorlandi) return;
    m.skorlandi = true;
    Object.values(this.botSaat).forEach(clearTimeout);
    if (m.kazanan) this.skor[m.kazanan] = (this.skor[m.kazanan] || 0) + 1;
    if (this.hiz === 'uyumlu') {
      // Botlar oyuncuya göre: kazandıysa hızlanır, kaybettiyse yavaşlar
      const yeni = uyumHesapla(this.carpan, this.seviyeler, this.ayar.basamak, m.kazanan === 'ben', m.sonuc.sure);
      depo.koy('sb_uyum', String(yeni));
      const yuzde = Math.round(Math.abs(this.carpan / yeni - 1) * 100);
      this.uyumNot = yeni < this.carpan ? `⚡ Bir sonraki yarışta botlar %${yuzde} hızlanıyor`
        : yeni > this.carpan ? `🐢 Bir sonraki yarışta botlar %${yuzde} yavaşlıyor` : null;
    }
    if (m.kazanan === 'ben') this.botYaz(this.rastgeleBot(), 'kaybettim', 900);
    else if (m.kazanan) this.botYaz(this.botlar.find(b => b.id === m.kazanan), 'buldum', 900);
  }
  /** Botun bir sonraki sorusunu düşünme süresi sonra sor. */
  botPlanla(b, ilk) {
    clearTimeout(this.botSaat[b.id]);
    const m = this.mac;
    if (m.faz !== 'oyun') return;
    this.botSaat[b.id] = setTimeout(() => {
      if (this.kapandi || this.mac !== m || m.faz !== 'oyun') return;
      const o = m._o(b.id);
      m.tahminEt(b.id, Oyun.botTahmin(b.seviye, m.ayar, o.sorular.map(k => ({ tahmin: k.tahmin, arti: k.arti, eksi: k.eksi }))));
      const son = o.sorular[o.sorular.length - 1];
      if (m.faz === 'oyun' && son && son.arti >= m.ayar.basamak - 1 && Math.random() < 0.35) this.botYaz(b, 'benYakin');
      this.yayinla();
      this.botPlanla(b, false);
    }, botDusunmeSuresi(b.seviye, m.ayar.basamak, this.carpan, ilk));
  }
  /** tur: kişilik satırı türü ya da hazır metin. */
  botYaz(b, tur, gecikme) {
    const metin = BOT_KISILIK[b.seviye][tur] ? this.sec(b, tur) : tur;
    this.saatler.push(setTimeout(() => {
      if (this.kapandi) return;
      this.sohbet.push({ no: ++this.mesajNo, ad: b.ad, metin, ben: false });
      durumGeldi(this.durum());
    }, gecikme || 900 + Math.random() * 1500));
  }
  async eylem(tur, v) {
    v = v || {};
    let h = null;
    switch (tur) {
      case 'tahmin': h = this.mac.tahminEt('ben', String(v.sayi)); break;
      case 'teslim': this.mac.cekil('ben'); break;
      case 'mesaj': {
        const metin = String(v.metin || '').replace(/\s+/g, ' ').trim().slice(0, 120);
        if (!metin) return;
        this.sohbet.push({ no: ++this.mesajNo, ad: adim(), metin, ben: true });
        durumGeldi(this.durum());
        const b = this.rastgeleBot();
        this.botYaz(b, botCevapla(b.seviye, metin), 1200 + Math.random() * 1500);
        return;
      }
      case 'rovans': this.yeniMac(); return;
      case 'ayril': case 'lobi': this.kapat(); anaMenu('bot'); return;
      default: h = 'Bu oyunda yok';
    }
    if (h) throw new Error(h);
    this.yayinla();
  }
  kapat() {
    // Yarış ortasında çıkmak uyumlu hızda kayıp sayılır (botlar yavaşlar)
    if (this.mac.faz === 'oyun' && this.hiz === 'uyumlu' && !this.kapandi) {
      depo.koy('sb_uyum', String(uyumHesapla(this.carpan, this.seviyeler, this.ayar.basamak, false, 0)));
    }
    this.kapandi = true;
    Object.values(this.botSaat).forEach(clearTimeout);
    this.saatler.forEach(clearTimeout);
    if (this.mac.faz === 'oyun') this.mac.cekil('ben');
  }
}

// ------------------------------------------------------------ durum akışı
function durumGeldi(d) {
  S.ofset = d.simdi - Date.now();
  const ilk = !S.d;
  if (d.mac) {
    const anahtar = d.mac.id;
    if (anahtar !== S.tabloAnahtar) {
      // Yeni maç: eleme tablosu temiz başlar. Sayfa yenilenirse aynı maçın
      // tablosu geri gelir; eski maçların kayıtları silinir.
      S.tabloAnahtar = anahtar;
      const kayit = jsonAl('sb_tablo', null);
      S.tablo = kayit && kayit.id === anahtar && Array.isArray(kayit.t) ? kayit.t : new Array(10).fill(0);
      tabloKaydet();
      S.girdi = ''; S.cevap = { arti: 0, eksi: 0 }; S.sonucKapali = false;
      S.sonOlay = 0; // yeni maçta olay sayacı baştan başlıyor
    }
    // Faz değiştiyse (sayı seçimi -> oyun) yarım kalan girdi taşınmasın
    if (S.d && S.d.mac && S.d.mac.faz !== d.mac.faz) S.girdi = '';
    const o = d.mac.olay;
    if (o && o.no > S.sonOlay) {
      S.sonOlay = o.no;
      if (!ilk) olayGoster(o, d.mac);
    }
    // Cevap sırası yeni geldiyse önceki seçim kalmasın
    if (d.mac.asama === 'cevap' && !d.mac.siraBende && d.mac.bekleyen !== (S.d && S.d.mac && S.d.mac.bekleyen)) {
      S.cevap = { arti: 0, eksi: 0 };
    }
  } else {
    S.sonOlay = 0;
  }
  sohbetGeldi(d, ilk);
  if (d.mac && d.mac.faz === 'bitti') macKaydet(d);
  if (!ilk) sesCal(S.d, d);
  if (hamleBende(d) && !hamleBende(S.d)) titret(80);
  if (d.mac && d.mac.faz === 'bitti' && !(S.d && S.d.mac && S.d.mac.faz === 'bitti')) titret([60, 60, 120]);
  S.d = d;
  ciz();
}

/** Durum değişikliğine göre tek bir ses çal (en önemlisi). */
function sesCal(once, d) {
  const m = d.mac, om = once && once.mac;
  if (!m) return;
  const ayniMac = om && om.id === m.id;
  if (m.tur === 'yaris') {
    if (m.faz === 'bitti' && !(ayniMac && om.faz === 'bitti')) { Ses.cal(m.sonuc.kazanan === 'ben' ? 'kazandin' : 'kaybettin'); return; }
    if (ayniMac && m.ben.sorular.length > om.ben.sorular.length) {
      const k = m.ben.sorular[m.ben.sorular.length - 1], N = m.ayar.basamak;
      Ses.cal(k.arti === N ? 'buldu' : k.arti + k.eksi === 0 ? 'sifir' : k.arti >= N - 1 ? 'yakin' : 'cevap');
    }
    return;
  }
  if (m.faz === 'bitti' && !(ayniMac && om.faz === 'bitti')) {
    Ses.cal(m.sonuc.kazanan === 'ben' ? 'kazandin' : m.sonuc.kazanan === 'rakip' ? 'kaybettin' : 'berabere');
    return;
  }
  if (m.olay && m.olay.tur === 'yanlis' && !(ayniMac && om.olay && om.olay.no === m.olay.no)) { Ses.cal('yanlis'); return; }
  const N = m.ayar.basamak;
  if (ayniMac && m.sorularim.length > om.sorularim.length) {
    const k = m.sorularim[m.sorularim.length - 1];
    if (k.tahmin) {
      Ses.cal(k.arti === N ? 'buldu' : k.arti + k.eksi === 0 ? 'sifir' : k.arti >= N - 1 ? 'yakin' : 'cevap');
      return;
    }
  }
  if (hamleBende(d) && !hamleBende(once)) Ses.cal('sira');
}

function tabloKaydet() {
  depo.koy('sb_tablo', JSON.stringify({ id: S.tabloAnahtar, t: S.tablo }));
  // eski sürümün maç maç tuttuğu kayıtları temizle
  try { Object.keys(localStorage).filter(k => k.startsWith('sb_tablo_')).forEach(k => localStorage.removeItem(k)); } catch (e) { /* yok */ }
}

/** Yeni mesaj geldiyse: sohbet kapalıysa bildirim + okunmamış sayısı. */
function sohbetGeldi(d, ilk) {
  const l = d.sohbet;
  if (!l) return;
  const son = l.length ? l[l.length - 1].no : 0;
  if (S.sohbetSon == null || ilk) {
    // odaya yeni girdim / sayfa yenilendi: eski mesajlar için bildirim yok
    S.sohbetSon = son; S.sohbetOkunan = son;
    return;
  }
  const yeni = l.filter(x => x.no > S.sohbetSon && !x.ben);
  S.sohbetSon = son;
  if (S.sohbetAcik) { S.sohbetOkunan = son; if (yeni.length) Ses.cal('mesaj'); return; }
  if (yeni.length) Ses.cal('mesaj');
  if (yeni.length) {
    const x = yeni[yeni.length - 1];
    bildir(`💬 ${x.ad}: ${x.metin}`);
    titret(40);
  }
}
function okunmamis(d) {
  if (!d || !d.sohbet) return 0;
  return d.sohbet.filter(x => !x.ben && x.no > S.sohbetOkunan).length;
}
function sohbetDugme(d) {
  if (!d || !d.sohbet) return '<span></span>';
  const n = okunmamis(d);
  return `<button class="geri-ok sohbet-dugme" data-e="sohbetAc" aria-label="Sohbet">💬${n ? `<b class="rozet-sayi">${n > 9 ? '9+' : n}</b>` : ''}</button>`;
}

function olayGoster(o, m) {
  const ben = o.kim === 'ben';
  switch (o.tur) {
    case 'soru':
      if (!ben) bildir(`${m.rakip.ad} ${o.tahmin} sordu → ${cevapMetin(o.arti, o.eksi)}`);
      break;
    case 'yanlis':
      if (ben) bildir(`Yanlış cevap! Doğrusu ${cevapMetin(o.gercek.arti, o.gercek.eksi)}. Kalan hakkın: ${o.kalan}`, 'kotu');
      else bildir(`Rakip yanlış cevap yazdı (${cevapMetin(o.verilen.arti, o.verilen.eksi)}). Doğrusu: ${cevapMetin(o.gercek.arti, o.gercek.eksi)}`, 'iyi');
      titret([40, 40, 40]);
      break;
    case 'sureTahmin':
      bildir(ben ? 'Süren doldu, sıra rakibe geçti.' : 'Rakibin süresi doldu, sıra sende!', ben ? 'kotu' : 'iyi');
      break;
    case 'sureCevap':
      bildir(ben ? `Cevap süren doldu, yanlış sayıldı. Kalan hakkın: ${o.kalan}` : 'Rakip zamanında cevap veremedi, hakkı düştü.', ben ? 'kotu' : 'iyi');
      break;
    case 'sonSans':
      bildir(ben ? 'Buldun! Ama rakibin son bir hakkı var…' : 'Rakip sayını buldu! Son hakkın: bulursan berabere.', ben ? 'iyi' : 'kotu');
      break;
  }
}

function anaMenu(alt) {
  if (S.kaynak) S.kaynak.kapat();
  S.kaynak = null; S.d = null; S.girdi = ''; S.tabloAnahtar = null; S.sonOlay = 0;
  S.sohbetAcik = false; S.sohbetSon = null; S.sohbetOkunan = 0; S.analiz = null;
  S.alt = alt || null;
  ciz();
}

async function baglan(kod) {
  if (S.kaynak) S.kaynak.kapat();
  S.d = null;
  S.sohbetAcik = false; S.sohbetSon = null; S.sohbetOkunan = 0;
  S.kaynak = new Cevrimici(kod);
  ciz();
}

// ------------------------------------------------------------ ekranlar
function ciz() {
  const d = S.d;
  let html;
  if (!S.hesap) html = girisEkrani();
  else if (!S.kaynak) html = S.alt === 'gunluk' ? gunlukCiz() : S.alt === 'profil' ? profilCiz() : girisCiz();
  else if (!d) html = `<div class="ortala"><div class="yukleniyor">Bağlanılıyor…</div><button class="dugme ince" data-e="cik">Vazgeç</button></div>`;
  else if (!d.mac) html = lobiCiz(d);
  else if (d.mac.tur === 'yaris') html = yarisCiz(d);
  else if (d.mac.faz === 'gizli') html = gizliCiz(d);
  else html = oyunCiz(d);
  $('#ekran').innerHTML = html;
  katmanCiz();
  sureGuncelle();
}

function logo() {
  return `<div class="logo"><span class="kutu">4</span><span class="kutu">2</span><span class="kutu cizik">7</span></div>
    <h1>Sayı Bulmaca</h1>`;
}

function ayarFormu(a, eylem, kilitli, odada) {
  const sec = (anahtar, deger, etiket) =>
    `<button class="sec ${a[anahtar] === deger ? 'secili' : ''}" data-e="${eylem}" data-v="${anahtar}=${deger}" ${kilitli ? 'disabled' : ''}>${etiket}</button>`;
  const tur = odada ? `<div class="ayar"><span>Oyun türü</span><div class="secenekler genis">${sec('oyunTuru', 'klasik', 'Klasik (2 kişi)')}${sec('oyunTuru', 'yaris', 'Yarış (2–4 kişi)')}</div>
      <small class="sol">${a.oyunTuru === 'yaris' ? 'Uygulama bir sayı tutar, herkes aynı anda sorar, ilk bulan kazanır.' : 'Herkes bir sayı tutar, sırayla birbirinizin sayısını sorarsınız.'}</small></div>` : '';
  if (odada && a.oyunTuru === 'yaris') {
    return `<div class="ayarlar">${tur}
    <div class="ayar"><span>Basamak</span><div class="secenekler">${[3, 4, 5].map(b => sec('basamak', b, b)).join('')}</div></div>
    <div class="ayar"><span>Sayı 0 ile başlayabilir</span><div class="secenekler">${sec('basSifir', false, 'Hayır')}${sec('basSifir', true, 'Evet')}</div></div>
  </div>`;
  }
  return `<div class="ayarlar">${tur}
    <div class="ayar"><span>Cevaplar</span><div class="secenekler">${sec('otoCevap', true, 'Otomatik')}${sec('otoCevap', false, 'Elle yazılır')}</div></div>
    <div class="ayar"><span>Basamak</span><div class="secenekler">${[3, 4, 5].map(b => sec('basamak', b, b)).join('')}</div></div>
    <div class="ayar"><span>Tur süresi</span><div class="secenekler">${Oyun.SURELER.map(s => sec('turSure', s, s ? s + ' sn' : 'Yok')).join('')}</div></div>
    ${a.otoCevap ? '' : `<div class="ayar"><span>Yanlış cevap hakkı</span><div class="secenekler">${[1, 2, 3, 4, 5].map(y => sec('yanlisHak', y, y)).join('')}</div></div>`}
    <div class="ayar"><span>Sayı 0 ile başlayabilir</span><div class="secenekler">${sec('basSifir', false, 'Hayır')}${sec('basSifir', true, 'Evet')}</div></div>
    <div class="ayar"><span title="Başlayan oyuncu bulursa rakibine son bir soru hakkı verilir">Eşit tur <small>(başlayan bulursa rakibe son hak)</small></span><div class="secenekler">${sec('esitTur', true, 'Açık')}${sec('esitTur', false, 'Kapalı')}</div></div>
  </div>`;
}

function girisCiz() {
  let alt = '';
  if (S.alt === 'katil') {
    alt = `<div class="kart">
      <label for="kod">Oda kodu</label>
      <input id="kod" class="kod-girdi" maxlength="4" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCD" value="${esc(S.katilKod)}">
      <button class="dugme ana" data-e="katil">Odaya gir</button>
      <button class="dugme ince" data-e="geri">Geri</button>
    </div>`;
  } else if (S.alt === 'bot' && S.botMod === 'yaris') {
    const toplam = S.botYaris.kolay + S.botYaris.orta + S.botYaris.zor;
    const secA = (anahtar, deger, etiket) => `<button class="sec ${S.botAyar[anahtar] === deger ? 'secili' : ''}" data-e="botAyar" data-v="${anahtar}=${deger}">${etiket}</button>`;
    alt = `<div class="kart">
      ${botModSecimi()}
      <label>Rakiplerin <small>(1–3 bot, en hızlı bulan kazanır)</small></label>
      <div class="bot-secim">${['kolay', 'orta', 'zor'].map(sv => {
        const k = BOT_KISILIK[sv], n = S.botYaris[sv];
        return `<div class="bot-kart ${n ? 'secili' : ''}">
          <span class="bot-simge">${k.simge}</span><b>${esc(k.ad)}</b><small>${SEVIYE_AD[sv]}</small>
          <div class="sayac"><button class="sec" data-e="botSayi" data-v="${sv}:-1" ${n ? '' : 'disabled'} aria-label="Azalt">−</button><b>${n}</b>
          <button class="sec" data-e="botSayi" data-v="${sv}:1" ${toplam >= 3 ? 'disabled' : ''} aria-label="Artır">+</button></div></div>`;
      }).join('')}</div>
      <div class="ayarlar">
        <div class="ayar"><span>Bot hızı</span><div class="secenekler genis">${Object.keys(BOT_HIZ.hiz).map(h => `<button class="sec ${S.botHiz === h ? 'secili' : ''}" data-e="botHiz" data-v="${h}">${BOT_HIZ.ad[h]}</button>`).join('')}</div>
          <small class="sol">${S.botHiz === 'uyumlu' ? uyumAciklama() : 'Normal hızda 3 basamakta ortalama: 🐣 Ali ~2,5 dk · 🦊 Kemal ~1 dk 45 sn · 🧠 Ayşe ~1 dk'}</small></div>
        <div class="ayar"><span>Basamak</span><div class="secenekler">${[3, 4, 5].map(b => secA('basamak', b, b)).join('')}</div></div>
        <div class="ayar"><span>Sayı 0 ile başlayabilir</span><div class="secenekler">${secA('basSifir', false, 'Hayır')}${secA('basSifir', true, 'Evet')}</div></div>
      </div>
      <button class="dugme ana" data-e="botBasla" ${toplam ? '' : 'disabled'}>Yarışı başlat</button>
      <button class="dugme ince" data-e="geri">Geri</button>
    </div>`;
  } else if (S.alt === 'bot') {
    alt = `<div class="kart">
      ${botModSecimi()}
      <label>Rakibini seç</label>
      <div class="bot-secim">${['kolay', 'orta', 'zor'].map(s => {
        const k = BOT_KISILIK[s];
        return `<button class="bot-kart ${S.botSeviye === s ? 'secili' : ''}" data-e="botSeviye" data-v="${s}">
          <span class="bot-simge">${k.simge}</span><b>${esc(k.ad)}</b><small>${SEVIYE_AD[s]} · ${esc(k.tanim)}</small></button>`;
      }).join('')}</div>
      ${ayarFormu(S.botAyar, 'botAyar', false)}
      <button class="dugme ana" data-e="botBasla">Başla</button>
      <button class="dugme ince" data-e="geri">Geri</button>
    </div>`;
  } else {
    alt = `<div class="kart acik-odalar" id="acik-odalar">${acikOdalarHTML()}</div>
    <div class="menu">
      <button class="dugme ana" data-e="odaKur">Oda kur</button>
      <button class="dugme" data-e="katilAc">Kodla katıl</button>
      <button class="dugme" data-e="botAc">Botla oyna</button>
      <button class="dugme gunluk-dugme" data-e="gunlukAc">📅 Günün bulmacası${Istat.gunluk()[bugunTR()] ? ' <small>✓ çözdün</small>' : ''}</button>
      <div class="ikili">
        <button class="dugme ince" data-e="profilAc">📊 İstatistik</button>
        <button class="dugme ince" data-e="kurallar">Nasıl oynanır?</button>
      </div>
      <button class="dugme ince" data-e="sesDegistir">${Ses.acik ? '🔊 Ses açık' : '🔇 Ses kapalı'}</button>
    </div>
    ${YEREL_ACILIS && S.agAdres ? `<p class="not kucuk">Aynı Wi-Fi'daki telefonlar şu adresi açsın:<br><b class="ag-adres">${esc(S.agAdres)}</b></p>` : ''}
    ${/android/i.test(navigator.userAgent) && !window.SBAndroid ? '<a class="dugme ince" href="indir/SayiBulmaca.apk" download>Android uygulamasını indir (APK)</a>' : ''}`;
  }
  return `<section class="giris">
    ${logo()}
    ${hesapKarti()}
    ${alt}
  </section>`;
}

/** Uyumlu hızın şu anki durumu, düz Türkçe. */
function uyumAciklama() {
  const c = uyumCarpani();
  const ayse = Math.round(botBeklenenSure('zor', S.botAyar.basamak || 3, c) / 1000);
  const durum = Math.abs(c - 1) < 0.02 ? 'botlar normal hızda'
    : c < 1 ? `botlar normalden %${Math.round((1 / c - 1) * 100)} hızlı` : `botlar normalden %${Math.round((1 - 1 / c) * 100)} yavaş`;
  return `Uyumlu: sen kazandıkça botlar hızlanır, kaybettikçe yavaşlar. Şu an ${durum} (🧠 Ayşe ortalama ~${ayse} sn).
    ${Math.abs(c - 1) < 0.02 ? '' : '<button class="sec ince-sec" data-e="uyumSifirla">Sıfırla</button>'}`;
}

/*
 * Botlarla yarış (1–3 bot, uyumlu hız) 17.11.2026'da kullanıcı isteğiyle
 * şimdilik KAPATILDI ("tam istediğim gibi olmadı"). Kod duruyor; açmak için true yap.
 */
const BOT_YARIS_ACIK = false;

function botModSecimi() {
  if (!BOT_YARIS_ACIK) return '';
  return `<div class="secenekler genis">
    <button class="sec ${S.botMod === 'klasik' ? 'secili' : ''}" data-e="botMod" data-v="klasik">Klasik (1 bot)</button>
    <button class="sec ${S.botMod === 'yaris' ? 'secili' : ''}" data-e="botMod" data-v="yaris">🏁 Yarış (1–3 bot)</button>
  </div>`;
}

function acikOdalarHTML() {
  const l = S.acikOdalar;
  const baslik = '<label>Açık odalar <small class="canli">● canlı</small></label>';
  if (!l.length) return baslik + '<p class="not kucuk sol">Şu an rakip bekleyen oda yok.</p>';
  return baslik + '<ul class="oda-listesi">' + l.map(o => `<li>
      <div><b>${esc(o.ad)}</b><small>${o.oyunTuru === 'yaris' ? `Yarış · ${o.kisi}/${o.kapasite} kişi` : 'Klasik'} · ${o.basamak} basamak${o.oyunTuru === 'yaris' ? '' : ' · ' + (o.turSure ? o.turSure + ' sn' : 'süresiz')}</small></div>
      <button class="sec" data-e="katilAc">Kodla gir</button>
    </li>`).join('') + '</ul><p class="not kucuk sol">Odaya girmek için kodu odayı kurandan iste.</p>';
}

async function acikOdalariYenile() {
  if (S.kaynak || S.alt || !S.hesap) return; // yalnızca girişli ve ana menüdeyken
  try {
    const r = await fetch(API + '/api/odalar', { headers: basliklar() }).then(x => x.json());
    S.acikOdalar = r.odalar || [];
  } catch (e) { S.acikOdalar = []; }
  // Yalnızca listeyi yenile: bütün ekranı çizersek ad kutusuna yazılan kaybolur
  const k = document.getElementById('acik-odalar');
  if (k && !S.kaynak && !S.alt) k.innerHTML = acikOdalarHTML();
}
setInterval(acikOdalariYenile, 3000); // açık odalar 3 saniyede bir yenilenir

function lobiCiz(d) {
  const o = d.oda;
  const rakip = o.oyuncular.find(x => !x.ben);
  const yaris = o.ayar.oyunTuru === 'yaris';
  const kap = yaris ? 4 : 2;
  const oyuncular = o.oyuncular.map((x, i) =>
    `<li><span class="nokta ${x.bagli ? 'acik' : ''}"></span>${esc(x.ad)}${x.ben ? ' <small>(sen)</small>' : ''}${i === 0 ? ' <small class="rozet">kurucu</small>' : ''}</li>`).join('')
    + (o.oyuncular.length < kap ? `<li class="bekle"><span class="nokta"></span>${rakip ? `Başka oyuncu girebilir (${o.oyuncular.length}/${kap})` : 'Rakip bekleniyor…'}</li>` : '');
  const basla = o.kurucuBen
    ? `<button class="dugme ana" data-e="basla" ${rakip ? '' : 'disabled'}>${rakip ? 'Oyunu başlat' : 'Rakip bekleniyor…'}</button>`
    : '<p class="not">Odayı kuran oyunu başlatacak.</p>';
  return `<section class="lobi">
    <div class="ust-cubuk"><button class="geri-ok" data-e="cik" aria-label="Odadan çık">‹</button><span>Oda</span>${sohbetDugme(d)}</div>
    <div class="kart oda-kart">
      <div class="oda-kod">${esc(o.kod)}</div>
      <p class="not">Arkadaşların odaya <b>yalnızca bu kodla</b> girer. Kodu söyle ya da bağlantıyı gönder.</p>
      ${YEREL_ACILIS && S.agAdres ? `<p class="not kucuk">Telefonlar şu adresi açsın: <b class="ag-adres">${esc(S.agAdres)}</b></p>` : ''}
      <div class="ikili">
        <button class="dugme" data-e="kopyala">Kodu kopyala</button>
        <button class="dugme" data-e="paylas">Bağlantı gönder</button>
      </div>
    </div>
    <div class="kart"><label>Oyuncular ${yaris ? `<small>(${o.oyuncular.length}/4)</small>` : ''}</label><ul class="oyuncular">${oyuncular}</ul>${yaris ? yarisSkorHTML(d) : skorHTML(d)}</div>
    <div class="kart"><label>Ayarlar ${o.kurucuBen ? '' : '<small>(kurucu belirler)</small>'}</label>${ayarFormu(o.ayar, 'ayar', !o.kurucuBen, true)}</div>
    ${basla}
    ${baglantiUyari()}
  </section>`;
}

function baglantiUyari() {
  return S.baglanti || !(S.kaynak instanceof Cevrimici) ? '' : '<div class="baglanti-yok">Bağlantı koptu, yeniden bağlanılıyor…</div>';
}

function kutular(n, deger, gizle) {
  let s = '<div class="kutular">';
  for (let i = 0; i < n; i++) {
    const c = deger[i];
    s += `<span class="kutu ${c ? 'dolu' : ''} ${i === deger.length ? 'imlec' : ''}">${c ? (gizle ? '•' : c) : ''}</span>`;
  }
  return s + '</div>';
}

function tusTakimi(ayar, girdi, tamamEylem, tamamYazi, tablo) {
  const t = tablo || S.tablo;
  let s = '<div class="tuslar">';
  for (const c of '1234567890') {
    const kullanildi = girdi.indexOf(c) >= 0;
    const basSifir = c === '0' && girdi.length === 0 && !ayar.basSifir;
    const dolu = girdi.length >= ayar.basamak;
    s += `<button class="tus r${t[+c]}" data-e="tus" data-v="${c}" ${kullanildi || basSifir || dolu ? 'disabled' : ''}>${c}</button>`;
  }
  return s + `<button class="tus sil" data-e="sil" ${girdi ? '' : 'disabled'} aria-label="Sil">⌫</button>
    <button class="tus tamam" data-e="${tamamEylem}" ${girdi.length === ayar.basamak ? '' : 'disabled'}>${tamamYazi}</button></div>`;
}

function gizliCiz(d) {
  const m = d.mac;
  const ust = `<div class="ust-cubuk"><button class="geri-ok" data-e="cik" aria-label="Çık">‹</button><span>${esc(m.ben.ad)} — ${esc(m.rakip.ad)}</span>${sohbetDugme(d)}</div>`;
  if (m.ben.hazir) {
    return `<section class="gizli">${ust}
      <div class="ortala">
        <p class="not">Tuttuğun sayı</p>
        ${kutular(m.ayar.basamak, m.ben.gizli)}
        <div class="yukleniyor">${esc(m.rakip.ad)} sayısını seçiyor…</div>
        ${skorHTML(d)}
      </div>${baglantiUyari()}</section>`;
  }
  return `<section class="gizli">${ust}
    <div class="ortala">
      <h2>Sayını tut</h2>
      <p class="not">${m.ayar.basamak} basamaklı, rakamları birbirinden farklı${m.ayar.basSifir ? '' : ', 0 ile başlamayan'} bir sayı.</p>
      ${kutular(m.ayar.basamak, S.girdi)}
      <p class="not kucuk">Rakip: ${m.rakip.hazir ? 'seçti ✓' : 'seçiyor…'} · İlk soruyu ${m.baslayanBen ? '<b>sen</b>' : esc(m.rakip.ad)} soracak</p>
      ${skorHTML(d)}
    </div>
    <div class="eylem-alani">
      <button class="dugme ince" data-e="rastgele">Rastgele seç</button>
      ${tusTakimi(m.ayar, S.girdi, 'gizliOnay', 'Tamam')}
    </div>${baglantiUyari()}</section>`;
}

function oyunCiz(d) {
  const m = d.mac, a = m.ayar;
  const bitti = m.faz === 'bitti';

  let durumYazi = '';
  if (bitti) durumYazi = 'Oyun bitti';
  else if (m.asama === 'tahmin') durumYazi = m.siraBende ? 'Sıra sende — soru sor' : `${esc(m.rakip.ad)} soru düşünüyor…`;
  else durumYazi = m.siraBende ? `${esc(m.rakip.ad)} cevap yazıyor…` : 'Cevap ver!';
  if (m.sonSans && !bitti) durumYazi = (m.siraBende ? 'Son hakkın! ' : 'Rakibin son hakkı · ') + durumYazi;

  const tablo = '<div class="tablo" role="group" aria-label="Rakam eleme tablosu">' +
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => `<button class="hucre r${S.tablo[i]}" data-e="tablo" data-v="${i}" aria-label="${i}">${i}</button>`).join('') + '</div>';

  const gelen = m.gelenSorular.map(k => `<li>
      ${k.tahmin ? sayiHTML(k.tahmin, false) : '<span class="sayi soluk">———</span>'}
      <span class="esittir">=</span>
      ${k.tahmin ? cevapHTML(k.arti, k.eksi) : '<span class="etiket">süre doldu</span>'}
      ${k.verilen ? `<span class="hatali" title="Yanlış yazdın">✗ ${esc(cevapMetin(k.verilen.arti, k.verilen.eksi))}</span>` : ''}
      ${k.sure && k.tahmin ? '<span class="hatali" title="Cevap süresi doldu">⏱</span>' : ''}
    </li>`).join('');
  const benim = m.sorularim.map(k => `<li>
      ${k.tahmin ? sayiHTML(k.tahmin, true) : '<span class="sayi soluk">———</span>'}
      <span class="esittir">=</span>
      ${k.tahmin ? cevapHTML(k.arti, k.eksi) : '<span class="etiket">süre doldu</span>'}
      ${k.verilen ? `<span class="duzeltme" title="Rakip yanlış yazdı, uygulama düzeltti">düzeltildi</span>` : ''}
    </li>`).join('');

  return `<section class="oyun ${bitti ? 'bitti' : ''}">
    <header class="oyun-ust ${d.sohbet ? 'sohbetli' : ''}">
      <button class="geri-ok" data-e="menuAc" aria-label="Menü">⋯</button>
      <div class="kisi ben"><span class="isim">${esc(m.ben.ad)}${skorRozet(d, true)}</span>${haklar(m.ben.yanlis, a.yanlisHak, a.otoCevap)}</div>
      <div class="sure" id="sure"><span id="sure-sayi"></span><i id="sure-cubuk"></i></div>
      <div class="kisi rakip"><span class="isim">${skorRozet(d, false)}${esc(m.rakip.ad)}${rakipBagli(d) ? '' : ' <small class="kopuk">(koptu)</small>'}</span>${haklar(m.rakip.yanlis, a.yanlisHak, a.otoCevap)}</div>
      ${d.sohbet ? sohbetDugme(d) : ''}
    </header>
    <div class="durum-serit ${hamleBende(d) ? 'sende' : ''}">${durumYazi}</div>
    ${tablo}
    <div class="defter">
      <div class="sutun">
        <div class="sutun-bas"><span class="tuttugum">${sayiHTML(m.ben.gizli, false)}</span><small>tuttuğum sayı</small></div>
        <div class="sutun-ad">Gelen sorular</div>
        <ol class="liste">${gelen || '<li class="bos">Henüz soru gelmedi</li>'}</ol>
      </div>
      <div class="cizgi"></div>
      <div class="sutun">
        <div class="sutun-bas"><span class="tuttugum soru">${bitti && m.rakip.gizli ? sayiHTML(m.rakip.gizli, false) : '?'.repeat(a.basamak)}</span><small>rakibin sayısı</small></div>
        <div class="sutun-ad">Sorduğum sorular</div>
        <ol class="liste">${benim || '<li class="bos">Henüz soru sormadın</li>'}</ol>
      </div>
    </div>
    ${bitti ? sonucSerit(m) : eylemAlani(m)}
    ${baglantiUyari()}
  </section>`;
}

function skorRozet(d, ben) {
  const l = d.oda.oyuncular || [];
  if (!l.some(x => x.galibiyet) && !d.oda.berabere) return '';
  const x = l.find(o => !!o.ben === ben);
  return x ? ` <b class="skor-rozet" title="Bu odadaki galibiyet">${x.galibiyet || 0}</b> ` : '';
}

function rakipBagli(d) {
  const r = d.oda.oyuncular.find(x => !x.ben);
  return r ? r.bagli : false;
}

function eylemAlani(m) {
  const a = m.ayar;
  if (m.asama === 'tahmin' && m.siraBende) {
    return `<div class="eylem-alani">
      ${kutular(a.basamak, S.girdi)}
      ${tusTakimi(a, S.girdi, 'sor', 'Sor')}
    </div>`;
  }
  if (m.asama === 'cevap' && !m.siraBende) {
    const N = a.basamak, c = S.cevap;
    const satir = (tur, isaret, deger, sinir) => {
      let s = '';
      for (let i = 0; i <= N; i++) s += `<button class="sec ${tur} ${deger === i ? 'secili' : ''}" data-e="${tur}" data-v="${i}" ${i > sinir ? 'disabled' : ''}>${i ? isaret + i : '0'}</button>`;
      return s;
    };
    return `<div class="eylem-alani cevap-alani">
      <div class="karsilastir">
        <div><small>Gelen soru</small>${sayiHTML(m.bekleyen, false)}</div>
        <div><small>Senin sayın</small><span class="sayi">${esc(m.ben.gizli)}</span></div>
      </div>
      <div class="cevap-satir"><span>Yeri doğru</span><div class="secenekler">${satir('arti', '+', c.arti, N - c.eksi)}</div></div>
      <div class="cevap-satir"><span>Yeri yanlış</span><div class="secenekler">${satir('eksi', '−', c.eksi, N - c.arti)}</div></div>
      <button class="dugme ana" data-e="cevapGonder">Cevabı gönder: ${cevapMetin(c.arti, c.eksi)}</button>
    </div>`;
  }
  const bekle = m.asama === 'tahmin'
    ? 'Rakip sorusunu düşünüyor…'
    : `Sorduğun ${sayiHTML(m.bekleyen, true)} için rakibin cevabı bekleniyor…`;
  return `<div class="eylem-alani bekleme"><div class="yukleniyor">${bekle}</div></div>`;
}

function sonucSerit(m) {
  return `<div class="eylem-alani"><div class="ikili uclu">
    <button class="dugme ana" data-e="rovans">Rövanş</button>
    <button class="dugme" data-e="analizAc" data-v="ben">Analiz</button>
    <button class="dugme" data-e="sonucAc">Sonuç</button>
  </div></div>`;
}

function katmanCiz() {
  const k = $('#katman');
  let ic = '';
  const m = S.d && S.d.mac;
  if (S.sohbetAcik && S.d && S.d.sohbet) {
    S.sohbetOkunan = S.sohbetSon || 0;
    // Panel zaten açıksa yalnızca mesajları yenile: yazılan metin kaybolmasın
    const liste = document.getElementById('sohbet-liste');
    if (liste) { liste.innerHTML = mesajlarHTML(S.d.sohbet); liste.scrollTop = liste.scrollHeight; return; }
    k.innerHTML = `<div class="perde alt"><div class="modal sohbet">
      <div class="sohbet-bas"><h2>Sohbet</h2><button class="geri-ok" data-e="sohbetKapat" aria-label="Kapat">✕</button></div>
      <ol class="sohbet-liste" id="sohbet-liste">${mesajlarHTML(S.d.sohbet)}</ol>
      <div class="hazir">${HAZIR_MESAJLAR.map(x => `<button class="sec" data-e="hazirMesaj" data-v="${esc(x)}">${esc(x)}</button>`).join('')}</div>
      <div class="emojiler">${EMOJILER.map(x => `<button data-e="emoji" data-v="${x}" aria-label="${x}">${x}</button>`).join('')}</div>
      <div class="sohbet-yaz"><input id="sohbet-girdi" maxlength="120" autocomplete="off" placeholder="Mesaj yaz…" enterkeyhint="send"><button class="dugme ana" data-e="mesajGonder">Gönder</button></div>
    </div></div>`;
    const l2 = document.getElementById('sohbet-liste');
    l2.scrollTop = l2.scrollHeight;
    return;
  }
  if (S.analiz && m && m.faz === 'bitti') {
    k.innerHTML = `<div class="perde">${analizHTML(m.tur === 'yaris' ? yarisAnalizUyarla(m) : m, m.tur === 'yaris' ? 'ben' : S.analiz)}</div>`;
    return;
  }
  if (m && m.tur === 'yaris' && m.faz === 'bitti' && !S.sonucKapali && !S.menu && !S.kurallar && !S.adModal) {
    k.innerHTML = `<div class="perde">${yarisSonucHTML(S.d)}</div>`;
    return;
  }
  if (S.alt === 'gunluk' && !S.kaynak && S.gSiralama && S.g && S.g.gun) {
    k.innerHTML = `<div class="perde">${siralamaHTML()}</div>`;
    return;
  }
  if (S.adModal && S.hesap) {
    k.innerHTML = `<div class="perde">${adModalHTML()}</div>`;
    return;
  }
  if (S.kurallar) {
    ic = `<div class="modal"><h2>Nasıl oynanır?</h2>
      <ol class="kurallar">
        <li>İki oyuncu da rakamları birbirinden farklı bir sayı tutar (ör. <b>302</b>).</li>
        <li>Sırayla birbirinizin sayısını tahmin edersiniz.</li>
        <li>Her soruya cevap verilir: yeri doğru her rakam <span class="c arti">+1</span>, sayıda olup yeri yanlış her rakam <span class="c eksi">−1</span>, hiçbiri yoksa <span class="c sifir">0</span>.</li>
        <li>Örnek: sayın 302, soru 203 → 0'ın yeri doğru, 2 ve 3'ün yeri yanlış: <span class="c arti">+1</span><span class="c eksi">−2</span></li>
        <li>"Cevaplar: Otomatik" ayarında cevabı uygulama hesaplar. "Elle yazılır" seçildiyse cevabı sen yazarsın; yanlış yazarsan uygulama yakalar, hakkın düşer, rakibe doğru cevap gider. Hakların bitince kaybedersin.</li>
        <li><b>Yarış</b> (odada oyun türü): 2–4 kişi. Sayıyı uygulama tutar, herkes aynı anda sorar, cevaplar otomatik. Sayıyı ilk bulan kazanır ve oyun biter. Oyun sırasında başkalarının yalnızca kaç soru sorduğu görünür.</li>
        <li>Rakibin sayısını ilk bulan kazanır. "Eşit tur" açıksa, başlayan bulduğunda rakibine son bir hak verilir; o da bulursa berabere.</li>
        <li>Üstteki 0–9 tablosu senin notun: dokununca rakam çizilir (yok), bir daha dokununca yeşil olur (var). Yalnızca <b>kendi sorduğun</b> sayılarda görünür, her yeni oyunda temizlenir.</li>
        <li>💬 düğmesinden rakibine hazır mesaj, emoji ya da kendi yazdığın mesajı gönderebilirsin. Botlar da cevap verir.</li>
        <li>Maç bitince <b>Analiz</b>: her sorudan sonra kaç ihtimal kaldığını ve zor botun aynı sayıyı kaç soruda bulacağını gösterir.</li>
        <li>📅 <b>Günün bulmacası</b>: her gün herkese aynı 4 basamaklı sayı. En az soruda bulan sıralamada birinci olur.</li>
      </ol>
      <button class="dugme ana" data-e="kurallarKapat">Anladım</button></div>`;
  } else if (S.menu && m) {
    const bitti = m.faz === 'bitti';
    ic = `<div class="modal"><h2>Menü</h2>
      <button class="dugme" data-e="kurallar">Nasıl oynanır?</button>
      <button class="dugme" data-e="sesDegistir">${Ses.acik ? '🔊 Ses açık' : '🔇 Ses kapalı'}</button>
      ${bitti ? '' : '<button class="dugme tehlike" data-e="teslim">Pes et</button>'}
      <button class="dugme" data-e="cik">${S.d.oda.bot ? 'Ana menüye dön' : 'Odadan çık'}</button>
      <button class="dugme ince" data-e="menuKapat">Kapat</button></div>`;
  } else if (m && m.faz === 'bitti' && !S.sonucKapali) {
    const s = m.sonuc;
    const baslik = s.kazanan === 'ben' ? 'Kazandın!' : s.kazanan === 'rakip' ? 'Kaybettin' : 'Berabere';
    const neden = {
      buldu: s.kazanan === 'ben' ? `${m.sorularim.filter(x => x.tahmin).length}. soruda rakibin sayısını buldun.` : `${esc(m.rakip.ad)} sayını buldu.`,
      yanlis: s.kazanan === 'ben' ? `${esc(m.rakip.ad)} ${m.ayar.yanlisHak} kez yanlış cevap verdi.` : `${m.ayar.yanlisHak} yanlış cevap hakkın bitti.`,
      teslim: s.kazanan === 'ben' ? `${esc(m.rakip.ad)} pes etti ya da oyundan çıktı.` : 'Pes ettin.',
      berabere: 'İkiniz de buldunuz!',
    }[s.neden] || '';
    const kurucu = S.d.oda.kurucuBen && !S.d.oda.bot;
    ic = `<div class="modal sonuc ${s.kazanan}"><h2>${baslik}</h2><p>${neden}</p>
      <div class="karsilastir">
        <div><small>Senin sayın</small>${sayiHTML(m.ben.gizli, false)}</div>
        <div><small>${esc(m.rakip.ad)}</small>${m.rakip.gizli ? sayiHTML(m.rakip.gizli, false) : ''}</div>
      </div>
      ${skorHTML(S.d)}
      <button class="dugme ana" data-e="rovans">Rövanş</button>
      <button class="dugme" data-e="analizAc" data-v="ben">📈 Maç analizi</button>
      ${kurucu ? '<button class="dugme" data-e="lobi">Ayarları değiştir</button>' : ''}
      ${S.d.oda.bot ? '<button class="dugme" data-e="lobi">Seviye / ayar değiştir</button>' : ''}
      <button class="dugme ince" data-e="sonucKapat">Tahtaya bak</button></div>`;
  }
  k.innerHTML = ic ? `<div class="perde">${ic}</div>` : '';
}

// ------------------------------------------------------------ yarış (2–4 kişi, tek ortak sayı)
function sureYazi(ms) {
  const sn = Math.floor(ms / 1000);
  return Math.floor(sn / 60) + ':' + String(sn % 60).padStart(2, '0');
}

/** Odadaki galibiyetler (yarışta herkes). */
function yarisSkorHTML(d) {
  const l = d.oda.oyuncular || [];
  if (!l.some(x => x.galibiyet)) return '';
  return `<div class="skor-serit">${l.map(x => `<span>${esc(x.ad)} <b>${x.galibiyet || 0}</b></span>`).join('')}</div>`;
}

function yarisCiz(d) {
  const m = d.mac, a = m.ayar, bitti = m.faz === 'bitti';
  const kisiler = m.oyuncular.map(o => `<span class="yaris-kisi ${o.ben ? 'ben' : ''} ${o.cekildi ? 'cekildi' : ''}">
      ${esc(o.ad)}${o.ben ? ' <small>(sen)</small>' : ''} · <b>${o.soru}</b> soru</span>`).join('');
  let durumYazi;
  if (bitti) durumYazi = m.sonuc.kazanan === 'ben' ? `Buldun! ${sureYazi(m.sonuc.sure)}` : m.sonuc.kazanan ? `${esc(m.sonuc.kazanan)} buldu (${sureYazi(m.sonuc.sure)})` : 'Kimse bulamadı';
  else if (m.ben.cekildi) durumYazi = 'Yarıştan çekildin, diğerleri devam ediyor';
  else durumYazi = 'Herkes aynı anda soruyor — ilk bulan kazanır!';
  const tablo = '<div class="tablo" role="group" aria-label="Rakam eleme tablosu">' +
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => `<button class="hucre r${S.tablo[i]}" data-e="tablo" data-v="${i}" aria-label="${i}">${i}</button>`).join('') + '</div>';
  const benim = m.ben.sorular.map((k, i) => `<li><span class="an-no">${i + 1}</span>${sayiHTML(k.tahmin, true)}<span class="esittir">=</span>${cevapHTML(k.arti, k.eksi)}<small class="yaris-zaman">${sureYazi(k.zaman)}</small></li>`).join('');
  const alt = bitti ? sonucSerit(m)
    : m.ben.cekildi ? '<div class="eylem-alani bekleme"><div class="yukleniyor">Diğerleri oynuyor</div></div>'
      : `<div class="eylem-alani">${kutular(a.basamak, S.girdi)}${tusTakimi(a, S.girdi, 'sor', 'Sor')}</div>`;
  return `<section class="oyun yaris ${bitti ? 'bitti' : ''}">
    <header class="oyun-ust ${d.sohbet ? 'sohbetli' : ''}">
      <button class="geri-ok" data-e="menuAc" aria-label="Menü">⋯</button>
      <div class="kisi ben"><span class="isim">🏁 Yarış</span><small>${a.basamak} basamak</small></div>
      <div class="sure" id="sure"><span id="sure-sayi"></span><i id="sure-cubuk"></i></div>
      <div class="kisi rakip"><span class="isim">${m.oyuncular.length} kişi</span></div>
      ${d.sohbet ? sohbetDugme(d) : ''}
    </header>
    <div class="yaris-kisiler">${kisiler}</div>
    <div class="durum-serit ${hamleBende(d) ? 'sende' : ''}">${durumYazi}</div>
    ${tablo}
    <div class="defter tek"><div class="sutun">
      <div class="sutun-bas"><span class="tuttugum soru">${bitti && m.gizli ? sayiHTML(m.gizli, false) : '?'.repeat(a.basamak)}</span><small>herkesin aradığı sayı</small></div>
      <div class="sutun-ad">Sorduğum sorular</div>
      <ol class="liste" id="y-liste">${benim || '<li class="bos">Henüz soru sormadın</li>'}</ol>
    </div></div>
    ${alt}
    ${baglantiUyari()}
  </section>`;
}

function yarisSonucHTML(d) {
  const m = d.mac, s = m.sonuc;
  const baslik = s.kazanan === 'ben' ? 'Kazandın!' : s.kazanan ? 'Kaybettin' : 'Kimse bulamadı';
  const neden = s.kazanan === 'ben' ? `${sureYazi(s.sure)}'de, ${s.soru}. soruda buldun.`
    : s.kazanan ? `${esc(s.kazanan)} ${sureYazi(s.sure)}'de, ${s.soru}. soruda buldu.` : 'Herkes yarıştan çekildi.';
  const liste = m.oyuncular.slice().sort((x, y) => (y.sorular && y.sorular.some(k => k.arti === m.ayar.basamak)) - (x.sorular && x.sorular.some(k => k.arti === m.ayar.basamak)) || x.soru - y.soru)
    .map(o => {
      const buldu = o.sorular && o.sorular.some(k => k.arti === m.ayar.basamak);
      const son = o.sorular && o.sorular[o.sorular.length - 1];
      return `<li class="${o.ben ? 'ben' : ''}"><span class="an-no">${buldu ? '🏆' : o.cekildi ? '🏳️' : '·'}</span><span class="sir-ad">${esc(o.ad)}${o.ben ? ' <small>(sen)</small>' : ''}</span>
        <b>${o.soru} soru${son && !buldu ? ` <small>son: ${cevapMetin(son.arti, son.eksi)}</small>` : ''}</b></li>`;
    }).join('');
  const kurucu = d.oda.kurucuBen;
  return `<div class="modal sonuc ${s.kazanan === 'ben' ? 'ben' : 'rakip'}"><h2>${baslik}</h2><p>${neden}</p>
    <div class="karsilastir"><div><small>Aranan sayı</small>${sayiHTML(m.gizli, false)}</div></div>
    <ol class="sir-liste">${liste}</ol>
    ${d.oda.uyumNot ? `<p class="uyum-not">${esc(d.oda.uyumNot)}</p>` : ''}
    ${yarisSkorHTML(d)}
    <button class="dugme ana" data-e="rovans">Rövanş</button>
    <button class="dugme" data-e="analizAc" data-v="ben">📈 Sorularımın analizi</button>
    ${kurucu ? '<button class="dugme" data-e="lobi">Ayarları değiştir</button>' : ''}
    <button class="dugme ince" data-e="sonucKapat">Tahtaya bak</button></div>`;
}

/** Analiz ekranı klasik maç biçimini bekler: yarışı ona çevir (yalnızca benim sorularım). */
function yarisAnalizUyarla(m) {
  return { id: m.id, ayar: m.ayar, tekSekme: true, sorularim: m.ben.sorular, gelenSorular: [], rakip: { ad: '', gizli: m.gizli }, ben: { gizli: null } };
}

function mesajlarHTML(l) {
  if (!l.length) return '<li class="bos">Henüz mesaj yok. Aşağıdan hazır bir mesaj ya da emoji seç.</li>';
  return l.map(x => {
    const tekEmoji = /^(\p{Extended_Pictographic}|\uFE0F|\u200D|\s)+$/u.test(x.metin);
    return `<li class="${x.ben ? 'ben' : 'rakip'}"><small>${x.ben ? 'Sen' : esc(x.ad)}</small><span class="balon ${tekEmoji ? 'emoji' : ''}">${esc(x.metin)}</span></li>`;
  }).join('');
}

// ------------------------------------------------------------ süre göstergesi
function sureGuncelle() {
  const kutu = $('#sure');
  if (!kutu) return;
  const m = S.d && S.d.mac;
  if (m && m.tur === 'yaris') {
    const gecen = Math.max(0, (m.faz === 'bitti' ? m.bitis : Date.now() + S.ofset) - m.baslangic);
    $('#sure-sayi').textContent = sureYazi(gecen);
    $('#sure-cubuk').style.width = '0%';
    kutu.className = 'sure yaris-sure';
    return;
  }
  if (!m || m.faz !== 'oyun' || !m.bitis) { kutu.className = 'sure yok'; return; }
  const kalan = Math.max(0, m.bitis - (Date.now() + S.ofset));
  const sn = Math.ceil(kalan / 1000);
  $('#sure-sayi').textContent = sn;
  $('#sure-cubuk').style.width = (100 * kalan / (m.ayar.turSure * 1000)) + '%';
  kutu.className = 'sure' + (sn <= 10 ? ' az' : '') + (hamleBende(S.d) ? ' benim' : '');
}
setInterval(sureGuncelle, 250);

// ------------------------------------------------------------ eylemler
async function mesajYolla(metin, olmazsa) {
  if (!S.kaynak) return;
  try { await S.kaynak.eylem('mesaj', { metin }); }
  catch (h) { bildir(h.message || 'Mesaj gitmedi', 'kotu'); olmazsa && olmazsa(); }
}

async function gonder(tur, veri) {
  if (!S.kaynak || S.mesgul) return false;
  S.mesgul = true;
  try { await S.kaynak.eylem(tur, veri); return true; }
  catch (h) { bildir(h.message || 'Bir hata oldu', 'kotu'); return false; }
  finally { S.mesgul = false; }
}

function ayarDegeri(v) {
  const [k, x] = v.split('=');
  return { [k]: x === 'true' ? true : x === 'false' ? false : isNaN(+x) ? x : +x };
}

const EYLEM = {
  async odaKur() {
    try { const r = await istek('/api/oda', { ad: adim() }); baglan(r.kod); }
    catch (h) { bildir('Sunucuya ulaşılamadı: ' + h.message, 'kotu'); }
  },
  katilAc() { S.alt = 'katil'; ciz(); setTimeout(() => $('#kod') && $('#kod').focus(), 50); },
  botAc() { S.alt = 'bot'; ciz(); },
  geri() { S.alt = null; ciz(); acikOdalariYenile(); },
  async katil() {
    const kod = ($('#kod').value || '').trim().toUpperCase();
    if (kod.length !== 4) { bildir('Oda kodu 4 harfli', 'kotu'); return; }
    try { await istek('/api/katil', { kod, ad: adim() }); baglan(kod); }
    catch (h) { bildir(h.message, 'kotu'); }
  },
  botSeviye(v) { S.botSeviye = v; depo.koy('sb_bot', v); ciz(); },
  botAyar(v) { S.botAyar = Oyun.ayarDuzelt(Object.assign({}, S.botAyar, ayarDegeri(v))); depo.koy('sb_botayar', JSON.stringify(S.botAyar)); ciz(); },
  botBasla() {
    S.d = null;
    if (S.botMod === 'yaris') {
      const l = [];
      ['kolay', 'orta', 'zor'].forEach(sv => { for (let i = 0; i < S.botYaris[sv]; i++) l.push(sv); });
      if (!l.length) return;
      S.kaynak = new YerelYaris(l, S.botAyar, S.botHiz);
    } else S.kaynak = new YerelOda(S.botSeviye, S.botAyar);
    ciz();
  },
  botMod(v) { S.botMod = BOT_YARIS_ACIK && v === 'yaris' ? 'yaris' : 'klasik'; depo.koy('sb_botmod', S.botMod); ciz(); },
  botHiz(v) { if (v in BOT_HIZ.hiz) { S.botHiz = v; depo.koy('sb_bothiz', v); ciz(); } },
  uyumSifirla() { depo.koy('sb_uyum', '1'); bildir('Bot hızı normale döndü'); ciz(); },
  botSayi(v) {
    const [sv, d] = v.split(':');
    const y = Object.assign({}, S.botYaris);
    const toplam = y.kolay + y.orta + y.zor;
    const yeni = (y[sv] || 0) + Number(d);
    if (yeni < 0 || (Number(d) > 0 && toplam >= 3)) return;
    y[sv] = yeni;
    S.botYaris = y; depo.koy('sb_botyaris', JSON.stringify(y)); ciz();
  },
  ayar(v) { gonder('ayar', { ayar: ayarDegeri(v) }); },
  basla() { gonder('basla'); },
  async kopyala() {
    try { await navigator.clipboard.writeText(S.d.oda.kod); bildir('Kod kopyalandı'); }
    catch (e) { bildir('Kod: ' + S.d.oda.kod); }
  },
  async paylas() {
    const taban = S.agAdres || (location.origin + location.pathname);
    const url = taban + '?oda=' + S.d.oda.kod;
    const metin = `Sayı Bulmaca oynayalım! Oda kodu: ${S.d.oda.kod}`;
    if (window.SBAndroid) { window.SBAndroid.paylas(metin + '\n' + url); return; } // Android uygulaması
    try {
      if (navigator.share) await navigator.share({ title: 'Sayı Bulmaca', text: metin, url });
      else { await navigator.clipboard.writeText(metin + ' ' + url); bildir('Bağlantı kopyalandı'); }
    } catch (e) {
      if (e && e.name !== 'AbortError') bildir(url);
    }
  },
  async cik() {
    const m = S.d && S.d.mac;
    if (m && m.faz === 'oyun' && !confirm('Oyundan çıkarsan maçı kaybedersin. Çıkılsın mı?')) return;
    S.menu = false;
    if (S.kaynak instanceof Cevrimici) {
      // Önce dinlemeyi bırak: sunucu bekleyen isteğe "oda yok" der, bu
      // kendi çıkışımızı "oda kapanmış" uyarısına çevirmesin.
      S.kaynak.kapandi = true;
      try { await S.kaynak.eylem('ayril'); } catch (e) { /* zaten yok */ }
      anaMenu();
    }
    else anaMenu(S.kaynak ? 'bot' : null);
  },
  tus(v) {
    const a = girdiAyari();
    if (S.girdi.length < a.basamak && S.girdi.indexOf(v) < 0) { S.girdi += v; ciz(); }
  },
  sil() { S.girdi = S.girdi.slice(0, -1); ciz(); },
  rastgele() { S.girdi = Oyun.rastgeleSayi(S.d.mac.ayar); ciz(); },
  async gizliOnay() {
    const h = Oyun.sayiHatasi(S.girdi, S.d.mac.ayar);
    if (h) { bildir(h, 'kotu'); return; }
    const s = S.girdi;
    S.girdi = ''; // gönderirken temizle: durum hemen gelip ekranı çizebilir
    if (!(await gonder('gizli', { sayi: s }))) { S.girdi = s; ciz(); }
  },
  async sor() {
    const h = Oyun.sayiHatasi(S.girdi, S.d.mac.ayar);
    if (h) { bildir(h, 'kotu'); return; }
    const s = S.girdi;
    if ((S.d.mac.tur === 'yaris' ? S.d.mac.ben.sorular : S.d.mac.sorularim).some(k => k.tahmin === s)) { bildir('Bu sayıyı zaten sordun', 'kotu'); return; }
    S.girdi = '';
    if (!(await gonder('tahmin', { sayi: s }))) { S.girdi = s; ciz(); }
  },
  arti(v) { S.cevap.arti = +v; ciz(); },
  eksi(v) { S.cevap.eksi = +v; ciz(); },
  async cevapGonder() {
    const c = S.cevap;
    S.cevap = { arti: 0, eksi: 0 };
    if (!(await gonder('cevap', { arti: c.arti, eksi: c.eksi }))) { S.cevap = c; ciz(); }
  },
  tablo(v) {
    S.tablo[v] = (S.tablo[v] + 1) % 3;
    tabloKaydet();
    ciz();
  },
  sohbetAc() { S.sohbetAcik = true; S.menu = false; ciz(); setTimeout(() => { const g = $('#sohbet-girdi'); if (g && matchMedia('(pointer: fine)').matches) g.focus(); }, 50); },
  sohbetKapat() { S.sohbetAcik = false; ciz(); },
  hazirMesaj(v) { mesajYolla(v); },
  emoji(v) {
    const g = $('#sohbet-girdi');
    if (g && g.value.trim()) { g.value += v; g.focus(); } // yazarken emoji metne eklenir
    else mesajYolla(v);                                      // tek başına emoji hemen gider
  },
  mesajGonder() {
    const g = $('#sohbet-girdi');
    if (!g || !g.value.trim()) return;
    const metin = g.value;
    g.value = '';
    mesajYolla(metin, () => { if (!g.value) g.value = metin; });
  },
  menuAc() { S.menu = true; katmanCiz(); },
  menuKapat() { S.menu = false; katmanCiz(); },
  async teslim() {
    if (!confirm('Pes etmek istediğine emin misin?')) return;
    S.menu = false;
    await gonder('teslim');
    katmanCiz();
  },
  rovans() { S.sonucKapali = false; S.analiz = null; gonder('rovans'); },
  lobi() { gonder('lobi'); },
  sonucKapat() { S.sonucKapali = true; katmanCiz(); },
  sonucAc() { S.sonucKapali = false; katmanCiz(); },
  kurallar() { S.kurallar = true; S.menu = false; katmanCiz(); },
  kurallarKapat() { S.kurallar = false; katmanCiz(); },
  sesDegistir() { Ses.degistir(); ciz(); },
};
Object.assign(EYLEM, PROFIL_EYLEM, ANALIZ_EYLEM, GUNLUK_EYLEM, GIRIS_EYLEM);

/** Rakam yazılan ekranın ayarı: günün bulmacası ya da maç. */
function girdiAyari() { return !S.kaynak && S.alt === 'gunluk' && S.g && S.g.gun ? gunlukAyar() : S.d.mac.ayar; }

document.addEventListener('click', e => {
  const b = e.target.closest('[data-e]');
  if (!b || b.disabled) return;
  const f = EYLEM[b.dataset.e];
  if (f) f(b.dataset.v, b);
});

document.addEventListener('input', e => {
  if (e.target.id === 'kod') {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    S.katilKod = e.target.value;
  }
});

// Bilgisayarda klavyeyle de oynanabilsin
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') {
    if (e.key === 'Enter' && e.target.id === 'kod') EYLEM.katil();
    if (e.key === 'Enter' && e.target.id === 'sohbet-girdi') EYLEM.mesajGonder();
    return;
  }
  if (!S.kaynak && S.alt === 'gunluk' && S.g && S.g.gun && !gunlukBitti() && !$('#katman').innerHTML) {
    if (/^\d$/.test(e.key)) { const t = document.querySelector(`.tus[data-v="${e.key}"]`); if (t && !t.disabled) EYLEM.tus(e.key); }
    else if (e.key === 'Backspace') EYLEM.sil();
    else if (e.key === 'Enter' && S.girdi.length === S.g.basamak) EYLEM.gSor();
    return;
  }
  const m = S.d && S.d.mac;
  if (!m || $('#katman').innerHTML) return;
  const yazilabilir = m.tur === 'yaris' ? (m.faz === 'oyun' && !m.ben.cekildi)
    : (m.faz === 'gizli' && !m.ben.hazir) || (m.faz === 'oyun' && m.asama === 'tahmin' && m.siraBende);
  if (!yazilabilir) return;
  if (/^\d$/.test(e.key)) {
    const tus = document.querySelector(`.tus[data-v="${e.key}"]`);
    if (tus && !tus.disabled) EYLEM.tus(e.key);
  } else if (e.key === 'Backspace') EYLEM.sil();
  else if (e.key === 'Enter') {
    if (S.girdi.length === m.ayar.basamak) (m.faz === 'gizli' ? EYLEM.gizliOnay : EYLEM.sor)();
  }
});

// ------------------------------------------------------------ açılış
(async function basla() {
  ciz(); // "Yükleniyor"
  // Önce hesap: oyunun tamamı girişle oynanır
  if (!(await hesapDenetle())) { ciz(); return; }
  const p = new URLSearchParams(location.search);
  const davet = (p.get('oda') || '').toUpperCase();
  const kayitli = depo.al('sb_oda', null);
  if (davet) {
    history.replaceState(null, '', location.pathname);
    if (kayitli === davet) { baglan(davet); return; }
    S.alt = 'katil'; S.katilKod = davet;
  } else if (kayitli) {
    // Sayfa yenilendi ya da uygulama kapanıp açıldı: odaya geri dön
    istek('/api/katil', { kod: kayitli }).then(() => baglan(kayitli)).catch(() => depo.koy('sb_oda', null));
  }
  ciz();
  acikOdalariYenile();
  agAdresiOgren().then(() => { if (!S.kaynak) ciz(); });
})();
