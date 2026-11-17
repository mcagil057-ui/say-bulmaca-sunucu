/*
 * Sayı Bulmaca — mail ile giriş ve hesap.
 *
 * Oyunun tamamı hesapla oynanır. Giriş: mail → maile gelen 6 haneli kod →
 * (yeni hesapsa) ad. Oturum anahtarı telefonda saklanır, her istekte
 * "X-Oturum" başlığıyla gider. Bir cihazda açılan hesaptan 14 gün başka
 * hesaba geçilemez; isim 3 günde bir değişir (kurallar sunucuda: hesap.js).
 */
'use strict';

/**
 * Telefonun uygulamada da tarayıcıda da aynı olan özellikleri (cihaz kilidi
 * için). Tarayıcı adı/sürümü bilerek yok: uygulama ile Chrome'da farklıdır.
 */
let IZ = null;
function cihazIzi() {
  if (IZ) return IZ;
  let gpu = '';
  try {
    const c = document.createElement('canvas').getContext('webgl');
    const e = c && c.getExtension('WEBGL_debug_renderer_info');
    gpu = c ? String(e ? c.getParameter(e.UNMASKED_RENDERER_WEBGL) : c.getParameter(c.RENDERER)) : '';
  } catch (e) { /* yok */ }
  let tz = '';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { /* yok */ }
  const ekran = [screen.width, screen.height].sort((a, b) => a - b).join('x'); // yan çevirince de aynı
  IZ = ['v1', ekran, (window.devicePixelRatio || 1).toFixed(2), navigator.hardwareConcurrency || 0,
    navigator.deviceMemory || 0, navigator.maxTouchPoints || 0, navigator.platform || '', tz, gpu].join('|');
  return IZ;
}
/** Android uygulamasının gerçek cihaz kimliği (yeni APK'da var). */
function androidNo() { try { return window.SBAndroid && window.SBAndroid.cihazNo ? String(window.SBAndroid.cihazNo()) : ''; } catch (e) { return ''; } }
function cihazBilgisi() { return { tel: ID, iz: cihazIzi(), cihazNo: androidNo() }; }

function oturum() { return depo.al('sb_oturum', ''); }
/** Her isteğe: oturum (mail girişi açıkken) + telefon kimliği ve ad (mail girişi kapalıyken misafir hesap). */
function basliklar(ek) {
  return Object.assign({ 'X-Oturum': oturum(), 'X-Cihaz': ID, 'X-Ad': encodeURIComponent(adim()) }, ek || {});
}
/** Mail ile giriş kapalıyken: misafir (yalnızca ad, giriş yok). */
function misafirOl() {
  S.hesap = { ad: (depo.al('sb_ad', '') || '').trim(), misafir: true };
  S.giris = null;
}

/** Oturum geçersizse (çıkış yapılmış, başka yerden silinmiş): giriş ekranına dön. */
function girisGerekli() {
  depo.koy('sb_oturum', null); depo.koy('sb_hesap', null);
  if (S.kaynak) { try { S.kaynak.kapat(); } catch (e) { /* yok */ } }
  S.kaynak = null; S.d = null; S.hesap = null; S.alt = null;
  S.giris = { adim: 'mail', mail: '', kod: '', ad: '' };
  ciz();
}

function hesapKoy(h) {
  S.hesap = h;
  depo.koy('sb_hesap', JSON.stringify(h));
}

/** Açılışta: kayıtlı oturum geçerli mi? */
async function hesapDenetle() {
  // Sunucuda mail ile giriş açık mı? (Render'daki MAIL_GIRIS ayarı)
  try {
    const m = await fetch(API + '/api/mod', { cache: 'no-store' }).then(x => x.json());
    S.mailGiris = !!m.mailGiris;
    depo.koy('sb_mailgiris', S.mailGiris ? '1' : '0');
  } catch (e) { S.mailGiris = depo.al('sb_mailgiris', '0') === '1'; }
  if (!S.mailGiris) { misafirOl(); return true; }
  if (!oturum()) { S.giris = { adim: 'mail', mail: '', kod: '', ad: '' }; return false; }
  try {
    const r = await fetch(API + '/api/ben', { headers: basliklar(), cache: 'no-store' });
    if (r.status === 401) { girisGerekli(); return false; }
    if (!r.ok) throw new Error('Sunucu ' + r.status);
    hesapKoy((await r.json()).hesap);
    return true;
  } catch (e) {
    // İnternet yok / sunucu uyanıyor: son bilinen hesapla devam (bot oynanabilir)
    const h = jsonAl('sb_hesap', null);
    if (h) { S.hesap = h; S.cevrimdisi = true; return true; }
    S.giris = { adim: 'mail', mail: '', kod: '', ad: '', hata: 'Sunucuya ulaşılamadı. İnternetini kontrol edip tekrar dene.' };
    return false;
  }
}

