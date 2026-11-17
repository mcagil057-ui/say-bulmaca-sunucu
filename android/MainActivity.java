package @@PAKET@@;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.provider.Settings;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup.LayoutParams;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

/**
 * Sayı Bulmaca — oyun sitesini açan kabuk.
 *
 * Oyunun kendisi sunucudaki web sayfası; böylece Android, iPhone ve
 * bilgisayar hep aynı sürümü oynar ve birlikte oynayabilir. Güncelleme
 * için APK'yı yeniden kurmak gerekmez.
 *
 * Ücretsiz sunucu boştayken uyuyor ve ilk açılış 30-50 sn sürebiliyor;
 * bu sırada boş beyaz ekran yerine "sunucu uyanıyor" yazısı gösteriliyor.
 */
public class MainActivity extends Activity {

    static final String ADRES = "@@ADRES@@";
    static final int ARKA = 0xFFF7F5EE;
    static final int YAZI = 0xFF23262B;
    static final int SOLUK = 0xFF6D6A62;
    static final int VURGU = 0xFF1F4FB5;

    private WebView web;
    private LinearLayout perde;
    private TextView durum;
    private ProgressBar cark;
    private Button tekrar;
    private long baslangic;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        FrameLayout kok = new FrameLayout(this);
        kok.setBackgroundColor(ARKA);

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);   // ad, oda ve ayarlar localStorage'da
        s.setMediaPlaybackRequiresUserGesture(false);
        web.setBackgroundColor(ARKA);
        web.addJavascriptInterface(new Kopru(), "SBAndroid");
        // WebChromeClient olmadan confirm() pencereleri hiç görünmüyor
        // ve "Pes et / Çık" düğmeleri tepkisiz kalıyor.
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                String u = r.getUrl().toString();
                if (u.startsWith(ADRES)) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, r.getUrl())); } catch (Exception e) { /* yok */ }
                return true;
            }
            @Override
            public void onPageFinished(WebView v, String url) {
                if (perde.getVisibility() == View.VISIBLE && tekrar.getVisibility() != View.VISIBLE) {
                    perde.setVisibility(View.GONE);
                }
            }
            @Override
            public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError h) {
                if (r != null && r.isForMainFrame()) {
                    hata("Sunucuya ulaşılamadı.\nİnternet bağlantını kontrol et."
                            + (h != null ? "\n(" + h.getDescription() + ")" : ""));
                }
            }
        });
        kok.addView(web, new FrameLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));

        perde = new LinearLayout(this);
        perde.setOrientation(LinearLayout.VERTICAL);
        perde.setGravity(Gravity.CENTER);
        perde.setBackgroundColor(ARKA);
        int p = dp(28);
        perde.setPadding(p, p, p, p);

        TextView baslik = new TextView(this);
        baslik.setText("Sayı Bulmaca");
        baslik.setTextColor(YAZI);
        baslik.setTextSize(TypedValue.COMPLEX_UNIT_SP, 30);
        baslik.setGravity(Gravity.CENTER);
        perde.addView(baslik);

        cark = new ProgressBar(this);
        LinearLayout.LayoutParams cl = new LinearLayout.LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT);
        cl.topMargin = dp(24);
        perde.addView(cark, cl);

        durum = new TextView(this);
        durum.setTextColor(SOLUK);
        durum.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        durum.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams dl = new LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT);
        dl.topMargin = dp(16);
        perde.addView(durum, dl);

        tekrar = new Button(this);
        tekrar.setText("Tekrar dene");
        tekrar.setAllCaps(false);
        tekrar.setTextColor(Color.WHITE);
        tekrar.setBackgroundColor(VURGU);
        tekrar.setVisibility(View.GONE);
        tekrar.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { yukle(); }
        });
        LinearLayout.LayoutParams tl = new LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT);
        tl.topMargin = dp(22);
        perde.addView(tekrar, tl);

        kok.addView(perde, new FrameLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));
        setContentView(kok);
        yukle();
    }

    private void yukle() {
        baslangic = System.currentTimeMillis();
        perde.setVisibility(View.VISIBLE);
        cark.setVisibility(View.VISIBLE);
        tekrar.setVisibility(View.GONE);
        durum.setText("Yükleniyor…");
        // Birkaç saniyede açılmadıysa sunucu uyuyordur: kullanıcı beklesin
        perde.postDelayed(new Runnable() {
            @Override public void run() {
                if (perde.getVisibility() == View.VISIBLE && tekrar.getVisibility() != View.VISIBLE) {
                    durum.setText("Sunucu uyanıyor…\nİlk açılış 1 dakikayı bulabilir.");
                }
            }
        }, 4000);
        web.loadUrl(ADRES);
    }

    private void hata(String m) {
        perde.setVisibility(View.VISIBLE);
        cark.setVisibility(View.GONE);
        tekrar.setVisibility(View.VISIBLE);
        durum.setText(m);
    }

    /** Sayfadan çağrılır: oda kodunu WhatsApp vb. ile göndermek için. */
    class Kopru {
        @JavascriptInterface
        public void paylas(final String metin) {
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    Intent i = new Intent(Intent.ACTION_SEND);
                    i.setType("text/plain");
                    i.putExtra(Intent.EXTRA_TEXT, metin);
                    startActivity(Intent.createChooser(i, "Oda kodunu gönder"));
                }
            });
        }

        /**
         * Telefonun Android kimliği: uygulama silinip yeniden kurulsa da
         * değişmez. Sunucu "bir cihazda 14 gün tek hesap" kuralı için kullanır.
         */
        @JavascriptInterface
        public String cihazNo() {
            String k = Settings.Secure.getString(getContentResolver(), Settings.Secure.ANDROID_ID);
            return k == null ? "" : k;
        }
    }

    private int dp(int v) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics());
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }
}
