/*
 * Sayı Bulmaca — ses efektleri.
 *
 * Ses dosyası yok: her efekt tarayıcının kendi ses üreteciyle (Web Audio)
 * birkaç kısa notadan çalınır. Telefonlar sesi ancak ilk dokunuştan sonra
 * açtığı için üreteç ilk dokunuşta hazırlanır.
 */
'use strict';
const Ses = (function () {
  let ctx = null;
  let acik = (function () { try { return localStorage.getItem('sb_ses') !== '0'; } catch (e) { return true; } })();

  function hazirla() {
    if (!ctx) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      try { ctx = new C(); } catch (e) { return null; }
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => { /* sonra */ });
    return ctx;
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach(t => document.addEventListener(t, hazirla, { passive: true }));

  /** notalar: [frekans Hz, başlangıç sn, süre sn, ses yüksekliği?, dalga?] */
  function cal(notalar) {
    if (!acik) return;
    const c = hazirla();
    if (!c || c.state !== 'running') return;
    const t0 = c.currentTime + 0.01;
    for (const [f, bas, sure, guc, dalga] of notalar) {
      const o = c.createOscillator(), g = c.createGain();
      o.type = dalga || 'triangle';
      o.frequency.setValueAtTime(f, t0 + bas);
      g.gain.setValueAtTime(0.0001, t0 + bas);
      g.gain.exponentialRampToValueAtTime(guc || 0.18, t0 + bas + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + bas + sure);
      o.connect(g).connect(c.destination);
      o.start(t0 + bas);
      o.stop(t0 + bas + sure + 0.05);
    }
  }

  const EFEKT = {
    tik: [[880, 0, 0.05, 0.06, 'sine']],
    sira: [[660, 0, 0.12], [990, 0.11, 0.2]],                       // sıra sende
    soru: [[520, 0, 0.1, 0.14], [440, 0.09, 0.14, 0.14]],           // rakip soru sordu
    cevap: [[600, 0, 0.09, 0.12, 'sine'], [750, 0.08, 0.12, 0.12, 'sine']],
    sifir: [[330, 0, 0.16, 0.14], [262, 0.14, 0.22, 0.12]],         // cevap 0
    yakin: [[660, 0, 0.09], [830, 0.08, 0.09], [990, 0.16, 0.16]],  // çok yaklaştın
    buldu: [[523, 0, 0.12], [659, 0.1, 0.12], [784, 0.2, 0.12], [1047, 0.3, 0.35]],
    kazandin: [[523, 0, 0.14], [659, 0.13, 0.14], [784, 0.26, 0.14], [1047, 0.39, 0.2], [784, 0.58, 0.1], [1047, 0.68, 0.45]],
    kaybettin: [[392, 0, 0.22], [370, 0.2, 0.22], [349, 0.4, 0.22], [330, 0.6, 0.5]],
    berabere: [[523, 0, 0.16], [523, 0.18, 0.16], [659, 0.36, 0.4]],
    mesaj: [[1320, 0, 0.07, 0.1, 'sine'], [1760, 0.07, 0.1, 0.1, 'sine']],
    yanlis: [[200, 0, 0.25, 0.16, 'square']],
  };

  return {
    cal(ad) { if (EFEKT[ad]) cal(EFEKT[ad]); },
    get acik() { return acik; },
    degistir() {
      acik = !acik;
      try { localStorage.setItem('sb_ses', acik ? '1' : '0'); } catch (e) { /* yok */ }
      if (acik) this.cal('sira');
      return acik;
    },
  };
})();