// ------------------------------------------------------------ ekranlar
function girisEkrani() {
  const g = S.giris;
  if (!g) return `<div class="ortala"><div class="yukleniyor">Yükleniyor</div></div>`;
  const hata = g.hata ? `<p class="giris-hata">${esc(g.hata)}</p>` : '';
  let ic;
  if (g.adim === 'mail') {
    ic = `<div class="kart">
      <label for="g-mail">Mail adresin</label>
      <input id="g-mail" type="email" inputmode="email" autocomplete="email" placeholder="ornek@gmail.com" value="${esc(g.mail)}">
      ${hata}
      <button class="dugme ana" data-e="gKodIste" ${g.mesgul ? 'disabled' : ''}>${g.mesgul ? 'Gönderiliyor…' : 'Kod gönder'}</button>
      <p class="not kucuk">Maile 6 haneli bir giriş kodu gelir. Gelmezse spam klasörüne bak.</p>
    </div>
    <p class="not kucuk">Bir cihazda açılan hesaptan 14 gün boyunca başka bir hesaba geçilemez.</p>`;
  } else {
    ic = `<div class="kart">
      <p class="not"><b>${esc(g.mail)}</b> adresine kod gönderdik.</p>
      <label for="g-kod">Giriş kodu</label>
      <input id="g-kod" class="kod-girdi" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••" value="${esc(g.kod)}">
      ${g.yeni ? `<label for="g-ad">Oyunda görünecek adın</label>
      <input id="g-ad" maxlength="16" autocomplete="nickname" placeholder="Adını yaz" value="${esc(g.ad)}">
      <p class="not kucuk sol">Adını sonra 3 günde bir değiştirebilirsin.</p>` : ''}
      ${hata}
      <button class="dugme ana" data-e="gDogrula" ${g.mesgul ? 'disabled' : ''}>${g.mesgul ? 'Kontrol ediliyor…' : 'Giriş yap'}</button>
      <div class="ikili">
        <button class="dugme ince" data-e="gKodIste">Kodu tekrar gönder</button>
        <button class="dugme ince" data-e="gMailDegistir">Maili değiştir</button>
      </div>
    </div>`;
  }
  return `<section class="giris">${logo()}${ic}</section>`;
}

function hesapKarti() {
  const h = S.hesap;
  if (h.misafir) {
    // Mail ile giriş kapalı: eskisi gibi yalnızca ad
    return `<div class="kart ad-kart">
      <label for="ad">Adın</label>
      <input id="ad" maxlength="16" autocomplete="nickname" placeholder="Adını yaz" value="${esc(h.ad)}">
    </div>`;
  }
  return `<div class="kart hesap-kart">
    <div><b class="hesap-ad">👤 ${esc(h.ad)}</b><small>${esc(h.mail)}${S.cevrimdisi ? ' · çevrimdışı' : ''}</small></div>
    <button class="sec" data-e="adAc">Adı değiştir</button>
  </div>`;
}

function adModalHTML() {
  const h = S.hesap;
  const gun = Math.ceil((h.adDegisebilir || 0) / 86400000);
  const kilitli = gun > 0;
  return `<div class="modal"><h2>Adını değiştir</h2>
    ${kilitli
      ? `<p>Adını <b>${gun} gün</b> sonra değiştirebilirsin. Ad 3 günde bir değişir.</p>`
      : `<p>Ad 3 günde bir değiştirilebilir.</p>
         <input id="ad-yeni" maxlength="16" placeholder="Yeni adın" value="${esc(h.ad)}">
         <button class="dugme ana" data-e="adKaydet">Kaydet</button>`}
    <button class="dugme ince" data-e="adKapat">Kapat</button></div>`;
}

