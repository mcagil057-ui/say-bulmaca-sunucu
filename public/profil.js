/*
 * Sayı Bulmaca — istatistiklerim.
 *
 * Maç sonuçları telefonda (localStorage) tutulur: sunucu yeniden kurulsa da
 * kaybolmaz, hesap açmak gerekmez. Telefon değişirse istatistik yeni başlar.
 */
'use strict';
const Istat = {
  liste() { try { return JSON.parse(localStorage.getItem('sb_istat')) || []; } catch (e) { return []; } },
  kaydet(k) {
    const l = this.liste();
    if (l.some(x => x.id === k.id)) return false;
    l.push(k);
    while (l.length > 500) l.shift();
    try { localStorage.setItem('sb_istat', JSON.stringify(l)); } catch (e) { /* dolu */ }
    return true;
  },
  /** Günün bulmacası: {gun: soru sayısı} */
  gunluk() { try { return JSON.parse(localStorage.getItem('sb_gunluk_gecmis')) || {}; } catch (e) { return {}; } },
  gunlukKaydet(gun, soru) {
    const g = this.gunluk();
    if (g[gun]) return;
    g[gun] = soru;
    try { localStorage.setItem('sb_gunluk_gecmis', JSON.stringify(g)); } catch (e) { /* dolu */ }
  },
  sifirla() {
    try { localStorage.removeItem('sb_istat'); localStorage.removeItem('sb_gunluk_gecmis'); } catch (e) { /* yok */ }
  },
};

/** Türkiye saatine göre bugün: 2026-11-17 (sunucuyla aynı hesap) */
function bugunTR(fark) { return new Date(Date.now() + 3 * 3600 * 1000 + (fark || 0) * 86400000).toISOString().slice(0, 10); }

/** Biten bir maçı istatistiğe yaz (aynı maç iki kez yazılmaz). */
function macKaydet(d) {
  const m = d.mac;
  if (!m || m.faz !== 'bitti' || !m.sonuc) return;
  const N = m.ayar.basamak;
  const benim = m.sorularim.filter(k => k.tahmin);
  Istat.kaydet({
    id: m.id, t: Date.now(),
    tur: d.oda.bot ? 'bot' : 'oda', seviye: d.oda.bot || null, rakip: m.rakip.ad,
    sonuc: m.sonuc.kazanan === 'ben' ? 'g' : m.sonuc.kazanan === 'rakip' ? 'm' : 'b',
    soru: benim.length, buldum: benim.some(k => k.arti === N), basamak: N,
  });
}

/** Kaç gün üst üste günün bulmacası çözüldü? */
function gunlukSeri(g) {
  let fark = g[bugunTR()] ? 0 : -1, seri = 0;
  while (g[bugunTR(fark)]) { seri++; fark--; }
  return seri;
}

function gbm(l) {
  const say = s => l.filter(x => x.sonuc === s).length;
  return `<span class="gbm"><b class="g">${say('g')}</b>–<b class="b">${say('b')}</b>–<b class="m">${say('m')}</b></span>`;
}

