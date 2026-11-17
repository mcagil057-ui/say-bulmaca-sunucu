/*
 * Sayı Bulmaca — meydan okuma bağlantısı (telefon tarafı).
 *
 * "⚔️ Meydan oku": bir sayı tut (ya da rastgele) → bağlantıyı gönder. Açan
 * kişi sayıyı kendi başına bulmaya çalışır; meydan okuyan kimin kaç soruda,
 * ne kadar sürede bulduğunu görür. Sayı yalnızca sunucuda durur.
 */
'use strict';

function meydanAyar() { return Oyun.ayarDuzelt({ basamak: S.m.basamak }); }
function meydanBitti() { return S.m && S.m.tahminler.some(k => k.arti === S.m.basamak); }

async function meydanYukle(id) {
  S.m = { id, yukleniyor: true, tablo: new Array(10).fill(0) };
  S.alt = 'meydan'; S.girdi = '';
  ciz();
  try {
    const x = await fetch(`${API}/api/meydan?id=${encodeURIComponent(id)}`, { headers: basliklar(), cache: 'no-store' });
    const r = await x.json();
    if (!x.ok) throw new Error(r.hata || 'Sunucu ' + x.status);
    const t = jsonAl('sb_meydan_tablo', {});
    S.m = Object.assign(r, { tablo: t.id === id && Array.isArray(t.t) ? t.t : new Array(10).fill(0) });
  } catch (e) { S.m = { id, hata: e.message || 'Sunucuya ulaşılamadı', tablo: new Array(10).fill(0) }; }
  if (S.alt === 'meydan') ciz();
}

function meydanBaglanti(id) { return `${location.origin}/?meydan=${encodeURIComponent(id)}`; }

async function meydanPaylas(id, metin) {
  const url = meydanBaglanti(id);
  if (window.SBAndroid) { window.SBAndroid.paylas(metin + '\n' + url); return; }
  try {
    if (navigator.share) await navigator.share({ title: 'Sayı Bulmaca', text: metin, url });
    else { await navigator.clipboard.writeText(metin + ' ' + url); bildir('Bağlantı kopyalandı'); }
  } catch (e) { if (e && e.name !== 'AbortError') bildir(url); }
}

/** Meydan okuma kurma ekranı (+ gönderdiklerim). */
function meydanKurCiz() {
  const k = S.mk || (S.mk = { basamak: 3, sayi: '', liste: null });
  const ust = `<div class="ust-cubuk"><button class="geri-ok" data-e="geri" aria-label="Geri">‹</button><span>⚔️ Meydan oku</span><span></span></div>`;
  const liste = k.liste == null ? '<p class="not kucuk">Yükleniyor…</p>'
    : !k.liste.length ? '<p class="not kucuk sol">Henüz meydan okuma göndermedin.</p>'
      : `<ul class="ist-liste">${k.liste.map(m => `<li data-e="meydanAc" data-v="${esc(m.id)}" class="tiklanir">
          <span>${m.basamak} basamak <small>${new Date(m.olusturma).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })}</small></span>
          <small>${m.oynayan} kişi oynadı · ${m.cozen} buldu ›</small></li>`).join('')}</ul>`;
  return `<section class="profil">${ust}
    <div class="kart">
      <p class="not sol">Bir sayı tut, bağlantıyı gönder: <b>"Bakalım kaç soruda bulacaksın?"</b> Kim kaç soruda, ne kadar sürede buldu, sen görürsün.</p>
      <label>Basamak</label>
      <div class="secenekler genis">${[3, 4].map(b => `<button class="sec ${k.basamak === b ? 'secili' : ''}" data-e="mkBasamak" data-v="${b}">${b} basamak</button>`).join('')}</div>
      <label for="m-sayi">Tuttuğun sayı <small>(boş bırakırsan uygulama tutar)</small></label>
      <input id="m-sayi" inputmode="numeric" maxlength="${k.basamak}" placeholder="${'•'.repeat(k.basamak)}" value="${esc(k.sayi)}" autocomplete="off">
      <button class="dugme ana" data-e="mkOlustur">Bağlantıyı oluştur ve gönder</button>
    </div>
    <div class="kart"><label>Gönderdiklerim</label>${liste}</div>
  </section>`;
}

