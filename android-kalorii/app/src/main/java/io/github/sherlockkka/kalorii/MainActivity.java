package io.github.sherlockkka.kalorii;

import android.app.Activity;
import android.content.ClipData;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.media.ExifInterface;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import org.json.JSONArray;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.WebViewAssetLoader;

/** Калории: страница из assets во весь экран; выбор фото из галереи/камеры; ссылки наружу открываются в браузере. */
public class MainActivity extends Activity {
    static final int PICK = 7, PICK2 = 8;
    // страница живёт на сайте, поэтому обновляется без переустановки; встроенная копия нужна без сети
    static final String WEB = "https://klimentiev-a.github.io/konspekty/kalorii/";
    static final String LOCAL = "https://appassets.androidplatform.net/assets/index.html";
    boolean fallback = false;
    WebView web;
    ValueCallback<Uri[]> pending;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        web = new WebView(this);
        web.setLayoutParams(new ViewGroup.LayoutParams(-1, -1));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // дневник и ключ лежат в localStorage
        s.setTextZoom(100);
        web.addJavascriptInterface(new Bridge(), "KcalApp");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                return loader.shouldInterceptRequest(r.getUrl());
            }
            @Override
            public void onReceivedError(WebView v, WebResourceRequest r, android.webkit.WebResourceError e) {
                // нет сети — открываем встроенную копию страницы
                if (r.isForMainFrame() && !fallback) { fallback = true; v.loadUrl(LOCAL); }
            }
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if ("appassets.androidplatform.net".equals(u.getHost())) return false;
                if ("klimentiev-a.github.io".equals(u.getHost()) && u.getPath() != null && u.getPath().startsWith("/konspekty/kalorii")) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception e) { }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (pending != null) pending.onReceiveValue(null);
                pending = cb;
                try {
                    startActivityForResult(p.createIntent(), PICK);
                } catch (Exception e) {
                    pending = null;
                    return false;
                }
                return true;
            }
        });
        setContentView(web);
        if (b != null) web.restoreState(b); else web.loadUrl(WEB);
    }

    /** Выбор фото силами приложения: страница зовёт KcalApp.pick(), фото возвращаются уменьшенными (JPEG, data-URL). */
    class Bridge {
        @JavascriptInterface
        public void pick() {
            runOnUiThread(new Runnable() { public void run() {
                try {
                    Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                    i.setType("image/*");
                    i.addCategory(Intent.CATEGORY_OPENABLE);
                    i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                    startActivityForResult(Intent.createChooser(i, "Фото еды"), PICK2);
                } catch (Exception e) { js("window.__kcalErr&&window.__kcalErr(" + JSONArray.quote("Не открылась галерея: " + e.getMessage()) + ")"); }
            }});
        }
    }

    void js(final String code) {
        runOnUiThread(new Runnable() { public void run() { web.evaluateJavascript(code, null); } });
    }

    String shrink(Uri u) throws Exception {
        BitmapFactory.Options o = new BitmapFactory.Options();
        o.inJustDecodeBounds = true;
        InputStream a = getContentResolver().openInputStream(u);
        BitmapFactory.decodeStream(a, null, o);
        a.close();
        int sample = 1;
        while (Math.max(o.outWidth, o.outHeight) / sample > 2600) sample *= 2;
        o = new BitmapFactory.Options();
        o.inSampleSize = sample;
        InputStream b = getContentResolver().openInputStream(u);
        Bitmap bm = BitmapFactory.decodeStream(b, null, o);
        b.close();
        if (bm == null) throw new Exception("формат не поддерживается");
        int rot = 0;
        try {
            InputStream c = getContentResolver().openInputStream(u);
            int ori = new ExifInterface(c).getAttributeInt(ExifInterface.TAG_ORIENTATION, 1);
            c.close();
            if (ori == 6) rot = 90; else if (ori == 3) rot = 180; else if (ori == 8) rot = 270;
        } catch (Exception e) { }
        float k = Math.min(1f, 1280f / Math.max(bm.getWidth(), bm.getHeight()));
        Matrix m = new Matrix();
        m.postScale(k, k);
        if (rot != 0) m.postRotate(rot);
        Bitmap out = Bitmap.createBitmap(bm, 0, 0, bm.getWidth(), bm.getHeight(), m, true);
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        out.compress(Bitmap.CompressFormat.JPEG, 82, bo);
        return "data:image/jpeg;base64," + Base64.encodeToString(bo.toByteArray(), Base64.NO_WRAP);
    }

    void handlePicked(Intent data) {
        final ArrayList<Uri> uris = new ArrayList<Uri>();
        if (data != null) {
            ClipData cd = data.getClipData();
            if (cd != null) for (int i = 0; i < cd.getItemCount() && i < 5; i++) uris.add(cd.getItemAt(i).getUri());
            else if (data.getData() != null) uris.add(data.getData());
        }
        if (uris.isEmpty()) { js("window.__kcalErr&&window.__kcalErr('Файл не выбран')"); return; }
        new Thread(new Runnable() { public void run() {
            JSONArray arr = new JSONArray();
            String err = null;
            for (Uri u : uris) {
                try { arr.put(shrink(u)); } catch (Throwable e) { err = String.valueOf(e.getMessage()); }
            }
            if (arr.length() == 0) js("window.__kcalErr&&window.__kcalErr(" + JSONArray.quote("Фото не открылось: " + err) + ")");
            else js("window.__kcalPhotos&&window.__kcalPhotos(" + arr.toString() + ")");
        }}).start();
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        if (req == PICK2) {
            if (res == RESULT_OK) handlePicked(data); else js("window.__kcalErr&&window.__kcalErr('Выбор отменён')");
            return;
        }
        if (req != PICK || pending == null) { super.onActivityResult(req, res, data); return; }
        Uri[] r = res == RESULT_OK ? WebChromeClient.FileChooserParams.parseResult(res, data) : null;
        pending.onReceiveValue(r);
        pending = null;
    }

    @Override
    protected void onSaveInstanceState(Bundle b) { super.onSaveInstanceState(b); web.saveState(b); }

    @Override
    public void onBackPressed() { if (web.canGoBack()) web.goBack(); else super.onBackPressed(); }
}
