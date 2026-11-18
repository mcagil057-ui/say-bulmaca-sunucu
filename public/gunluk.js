/*
 * Sayı Bulmaca — günün bulmacası.
 *
 * Her gün herkese aynı 4 basamaklı sayı. Gizli sayı yalnızca sunucuda durur;
 * telefon her soruyu sunucuya sorar. İlerleme HESABA bağlı, veritabanında
 * durur: aynı hesapla hangi cihazdan girersen gir kaldığın yerden devam
 * edersin, bir hesap günde bir kez oynar (bkz. gunluk-sunucu.js).
 * Telefonda yalnızca eleme tablosu saklanır.
 */
'use strict';
const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
function gunYazi(gun) { const [y, a, g] = gun.split('-').map(Number); return `${g} ${AYLAR[a - 1]} ${y}`; }

function gunlukAyar() { return Oyun.ayarDuzelt({ basamak: S.g.basamak, basSifir: S.g.basSifir }); }
function gunlukSakla() {
  const g = S.g;
  depo.koy('sb_gunluk', JSON.stringify({ gun: g.gun, tablo: g.tablo }));
}
function gunlukBitti() { return S.g && S.g.tahminler.some(k => k.arti === S.g.basamak); }
function sunucudanAl(r) {
  Object.assign(S.g, { gun: r.gun, basamak: r.basamak, basSifir: r.basSifir, siralama: r.siralama, toplam: r.toplam, benim: r.benim, tahminler: r.tahminler || [] });
}

async function gunlukYukle() {
  S.g = Object.assign(S.g || {}, { yukleniyor: true, hata: null });
  ciz();
  try {
    const x = await fetch(`${API}/api/gunluk`, { cache: 'no-store', headers: basliklar() });
    if (x.status === 401) { girisGerekli(); return; }
    if (!x.ok) throw new Error('Sunucu ' + x.status);
    const r = await x.json();
    const yerel = jsonAl('sb_gunluk', null);
    const ayni = yerel && yerel.gun === r.gun;
    S.g = { tablo: ayni && Array.isArray(yerel.tablo) ? yerel.tablo : new Array(10).fill(0), yukleniyor: false };
    sunucudanAl(r);
    if (gunlukBitti()) Istat.gunlukKaydet(r.gun, r.tahminler.length);
    gunlukSakla();
  } catch (e) {
    S.g.yukleniyor = false;
    S.g.hata = 'Sunucuya ulaşılamadı. İnternetini kontrol edip tekrar dene.';
  }
  if (S.alt === 'gunluk') ciz();
}

function gunlukCiz() {
  const g = S.g;
  const ust = `<header class="ust-cubuk"><button class="geri-ok" data-e="geri" aria-label="Geri">‹</button>
    <span>Günün bulmacası</span>
    <button class="geri-ok" data-e="gSiralama" aria-label="Sıralama">🏆</button></header>`;
  if (!g || g.yukleniyor) return `<section class="oyun gunluk">${ust}<div class="ortala"><div class="yukleniyor">Bulmaca geliyor</div><p class="not kucuk">Sunucu uyuyorsa ilk açılış biraz sürebilir.</p></div></section>`;
  if (g.hata) return `<section class="oyun gunluk">${ust}<div class="ortala"><p class="not">${esc(g.hata)}</p><button class="dugme ana" data-e="gunlukAc">Tekrar dene</button></div></section>`;

  const a = gunlukAyar();
  const bitti = gunlukBitti();
  const tablo = '<div class="tablo" role="group" aria-label="Rakam eleme tablosu">' +
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => `<button class="hucre r${g.tablo[i]}" data-e="gTablo" data-v="${i}" aria-label="${i}">${i}</button>`).join('') + '</div>';
  const liste = g.tahminler.map((k, i) => `<li><span class="an-no">${i + 1}</span>${sayiHTML(k.tahmin, true, g.tablo)}<span class="esittir">=</span>${cevapHTML(k.arti, k.eksi)}</li>`).join('');
  const alt = bitti
    ? `<div class="eylem-alani"><div class="gunluk-bitti">🎉 <b>${g.tahminler.length}</b> soruda buldun!</div>
        <div class="ikili"><button class="dugme ana" data-e="gPaylas">Sonucu paylaş</button><button class="dugme" data-e="gSiralama">Sıralama 🏆</button></div>
        <p class="not kucuk">Yeni bulmaca gece yarısı gelir. Bugün ${g.toplam} kişi çözdü.</p></div>`
    : `<div class="eylem-alani">${kutular(a.basamak, S.girdi)}${tusTakimi(a, S.girdi, 'gSor', 'Sor', g.tablo)}</div>`;

  return `<section class="oyun gunluk">${ust}
    <div class="durum-serit">${gunYazi(g.gun)} · ${a.basamak} basamak · herkese aynı</div>
    ${tablo}
    <div class="defter tek"><div class="sutun">
      <div class="sutun-ad">Sorularım ${g.tahminler.length ? `(${g.tahminler.length})` : ''}</div>
      <ol class="liste" id="g-liste">${liste || `<li class="bos">${a.basamak} basamaklı, rakamları farklı bir sayı tuttum. En az soruda bulan sıralamada birinci olur. Bugün ${g.toplam} kişi çözdü.</li>`}</ol>
    </div></div>
    ${alt}
  </section>`;
}

