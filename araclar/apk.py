"""Sayı Bulmaca Android uygulamasını (APK) derler.

Gradle / Android Studio gerekmez: hemcan projesinin .tools klasöründeki
komut satırı araçlarını (aapt2, javac, d8, apksigner) kullanır.

    python araclar/apk.py --adres https://sayi-bulmaca.onrender.com
    python araclar/apk.py --adres ... --kur        # USB'deki telefona da kur

Çıktı: android/cikti/SayiBulmaca.apk
"""
import argparse
import os
import shutil
import sys

KOK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HEMCAN = os.path.dirname(KOK)
sys.path.insert(0, os.path.join(HEMCAN, "android"))
import olustur  # noqa: E402  (derleme zinciri oradan geliyor)

sys.path.insert(0, os.path.join(KOK, "araclar"))
import ikon  # noqa: E402

ANDROID = os.path.join(KOK, "android")
CIKTI = os.path.join(ANDROID, "cikti")
PAKET = "com.sayibulmaca.oyun"
SURUM = "1.1"
SURUM_KOD = "2"


def anahtar(a):
    ks = os.path.join(ANDROID, "sayibulmaca.keystore")
    if not os.path.exists(ks):
        print("  [imza] anahtar deposu oluşturuluyor (tek seferlik)...")
        olustur.calistir([a["keytool"], "-genkeypair", "-keystore", ks,
                          "-storepass", "hemcan", "-keypass", "hemcan", "-alias", "hemcan",
                          "-keyalg", "RSA", "-keysize", "2048", "-validity", "10000",
                          "-dname", "CN=Sayi Bulmaca, O=Hemcan, C=TR"], "keytool")
    return ks


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--adres", required=True, help="oyun sitesinin adresi, ör. https://sayi-bulmaca.onrender.com")
    ap.add_argument("--kur", action="store_true", help="derleyince USB ile bağlı telefona kur")
    args = ap.parse_args()
    adres = args.adres.rstrip("/") + "/"

    a = olustur.araclari_bul()
    proje = os.path.join(CIKTI, "proje")
    if os.path.exists(proje):
        shutil.rmtree(proje)
    src = os.path.join(proje, "src", *PAKET.split("."))
    res = os.path.join(proje, "res")
    os.makedirs(src)
    os.makedirs(os.path.join(res, "values"))

    def doldur(metin):
        return (metin.replace("@@PAKET@@", PAKET).replace("@@ADRES@@", adres)
                .replace("@@SURUM@@", SURUM).replace("@@SURUM_KOD@@", SURUM_KOD))

    for ad, hedef in (("MainActivity.java", src), ("AndroidManifest.xml", proje)):
        with open(os.path.join(ANDROID, ad), encoding="utf-8") as f:
            metin = doldur(f.read())
        with open(os.path.join(hedef, ad), "w", encoding="utf-8") as f:
            f.write(metin)
    with open(os.path.join(res, "values", "strings.xml"), "w", encoding="utf-8") as f:
        f.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
                '    <string name="app_name">Sayı Bulmaca</string>\n</resources>\n')
    for yogunluk, n in {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}.items():
        d = os.path.join(res, "mipmap-" + yogunluk)
        os.makedirs(d)
        ikon.ciz(n).save(os.path.join(d, "ic_launcher.png"))

    olustur.CIKTI = CIKTI  # derle() çıktıyı buraya yazsın
    son = olustur.derle(dict(ad="Sayı Bulmaca", dosya="SayiBulmaca.apk"), proje, a, anahtar(a))
    print("\nAPK hazır: %s\nAçtığı adres: %s" % (son, adres))

    if args.kur:
        olustur.calistir([a["adb"], "install", "-r", son], "adb install")
        print("Telefona kuruldu.")


if __name__ == "__main__":
    main()
