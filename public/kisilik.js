/*
 * Sayı Bulmaca — botların kişilikleri.
 *
 * Her seviyenin bir adı ve konuşma tarzı var. Bot maçında sohbete yazar:
 * maç başında, iyi/kötü cevaplarda, maç sonunda ve oyuncu mesaj atınca.
 */
'use strict';
const BOT_KISILIK = {
  kolay: {
    ad: 'Acemi Ali', simge: '🐣', tanim: 'Yeni öğreniyor, çabuk unutur',
    basla: ['Selaam! Ben Ali, bu oyunu yeni öğreniyorum 🐣', 'Merhaba! Kolay gelsin, bana da 😅'],
    benSifir: ['Hiçbiri yok mu? Eyvah 😅', 'Hmm, sıfır… Neyse, öğreniyorum!'],
    benYakin: ['Oha, yaklaştım galiba! 😮', 'Bu sefer bulacağım sanki 🤞'],
    senSifir: ['Hiçbiri tutmadı, şanslıyım 😄', 'Sıfır! Bir puan bana 🙈'],
    senYakin: ['Eyvah eyvah, çok yaklaştın 😰', 'Ay, buluyorsun galiba 😬'],
    buldum: ['Buldum! Buldum! İnanamıyorum 🎉', 'Yaşasın, şans eseri buldum 😂'],
    kaybettim: ['Tebrikler! Çok iyisin 👏', 'Yine kaybettim ama eğlendim 😄'],
    berabere: ['Berabere! Fena değilim di mi? 😎'],
    selam: ['Selam selam! 👋', 'Merhabaa! 😊'],
    sans: ['Sana da bol şans! 🍀', 'Şansa ihtiyacım var aslında 😅'],
    rovans: ['Olur! Bu sefer daha dikkatli olacağım 💪'],
    tebrik: ['Teşekkür ederim 😊', 'Şans eseri oldu ama sağ ol 😄'],
    genel: ['Hı hı 😄', 'Anlamadım ama tamam 😅', 'Hmm, düşünüyorum…', 'Sen çok iyi oynuyorsun!'],
  },
  orta: {
    ad: 'Kurnaz Kemal', simge: '🦊', tanim: 'Dikkatli ama bazen dalgın',
    basla: ['Selam! Ben Kemal. Kolay lokma değilim 🦊', 'Hazır mısın? Sayımı bulmak kolay olmayacak 😏'],
    benSifir: ['Sıfır mı? Bu da bir bilgi 🤔', 'Hiçbiri yok… Not ettim 📝'],
    benYakin: ['Kokusunu alıyorum 👃', 'Az kaldı, hissediyorum 😏'],
    senSifir: ['Sıfır! Boşa bir soru 😄', 'Hiç tutmadı, devam et bakalım'],
    senYakin: ['Hmm, iyi soru… Çok yaklaştın 😬', 'Dikkat etmem lazım 🤨'],
    buldum: ['Buldum! Kurnazlık kazandı 🦊', 'İşte bu! Sayın elimde 😎'],
    kaybettim: ['Tebrikler, iyi oynadın 👏', 'Bu sefer sen kazandın, rövanş isterim!'],
    berabere: ['Berabere! İkimiz de iyiyiz 🤝'],
    selam: ['Selam! 👋', 'Merhaba, hoş geldin 🦊'],
    sans: ['Sana da! Gerçi şansa ihtiyacın olacak 😏'],
    rovans: ['Tabii ki! Hadi bakalım 💪'],
    tebrik: ['Sağ ol, sen de iyiydin 🤝'],
    genel: ['🤔', 'Öyle mi dersin?', 'Konuşma, sayını düşün 😄', 'Hmm…'],
  },
  zor: {
    ad: 'Usta Ayşe', simge: '🧠', tanim: 'Her soruyu hesaplar, ortalama 5 soruda bulur',
    basla: ['Merhaba, ben Ayşe. Genelde 5 soruda bulurum 🧠', 'Hazırsan başlayalım. İyi hesap yap 😌'],
    benSifir: ['Sıfır da çok şey anlatır 🧠', 'Güzel, birçok sayı elendi 📉'],
    benYakin: ['Neredeyse tamam 😌', 'Bir iki soru kaldı.'],
    senSifir: ['O soru pek bir şey kazandırmadı 🙂'],
    senYakin: ['Etkileyici, çok yaklaştın 👀', 'İyi akıl yürütüyorsun 👏'],
    buldum: ['Buldum. Analize bakmanı öneririm 🧠', 'Sayın buydu. İyi maçtı 😌'],
    kaybettim: ['Tebrikler! Beni yenmek kolay değil 👏', 'Harika oyun, gerçekten 🏆'],
    berabere: ['Berabere. Güzel bir maçtı 🤝'],
    selam: ['Merhaba 🙂', 'Selam, iyi oyunlar.'],
    sans: ['Teşekkürler, sana da. Ama ben hesaba güvenirim 🧠'],
    rovans: ['Memnuniyetle 🙂'],
    tebrik: ['Teşekkür ederim 🙂'],
    genel: ['🙂', 'Hesaplıyorum…', 'İlginç.', 'Sıra kimde? 😌'],
  },
};

/** Oyuncunun mesajına göre botun cevabı. */
function botCevapla(kisilik, metin) {
  const k = BOT_KISILIK[kisilik];
  const m = metin.toLocaleLowerCase('tr');
  const sec = l => l[Math.floor(Math.random() * l.length)];
  if (/^(\p{Extended_Pictographic}|️|‍|\s)+$/u.test(metin)) return sec(['😄', '😎', '🤔', '😂', '👍', '🙈']);
  if (/selam|merhaba|naber|slm|mrb/.test(m)) return sec(k.selam);
  if (/şans/.test(m)) return sec(k.sans);
  if (/rövanş|rovans|tekrar/.test(m)) return sec(k.rovans);
  if (/tebrik|helal|aferin|bravo|iyi oyun/.test(m)) return sec(k.tebrik);
  return sec(k.genel);
}

/*
 * Botlarla YARIŞ: kazanan en kısa sürede bulan olduğu için botlar her soru
 * arasında "düşünür". Süreler ölçüme göre ayarlandı (3 basamak, ortalama
 * soru: Ali 10,8 · Kemal 6,3 · Ayşe 5,0) ki normal hızda ortalama bitiş
 * süresi zorlukla aynı sırada olsun: Ali ~2,5 dk, Kemal ~1 dk 40 sn, Ayşe ~1 dk.
 */
const BOT_HIZ = {
  soruBasina: { kolay: 14000, orta: 16000, zor: 12000 },  // ms, 3 basamakta
  basamak: { 3: 1, 4: 1.3, 5: 1.6 },                       // büyük sayıda daha uzun düşünür
  hiz: { yavas: 1.5, normal: 1, hizli: 0.6 },
  ad: { yavas: 'Yavaş', normal: 'Normal', hizli: 'Hızlı' },
};
/** Botun bir sonraki sorusuna kadar düşünme süresi (ms), her seferinde biraz farklı. */
function botDusunmeSuresi(seviye, basamak, hiz, ilk, rnd) {
  rnd = rnd || Math.random;
  const t = BOT_HIZ.soruBasina[seviye] * (BOT_HIZ.basamak[basamak] || 1) * (BOT_HIZ.hiz[hiz] || 1);
  return Math.round(t * (0.7 + 0.6 * rnd()) + (ilk ? 1500 + 2000 * rnd() : 0));
}
