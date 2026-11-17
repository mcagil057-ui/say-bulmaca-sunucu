/*
 * Sayı Bulmaca — oyun kuralları ve botlar.
 *
 * Bu dosya HEM sunucuda (Node) HEM tarayıcıda çalışır. Kurallar tek yerde
 * dursun diye: çevrimiçi maçı sunucu, bot maçını telefon aynı kodla yönetir.
 *
 * Puanlama:  +1 = rakam var ve yeri doğru,  -1 = rakam var ama yeri yanlış.
 * Örnek: gizli 302, tahmin 203  ->  +1 (0)  -2 (2 ve 3)
 */
(function (kok, fabrika) {
  if (typeof module === 'object' && module.exports) module.exports = fabrika();
  else kok.Oyun = fabrika();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VARSAYILAN_AYAR = {
    basamak: 3,      // 3, 4 ya da 5
    turSure: 60,     // saniye; 0 = süre yok
    yanlisHak: 3,    // bu kadar yanlış cevapta kaybedersin
    basSifir: false, // sayı 0 ile başlayabilir mi
    esitTur: true,   // başlayan bulursa rakibe son bir hak
    otoCevap: true,  // cevabı uygulama verir (kapalıysa oyuncu elle yazar)
    oyunTuru: 'klasik', // 'klasik' (2 kişi, herkes sayı tutar) | 'yaris' (2–4 kişi, tek ortak sayı)
  };
  const SURELER = [0, 15, 30, 45, 60, 90, 120];   // 15 sn = hızlı mod
  const TEPKILER = ['😮', '😂', '👏', '🤔', '🔥', '😅'];
  // Botların eski cevapları hatırlama olasılığı (test.js ile ayarlandı).
  const HATIRLAMA = { kolay: 0.1, orta: 0.5 };

  function ayarDuzelt(a) {
    a = Object.assign({}, VARSAYILAN_AYAR, a || {});
    const b = parseInt(a.basamak, 10);
    const s = parseInt(a.turSure, 10);
    const y = parseInt(a.yanlisHak, 10);
    return {
      basamak: [3, 4, 5].includes(b) ? b : 3,
      turSure: SURELER.includes(s) ? s : 60,
      yanlisHak: [1, 2, 3, 4, 5].includes(y) ? y : 3,
      basSifir: !!a.basSifir,
      esitTur: !!a.esitTur,
      otoCevap: !!a.otoCevap,
      oyunTuru: a.oyunTuru === 'yaris' ? 'yaris' : 'klasik',
    };
  }

  function puanla(gizli, tahmin) {
    let arti = 0, eksi = 0;
    for (let i = 0; i < tahmin.length; i++) {
      if (tahmin[i] === gizli[i]) arti++;
      else if (gizli.indexOf(tahmin[i]) >= 0) eksi++;
    }
    return { arti, eksi };
  }

  /** Geçersizse açıklama döner, geçerliyse null. */
  function sayiHatasi(s, ayar) {
    if (typeof s !== 'string' || !/^\d+$/.test(s)) return 'Sadece rakam girilebilir';
    if (s.length !== ayar.basamak) return ayar.basamak + ' basamaklı olmalı';
    if (new Set(s).size !== s.length) return 'Rakamlar birbirinden farklı olmalı';
    if (!ayar.basSifir && s[0] === '0') return 'Sayı 0 ile başlayamaz';
    return null;
  }

  const onbellek = {};
  function tumSayilar(ayar) {
    const anahtar = ayar.basamak + (ayar.basSifir ? 's' : '');
    if (onbellek[anahtar]) return onbellek[anahtar];
    const sonuc = [];
    (function kur(on) {
      if (on.length === ayar.basamak) { sonuc.push(on); return; }
      for (let d = 0; d <= 9; d++) {
        const c = String(d);
        if (on.indexOf(c) >= 0) continue;
        if (on.length === 0 && c === '0' && !ayar.basSifir) continue;
        kur(on + c);
      }
    })('');
    return (onbellek[anahtar] = sonuc);
  }

  function rastgeleSec(dizi, rnd) {
    return dizi[Math.floor((rnd || Math.random)() * dizi.length)];
  }
  function rastgeleSayi(ayar, rnd) { return rastgeleSec(tumSayilar(ayar), rnd); }

  function ornekle(dizi, n, rnd) {
    if (dizi.length <= n) return dizi.slice();
    const kopya = dizi.slice();
    for (let i = 0; i < n; i++) {
      const j = i + Math.floor((rnd || Math.random)() * (kopya.length - i));
      const t = kopya[i]; kopya[i] = kopya[j]; kopya[j] = t;
    }
    return kopya.slice(0, n);
  }

  function uyumlu(aday, gecmis) {
    for (const g of gecmis) {
      const p = puanla(aday, g.tahmin);
      if (p.arti !== g.arti || p.eksi !== g.eksi) return false;
    }
    return true;
  }

  /**
   * Botun sıradaki tahmini.
   * gecmis: [{tahmin, arti, eksi}] — botun kendi sorduğu sorular ve cevapları.
   *  kolay: yalnızca son iki cevabı hatırlar, bazen boş yere sorar
   *  orta : bütün cevaplara uyan sayılardan rastgele birini sorar
   *  zor  : en çok bilgi getirecek soruyu hesaplar (ortalama 5 soruda bulur)
   */
  function botTahmin(seviye, ayar, gecmis, rnd) {
    rnd = rnd || Math.random;
    const tum = tumSayilar(ayar);
    const soruldu = new Set(gecmis.map(g => g.tahmin));
    const sorulmamis = s => !soruldu.has(s);

    if (seviye !== 'zor') {
      // İnsan gibi unutkan: her turda eski cevapların bir kısmını hesaba
      // katmıyor. Son cevabı her zaman hatırlıyor.
      const hatirlama = seviye === 'kolay' ? HATIRLAMA.kolay : HATIRLAMA.orta;
      const hatirlanan = gecmis.filter((g, k) => k === gecmis.length - 1 || rnd() < hatirlama);
      let aday = tum.filter(s => sorulmamis(s) && uyumlu(s, hatirlanan));
      if (!aday.length) aday = tum.filter(s => sorulmamis(s) && uyumlu(s, gecmis));
      if (!aday.length) aday = tum.filter(sorulmamis);
      return rastgeleSec(aday, rnd);
    }

    const aday = tum.filter(s => uyumlu(s, gecmis));
    if (!aday.length) return rastgeleSec(tum.filter(sorulmamis), rnd); // olmamalı
    if (aday.length <= 2) return rastgeleSec(aday, rnd);

    // Zor: her soru adayları cevaplara göre gruplara böler. Grupların
    // ortalama büyüklüğü en küçük olan soru en çok bilgiyi getirir.
    const adaySeti = new Set(aday);
    const olcum = ornekle(aday, 1200, rnd);
    const havuz = aday.length * tum.length <= 600000
      ? tum
      : ornekle(aday, 150, rnd).concat(ornekle(tum, 250, rnd));
    let enIyi = null, enIyiDeger = Infinity;
    for (const g of havuz) {
      if (soruldu.has(g)) continue;
      const grup = {};
      for (const a of olcum) {
        const p = puanla(a, g);
        const k = p.arti * 10 + p.eksi;
        grup[k] = (grup[k] || 0) + 1;
      }
      let deger = 0;
      for (const k in grup) deger += grup[k] * grup[k];
      if (adaySeti.has(g)) deger -= 0.5; // eşitlikte doğrudan bulma şansı olanı seç
      if (deger < enIyiDeger) { enIyiDeger = deger; enIyi = g; }
    }
    return enIyi || rastgeleSec(aday, rnd);
  }

  /**
   * Maç sonu analizi: her sorudan önce/sonra kaç sayı hâlâ mümkündü?
   * sorular: [{tahmin, arti, eksi}] (süre dolan, tahmini boş olanlar atlanır)
   * Dönen her adım: {tahmin, arti, eksi, once, sonra, olabilirdi}
   *   olabilirdi = sorulan sayı o ana kadarki cevaplara uyuyordu (doğru cevap olabilirdi)
   */
  function analizEt(ayar, sorular) {
    let aday = tumSayilar(ayar);
    const adimlar = [];
    for (const k of sorular) {
      if (!k.tahmin) continue;
      const once = aday.length;
      const olabilirdi = aday.indexOf(k.tahmin) >= 0;
      aday = aday.filter(s => { const p = puanla(s, k.tahmin); return p.arti === k.arti && p.eksi === k.eksi; });
      adimlar.push({ tahmin: k.tahmin, arti: k.arti, eksi: k.eksi, once, sonra: aday.length, olabilirdi });
    }
    return adimlar;
  }

  /** Bot bu gizli sayıyı kaç soruda bulurdu? (karşılaştırma için) */
  function botKacSoruda(seviye, ayar, gizli, rnd) {
    const gecmis = [];
    while (gecmis.length < 60) {
      const t = botTahmin(seviye, ayar, gecmis, rnd);
      const p = puanla(gizli, t);
      gecmis.push({ tahmin: t, arti: p.arti, eksi: p.eksi });
      if (p.arti === ayar.basamak) break;
    }
    return gecmis.length;
  }

  /**
   * İki kişilik tek bir maç. Oyuncu 0 ve 1.
   * faz: 'gizli' (sayılar seçiliyor) -> 'oyun' -> 'bitti'
   * asama: 'tahmin' (sıradaki soruyor) | 'cevap' (rakip cevabı yazıyor)
   */
  class Mac {
    constructor(ayar, adlar, baslayan, simdi) {
      this.ayar = ayarDuzelt(ayar);
      this.simdi = simdi || Date.now;
      this.oyuncular = [0, 1].map(i => ({ ad: (adlar && adlar[i]) || ('Oyuncu ' + (i + 1)), gizli: null, yanlis: 0 }));
      this.faz = 'gizli';
      this.kayitlar = [];        // {kim, tahmin, arti, eksi, verilen, sure, no}
      this.baslayan = baslayan === 1 ? 1 : 0;
      this.sira = this.baslayan;
      this.asama = 'tahmin';
      this.bekleyen = null;
      this.bitis = null;
      this.sonSans = false;
      this.bulan = null;
      this.sonuc = null;
      this.olay = null;          // son önemli olay (bildirim için)
      this.olaySayac = 0;
      // Her maçın kendi kimliği: telefondaki eleme tablosu maça bağlı kalsın
      this.id = Math.random().toString(36).slice(2, 10);
    }

    _sureBaslat() {
      this.bitis = this.ayar.turSure ? this.simdi() + this.ayar.turSure * 1000 : null;
    }
    _olay(tur, veri) {
      this.olay = Object.assign({ tur, no: ++this.olaySayac }, veri || {});
    }

    gizliBelirle(i, s) {
      if (this.faz !== 'gizli') return 'Şu an sayı seçilmiyor';
      const h = sayiHatasi(s, this.ayar);
      if (h) return h;
      this.oyuncular[i].gizli = s;
      if (this.oyuncular[0].gizli && this.oyuncular[1].gizli) {
        this.faz = 'oyun';
        this.sira = this.baslayan;
        this.asama = 'tahmin';
        this._sureBaslat();
      }
      return null;
    }

    tahminEt(i, s) {
      if (this.faz !== 'oyun') return 'Oyun başlamadı';
      if (this.sira !== i || this.asama !== 'tahmin') return 'Sıra sende değil';
      const h = sayiHatasi(s, this.ayar);
      if (h) return h;
      const rakip = this.oyuncular[1 - i];
      const gercek = puanla(rakip.gizli, s);
      // Otomatik cevapta, tam isabette ya da son şans sorusunda cevap
      // beklemeye gerek yok: sonucu uygulama verir.
      if (this.ayar.otoCevap || gercek.arti === this.ayar.basamak || this.sonSans) {
        this._olay('soru', { kim: i, tahmin: s, arti: gercek.arti, eksi: gercek.eksi });
        this._kaydet({ kim: i, tahmin: s, arti: gercek.arti, eksi: gercek.eksi, verilen: null });
        return null;
      }
      this.bekleyen = s;
      this.asama = 'cevap';
      this._sureBaslat();
      return null;
    }

    cevapVer(i, arti, eksi) {
      if (this.faz !== 'oyun' || this.asama !== 'cevap') return 'Cevap beklenmiyor';
      if (this.sira === i) return 'Kendi sorana cevap veremezsin';
      arti = parseInt(arti, 10); eksi = parseInt(eksi, 10);
      const N = this.ayar.basamak;
      if (!(arti >= 0 && eksi >= 0 && arti + eksi <= N)) return 'Geçersiz cevap';
      const ben = this.oyuncular[i];
      const gercek = puanla(ben.gizli, this.bekleyen);
      const dogru = gercek.arti === arti && gercek.eksi === eksi;
      const kayit = { kim: this.sira, tahmin: this.bekleyen, arti: gercek.arti, eksi: gercek.eksi, verilen: null };
      if (!dogru) {
        ben.yanlis++;
        kayit.verilen = { arti, eksi };
        this._olay('yanlis', { kim: i, verilen: kayit.verilen, gercek, kalan: this.ayar.yanlisHak - ben.yanlis });
      }
      this._kaydet(kayit);
      return null;
    }

    /**
     * Rakibin SORUSUNA emoji tepkisi (yalnızca kendi sayına sorulan sorulara).
     * Aynı emojiye yeniden basınca kalkar.
     */
    tepki(i, no, emoji) {
      if (TEPKILER.indexOf(emoji) < 0) return 'Bu tepki yok';
      const k = this.kayitlar.find(x => x.no === Number(no));
      if (!k || !k.tahmin) return 'Soru bulunamadı';
      if (k.kim === i) return 'Kendi sorana tepki veremezsin';
      k.tepki = k.tepki === emoji ? null : emoji;
      return null;
    }

    teslim(i) {
      if (this.faz === 'bitti') return null;
      this._bitir(1 - i, 'teslim');
      return null;
    }

    /** Süresi dolan hamle var mı? Değişiklik olduysa true. */
    sureKontrol() {
      if (this.faz !== 'oyun' || !this.bitis || this.simdi() < this.bitis) return false;
      if (this.asama === 'tahmin') {
        this._olay('sureTahmin', { kim: this.sira });
        this._kaydet({ kim: this.sira, tahmin: null, arti: 0, eksi: 0, verilen: null, sure: true });
      } else {
        // Cevap süresi doldu: yanlış cevap sayılır, doğrusunu uygulama verir.
        const cevaplayan = 1 - this.sira;
        const ben = this.oyuncular[cevaplayan];
        const gercek = puanla(ben.gizli, this.bekleyen);
        ben.yanlis++;
        this._olay('sureCevap', { kim: cevaplayan, gercek, kalan: this.ayar.yanlisHak - ben.yanlis });
        this._kaydet({ kim: this.sira, tahmin: this.bekleyen, arti: gercek.arti, eksi: gercek.eksi, verilen: null, sure: true });
      }
      return true;
    }

    _kaydet(kayit) {
      kayit.no = this.kayitlar.length + 1;
      this.kayitlar.push(kayit);
      this.bekleyen = null;
      const tahminci = kayit.kim, cevaplayan = 1 - kayit.kim;

      if (this.oyuncular[cevaplayan].yanlis >= this.ayar.yanlisHak) {
        this._bitir(tahminci, 'yanlis');
        return;
      }
      const buldu = kayit.tahmin && kayit.arti === this.ayar.basamak;
      if (this.sonSans) {
        // Son şans kullanıldı: o da bulduysa berabere, bulamadıysa ilk bulan kazanır.
        if (buldu) this._bitir(-1, 'berabere');
        else this._bitir(this.bulan, 'buldu');
        return;
      }
      if (buldu) {
        if (this.ayar.esitTur && tahminci === this.baslayan) {
          this.sonSans = true;
          this.bulan = tahminci;
          this._olay('sonSans', { kim: tahminci });
        } else {
          this._bitir(tahminci, 'buldu');
          return;
        }
      }
      this.sira = 1 - this.sira;
      this.asama = 'tahmin';
      this._sureBaslat();
    }

    _bitir(kazanan, neden) {
      this.faz = 'bitti';
      this.sonuc = { kazanan, neden };
      this.bitis = null;
      this.bekleyen = null;
    }

    /** i numaralı oyuncunun göreceği durum. Rakibin sayısı oyun bitene kadar gizli. */
    gorunum(i) {
      const ben = this.oyuncular[i], rakip = this.oyuncular[1 - i];
      const bitti = this.faz === 'bitti';
      const kim = k => (k === i ? 'ben' : 'rakip');
      return {
        id: this.id,
        faz: this.faz,
        ayar: this.ayar,
        ben: { ad: ben.ad, gizli: ben.gizli, hazir: !!ben.gizli, yanlis: ben.yanlis },
        rakip: { ad: rakip.ad, hazir: !!rakip.gizli, yanlis: rakip.yanlis, gizli: bitti ? rakip.gizli : null },
        siraBende: this.sira === i,
        baslayanBen: this.baslayan === i,
        asama: this.asama,
        bekleyen: this.bekleyen,
        bitis: this.bitis,
        sonSans: this.sonSans,
        sorularim: this.kayitlar.filter(k => k.kim === i),
        gelenSorular: this.kayitlar.filter(k => k.kim !== i),
        sonuc: this.sonuc ? {
          kazanan: this.sonuc.kazanan === -1 ? 'berabere' : kim(this.sonuc.kazanan),
          neden: this.sonuc.neden,
        } : null,
        olay: this.olay ? Object.assign({}, this.olay, { kim: this.olay.kim == null ? null : kim(this.olay.kim) }) : null,
      };
    }
  }

  /**
   * Yarış: 2–4 oyuncu, sayıyı uygulama tutar, herkes AYNI ANDA sorar,
   * cevaplar otomatik. İlk bulan kazanır ve oyun hemen biter (en kısa sürede
   * bulan). Oyun sırasında başkalarının yalnızca soru sayısı görünür.
   * Oyuncular kimlikle (id) tutulur: biri odadan çıksa da sıra karışmaz.
   */
  class Yaris {
    constructor(ayar, oyuncular, simdi, rnd) {
      this.tur = 'yaris';
      this.ayar = ayarDuzelt(Object.assign({}, ayar, { oyunTuru: 'yaris' }));
      this.simdi = simdi || Date.now;
      this.gizli = rastgeleSayi(this.ayar, rnd);
      this.oyuncular = oyuncular.map(o => ({ id: o.id, ad: o.ad, sorular: [], cekildi: false }));
      this.faz = 'oyun';
      this.baslangic = this.simdi();
      this.bitis = null;
      this.kazanan = null;      // id
      this.sonuc = null;
      this.id = Math.random().toString(36).slice(2, 10);
    }
    _o(id) { return this.oyuncular.find(o => o.id === id); }

    tahminEt(id, s) {
      if (this.faz !== 'oyun') return 'Oyun bitti';
      const o = this._o(id);
      if (!o) return 'Bu yarışta değilsin';
      if (o.cekildi) return 'Yarıştan çekildin';
      const h = sayiHatasi(s, this.ayar);
      if (h) return h;
      if (o.sorular.some(k => k.tahmin === s)) return 'Bu sayıyı zaten sordun';
      const p = puanla(this.gizli, s);
      o.sorular.push({ tahmin: s, arti: p.arti, eksi: p.eksi, zaman: this.simdi() - this.baslangic });
      if (p.arti === this.ayar.basamak) this._bitir(id, 'buldu');
      return null;
    }

    /** Pes et / odadan çık: bu oyuncu artık soramaz; kimse kalmazsa oyun biter. */
    cekil(id) {
      const o = this._o(id);
      if (!o || this.faz !== 'oyun') return null;
      o.cekildi = true;
      if (this.oyuncular.every(x => x.cekildi)) this._bitir(null, 'herkesCekildi');
      return null;
    }

    _bitir(kazanan, neden) {
      this.faz = 'bitti';
      this.kazanan = kazanan;
      this.bitis = this.simdi();
      this.sonuc = { kazanan, neden, sure: this.bitis - this.baslangic };
    }

    /** id'li oyuncunun göreceği durum. Sayı ve başkalarının soruları oyun bitene kadar gizli. */
    gorunum(id) {
      const bitti = this.faz === 'bitti';
      const ben = this._o(id) || { ad: '', sorular: [], cekildi: true };
      const kazananO = this.kazanan != null ? this._o(this.kazanan) : null;
      return {
        tur: 'yaris', id: this.id, faz: this.faz, ayar: this.ayar,
        baslangic: this.baslangic, bitis: this.bitis,
        ben: { ad: ben.ad, sorular: ben.sorular, cekildi: ben.cekildi },
        oyuncular: this.oyuncular.map(o => ({
          ad: o.ad, ben: o.id === id, soru: o.sorular.length, cekildi: o.cekildi,
          sorular: bitti || o.id === id ? o.sorular : null,
        })),
        gizli: bitti ? this.gizli : null,
        sonuc: this.sonuc ? {
          kazanan: this.kazanan == null ? null : (this.kazanan === id ? 'ben' : kazananO.ad),
          neden: this.sonuc.neden, sure: this.sonuc.sure,
          soru: kazananO ? kazananO.sorular.length : null,
        } : null,
      };
    }
  }

  return { VARSAYILAN_AYAR, SURELER, TEPKILER, ayarDuzelt, puanla, sayiHatasi, tumSayilar, rastgeleSayi, botTahmin, analizEt, botKacSoruda, Mac, Yaris };
});
