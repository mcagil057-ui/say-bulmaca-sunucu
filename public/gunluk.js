/*
 * Sayı Bulmaca — günün bulmacası.
 *
 * Her gün herkese aynı 4 basamaklı sayı. Gizli sayı yalnızca sunucuda durur;
 * telefon her soruyu sunucuya sorar, cevabı alır. Bulunca sonuç sunucuda
 * doğrulanıp günün sıralamasına yazılır. Sorular telefonda saklanır:
 * uygulama kapanıp açılınca kaldığın yerden devam edersin.
 */
'use strict';
const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
function gunYazi(gun) { const [y, a, g] = gun.split('-').map(Number); return `${g} ${AYLAR[a - 1]} ${y}`; }

function gunlukAyar() { return Oyun.ayarDuzelt({ basamak: S.g.basamak, basSifir: S.g.basSifir }); }
function gunlukSakla() {
  const g = S.g;
  depo.koy('sb_gunluk', JSON.stringify({ gun: g.gun, tahminler: g.tahminler, gonderildi: g.gonderildi, tablo: g.tablo }));
}
function gunlukBitti() { return S.g && S.g.tahminler.some(k => k.arti === S.g.basamak); }

async function gunlukYukle() {
  S.g = Object.assign(S.g || {}, { yukleniyor: true, hata: null });
  ciz();
  try {
    const r = await fetch(`${API}/api/gunluk?id=${encodeURIComponent(ID)}`, { cache: 'no-store' }).then(x => { if (!x.ok) throw new Error('Sunucu ' + x.status); return x.json(); });
    const yerel = jsonAl('sb_gunluk', null);
    const ayni = yerel && yerel.gun === r.gun;
    S.g = {
      gun: r.gun, basamak: r.basamak, basSifir: r.basSifir, siralama: r.siralama, toplam: r.toplam, benim: r.benim,
      tahminler: ayni ? yerel.tahminler || [] : [],
      gonderildi: ayni ? !!yerel.gonderildi : false,
      tablo: ayni && Array.isArray(yerel.tablo) ? yerel.tablo : new Array(10).fill(0),
      yukleniyor: false,
    };
    gunlukSakla();
    // Çözülmüş ama sonuç sunucuya gitmemişse (ya da sunucu yeniden kurulmuşsa) gönder
    if (gunlukBitti() && (!S.g.gonderildi || !S.g.benim)) gunlukGonder();
  } catch (e) {
    S.g.yukleniyor = false;
    S.g.hata = 'Sunucuya ulaşılamadı. İnternetini kontrol edip tekrar dene.';
  }
  if (S.alt === 'gunluk') ciz();
}

async function gunlukGonder() {
  try {
    const r = await istek('/api/gunluk/bitti', { gun: S.g.gun, ad: adim(), tahminler: S.g.tahminler.map(k => k.tahmin) });
    Object.assign(S.g, { siralama: r.siralama, toplam: r.toplam, benim: r.benim, gonderildi: true });
    gunlukSakla();
  } catch (e) { /* bir dahaki açılışta yeniden denenir */ }
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
  const l = (g.siralama || []).map((x, i) => `<li class="${x.ben ? 'ben' : ''}"><span class="an-no">${i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}</span><span class="sir-ad">${esc(x.ad)}${x.ben ? ' <small>(sen)</small>' : ''}</span><b>${x.soru} soru</b></li>`).join('');
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
      const p = await istek('/api/gunluk/sor', { gun: g.gun, tahmin: t });
      g.tahminler.push({ tahmin: t, arti: p.arti, eksi: p.eksi });
      gunlukSakla();
      if (p.arti === a.basamak) {
        Istat.gunlukKaydet(g.gun, g.tahminler.length);
        Ses.cal('kazandin'); titret([60, 60, 120]);
        await gunlukGonder();
        S.gSiralama = true;
      } else Ses.cal(p.arti + p.eksi === 0 ? 'sifir' : p.arti >= a.basamak - 1 ? 'yakin' : 'cevap');
    } catch (e) {
      S.girdi = t;
      if (e.kod === 409) { bildir('Gün değişti, yeni bulmaca yükleniyor', 'kotu'); S.mesgul = false; gunlukYukle(); return; }
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
