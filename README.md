# Sayı Bulmaca

**Oyna:** https://sayi-bulmaca-u4e8.onrender.com — Android uygulaması:
sitenin giriş ekranındaki "Android uygulamasını indir" bağlantısı.

İki kişilik sayı bulmaca. Herkes rakamları farklı bir sayı tutar, sırayla
birbirinin sayısını sorar. Cevap: `+1` = yeri doğru, `−1` = var ama yeri
yanlış, `0` = hiçbiri yok. Cevabı varsayılan olarak **uygulama verir**;
"Cevaplar: Elle yazılır" seçilirse oyuncu kendisi yazar, yanlış yazarsa
uygulama yakalar, hakkı düşer, rakibe doğru cevabı uygulama verir.

- **Oda kur / katıl**: 4 harfli kodla. Ayarları odayı kuran seçer:
  cevaplar (otomatik/elle), basamak (3–5), tur süresi, yanlış hakkı (elle
  modda), 0 ile başlama, eşit tur.
- **Sohbet** (💬): hazır mesajlar, emojiler ve serbest yazı.
- **Eleme tablosu** (0–9): yalnızca kendi sorduğun sayıları boyar, her
  yeni maçta temizlenir.
- **Maç analizi**: her sorudan sonra kaç ihtimal kaldığı, boşa giden
  sorular ve zor botun aynı sayıyı kaç soruda bulacağı.
- **Oda skoru**: rövanşlar boyunca kim kaç kez kazandı.
- **İstatistiklerim**: maçlar, botlara/arkadaşlara karşı sonuçlar, günün
  bulmacası serisi. Telefonda saklanır.
- **Günün bulmacası**: her gün herkese aynı 4 basamaklı sayı, günün
  sıralaması, emojili sonuç paylaşma. Gizli sayı yalnızca sunucuda.
- **Botların kişiliği**: Acemi Ali (kolay), Kurnaz Kemal (orta), Usta Ayşe
  (zor); sohbete yazar, mesaja cevap verir.
- **Ses efektleri**: menüden açılıp kapanır.
- **Botla oyna**: kolay / orta / zor. Telefonda çalışır, internet gerekmez.
- Android (APK), iPhone (Safari'den aç → Paylaş → Ana Ekrana Ekle) ve
  bilgisayar aynı odada birlikte oynar.

## Hesaplar ve giriş

Oyunun tamamı mail ile girişle oynanır: maile 6 haneli kod gelir (Brevo),
yeni hesapta ad sorulur. Bir cihazda açılan hesaptan 14 gün başka hesaba
geçilemez; ad 3 günde bir değişir. Günün bulmacası hesap başına günde bir.

Render'da gereken ortam değişkenleri:

| Değişken | Ne |
|---|---|
| `DATABASE_URL` | Neon Postgres bağlantı adresi (hesaplar, günün bulmacası) |
| `BREVO_API_KEY` | Brevo API anahtarı (giriş kodu maili) |
| `MAIL_GONDEREN` | Brevo'da doğrulanmış gönderen adresi |

Bunlar yoksa (bilgisayarda deneme) hesaplar bellekte durur ve giriş kodu
sunucu penceresine yazılır. Denetim: `npm test` (kurallar + hesap akışı).

## Dosyalar

| Dosya | Ne yapar |
|---|---|
| `public/oyun.js` | Kurallar ve botlar. Sunucu ve telefon **aynı** dosyayı kullanır. |
| `public/uygulama.js`, `stil.css`, `index.html` | Arayüz |
| `server.js` | Odalar. Paket gerektirmez. Gizli sayılar yalnızca burada durur. |
| `test.js` | Kural denetimi + botların kaç soruda bulduğunu ölçer |
| `android/`, `araclar/apk.py` | Android kabuğu ve derleyici |

## Çalıştırma

```
node server.js        # http://localhost:8080
node test.js          # denetim
```

## Aynı Wi-Fi'da oynama (internet/Render gerekmez)

1. Bilgisayarda `AgdaOyna.bat`'a çift tıkla. Pencerede "Aynı Wi-Fi'dakiler"
   satırındaki adres yazar (ör. `http://192.168.68.61:8080`).
2. Telefonlar aynı Wi-Fi'dayken bu adresi tarayıcıda açar.
3. Biri **Oda kur** der ve odanın 4 harfli kodunu söyler; diğerleri **Kodla katıl** ile girer. (**Açık odalar** listesi kimin oda açtığını gösterir, 3 sn'de bir yenilenir; kodsuz giriş yoktur.)


İlk açılışta Windows "erişime izin ver" sorarsa izin ver. Wi-Fi ağı Windows'ta
"Ortak (Public)" ise telefonlar bağlanamaz: Ayarlar → Ağ ve İnternet → Wi-Fi →
ağın adı → **Özel ağ** seç.

## Render'a yükleme

Servis `main` dalına her gönderimde (push) kendiliğinden yeniden yayınlanır
(Auto-Deploy: On Commit). Olmazsa: Render paneli → Manual Deploy → Deploy latest commit.

1. Bu klasörü GitHub'da bir depoya gönder.
2. render.com → New → Web Service → depoyu seç.
   Build command: boş (ya da `npm install`), Start command: `node server.js`,
   Instance type: Free.
3. Verilen adresi (ör. `https://sayi-bulmaca.onrender.com`) APK'ya yaz:
   `python araclar/apk.py --adres https://sayi-bulmaca.onrender.com`

Not: ücretsiz sunucu 15 dk boş kalınca uyur. Bunu önlemek için sunucu
Render'dayken 10 dakikada bir kendi adresini yoklar (`RENDER_EXTERNAL_URL`);
`/api/saglik` cevabındaki `acilis` zamanı değişmiyorsa sunucu uyumamıştır.
Sunucu yeniden kurulursa (yeni sürüm yayınlanınca) açık odalar ve günün
sıralaması sıfırlanır; istatistikler telefonda durduğu için kaybolmaz.
