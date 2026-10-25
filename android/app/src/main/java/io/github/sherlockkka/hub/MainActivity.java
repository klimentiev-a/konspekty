package io.github.sherlockkka.hub;

import android.app.Activity;
import android.app.Dialog;
import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInstaller;
import android.content.res.ColorStateList;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/** Hub: сайт klimentiev-a.github.io/konspekty во весь экран, без адресной строки.
 *  Содержимое всегда свежее (грузится с сайта), после первого запуска работает и без сети (кэш сайта).
 *  Само приложение проверяет новые версии на GitHub Releases и обновляется изнутри. */
public class MainActivity extends Activity {
    ValueCallback<Uri[]> filePending;

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        if (req == 77) {
            if (filePending != null) {
                filePending.onReceiveValue(res == RESULT_OK ? WebChromeClient.FileChooserParams.parseResult(res, data) : null);
                filePending = null;
            }
            return;
        }
        super.onActivityResult(req, res, data);
    }

    static final String HOST = "klimentiev-a.github.io";
    static final String HOME = "https://klimentiev-a.github.io/konspekty/";
    static final String API = "https://api.github.com/repos/klimentiev-a/konspekty/releases/latest";
    static final String ACT_INSTALL = "io.github.sherlockkka.hub.INSTALL";

    // Три «экрана», каждый — свой WebView, живущий в памяти: главная/профили, Учёба, Финансы.
    // Переход между ними — мгновенное переключение, а не новая загрузка страницы.
    static final String K_HUB = "hub", K_UCHEBA = "ucheba", K_FIN = "finance";
    final java.util.HashMap<String, WebView> views = new java.util.HashMap<>();
    final java.util.HashSet<String> stale = new java.util.HashSet<>();   // страницы, которые нужно перезагрузить при показе
    android.widget.FrameLayout root;
    WebView web;                 // видимый сейчас
    SharedPreferences prefs;
    boolean offlineShown = false, firstPaint = true, preloaded = false;
    // ожидающее обновление (если пришлось сходить в настройки за разрешением)
    String pendingUrl = null; int pendingVer = 0;
    Dialog sheet; ProgressBar sheetBar; TextView sheetStatus, sheetBtn;

    static String keyOf(Uri u) {
        String p = u.getPath() == null ? "" : u.getPath();
        if (p.endsWith("/ucheba.html")) return K_UCHEBA;
        if (p.endsWith("/finance.html")) return K_FIN;
        return K_HUB;
    }
    static String noHash(String url) { int i = url.indexOf('#'); return i < 0 ? url : url.substring(0, i); }

    // ---------------------------------------------------------------- жизненный цикл
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = getSharedPreferences("hub", MODE_PRIVATE);
        root = new android.widget.FrameLayout(this);
        root.setBackgroundColor(getResources().getColor(R.color.bg, getTheme()));
        setContentView(root);
        web = makeView(K_HUB);
        web.setAlpha(0f);
        web.setVisibility(View.VISIBLE);
        web.postDelayed(() -> { if (web.getAlpha() < 1f) web.animate().alpha(1f).setDuration(200).start(); }, 2500);

        if (state != null) views.get(K_HUB).restoreState(state);
        else load(getIntent());

        root.postDelayed(this::showWhatsNewIfUpdated, 900);
        root.postDelayed(() -> checkUpdate(false), 2500);
    }

    WebView makeView(String key) {
        WebView w = new WebView(this);
        w.setBackgroundColor(getResources().getColor(R.color.bg, getTheme()));
        w.setVisibility(View.INVISIBLE);
        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // оценки, заметки, настройки сайта (localStorage)
        s.setDatabaseEnabled(true);
        s.setTextZoom(100);                    // масштаб — кнопками A−/A+ на самом сайте
        s.setSupportZoom(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        if (Build.VERSION.SDK_INT >= 23) s.setOffscreenPreRaster(true);   // фоновые экраны уже отрисованы — переключение без белой вспышки
        s.setUserAgentString(s.getUserAgentString() + " HubApp/" + versionCode());
        w.addJavascriptInterface(new Bridge(w), "HubApp");
        w.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {   // выбор фото (Калории и др.)
                if (filePending != null) filePending.onReceiveValue(null);
                filePending = cb;
                try { startActivityForResult(p.createIntent(), 77); }
                catch (Exception e) { filePending = null; return false; }
                return true;
            }
        });
        w.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if ("about".equals(u.getScheme()) || "data".equals(u.getScheme())) return false;
                if (!(HOST.equals(u.getHost()) && u.getPath() != null && u.getPath().startsWith("/konspekty"))) {
                    openOutside(u);            // источники новостей, Мосбиржа и т.п. — во внешнем браузере
                    return true;
                }
                String target = keyOf(u);
                if (target.equals(key)) return false;            // переход внутри своего экрана
                // страница просит другой экран (например, «Учёба» с главной или замок паролем → вход)
                if (u.getQueryParameter("login") != null) stale.add(key);   // эту страницу откроем заново после входа
                show(target, u.toString());
                return true;
            }

            @Override
            public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                if (r.isForMainFrame() && !offlineShown && v == web) {
                    offlineShown = true;
                    String bg = isNight() ? "#171611" : "#F4F1E8", fg = isNight() ? "#E8E4D8" : "#25221C";
                    v.loadDataWithBaseURL(HOME, "<html><head><meta name=viewport content='width=device-width,initial-scale=1'></head>"
                        + "<body style='margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:" + bg + ";color:" + fg + ";font-family:sans-serif;text-align:center'>"
                        + "<div><svg xmlns='http://www.w3.org/2000/svg' width='84' height='84' viewBox='0 0 512 512'><defs><linearGradient id='gh' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#22D39A'/><stop offset='1' stop-color='#05704C'/></linearGradient><radialGradient id='lh' cx='.5' cy='0' r='.9'><stop offset='0' stop-color='#fff' stop-opacity='.18'/><stop offset='1' stop-color='#fff' stop-opacity='0'/></radialGradient></defs><rect width='84' height='84' rx='113' fill='url(#gh)'/><rect width='84' height='84' rx='113' fill='url(#lh)'/><circle cx='256' cy='256' r='148' fill='none' stroke='#BDF7DF' stroke-width='20'/><g transform='translate(261 256) scale(0.62) translate(-97.0 -245.5)'><path d='M29.0 128.0V392' fill='none' stroke='#FFFFFF' stroke-width='58' stroke-linecap='butt'/><circle cx='29.0' cy='128.0' r='29.0' fill='#FFFFFF'/><path d='M29.0 300.0A68 68 0 0 1 165.0 300.0V392' fill='none' stroke='#FFFFFF' stroke-width='58' stroke-linecap='butt'/></g></svg><h2 style='margin:10px 0 6px'>Нет соединения</h2>"
                        + "<p style='opacity:.7;margin:0 0 18px'>Проверь интернет и попробуй ещё раз.</p>"
                        + "<a href='" + HOME + "' style='padding:12px 22px;border-radius:999px;background:#1F6B57;color:#fff;text-decoration:none'>Повторить</a></div></body></html>",
                        "text/html", "utf-8", null);
                }
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                if (url != null && url.startsWith("http")) offlineShown = false;
                if (firstPaint && v == web) { firstPaint = false; v.animate().alpha(1f).setDuration(260).start(); }
                if (v == web) paintBars(v);
                // зашли в профиль Артема — заранее открываем в фоне Учёбу и Финансы
                if (!preloaded && K_HUB.equals(key) && url != null && url.contains("/artem.html")) {
                    preloaded = true;
                    root.postDelayed(() -> { preload(K_UCHEBA, HOME + "ucheba.html"); preload(K_FIN, HOME + "finance.html"); }, 400);
                }
            }
        });
        w.setDownloadListener((url, ua, cd, mime, len) -> openOutside(Uri.parse(url)));
        root.addView(w, new android.widget.FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        views.put(key, w);
        return w;
    }

    void preload(String key, String url) {
        if (views.containsKey(key)) return;
        WebView w = makeView(key);
        w.loadUrl(url);
        w.onPause();                           // в фоне — без лишней работы
    }

    /** Показать экран key; если у него другой адрес — перейти (смена только #… — мгновенно, без перезагрузки). */
    void show(String key, String url) {
        WebView w = views.get(key);
        boolean fresh = false;
        if (w == null) { w = makeView(key); fresh = true; }
        String cur = w.getUrl();
        if (fresh || stale.remove(key) || cur == null || !cur.startsWith("http")) w.loadUrl(url);
        else if (!url.equals(cur)) {
            if (noHash(url).equals(noHash(cur))) {
                int h = url.indexOf('#');
                String hash = h < 0 ? "" : url.substring(h + 1);
                w.evaluateJavascript("location.hash=" + JSONObject.quote(hash) + ";", null);
            } else w.loadUrl(url);
        }
        if (w == web) return;
        WebView prev = web;
        web = w;
        w.setAlpha(1f);
        w.onResume();
        w.setVisibility(View.VISIBLE);
        w.bringToFront();
        prev.setVisibility(View.INVISIBLE);
        prev.onPause();
        lastBar = null;
        paintBars(w);
    }

    void paintBars(WebView v) {
        v.evaluateJavascript("(function(){try{HubApp.bar(getComputedStyle(document.body).backgroundColor)}catch(e){}"
            + "if(!window.__hubObs){window.__hubObs=1;new MutationObserver(function(){setTimeout(function(){try{HubApp.bar(getComputedStyle(document.body).backgroundColor)}catch(e){}},50)}).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme','data-skin']})}})()", null);
    }

    void load(Intent i) {
        Uri d = i != null ? i.getData() : null;
        String url = d != null && HOST.equals(d.getHost()) ? d.toString() : HOME;
        String k = keyOf(Uri.parse(url));
        if (K_HUB.equals(k)) views.get(K_HUB).loadUrl(url);
        else { views.get(K_HUB).loadUrl(HOME); show(k, url); }
    }

    @Override
    protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        if (ACT_INSTALL.equals(i.getAction())) { onInstallStatus(i); return; }
        if (i.getData() != null) load(i);
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        // вернулись из настроек с разрешением на установку — продолжаем обновление
        if (pendingUrl != null && canInstall()) { String u = pendingUrl; pendingUrl = null; startDownload(u, pendingVer); }
        else checkUpdate(false);
    }

    @Override
    protected void onPause() { super.onPause(); web.onPause(); }

    @Override
    public void onBackPressed() {
        if (sheet != null && sheet.isShowing()) { sheet.dismiss(); return; }
        if (web.canGoBack()) { web.goBack(); return; }
        WebView hub = views.get(K_HUB);
        if (web != hub) {                       // из Учёбы/Финансов — назад к профилю
            String hu = hub.getUrl();
            show(K_HUB, hu != null && hu.startsWith("http") ? hu : HOME + "artem.html");
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        views.get(K_HUB).saveState(out);
    }

    // ---------------------------------------------------------------- мелочи
    boolean isNight() {
        return (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
    }

    int dp(float v) { return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics())); }

    @SuppressWarnings("deprecation")
    int versionCode() {
        try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionCode; } catch (Exception e) { return 1; }
    }

    void openOutside(Uri u) {
        try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (ActivityNotFoundException ignored) { }
    }

    static String readAll(InputStream in) throws Exception {
        BufferedReader r = new BufferedReader(new InputStreamReader(in, "UTF-8"));
        StringBuilder sb = new StringBuilder(); String line;
        while ((line = r.readLine()) != null) sb.append(line).append('\n');
        r.close();
        return sb.toString();
    }

    static String cleanNotes(String md) {
        if (md == null) return "";
        return md.replaceAll("(?m)^#+\\s*", "").replaceAll("(?m)^\\s*[-*]\\s+", "•  ").replace("**", "").trim();
    }

    // ---------------------------------------------------------------- проверка обновлений
    void checkUpdate(boolean manual) {
        long now = System.currentTimeMillis();
        if (!manual && now - prefs.getLong("lastCheck", 0) < 6 * 3600_000L) return;
        prefs.edit().putLong("lastCheck", now).apply();
        new Thread(() -> {
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(API).openConnection();
                c.setRequestProperty("Accept", "application/vnd.github+json");
                c.setRequestProperty("User-Agent", "HubApp");
                c.setConnectTimeout(8000); c.setReadTimeout(8000);
                JSONObject j = new JSONObject(readAll(c.getInputStream()));
                String tag = j.optString("tag_name", "");
                int v = Integer.parseInt(tag.replaceAll("^.*\\.", ""));
                String url = null;
                JSONArray a = j.optJSONArray("assets");
                for (int k = 0; a != null && k < a.length(); k++) {
                    JSONObject o = a.getJSONObject(k);
                    if (o.optString("name").endsWith(".apk")) url = o.optString("browser_download_url");
                }
                String notes = cleanNotes(j.optString("body", ""));
                prefs.edit().putString("notes_" + v, notes).apply();
                final String fu = url;
                if (v <= versionCode() || fu == null) {
                    if (manual) runOnUiThread(() -> toast("У тебя последняя версия Hub 1." + versionCode()));
                    return;
                }
                if (!manual && prefs.getInt("skipVer", 0) == v && now - prefs.getLong("skipAt", 0) < 24 * 3600_000L) return;
                runOnUiThread(() -> showUpdate(v, fu, notes));
            } catch (Exception e) {
                if (manual) runOnUiThread(() -> toast("Не получилось проверить обновления — нет связи с GitHub"));
            }
        }).start();
    }

    void toast(String s) { Toast.makeText(this, s, Toast.LENGTH_LONG).show(); }

    // ---------------------------------------------------------------- красивая панель снизу
    int cBg() { return isNight() ? 0xFF22211A : 0xFFFBF9F3; }
    int cFg() { return isNight() ? 0xFFE8E4D8 : 0xFF25221C; }
    int cMut() { return isNight() ? 0xFFA39D8E : 0xFF665F52; }
    int cAcc() { return isNight() ? 0xFF5FC2A3 : 0xFF1F6B57; }
    int cRed() { return isNight() ? 0xFFE8886B : 0xFFA93D28; }

    LinearLayout sheetBase() {
        LinearLayout L = new LinearLayout(this);
        L.setOrientation(LinearLayout.VERTICAL);
        L.setPadding(dp(24), dp(10), dp(24), dp(22));
        GradientDrawable gd = new GradientDrawable();
        gd.setColor(cBg());
        float r = dp(28);
        gd.setCornerRadii(new float[]{r, r, r, r, 0, 0, 0, 0});
        L.setBackground(gd);
        View grab = new View(this);
        GradientDrawable gg = new GradientDrawable(); gg.setColor((cMut() & 0x00FFFFFF) | 0x66000000); gg.setCornerRadius(dp(3));
        grab.setBackground(gg);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(dp(38), dp(4));
        lp.gravity = Gravity.CENTER_HORIZONTAL; lp.bottomMargin = dp(20);
        L.addView(grab, lp);
        return L;
    }

    View header(String title, String sub) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        android.widget.ImageView ic = new android.widget.ImageView(this);   // значок приложения (h на изумруде)
        ic.setImageResource(R.mipmap.ic_launcher); ic.setScaleType(android.widget.ImageView.ScaleType.FIT_CENTER);
        row.addView(ic, new LinearLayout.LayoutParams(dp(56), dp(56)));
        LinearLayout tx = new LinearLayout(this); tx.setOrientation(LinearLayout.VERTICAL); tx.setPadding(dp(14), 0, 0, 0);
        TextView t1 = new TextView(this); t1.setText(title); t1.setTextColor(cFg()); t1.setTextSize(TypedValue.COMPLEX_UNIT_SP, 21);
        t1.setTypeface(Typeface.create(Typeface.SERIF, Typeface.BOLD));
        TextView t2 = new TextView(this); t2.setText(sub); t2.setTextColor(cMut()); t2.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        tx.addView(t1); tx.addView(t2);
        row.addView(tx, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        return row;
    }

    TextView pill(String text, boolean primary) {
        TextView b = new TextView(this);
        b.setText(text); b.setGravity(Gravity.CENTER); b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        b.setTypeface(Typeface.DEFAULT_BOLD);
        GradientDrawable g = new GradientDrawable(); g.setCornerRadius(dp(26));
        if (primary) { g.setColor(cAcc()); b.setTextColor(isNight() ? 0xFF10140F : Color.WHITE); }
        else { g.setColor(Color.TRANSPARENT); b.setTextColor(cMut()); }
        b.setBackground(g);
        b.setClickable(true); b.setFocusable(true);
        return b;
    }

    Dialog showSheet(LinearLayout L) {
        Dialog d = new Dialog(this);
        d.requestWindowFeature(Window.FEATURE_NO_TITLE);
        d.setContentView(L);
        Window w = d.getWindow();
        if (w != null) {
            w.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
            w.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            w.setGravity(Gravity.BOTTOM);
            w.setWindowAnimations(android.R.style.Animation_InputMethod);
            w.setDimAmount(0.45f);
            w.setNavigationBarColor(cBg());
        }
        d.show();
        return d;
    }

    void showUpdate(int v, String url, String notes) {
        if (isFinishing() || (sheet != null && sheet.isShowing())) return;
        LinearLayout L = sheetBase();
        L.addView(header("Доступно обновление", "Hub 1." + v + "  ·  у тебя 1." + versionCode()));
        if (!notes.isEmpty()) {
            TextView n = new TextView(this);
            n.setText(notes); n.setTextColor(cFg()); n.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
            n.setLineSpacing(dp(3), 1f);
            GradientDrawable nb = new GradientDrawable(); nb.setColor((cFg() & 0x00FFFFFF) | 0x0D000000); nb.setCornerRadius(dp(16));
            n.setBackground(nb); n.setPadding(dp(16), dp(14), dp(16), dp(14));
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            lp.topMargin = dp(18);
            L.addView(n, lp);
        }
        sheetBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        sheetBar.setMax(100); sheetBar.setProgressTintList(ColorStateList.valueOf(cAcc()));
        sheetBar.setProgressBackgroundTintList(ColorStateList.valueOf((cMut() & 0x00FFFFFF) | 0x33000000));
        sheetBar.setVisibility(View.GONE);
        LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(8));
        bp.topMargin = dp(20);
        L.addView(sheetBar, bp);
        sheetStatus = new TextView(this); sheetStatus.setTextColor(cMut()); sheetStatus.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        sheetStatus.setVisibility(View.GONE); sheetStatus.setPadding(0, dp(6), 0, 0);
        L.addView(sheetStatus);

        sheetBtn = pill("Обновить", true);
        LinearLayout.LayoutParams p1 = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52));
        p1.topMargin = dp(20);
        L.addView(sheetBtn, p1);
        TextView later = pill("Позже", false);
        L.addView(later, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(46)));

        sheet = showSheet(L);
        sheetBtn.setOnClickListener(x -> {
            sheetBtn.setEnabled(false); sheetBtn.setAlpha(0.6f);
            if (!canInstall()) {
                pendingUrl = url; pendingVer = v;
                toast("Разреши Hub устанавливать обновления и вернись назад — продолжу сам");
                try {
                    startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName())));
                } catch (Exception e) { pendingUrl = null; openOutside(Uri.parse(url)); }
                return;
            }
            startDownload(url, v);
        });
        later.setOnClickListener(x -> {
            prefs.edit().putInt("skipVer", v).putLong("skipAt", System.currentTimeMillis()).apply();
            sheet.dismiss();
        });
    }

    boolean canInstall() {
        return Build.VERSION.SDK_INT < 26 || getPackageManager().canRequestPackageInstalls();
    }

    // ---------------------------------------------------------------- скачивание и установка
    void showProgress(int pct, String text) {
        runOnUiThread(() -> {
            if (sheetBar == null) return;
            sheetBar.setVisibility(View.VISIBLE); sheetStatus.setVisibility(View.VISIBLE);
            if (pct < 0) sheetBar.setIndeterminate(true); else { sheetBar.setIndeterminate(false); sheetBar.setProgress(pct); }
            sheetStatus.setText(text);
            if (sheetBtn != null) sheetBtn.setText(pct >= 0 && pct < 100 ? "Скачиваю… " + pct + "%" : text);
        });
    }

    void startDownload(String url, int v) {
        if (sheet == null || !sheet.isShowing()) showUpdate(v, url, prefs.getString("notes_" + v, ""));
        if (sheetBtn != null) { sheetBtn.setEnabled(false); sheetBtn.setAlpha(0.6f); }
        showProgress(-1, "Подключаюсь…");
        new Thread(() -> {
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                c.setInstanceFollowRedirects(true);
                c.setRequestProperty("User-Agent", "HubApp");
                c.setConnectTimeout(15000); c.setReadTimeout(30000);
                int len = c.getContentLength();
                InputStream in = c.getInputStream();
                PackageInstaller pi = getPackageManager().getPackageInstaller();
                PackageInstaller.SessionParams sp = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
                sp.setAppPackageName(getPackageName());
                if (len > 0) sp.setSize(len);
                int sid = pi.createSession(sp);
                PackageInstaller.Session s = pi.openSession(sid);
                OutputStream out = s.openWrite("Hub.apk", 0, len > 0 ? len : -1);
                byte[] buf = new byte[1 << 16]; long done = 0; int n, last = -1;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n); done += n;
                    int pct = len > 0 ? (int) (done * 100 / len) : -1;
                    if (pct != last) { last = pct; showProgress(pct, len > 0 ? String.format("%.1f из %.1f МБ", done / 1048576.0, len / 1048576.0) : "Скачиваю…"); }
                }
                s.fsync(out); out.close(); in.close();
                showProgress(100, "Устанавливаю…");
                prefs.edit().putInt("expectVer", v).apply();
                Intent i = new Intent(this, MainActivity.class).setAction(ACT_INSTALL);
                int fl = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
                PendingIntent pend = PendingIntent.getActivity(this, sid, i, fl);
                s.commit(pend.getIntentSender());
                s.close();
            } catch (Exception e) {
                runOnUiThread(() -> {
                    toast("Не получилось обновить внутри приложения — открою загрузку в браузере");
                    openOutside(Uri.parse(url));
                    if (sheet != null) sheet.dismiss();
                });
            }
        }).start();
    }

    @SuppressWarnings("deprecation")
    void onInstallStatus(Intent i) {
        int st = i.getIntExtra(PackageInstaller.EXTRA_STATUS, -999);
        if (st == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent confirm = i.getParcelableExtra(Intent.EXTRA_INTENT);
            if (confirm != null) { try { startActivity(confirm); } catch (Exception ignored) { } }
        } else if (st == PackageInstaller.STATUS_SUCCESS) {
            if (sheet != null) sheet.dismiss();
        } else {
            String msg = i.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
            toast("Установка не завершилась" + (msg != null ? ": " + msg : ""));
            if (sheetBtn != null) { sheetBtn.setEnabled(true); sheetBtn.setAlpha(1f); sheetBtn.setText("Попробовать ещё раз"); }
        }
    }

    // ---------------------------------------------------------------- «что нового» после обновления
    void showWhatsNewIfUpdated() {
        int cur = versionCode(), seen = prefs.getInt("seenVer", 0);
        prefs.edit().putInt("seenVer", cur).apply();
        if (seen == 0 || cur <= seen || isFinishing()) return;     // первая установка — без поздравлений
        LinearLayout L = sheetBase();
        L.addView(header("Hub обновлён", "Версия 1." + cur));
        String notes = prefs.getString("notes_" + cur, "");
        TextView n = new TextView(this);
        n.setText(notes.isEmpty() ? "Готово — приложение обновлено до последней версии." : notes);
        n.setTextColor(cFg()); n.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15); n.setLineSpacing(dp(3), 1f);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(16);
        L.addView(n, lp);
        TextView ok = pill("Отлично", true);
        LinearLayout.LayoutParams p1 = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52));
        p1.topMargin = dp(20);
        L.addView(ok, p1);
        Dialog d = showSheet(L);
        ok.setOnClickListener(x -> d.dismiss());
    }

    // ---------------------------------------------------------------- мост для сайта
    String lastBar = null;

    class Bridge {
        final WebView owner;
        Bridge(WebView w) { owner = w; }

        @JavascriptInterface
        public String version() { return "1." + versionCode(); }

        @JavascriptInterface
        public void checkUpdate() { runOnUiThread(() -> MainActivity.this.checkUpdate(true)); }

        @JavascriptInterface
        public void bar(String css) {
            if (owner != web) return;                         // фоновый экран не трогает системные полосы
            if (css == null || css.equals(lastBar)) return;   // тот же цвет — ничего не трогаем (иначе телефон перерисовывает экран)
            lastBar = css;
            runOnUiThread(() -> {
                try {
                    String[] p = css.replaceAll("[^0-9,.]", "").split(",");
                    int r = (int) Float.parseFloat(p[0]), g = (int) Float.parseFloat(p[1]), b = (int) Float.parseFloat(p[2]);
                    int c = Color.rgb(r, g, b);
                    Window w = getWindow();
                    w.setStatusBarColor(c);
                    w.setNavigationBarColor(c);
                    boolean light = (0.299 * r + 0.587 * g + 0.114 * b) > 150;
                    View dv = w.getDecorView();
                    int f = dv.getSystemUiVisibility();
                    f = light ? (f | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR) : (f & ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
                    if (Build.VERSION.SDK_INT >= 26)
                        f = light ? (f | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR) : (f & ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
                    if (f != dv.getSystemUiVisibility()) dv.setSystemUiVisibility(f);
                } catch (Exception ignored) { }
            });
        }
    }
}