/** Meydan okumayı oynama / sonuç ekranı. */
function meydanCiz() {
  const m = S.m;
  const ust = `<header class="ust-cubuk"><button class="geri-ok" data-e="geri" aria-label="Geri">‹</button><span>⚔️ Meydan okuma</span><span></span></header>`;
  if (!m || m.yukleniyor) return `<section class="oyun gunluk">${ust}<div class="ortala"><div class="yukleniyor">Yükleniyor</div></div></section>`;
  if (m.hata) return `<section class="oyun gunluk">${ust}<div class="ortala"><p class="not">${esc(m.hata)}</p><button class="dugme" data-e="geri">Ana menü</button></div></section>`;
  const sonuclar = m.sonuclar ? `<ol class="sir-liste">${m.sonuclar.length ? m.sonuclar.map((x, i) => `<li class="${x.ben ? 'ben' : ''}">
      <span class="an-no">${x.cozuldu ? (i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1) : '…'}</span><span class="sir-ad">${esc(x.ad)}${x.ben ? ' <small>(sen)</small>' : ''}</span>
      <b>${x.cozuldu ? `${x.soru} soru <small>${sureYazi(x.sure)}</small>` : `<small>${x.soru} soru, sürüyor</small>`}</b></li>`).join('') : '<li class="bos">Henüz kimse oynamadı.</li>'}</ol>` : '';

  // Meydan okuyanın kendi görünümü
  if (m.sahipBen) {
    return `<section class="profil">${ust}
      <div class="kart"><p class="not">Senin meydan okuman · ${m.basamak} basamak</p>
        <div class="karsilastir"><div><small>Tuttuğun sayı</small>${sayiHTML(m.gizli, false)}</div></div>
        <button class="dugme ana" data-e="mPaylas">Bağlantıyı yeniden gönder</button></div>
      <div class="kart"><label>Kim nasıl buldu</label>${sonuclar}</div>
    </section>`;
  }

  const a = meydanAyar(), bitti = meydanBitti();
  const tablo = '<div class="tablo" role="group" aria-label="Rakam eleme tablosu">' +
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => `<button class="hucre r${m.tablo[i]}" data-e="mTablo" data-v="${i}" aria-label="${i}">${i}</button>`).join('') + '</div>';
  const liste = m.tahminler.map((k, i) => `<li><span class="an-no">${i + 1}</span>${sayiHTML(k.tahmin, true, m.tablo)}<span class="esittir">=</span>${cevapHTML(k.arti, k.eksi)}</li>`).join('');
  const sure = bitti ? sureYazi(m.cozuldu - m.baslangic) : '';
  const alt = bitti
    ? `<div class="eylem-alani"><div class="gunluk-bitti">🎉 <b>${m.tahminler.length}</b> soruda, <b>${sure}</b>'de buldun!</div>
        <div class="ikili"><button class="dugme ana" data-e="mSonucPaylas">Sonucu gönder</button><button class="dugme" data-e="meydanKurAc">⚔️ Sen de meydan oku</button></div></div>`
    : `<div class="eylem-alani">${kutular(a.basamak, S.girdi)}${tusTakimi(a, S.girdi, 'mSor', 'Sor', m.tablo)}</div>`;
  return `<section class="oyun gunluk">${ust}
    <div class="durum-serit">${bitti ? 'Buldun! Diğerlerinin sonuçları aşağıda' : `<b>${esc(m.sahip)}</b> sana meydan okuyor: ${a.basamak} basamaklı sayıyı bul!`}</div>
    ${bitti ? '' : tablo}
    <div class="defter tek"><div class="sutun">
      <div class="sutun-bas"><span class="tuttugum soru">${bitti ? sayiHTML(m.gizli, false) : '?'.repeat(a.basamak)}</span><small>${esc(m.sahip)} tuttu</small></div>
      <div class="sutun-ad">Sorularım ${m.tahminler.length ? `(${m.tahminler.length})` : ''}</div>
      <ol class="liste" id="m-liste">${liste || '<li class="bos">Süre ilk sorunla başlar. Kaç soruda bulacaksın?</li>'}</ol>
      ${bitti ? `<div class="sutun-ad">Sonuçlar</div>${sonuclar}` : ''}
    </div></div>
    ${alt}
  </section>`;
}