function profilCiz() {
  const l = Istat.liste();
  const g = Istat.gunluk();
  const ust = `<div class="ust-cubuk"><button class="geri-ok" data-e="geri" aria-label="Geri">‹</button><span>İstatistiklerim</span><span></span></div>`;
  const hesap = S.hesap ? `<div class="kart"><label>Hesabım</label>
    <div class="hesap-kart ic"><div><b class="hesap-ad">👤 ${esc(S.hesap.ad)}</b><small>${esc(S.hesap.mail)}</small></div><button class="sec" data-e="adAc">Adı değiştir</button></div>
    <button class="dugme ince tehlike" data-e="cikisYap">Çıkış yap</button></div>` : '';
  const gunler = Object.values(g);

  let ic = '';
  if (!l.length && !gunler.length) {
    ic = '<div class="kart"><p class="not">Henüz oyun yok. Bir maç bitince sonuçların burada birikir.</p></div>';
  } else {
    const bulunan = l.filter(x => x.buldum && x.basamak === 3);
    const ort = bulunan.length ? (bulunan.reduce((a, x) => a + x.soru, 0) / bulunan.length).toFixed(1) : '–';
    const enIyi = bulunan.length ? Math.min(...bulunan.map(x => x.soru)) : '–';
    const yuzde = l.length ? Math.round(100 * l.filter(x => x.sonuc === 'g').length / l.length) : 0;
    const kutu = (deger, etiket) => `<div class="ist-kutu"><b>${deger}</b><small>${etiket}</small></div>`;
    ic += `<div class="kart"><label>Genel</label><div class="ist-kutular">
        ${kutu(l.length, 'maç')}${kutu('%' + yuzde, 'galibiyet')}${kutu(ort, 'ortalama soru')}${kutu(enIyi, 'en az soru')}
      </div><p class="not kucuk sol">Ortalama ve en az soru 3 basamaklı maçlardan, sayıyı bulduğun maçlara göre. Sıra: galibiyet–beraberlik–mağlubiyet.</p></div>`;

    const botlar = ['kolay', 'orta', 'zor'].map(s => {
      const b = l.filter(x => x.tur === 'bot' && x.seviye === s);
      const k = BOT_KISILIK[s];
      return `<li><span>${k.simge} ${esc(k.ad)} <small>${SEVIYE_AD[s]}</small></span>${gbm(b)}</li>`;
    }).join('');
    ic += `<div class="kart"><label>Botlara karşı</label><ul class="ist-liste">${botlar}</ul></div>`;

    const rakipler = {};
    l.filter(x => x.tur === 'oda').forEach(x => { (rakipler[x.rakip] = rakipler[x.rakip] || []).push(x); });
    const rl = Object.entries(rakipler).sort((a, b) => b[1].length - a[1].length).slice(0, 12);
    ic += `<div class="kart"><label>Arkadaşlara karşı</label>${rl.length
      ? '<ul class="ist-liste">' + rl.map(([ad, x]) => `<li><span>${esc(ad)} <small>${x.length} maç</small></span>${gbm(x)}</li>`).join('') + '</ul>'
      : '<p class="not kucuk sol">Henüz arkadaşınla maç yok.</p>'}</div>`;

    const gOrt = gunler.length ? (gunler.reduce((a, x) => a + x, 0) / gunler.length).toFixed(1) : '–';
    ic += `<div class="kart"><label>Günün bulmacası</label><div class="ist-kutular">
        ${kutu(gunler.length, 'çözülen gün')}${kutu('🔥 ' + gunlukSeri(g), 'gün üst üste')}${kutu(gOrt, 'ortalama soru')}${kutu(gunler.length ? Math.min(...gunler) : '–', 'en az soru')}
      </div></div>`;

    const son = l.slice(-10).reverse().map(x => {
      const t = new Date(x.t);
      const simge = { g: '🏆', b: '🤝', m: '❌' }[x.sonuc];
      return `<li><span>${simge} ${esc(x.rakip)} <small>${t.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })}</small></span><small>${x.buldum ? x.soru + ' soruda buldun' : x.soru + ' soru sordun'}</small></li>`;
    }).join('');
    if (son) ic += `<div class="kart"><label>Son maçlar</label><ul class="ist-liste">${son}</ul></div>`;
    ic += '<button class="dugme ince" data-e="istatSifirla">İstatistikleri sıfırla</button>';
  }
  return `<section class="profil">${ust}${hesap}${ic}</section>`;
}

const PROFIL_EYLEM = {
  profilAc() { S.alt = 'profil'; ciz(); window.scrollTo(0, 0); },
  istatSifirla() {
    if (!confirm('Bütün istatistiklerin silinsin mi? Geri alınamaz.')) return;
    Istat.sifirla(); ciz();
  },
};
