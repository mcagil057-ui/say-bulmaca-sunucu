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
  katilKod: '',
  acikOdalar: [],
  agAdres: null,             // aynı Wi-Fi'dakilerin açacağı adres
};

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
function adim() { return (depo.al('sb_ad', '') || '').trim() || 'Oyuncu'; }

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
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({ id: ID }, govde)),
  });
  let v = {};
  try { v = await r.json(); } catch (e) { /* boş */ }
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
/** Sayıyı rakam rakam yazar; eleme tablosunda işaretli rakamlar renkli görünür. */
function sayiHTML(s) {
  return '<span class="sayi">' + String(s).split('').map(c =>
    `<i class="r${S.tablo[+c] || 0}">${c}</i>`).join('') + '</span>';
}
function haklar(yanlis, toplam) {
  let s = '';
  for (let i = 0; i < toplam; i++) s += `<b class="${i < yanlis ? 'gitti' : ''}"></b>`;
  return `<span class="haklar" title="Yanlış cevap: ${yanlis}/${toplam}">${s}</span>`;
}

/** Şu an hamle sırası bende mi (sayı seçmek, soru sormak ya da cevap vermek)? */
function hamleBende(d) {
  const m = d && d.mac;
  if (!m) return false;
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
        const r = await fetch(`${API}/api/bekle?kod=${encodeURIComponent(this.kod)}&id=${encodeURIComponent(ID)}&surum=${this.surum}`,
          { signal: this.iptal.signal, cache: 'no-store' });
        clearTimeout(saat);
        if (this.kapandi) return;
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
    this.ayar = Oyun.ayarDuzelt(ayar);
    this.macNo = 0;
    this.mac = null;
    this.yeniMac();
  }
  yeniMac() {
    const baslayan = this.mac ? 1 - this.mac.baslayan : (Math.random() < 0.5 ? 0 : 1);
    this.macNo++;
    this.mac = new Oyun.Mac(this.ayar, [adim(), 'Bot · ' + SEVIYE_AD[this.seviye]], baslayan);
    this.mac.gizliBelirle(1, Oyun.rastgeleSayi(this.ayar));
    this.yayinla();
  }
  durum() {
    return {
      oda: {
        kod: null, bot: this.seviye, ayar: this.ayar, kurucuBen: true, macNo: this.macNo, faz: 'mac',
        oyuncular: [{ ad: adim(), bagli: true, ben: true }, { ad: this.mac.oyuncular[1].ad, bagli: true, ben: false }],
      },
      mac: this.mac.gorunum(0),
      simdi: Date.now(),
    };
  }
  yayinla() {
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
      case 'rovans': this.yeniMac(); return;
      case 'ayril': case 'lobi': this.kapat(); anaMenu('bot'); return;
      default: h = 'Bilinmeyen eylem';
    }
    if (h) throw new Error(h);
    this.yayinla();
  }
  kapat() { clearTimeout(this.saat); clearTimeout(this.botSaat); this.mac.faz = 'bitti'; }
}

