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
- **Botla oyna**: kolay / orta / zor. Telefonda çalışır, internet gerekmez.
- Android (APK), iPhone (Safari'den aç → Paylaş → Ana Ekrana Ekle) ve
  bilgisayar aynı odada birlikte oynar.

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
3. Biri **Oda kur** der; odası diğerlerinin ekranında **Açık odalar**
   listesinde belirir, **Gir**'e basmak yeter.

İlk açılışta Windows "erişime izin ver" sorarsa izin ver. Wi-Fi ağı Windows'ta
"Ortak (Public)" ise telefonlar bağlanamaz: Ayarlar → Ağ ve İnternet → Wi-Fi →
ağın adı → **Özel ağ** seç.

## Render'a yükleme

1. Bu klasörü GitHub'da bir depoya gönder.
2. render.com → New → Web Service → depoyu seç.
   Build command: boş (ya da `npm install`), Start command: `node server.js`,
   Instance type: Free.
3. Verilen adresi (ör. `https://sayi-bulmaca.onrender.com`) APK'ya yaz:
   `python araclar/apk.py --adres https://sayi-bulmaca.onrender.com`

Not: ücretsiz sunucu 15 dk boş kalınca uyur, ilk açılış ~1 dk sürebilir.
Sunucu yeniden başlarsa açık odalar kapanır (oyuncular ana menüye döner).
