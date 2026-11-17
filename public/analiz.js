/*
 * Sayı Bulmaca — maç sonu analizi.
 *
 * Her sorudan önce ve sonra kaç sayının hâlâ mümkün olduğunu gösterir;
 * boşa giden soruları işaretler ve "zor" botun (Usta Ayşe) aynı sayıyı kaç
 * soruda bulacağını hesaplar. Hesap tamamen telefonda yapılır.
 */
'use strict';
const analizBellek = {};

function analizHTML(m, kimin) {
  const ben = kimin === 'ben';
  const sorular = ben ? m.sorularim : m.gelenSorular;
  const gizli = ben ? m.rakip.gizli : m.ben.gizli;
  const N = m.ayar.basamak;
  const adimlar = Oyun.analizEt(m.ayar, sorular);
  const anahtar = m.id + kimin;
  if (gizli && analizBellek[anahtar] == null) analizBellek[anahtar] = Oyun.botKacSoruda('zor', m.ayar, gizli);
  const bot = analizBellek[anahtar];
  const kisi = ben ? 'Sen' : esc(m.rakip.ad);

  const buldu = adimlar.some(a => a.arti === N);
  const tekKaldi = adimlar.findIndex(a => a.sonra === 1);
  const bosa = adimlar.filter((a, i) => !a.olabilirdi && a.arti !== N && !(i === 0)).length;

  let ozet = buldu
    ? `<b>${kisi}</b> sayıyı <b>${adimlar.length}</b> soruda ${ben ? 'buldun' : 'buldu'}.`
    : `<b>${kisi}</b> ${adimlar.length} soru ${ben ? 'sordun' : 'sordu'}, sayı bulunamadı${adimlar.length ? ` (${adimlar[adimlar.length - 1].sonra} ihtimal kalmıştı)` : ''}.`;
  if (tekKaldi >= 0 && tekKaldi < adimlar.length - 1) ozet += ` ${tekKaldi + 1}. sorudan sonra sayı belliydi.`;
  if (bosa) ozet += ` ${bosa} soru önceki cevaplarla çelişiyordu.`;
  if (bot) ozet += `<br>🧠 Usta Ayşe (zor bot) bu sayıyı <b>${bot}</b> soruda bulurdu.`;

  const satirlar = adimlar.map((a, i) => {
    const elenen = a.once ? Math.round(100 * (1 - a.sonra / a.once)) : 0;
    let not = '';
    if (a.arti === N) not = '<span class="an-not iyi">🎯 buldu</span>';
    else if (a.sonra === a.once) not = '<span class="an-not kotu">hiç eleme yok</span>';
    else if (!a.olabilirdi && i > 0) not = '<span class="an-not kotu">bu sayı olamazdı</span>';
    else if (a.sonra === 1) not = '<span class="an-not iyi">tek ihtimal kaldı</span>';
    else if (elenen >= 80) not = '<span class="an-not iyi">çok iyi soru</span>';
    return `<li>
      <span class="an-no">${i + 1}</span>
      ${sayiHTML(a.tahmin, false)} <span class="an-cevap">${cevapHTML(a.arti, a.eksi)}</span>
      <span class="an-kalan">${a.once} → <b>${a.sonra}</b></span>
      <span class="an-cubuk" title="%${elenen} elendi"><i style="width:${elenen}%"></i></span>
      ${not}
    </li>`;
  }).join('');

  return `<div class="modal analiz">
    <h2>Maç analizi</h2>
    ${m.tekSekme ? '' : `<div class="secenekler genis">
      <button class="sec ${ben ? 'secili' : ''}" data-e="analizAc" data-v="ben">Benim sorularım</button>
      <button class="sec ${ben ? '' : 'secili'}" data-e="analizAc" data-v="rakip">${esc(m.rakip.ad)}</button>
    </div>`}
    <p class="an-ozet">${ozet}</p>
    <p class="not kucuk sol">Sayılar: o sorudan önce → sonra kaç sayı hâlâ mümkündü. Çubuk, sorunun kaç ihtimali elediğini gösterir.</p>
    <ol class="an-liste">${satirlar || '<li class="bos">Soru yok</li>'}</ol>
    <button class="dugme ana" data-e="analizKapat">Kapat</button>
  </div>`;
}

const ANALIZ_EYLEM = {
  analizAc(v) { S.analiz = v === 'rakip' ? 'rakip' : 'ben'; S.menu = false; katmanCiz(); },
  analizKapat() { S.analiz = null; katmanCiz(); },
};