// ------------------------------------------------------------ durum akışı
function durumGeldi(d) {
  S.ofset = d.simdi - Date.now();
  const ilk = !S.d;
  if (d.mac) {
    const anahtar = (d.oda.kod || 'bot') + '-' + d.oda.macNo;
    if (anahtar !== S.tabloAnahtar) {
      S.tabloAnahtar = anahtar;
      S.tablo = jsonAl('sb_tablo_' + anahtar, null) || new Array(10).fill(0);
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
  if (hamleBende(d) && !hamleBende(S.d)) titret(80);
  if (d.mac && d.mac.faz === 'bitti' && !(S.d && S.d.mac && S.d.mac.faz === 'bitti')) titret([60, 60, 120]);
  S.d = d;
  ciz();
}

function olayGoster(o, m) {
  const ben = o.kim === 'ben';
  switch (o.tur) {
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
  S.alt = alt || null;
  ciz();
}

async function baglan(kod) {
  if (S.kaynak) S.kaynak.kapat();
  S.d = null;
  S.kaynak = new Cevrimici(kod);
  ciz();
}

// ------------------------------------------------------------ ekranlar
function ciz() {
  const d = S.d;
  let html;
  if (!S.kaynak) html = girisCiz();
  else if (!d) html = `<div class="ortala"><div class="yukleniyor">Bağlanılıyor…</div><button class="dugme ince" data-e="cik">Vazgeç</button></div>`;
  else if (!d.mac) html = lobiCiz(d);
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

function ayarFormu(a, eylem, kilitli) {
  const sec = (anahtar, deger, etiket) =>
    `<button class="sec ${a[anahtar] === deger ? 'secili' : ''}" data-e="${eylem}" data-v="${anahtar}=${deger}" ${kilitli ? 'disabled' : ''}>${etiket}</button>`;
  return `<div class="ayarlar">
    <div class="ayar"><span>Basamak</span><div class="secenekler">${[3, 4, 5].map(b => sec('basamak', b, b)).join('')}</div></div>
    <div class="ayar"><span>Tur süresi</span><div class="secenekler">${Oyun.SURELER.map(s => sec('turSure', s, s ? s + ' sn' : 'Yok')).join('')}</div></div>
    <div class="ayar"><span>Yanlış cevap hakkı</span><div class="secenekler">${[1, 2, 3, 4, 5].map(y => sec('yanlisHak', y, y)).join('')}</div></div>
    <div class="ayar"><span>Sayı 0 ile başlayabilir</span><div class="secenekler">${sec('basSifir', false, 'Hayır')}${sec('basSifir', true, 'Evet')}</div></div>
    <div class="ayar"><span title="Başlayan oyuncu bulursa rakibine son bir soru hakkı verilir">Eşit tur <small>(başlayan bulursa rakibe son hak)</small></span><div class="secenekler">${sec('esitTur', true, 'Açık')}${sec('esitTur', false, 'Kapalı')}</div></div>
  </div>`;
}

function girisCiz() {
  const ad = esc(depo.al('sb_ad', ''));
  let alt = '';
  if (S.alt === 'katil') {
    alt = `<div class="kart">
      <label for="kod">Oda kodu</label>
      <input id="kod" class="kod-girdi" maxlength="4" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCD" value="${esc(S.katilKod)}">
      <button class="dugme ana" data-e="katil">Odaya gir</button>
      <button class="dugme ince" data-e="geri">Geri</button>
    </div>`;
  } else if (S.alt === 'bot') {
    alt = `<div class="kart">
      <label>Bot seviyesi</label>
      <div class="secenekler genis">${['kolay', 'orta', 'zor'].map(s =>
        `<button class="sec ${S.botSeviye === s ? 'secili' : ''}" data-e="botSeviye" data-v="${s}">${SEVIYE_AD[s]}</button>`).join('')}</div>
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
      <button class="dugme ince" data-e="kurallar">Nasıl oynanır?</button>
    </div>
    ${YEREL_ACILIS && S.agAdres ? `<p class="not kucuk">Aynı Wi-Fi'daki telefonlar şu adresi açsın:<br><b class="ag-adres">${esc(S.agAdres)}</b></p>` : ''}`;
  }
  return `<section class="giris">
    ${logo()}
    <div class="kart ad-kart">
      <label for="ad">Adın</label>
      <input id="ad" maxlength="16" autocomplete="nickname" placeholder="Adını yaz" value="${ad}">
    </div>
    ${alt}
  </section>`;
}

function acikOdalarHTML() {
  const l = S.acikOdalar;
  const baslik = '<label>Açık odalar <small class="canli">● canlı</small></label>';
  if (!l.length) return baslik + '<p class="not kucuk sol">Şu an rakip bekleyen oda yok. Biri oda kurunca burada görünür.</p>';
  return baslik + '<ul class="oda-listesi">' + l.map(o => `<li>
      <div><b>${esc(o.ad)}</b><small>${o.basamak} basamak · ${o.turSure ? o.turSure + ' sn' : 'süresiz'}</small></div>
      <button class="sec secili" data-e="listedenKatil" data-v="${esc(o.kod)}">Gir</button>
    </li>`).join('') + '</ul>';
}

async function acikOdalariYenile() {
  if (S.kaynak || S.alt) return; // yalnızca ana menüdeyken
  try {
    const r = await fetch(API + '/api/odalar').then(x => x.json());
    S.acikOdalar = r.odalar || [];
  } catch (e) { S.acikOdalar = []; }
  // Yalnızca listeyi yenile: bütün ekranı çizersek ad kutusuna yazılan kaybolur
  const k = document.getElementById('acik-odalar');
  if (k && !S.kaynak && !S.alt) k.innerHTML = acikOdalarHTML();
}
setInterval(acikOdalariYenile, 3000);

function lobiCiz(d) {
  const o = d.oda;
  const rakip = o.oyuncular.find(x => !x.ben);
  const oyuncular = o.oyuncular.map((x, i) =>
    `<li><span class="nokta ${x.bagli ? 'acik' : ''}"></span>${esc(x.ad)}${x.ben ? ' <small>(sen)</small>' : ''}${i === 0 ? ' <small class="rozet">kurucu</small>' : ''}</li>`).join('')
    + (rakip ? '' : '<li class="bekle"><span class="nokta"></span>Rakip bekleniyor…</li>');
  const basla = o.kurucuBen
    ? `<button class="dugme ana" data-e="basla" ${rakip ? '' : 'disabled'}>${rakip ? 'Oyunu başlat' : 'Rakip bekleniyor…'}</button>`
    : '<p class="not">Odayı kuran oyunu başlatacak.</p>';
  return `<section class="lobi">
    <div class="ust-cubuk"><button class="geri-ok" data-e="cik" aria-label="Odadan çık">‹</button><span>Oda</span><span></span></div>
    <div class="kart oda-kart">
      <div class="oda-kod">${esc(o.kod)}</div>
      <p class="not">Aynı Wi-Fi'daysanız odan arkadaşının ekranında <b>Açık odalar</b> listesinde görünür. Değilse bu kodu söyle ya da bağlantıyı gönder.</p>
      ${YEREL_ACILIS && S.agAdres ? `<p class="not kucuk">Telefonlar şu adresi açsın: <b class="ag-adres">${esc(S.agAdres)}</b></p>` : ''}
      <div class="ikili">
        <button class="dugme" data-e="kopyala">Kodu kopyala</button>
        <button class="dugme" data-e="paylas">Bağlantı gönder</button>
      </div>
    </div>
    <div class="kart"><label>Oyuncular</label><ul class="oyuncular">${oyuncular}</ul></div>
    <div class="kart"><label>Ayarlar ${o.kurucuBen ? '' : '<small>(kurucu belirler)</small>'}</label>${ayarFormu(o.ayar, 'ayar', !o.kurucuBen)}</div>
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

function tusTakimi(ayar, girdi, tamamEylem, tamamYazi) {
  let s = '<div class="tuslar">';
  for (const c of '1234567890') {
    const kullanildi = girdi.indexOf(c) >= 0;
    const basSifir = c === '0' && girdi.length === 0 && !ayar.basSifir;
    const dolu = girdi.length >= ayar.basamak;
    s += `<button class="tus r${S.tablo[+c]}" data-e="tus" data-v="${c}" ${kullanildi || basSifir || dolu ? 'disabled' : ''}>${c}</button>`;
  }
  return s + `<button class="tus sil" data-e="sil" ${girdi ? '' : 'disabled'} aria-label="Sil">⌫</button>
    <button class="tus tamam" data-e="${tamamEylem}" ${girdi.length === ayar.basamak ? '' : 'disabled'}>${tamamYazi}</button></div>`;
}

function gizliCiz(d) {
  const m = d.mac;
  const ust = `<div class="ust-cubuk"><button class="geri-ok" data-e="cik" aria-label="Çık">‹</button><span>${esc(m.ben.ad)} — ${esc(m.rakip.ad)}</span><span></span></div>`;
  if (m.ben.hazir) {
    return `<section class="gizli">${ust}
      <div class="ortala">
        <p class="not">Tuttuğun sayı</p>
        ${kutular(m.ayar.basamak, m.ben.gizli)}
        <div class="yukleniyor">${esc(m.rakip.ad)} sayısını seçiyor…</div>
      </div>${baglantiUyari()}</section>`;
  }
  return `<section class="gizli">${ust}
    <div class="ortala">
      <h2>Sayını tut</h2>
      <p class="not">${m.ayar.basamak} basamaklı, rakamları birbirinden farklı${m.ayar.basSifir ? '' : ', 0 ile başlamayan'} bir sayı.</p>
      ${kutular(m.ayar.basamak, S.girdi)}
      <p class="not kucuk">Rakip: ${m.rakip.hazir ? 'seçti ✓' : 'seçiyor…'} · İlk soruyu ${m.baslayanBen ? '<b>sen</b>' : esc(m.rakip.ad)} soracak</p>
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
      ${k.tahmin ? sayiHTML(k.tahmin) : '<span class="sayi soluk">———</span>'}
      <span class="esittir">=</span>
      ${k.tahmin ? cevapHTML(k.arti, k.eksi) : '<span class="etiket">süre doldu</span>'}
      ${k.verilen ? `<span class="hatali" title="Yanlış yazdın">✗ ${esc(cevapMetin(k.verilen.arti, k.verilen.eksi))}</span>` : ''}
      ${k.sure && k.tahmin ? '<span class="hatali" title="Cevap süresi doldu">⏱</span>' : ''}
    </li>`).join('');
  const benim = m.sorularim.map(k => `<li>
      ${k.tahmin ? sayiHTML(k.tahmin) : '<span class="sayi soluk">———</span>'}
      <span class="esittir">=</span>
      ${k.tahmin ? cevapHTML(k.arti, k.eksi) : '<span class="etiket">süre doldu</span>'}
      ${k.verilen ? `<span class="duzeltme" title="Rakip yanlış yazdı, uygulama düzeltti">düzeltildi</span>` : ''}
    </li>`).join('');

  return `<section class="oyun ${bitti ? 'bitti' : ''}">
    <header class="oyun-ust">
      <button class="geri-ok" data-e="menuAc" aria-label="Menü">⋯</button>
      <div class="kisi ben"><span class="isim">${esc(m.ben.ad)}</span>${haklar(m.ben.yanlis, a.yanlisHak)}</div>
      <div class="sure" id="sure"><span id="sure-sayi"></span><i id="sure-cubuk"></i></div>
      <div class="kisi rakip"><span class="isim">${esc(m.rakip.ad)}${rakipBagli(d) ? '' : ' <small class="kopuk">(koptu)</small>'}</span>${haklar(m.rakip.yanlis, a.yanlisHak)}</div>
    </header>
    <div class="durum-serit ${hamleBende(d) ? 'sende' : ''}">${durumYazi}</div>
    ${tablo}
    <div class="defter">
      <div class="sutun">
        <div class="sutun-bas"><span class="tuttugum">${sayiHTML(m.ben.gizli)}</span><small>tuttuğum sayı</small></div>
        <div class="sutun-ad">Gelen sorular</div>
        <ol class="liste">${gelen || '<li class="bos">Henüz soru gelmedi</li>'}</ol>
      </div>
      <div class="cizgi"></div>
      <div class="sutun">
        <div class="sutun-bas"><span class="tuttugum soru">${bitti && m.rakip.gizli ? sayiHTML(m.rakip.gizli) : '?'.repeat(a.basamak)}</span><small>rakibin sayısı</small></div>
        <div class="sutun-ad">Sorduğum sorular</div>
        <ol class="liste">${benim || '<li class="bos">Henüz soru sormadın</li>'}</ol>
      </div>
    </div>
    ${bitti ? sonucSerit(m) : eylemAlani(m)}
    ${baglantiUyari()}
  </section>`;
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
        <div><small>Gelen soru</small>${sayiHTML(m.bekleyen)}</div>
        <div><small>Senin sayın</small><span class="sayi">${esc(m.ben.gizli)}</span></div>
      </div>
      <div class="cevap-satir"><span>Yeri doğru</span><div class="secenekler">${satir('arti', '+', c.arti, N - c.eksi)}</div></div>
      <div class="cevap-satir"><span>Yeri yanlış</span><div class="secenekler">${satir('eksi', '−', c.eksi, N - c.arti)}</div></div>
      <button class="dugme ana" data-e="cevapGonder">Cevabı gönder: ${cevapMetin(c.arti, c.eksi)}</button>
    </div>`;
  }
  const bekle = m.asama === 'tahmin'
    ? 'Rakip sorusunu düşünüyor…'
    : `Sorduğun ${sayiHTML(m.bekleyen)} için rakibin cevabı bekleniyor…`;
  return `<div class="eylem-alani bekleme"><div class="yukleniyor">${bekle}</div></div>`;
}

function sonucSerit(m) {
  return `<div class="eylem-alani"><div class="ikili">
    <button class="dugme ana" data-e="rovans">Rövanş</button>
    <button class="dugme" data-e="sonucAc">Sonuç</button>
  </div></div>`;
}

function katmanCiz() {
  const k = $('#katman');
  let ic = '';
  const m = S.d && S.d.mac;
  if (S.kurallar) {
    ic = `<div class="modal"><h2>Nasıl oynanır?</h2>
      <ol class="kurallar">
        <li>İki oyuncu da rakamları birbirinden farklı bir sayı tutar (ör. <b>302</b>).</li>
        <li>Sırayla birbirinizin sayısını tahmin edersiniz.</li>
        <li>Soru gelince cevabı <b>sen yazarsın</b>: yeri doğru her rakam <span class="c arti">+1</span>, sayıda olup yeri yanlış her rakam <span class="c eksi">−1</span>, hiçbiri yoksa <span class="c sifir">0</span>.</li>
        <li>Örnek: sayın 302, soru 203 → 0'ın yeri doğru, 2 ve 3'ün yeri yanlış: <span class="c arti">+1</span><span class="c eksi">−2</span></li>
        <li>Yanlış cevap yazarsan uygulama yakalar: hakkın düşer, rakibe doğru cevap gider. Hakların bitince kaybedersin.</li>
        <li>Rakibin sayısını ilk bulan kazanır. "Eşit tur" açıksa, başlayan bulduğunda rakibine son bir hak verilir; o da bulursa berabere.</li>
        <li>Üstteki 0–9 tablosu not içindir: dokununca rakam çizilir (yok), bir daha dokununca yeşil olur (var).</li>
      </ol>
      <button class="dugme ana" data-e="kurallarKapat">Anladım</button></div>`;
  } else if (S.menu && m) {
    const bitti = m.faz === 'bitti';
    ic = `<div class="modal"><h2>Menü</h2>
      <button class="dugme" data-e="kurallar">Nasıl oynanır?</button>
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
        <div><small>Senin sayın</small>${sayiHTML(m.ben.gizli)}</div>
        <div><small>${esc(m.rakip.ad)}</small>${m.rakip.gizli ? sayiHTML(m.rakip.gizli) : ''}</div>
      </div>
      <button class="dugme ana" data-e="rovans">Rövanş</button>
      ${kurucu ? '<button class="dugme" data-e="lobi">Ayarları değiştir</button>' : ''}
      ${S.d.oda.bot ? '<button class="dugme" data-e="lobi">Seviye / ayar değiştir</button>' : ''}
      <button class="dugme ince" data-e="sonucKapat">Tahtaya bak</button></div>`;
  }
  k.innerHTML = ic ? `<div class="perde">${ic}</div>` : '';
}

// ------------------------------------------------------------ süre göstergesi
function sureGuncelle() {
  const kutu = $('#sure');
  if (!kutu) return;
  const m = S.d && S.d.mac;
  if (!m || m.faz !== 'oyun' || !m.bitis) { kutu.className = 'sure yok'; return; }
  const kalan = Math.max(0, m.bitis - (Date.now() + S.ofset));
  const sn = Math.ceil(kalan / 1000);
  $('#sure-sayi').textContent = sn;
  $('#sure-cubuk').style.width = (100 * kalan / (m.ayar.turSure * 1000)) + '%';
  kutu.className = 'sure' + (sn <= 10 ? ' az' : '') + (hamleBende(S.d) ? ' benim' : '');
}
setInterval(sureGuncelle, 250);

// ------------------------------------------------------------ eylemler
async function gonder(tur, veri) {
  if (!S.kaynak || S.mesgul) return false;
  S.mesgul = true;
  try { await S.kaynak.eylem(tur, veri); return true; }
  catch (h) { bildir(h.message || 'Bir hata oldu', 'kotu'); return false; }
  finally { S.mesgul = false; }
}

function ayarDegeri(v) {
  const [k, x] = v.split('=');
  return { [k]: x === 'true' ? true : x === 'false' ? false : +x };
}

const EYLEM = {
  async odaKur() {
    try { const r = await istek('/api/oda', { ad: adim() }); baglan(r.kod); }
    catch (h) { bildir('Sunucuya ulaşılamadı: ' + h.message, 'kotu'); }
  },
  katilAc() { S.alt = 'katil'; ciz(); setTimeout(() => $('#kod') && $('#kod').focus(), 50); },
  botAc() { S.alt = 'bot'; ciz(); },
  geri() { S.alt = null; ciz(); acikOdalariYenile(); },
  async listedenKatil(kod) {
    try { await istek('/api/katil', { kod, ad: adim() }); baglan(kod); }
    catch (h) { bildir(h.message, 'kotu'); acikOdalariYenile(); }
  },
  async katil() {
    const kod = ($('#kod').value || '').trim().toUpperCase();
    if (kod.length !== 4) { bildir('Oda kodu 4 harfli', 'kotu'); return; }
    try { await istek('/api/katil', { kod, ad: adim() }); baglan(kod); }
    catch (h) { bildir(h.message, 'kotu'); }
  },
  botSeviye(v) { S.botSeviye = v; depo.koy('sb_bot', v); ciz(); },
  botAyar(v) { S.botAyar = Oyun.ayarDuzelt(Object.assign({}, S.botAyar, ayarDegeri(v))); depo.koy('sb_botayar', JSON.stringify(S.botAyar)); ciz(); },
  botBasla() { S.d = null; S.kaynak = new YerelOda(S.botSeviye, S.botAyar); ciz(); },
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
    if (S.kaynak instanceof Cevrimici) { try { await S.kaynak.eylem('ayril'); } catch (e) { /* zaten yok */ } anaMenu(); }
    else anaMenu(S.kaynak ? 'bot' : null);
  },
  tus(v) {
    const a = S.d.mac.ayar;
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
    if (S.d.mac.sorularim.some(k => k.tahmin === s)) { bildir('Bu sayıyı zaten sordun', 'kotu'); return; }
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
    depo.koy('sb_tablo_' + S.tabloAnahtar, JSON.stringify(S.tablo));
    ciz();
  },
  menuAc() { S.menu = true; katmanCiz(); },
  menuKapat() { S.menu = false; katmanCiz(); },
  async teslim() {
    if (!confirm('Pes etmek istediğine emin misin?')) return;
    S.menu = false;
    await gonder('teslim');
    katmanCiz();
  },
  rovans() { S.sonucKapali = false; gonder('rovans'); },
  lobi() { gonder('lobi'); },
  sonucKapat() { S.sonucKapali = true; katmanCiz(); },
  sonucAc() { S.sonucKapali = false; katmanCiz(); },
  kurallar() { S.kurallar = true; S.menu = false; katmanCiz(); },
  kurallarKapat() { S.kurallar = false; katmanCiz(); },
};

document.addEventListener('click', e => {
  const b = e.target.closest('[data-e]');
  if (!b || b.disabled) return;
  const f = EYLEM[b.dataset.e];
  if (f) f(b.dataset.v, b);
});

document.addEventListener('input', e => {
  if (e.target.id === 'ad') depo.koy('sb_ad', e.target.value.trim().slice(0, 16));
  if (e.target.id === 'kod') {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    S.katilKod = e.target.value;
  }
});

// Bilgisayarda klavyeyle de oynanabilsin
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') {
    if (e.key === 'Enter' && e.target.id === 'kod') EYLEM.katil();
    return;
  }
  const m = S.d && S.d.mac;
  if (!m || $('#katman').innerHTML) return;
  const yazilabilir = (m.faz === 'gizli' && !m.ben.hazir) || (m.faz === 'oyun' && m.asama === 'tahmin' && m.siraBende);
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
(function basla() {
  const p = new URLSearchParams(location.search);
  const davet = (p.get('oda') || '').toUpperCase();
  const kayitli = depo.al('sb_oda', null);
  if (davet) {
    history.replaceState(null, '', location.pathname);
    if (kayitli === davet) { baglan(davet); return; }
    S.alt = 'katil'; S.katilKod = davet;
  } else if (kayitli) {
    // Sayfa yenilendi ya da uygulama kapanıp açıldı: odaya geri dön
    istek('/api/katil', { kod: kayitli, ad: adim() }).then(() => baglan(kayitli)).catch(() => depo.koy('sb_oda', null));
  }
  ciz();
  acikOdalariYenile();
  agAdresiOgren().then(() => { if (!S.kaynak) ciz(); });
})();