const MEYDAN_EYLEM = {
  meydanKurAc() {
    S.alt = 'meydanKur'; S.mk = { basamak: 3, sayi: '', liste: null }; ciz();
    fetch(`${API}/api/meydanlarim`, { headers: basliklar(), cache: 'no-store' }).then(x => x.json())
      .then(r => { if (S.mk) { S.mk.liste = r.liste || []; if (S.alt === 'meydanKur') ciz(); } })
      .catch(() => { if (S.mk) { S.mk.liste = []; if (S.alt === 'meydanKur') ciz(); } });
  },
  mkBasamak(v) { S.mk.basamak = Number(v); S.mk.sayi = ''; ciz(); },
  async mkOlustur() {
    const sayi = ($('#m-sayi') || {}).value ? $('#m-sayi').value.trim() : '';
    if (sayi) { const h = Oyun.sayiHatasi(sayi, Oyun.ayarDuzelt({ basamak: S.mk.basamak })); if (h) { bildir(h, 'kotu'); return; } }
    try {
      const r = await istek('/api/meydan/olustur', { basamak: S.mk.basamak, sayi });
      await meydanPaylas(r.id, `${adim()} sana Sayı Bulmaca'da meydan okuyor! ⚔️ Bakalım kaç soruda bulacaksın?`);
      meydanYukle(r.id);
    } catch (h) { bildir(h.message, 'kotu'); }
  },
  meydanAc(v) { meydanYukle(v); },
  mTablo(v) { S.m.tablo[v] = (S.m.tablo[v] + 1) % 3; depo.koy('sb_meydan_tablo', JSON.stringify({ id: S.m.id, t: S.m.tablo })); ciz(); },
  async mSor() {
    const a = meydanAyar(), t = S.girdi;
    const h = Oyun.sayiHatasi(t, a);
    if (h) { bildir(h, 'kotu'); return; }
    if (S.m.tahminler.some(k => k.tahmin === t)) { bildir('Bu sayıyı zaten sordun', 'kotu'); return; }
    if (S.mesgul) return;
    S.mesgul = true; S.girdi = '';
    try {
      const r = await istek('/api/meydan/sor', { id: S.m.id, tahmin: t });
      S.m = Object.assign(r, { tablo: S.m.tablo });
      const k = S.m.tahminler[S.m.tahminler.length - 1] || {};
      if (meydanBitti()) { Ses.cal('kazandin'); titret([60, 60, 120]); konfeti(); }
      else Ses.cal(k.arti + k.eksi === 0 ? 'sifir' : k.arti >= a.basamak - 1 ? 'yakin' : 'cevap');
    } catch (e) { S.girdi = t; bildir(e.message || 'Bir hata oldu', 'kotu'); }
    finally { S.mesgul = false; }
    ciz();
    const l = document.getElementById('m-liste'); if (l) l.scrollTop = l.scrollHeight;
  },
  mPaylas() { meydanPaylas(S.m.id, `${adim()} sana Sayı Bulmaca'da meydan okuyor! ⚔️ Bakalım kaç soruda bulacaksın?`); },
  mSonucPaylas() {
    meydanPaylas(S.m.id, `${S.m.sahip}'in meydan okumasını ${S.m.tahminler.length} soruda, ${sureYazi(S.m.cozuldu - S.m.baslangic)}'de buldum! 🎯 Sen de dene:`);
  },
};
