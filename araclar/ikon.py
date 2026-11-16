"""ikon.svg ile aynı çizimi PNG olarak üretir (iPhone ve Android simgesi için).

    python araclar/ikon.py
"""
import os
from PIL import Image, ImageDraw, ImageFont

KOK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CIKTI = os.path.join(KOK, "public")


def font(boyut):
    for ad in ("georgiab.ttf", "timesbd.ttf", "arialbd.ttf", "DejaVuSerif-Bold.ttf"):
        try:
            return ImageFont.truetype(ad, boyut)
        except OSError:
            pass
    return ImageFont.load_default()


def ciz(boyut, kenar_bosluk=True):
    o = 4  # önce büyük çiz, sonra küçült: kenarlar yumuşak olsun
    S = 512 * o
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if kenar_bosluk:
        d.rounded_rectangle((0, 0, S - 1, S - 1), radius=112 * o, fill="#1f4fb5")
    else:  # iPhone köşeleri kendisi yuvarlıyor
        d.rectangle((0, 0, S, S), fill="#1f4fb5")
    f = font(128 * o)
    for x, rakam in ((62, "4"), (197, "2"), (332, "7")):
        d.rounded_rectangle((x * o, 166 * o, (x + 118) * o, 346 * o), radius=20 * o,
                            fill="#ffffff", outline="#0f2c6e", width=10 * o)
        d.text(((x + 59) * o, 256 * o), rakam, font=f, fill="#1f4fb5", anchor="mm")
    d.line((350 * o, 318 * o, 432 * o, 194 * o), fill="#cf3b3b", width=16 * o)
    return im.resize((boyut, boyut), Image.LANCZOS)


if __name__ == "__main__":
    ciz(180, kenar_bosluk=False).convert("RGB").save(os.path.join(CIKTI, "ikon-180.png"))
    ciz(192).save(os.path.join(CIKTI, "ikon-192.png"))
    ciz(512).save(os.path.join(CIKTI, "ikon-512.png"))
    print("ikonlar üretildi")