function siralamaHTML() {
  const g = S.g;
  const l = (g.siralama || []).map((x, i) => `<li class="${x.ben ? 'ben' : ''}"><span class="an-no">${i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}</span><span class="sir-ad">${x.rozet ? x.rozet + ' ' : ''}${esc(x.ad)}${x.ben ? ' <small>(sen)</small>' : ''}</span><b>${x.soru} soru</b></li>`).join('');
  return `<div class="modal"><h2>Bugünün sıralaması</h2>
    <p>${gunYazi(g.gun)} · ${g.toplam} kişi çözdü</p>
    <ol class="sir-liste">${l || '<li class="bos">Henüz çözen yok. İlk sen ol!</li>'}</ol>
    ${gunlukBitti() ? '' : '<p class="not kucuk">Sayıyı bulunca adın burada çıkar.</p>'}
    <button class="dugme ana" data-e="gSiralamaKapat">Kapat</button></div>`;
}

function gunlukPaylasMetin() {
  const g = S.g;
  // Nasıl çözüldüğü (sorular, cevaplar) paylaşılmaz: yalnızca gün, soru sayısı ve meydan okuma
  return `🧩 Sayı Bulmaca · Günün bulmacası\n📅 ${gunYazi(g.gun)}\n🎯 ${g.tahminler.length} soruda buldum!\n\nBakalım sen kaç soruda çözeceksin? 😏\n${location.origin}/`;
}

const GUNLUK_EYLEM = {
  gunlukAc() { S.alt = 'gunluk'; S.girdi = ''; S.gSiralama = false; gunlukYukle(); },
  gTablo(v) { S.g.tablo[v] = (S.g.tablo[v] + 1) % 3; gunlukSakla(); ciz(); },
  async gSor() {
    const g = S.g, a = gunlukAyar();
    const h = Oyun.sayiHatasi(S.girdi, a);
    if (h) { bildir(h, 'kotu'); return; }
    const t = S.girdi;
    if (g.tahminler.some(k => k.tahmin === t)) { bildir('Bu sayıyı zaten sordun', 'kotu'); return; }
    if (S.mesgul) return;
    S.mesgul = true; S.girdi = '';
    try {
      const r = await istek('/api/gunluk/sor', { gun: g.gun, tahmin: t });
      sunucudanAl(r);
      gunlukSakla();
      const k = g.tahminler[g.tahminler.length - 1] || {};
      if (gunlukBitti()) {
        Istat.gunlukKaydet(g.gun, g.tahminler.length);
        Ses.cal('kazandin'); titret([60, 60, 120]); konfeti();
        setTimeout(istatYenile, 2500);   // günlük seri rozeti
        S.gSiralama = true;
      } else Ses.cal(k.arti + k.eksi === 0 ? 'sifir' : k.arti >= a.basamak - 1 ? 'yakin' : 'cevap');
    } catch (e) {
      S.girdi = t;
      S.mesgul = false;
      if (e.kod === 409) { bildir(e.message, 'kotu'); S.girdi = ''; gunlukYukle(); return; }
      bildir(e.message || 'Bir hata oldu', 'kotu');
    } finally { S.mesgul = false; }
    ciz();
    const l = document.getElementById('g-liste');
    if (l) l.scrollTop = l.scrollHeight;
  },
  gSiralama() { S.gSiralama = true; katmanCiz(); },
  gSiralamaKapat() { S.gSiralama = false; katmanCiz(); },
  async gPaylas() {
    const metin = gunlukPaylasMetin();
    if (window.SBAndroid) { window.SBAndroid.paylas(metin); return; }
    try {
      if (navigator.share) await navigator.share({ text: metin });
      else { await navigator.clipboard.writeText(metin); bildir('Sonuç kopyalandı, istediğin yere yapıştır'); }
    } catch (e) { if (e && e.name !== 'AbortError') bildir('Paylaşılamadı', 'kotu'); }
  },
};