// ------------------------------------------------------------ eylemler
const GIRIS_EYLEM = {
  async gKodIste() {
    const g = S.giris;
    const m = $('#g-mail');
    if (m) g.mail = m.value.trim();
    if (!g.mail) { g.hata = 'Mail adresini yaz'; ciz(); return; }
    g.mesgul = true; g.hata = null; ciz();
    try {
      const r = await fetch(API + '/api/giris/kod', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ mail: g.mail }, cihazBilgisi())) });
      const v = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(v.hata || 'Sunucu ' + r.status);
      // Sunucu hesabın olup olmadığını söylemez; yeni hesapsa ad, kod doğrulanınca istenir.
      Object.assign(g, { adim: 'kod', kod: v.deneme || '' }); // deneme: yalnızca bilgisayardaki deneme sunucusunda
      bildir('Kod gönderildi, mailini kontrol et');
      setTimeout(() => $('#g-kod') && $('#g-kod').focus(), 50);
    } catch (e) { g.hata = e.message; }
    g.mesgul = false; ciz();
  },
  async gDogrula() {
    const g = S.giris;
    const k = $('#g-kod'), a = $('#g-ad');
    if (k) g.kod = k.value.trim();
    if (a) g.ad = a.value.trim();
    if (!/^\d{6}$/.test(g.kod)) { g.hata = 'Kod 6 rakamdan oluşur'; ciz(); return; }
    g.mesgul = true; g.hata = null; ciz();
    try {
      const r = await fetch(API + '/api/giris/dogrula', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ mail: g.mail, kod: g.kod, ad: g.ad }, cihazBilgisi())) });
      const v = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (v.adGerekli) {
          g.yeni = true;
          if (!g.ad) { g.hata = 'Kod doğru! Yeni hesap açılıyor: oyunda görünecek adını yaz.'; g.mesgul = false; ciz(); setTimeout(() => $('#g-ad') && $('#g-ad').focus(), 50); return; }
        }
        throw new Error(v.hata || 'Sunucu ' + r.status);
      }
      depo.koy('sb_oturum', v.oturum);
      hesapKoy(v.hesap);
      S.giris = null; S.cevrimdisi = false;
      bildir(`Hoş geldin ${v.hesap.ad}!`, 'iyi');
      ciz(); acikOdalariYenile();
      return;
    } catch (e) { g.hata = e.message; }
    g.mesgul = false; ciz();
  },
  gMailDegistir() { Object.assign(S.giris, { adim: 'mail', kod: '', hata: null }); ciz(); },
  adAc() { S.adModal = true; katmanCiz(); setTimeout(() => $('#ad-yeni') && $('#ad-yeni').select(), 50); },
  adKapat() { S.adModal = false; katmanCiz(); },
  async adKaydet() {
    const ad = ($('#ad-yeni') || {}).value || '';
    try {
      const r = await istek('/api/ad', { ad });
      hesapKoy(r.hesap);
      S.adModal = false; bildir('Adın değişti', 'iyi'); ciz();
    } catch (e) { bildir(e.message, 'kotu'); }
  },
  async cikisYap() {
    if (!confirm('Çıkış yapılsın mı? Bu cihazda 14 gün boyunca yalnızca bu hesapla girebilirsin.')) return;
    try { await istek('/api/cikis', {}); } catch (e) { /* zaten geçersiz */ }
    girisGerekli();
  },
};

// Misafirde ad kutusu
document.addEventListener('input', e => {
  if (e.target.id === 'ad' && S.hesap && S.hesap.misafir) {
    const ad = e.target.value.trim().slice(0, 16);
    depo.koy('sb_ad', ad);
    S.hesap.ad = ad;
  }
});

// Yazılanlar ekran yeniden çizilince kaybolmasın
document.addEventListener('input', e => {
  if (!S.giris) return;
  if (e.target.id === 'g-mail') S.giris.mail = e.target.value;
  if (e.target.id === 'g-kod') { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6); S.giris.kod = e.target.value; }
  if (e.target.id === 'g-ad') S.giris.ad = e.target.value;
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || !S.giris) return;
  if (e.target.id === 'g-mail') GIRIS_EYLEM.gKodIste();
  if (e.target.id === 'g-kod' || e.target.id === 'g-ad') GIRIS_EYLEM.gDogrula();
});
