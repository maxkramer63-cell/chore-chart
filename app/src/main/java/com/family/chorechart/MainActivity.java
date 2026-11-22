package com.family.chorechart;

import android.app.Activity;
import android.app.UiModeManager;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Full-screen TV app: shows the chore board and talks to the family's Google Apps Script backend. */
public class MainActivity extends Activity {
    private WebView web;
    private boolean isTv;
    private final ExecutorService pool = Executors.newFixedThreadPool(2);

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        isTv = detectTv();
        if (isTv) getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN, WindowManager.LayoutParams.FLAG_FULLSCREEN);
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(true);
        web.setBackgroundColor(0xFF0F172A);
        web.setWebViewClient(new WebViewClient());
        web.setWebChromeClient(new WebChromeClient()); // lets confirm() pop-ups show
        web.addJavascriptInterface(new Bridge(), "Native");
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);
        setContentView(web);
        web.loadUrl("file:///android_asset/index.html");
        web.requestFocus(View.FOCUS_DOWN);
    }

    /** Fire TV / Android TV get the chore board; phones get parent mode. */
    private boolean detectTv() {
        PackageManager pm = getPackageManager();
        UiModeManager ui = (UiModeManager) getSystemService(UI_MODE_SERVICE);
        if (ui != null && ui.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION) return true;
        if (pm.hasSystemFeature("amazon.hardware.fire_tv")) return true;
        if (pm.hasSystemFeature(PackageManager.FEATURE_LEANBACK)) return true;
        return !pm.hasSystemFeature(PackageManager.FEATURE_TOUCHSCREEN);
    }

    @Override
    public void onBackPressed() {
        if (web == null) { super.onBackPressed(); return; }
        // Back closes a pop-up first; only exits when nothing is open
        web.evaluateJavascript("(window.handleBack ? window.handleBack() : 0)", v -> { if (!"1".equals(v)) finish(); });
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) {
            web.requestFocus();
            web.evaluateJavascript("window.refresh && window.S && refresh();", null);
        }
    }

    @Override
    protected void onDestroy() {
        pool.shutdownNow();
        if (web != null) web.destroy();
        super.onDestroy();
    }

    class Bridge {
        @JavascriptInterface
        public String version() { return BuildConfig.VERSION_NAME; }

        @JavascriptInterface
        public String mode() { return isTv ? "tv" : "parent"; }

        @JavascriptInterface
        public void call(final String id, final String fn, final String argsJson) {
            pool.execute(() -> {
                String reply;
                try {
                    reply = post(fn, argsJson);
                } catch (Exception e) {
                    reply = "{\"ok\":false,\"error\":" + JSONObject.quote(friendly(e)) + "}";
                }
                final String js = "window.__nativeCb(" + JSONObject.quote(id) + "," + reply + ");";
                runOnUiThread(() -> { if (web != null) web.evaluateJavascript(js, null); });
            });
        }
    }

    private static String friendly(Exception e) {
        String m = e.getMessage();
        if (e instanceof java.net.UnknownHostException) return "No internet connection";
        return m == null ? e.getClass().getSimpleName() : m;
    }

    /** POST {fn,args} to the Apps Script web app; it answers with a redirect to the JSON result. */
    private String post(String fn, String argsJson) throws Exception {
        String base = BuildConfig.WEB_APP_URL;
        if (base == null || base.isEmpty()) throw new Exception("App not set up yet: WEB_APP_URL is missing");
        String body = "{\"fn\":" + JSONObject.quote(fn) + ",\"args\":" + (argsJson == null ? "[]" : argsJson) + "}";

        HttpURLConnection c = (HttpURLConnection) new URL(base).openConnection();
        c.setInstanceFollowRedirects(false);
        c.setConnectTimeout(15000);
        c.setReadTimeout(30000);
        c.setRequestMethod("POST");
        c.setDoOutput(true);
        c.setRequestProperty("Content-Type", "text/plain;charset=utf-8");
        try (OutputStream o = c.getOutputStream()) { o.write(body.getBytes(StandardCharsets.UTF_8)); }

        int code = c.getResponseCode();
        int hops = 0;
        while ((code == 301 || code == 302 || code == 303 || code == 307 || code == 308) && hops++ < 5) {
            String loc = c.getHeaderField("Location");
            c.disconnect();
            c = (HttpURLConnection) new URL(new URL(base), loc).openConnection();
            c.setInstanceFollowRedirects(true);
            c.setConnectTimeout(15000);
            c.setReadTimeout(30000);
            code = c.getResponseCode();
        }
        InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
        String text = read(in).trim();
        c.disconnect();
        if (!text.startsWith("{")) {
            throw new Exception("Chore server didn't answer correctly (HTTP " + code + "). Check the web app is deployed with access: Anyone.");
        }
        new JSONObject(text); // make sure it's valid JSON before handing it to the page
        return text;
    }

    private static String read(InputStream in) throws Exception {
        if (in == null) return "";
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) b.write(buf, 0, n);
        in.close();
        return b.toString("UTF-8");
    }
}
