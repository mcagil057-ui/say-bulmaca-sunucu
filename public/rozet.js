/*
 * Sayı Bulmaca — rozetler. Sunucu ve telefon aynı dosyayı kullanır.
 *
 * Basamaklar (kullanıcıyla kararlaştırıldı, 17.11.2026):
 *   10 🥉 Bronz · 50 🥈 Gümüş · 100 🥇 Altın · 250 💎 Elmas · 500 👑 Efsane
 * Dallar: galibiyet, maç, günlük bulmaca serisi (en uzun), yarış galibiyeti.
 * Sayılar sunucuda tutulur (istatistik tablosu).
 */
(function (kok, fabrika) {
  if (typeof module === 'object' && module.exports) module.exports = fabrika();
  else kok.Rozet = fabrika();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SEVIYELER = [
    { n: 10, ad: 'Bronz', simge: '🥉' },
    { n: 50, ad: 'Gümüş', simge: '🥈' },
    { n: 100, ad: 'Altın', simge: '🥇' },
    { n: 250, ad: 'Elmas', simge: '💎' },
    { n: 500, ad: 'Efsane', simge: '👑' },
  ];
  const DALLAR = [
    { anahtar: 'galibiyet', ad: 'Galibiyet', simge: '🏆', birim: 'galibiyet' },
    { anahtar: 'mac', ad: 'Maç', simge: '🎮', birim: 'maç' },
    { anahtar: 'enUzunSeri', ad: 'Günlük seri', simge: '📅', birim: 'gün üst üste' },
    { anahtar: 'yarisGalibiyet', ad: 'Yarış', simge: '🏁', birim: 'yarış galibiyeti' },
  ];

  /** n'ye karşılık gelen seviye sırası (-1: henüz rozet yok). */
  function seviye(n) {
    let s = -1;
    SEVIYELER.forEach((x, i) => { if (n >= x.n) s = i; });
    return s;
  }

  /** Her dal için: sayı, rozet (varsa), bir sonraki basamağa kalan. */
  function rozetler(istat) {
    istat = istat || {};
    return DALLAR.map(d => {
      const n = Number(istat[d.anahtar]) || 0;
      const s = seviye(n);
      const sonraki = SEVIYELER[s + 1] || null;
      return {
        anahtar: d.anahtar, ad: d.ad, simge: d.simge, birim: d.birim, n,
        rozet: s >= 0 ? SEVIYELER[s] : null, seviye: s,
        sonraki, kalan: sonraki ? sonraki.n - n : 0,
        oran: sonraki ? Math.min(1, (n - (s >= 0 ? SEVIYELER[s].n : 0)) / (sonraki.n - (s >= 0 ? SEVIYELER[s].n : 0))) : 1,
      };
    });
  }

  /** Adın yanında gösterilecek en yüksek rozet simgesi ('' = yok). */
  function enIyi(istat) {
    const l = rozetler(istat).filter(r => r.rozet);
    if (!l.length) return '';
    return SEVIYELER[Math.max(...l.map(r => r.seviye))].simge;
  }

  /** Kazanılmış rozetlerin anahtarları ("galibiyet:0" gibi) — yeni rozet bildirimi için. */
  function kazanilanlar(istat) {
    const l = [];
    for (const r of rozetler(istat)) for (let i = 0; i <= r.seviye; i++) l.push(r.anahtar + ':' + i);
    return l;
  }

  return { SEVIYELER, DALLAR, seviye, rozetler, enIyi, kazanilanlar };
});
