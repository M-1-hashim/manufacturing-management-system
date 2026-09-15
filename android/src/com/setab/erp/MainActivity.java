package com.setab.erp;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.MediaScannerConnection;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * سِتب — نسخهٔ اندروید «کاملاً مستقل» (آفلاین)
 * ---------------------------------------------------------------
 * کل برنامهٔ وب (همهٔ ۱۳ ماژول) به‌صورت استاتیک داخل همین APK باندل شده است
 * (android/assets/app) و هیچ هاست/سروری لازم نیست؛ دیتا در حافظهٔ خود
 * دستگاه (localStorage داخل WebView) ذخیره می‌شود.
 *
 * ترفند فنی: صفحه از آدرس جعلی http://localhost/index.html بارگذاری می‌شود
 * (تا crypto.subtle و localStorage در بستر امن کار کنند) و همهٔ درخواست‌ها
 * در shouldInterceptRequest از assets خوانده می‌شوند. درخواست‌های /api/*
 * نیز توسط موتور JS داخل صفحه (src/lib/local-api) پاسخ داده می‌شوند و به
 * شبکه نمی‌روند.
 *
 * ذخیرهٔ فایل (کاپی احتیاطی JSON): پل AndroidBridge.saveFile(name, base64)
 * فایل را در پوشهٔ Downloads دستگاه می‌نویسد.
 */
public class MainActivity extends Activity {

    private static final String START_URL = "http://localhost/index.html";
    private static final String ASSET_ROOT = "app/";
    private static final int FILE_REQ = 71;
    private static final int PERM_REQ = 51;

    private static final int COLOR_BG = 0xFFF3F6F4;

    private FrameLayout root;
    private WebView web;

    private ValueCallback<Uri[]> fileUpload;
    private long lastBack = 0;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        root = new FrameLayout(this);
        root.setBackgroundColor(COLOR_BG);

        web = buildWebView();
        root.addView(web, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        setContentView(root);

        // اجازهٔ نوشتن در Downloads برای اندروید ۷ تا ۹
        if (Build.VERSION.SDK_INT <= 28) {
            requestPermissions(new String[]{"android.permission.WRITE_EXTERNAL_STORAGE"}, PERM_REQ);
        }

        web.loadUrl(START_URL);
    }

    // ---------------- WebView ----------------

    @SuppressLint("SetJavaScriptEnabled")
    private WebView buildWebView() {
        WebView w = new WebView(this);
        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        // حیاتی: localStorage/IndexedDB — دیتای برنامه روی همین دستگاه ذخیره می‌شود
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setTextZoom(100);
        // تشخیص اپ اندروید در برنامه (برای پنهان کردن کارت‌های دانلود ویندوز)
        s.setUserAgentString(s.getUserAgentString() + " SetabAndroid/1.0");
        CookieManager.getInstance().setAcceptCookie(true);

        // پل Java ↔ JS — ذخیرهٔ کاپی احتیاطی در Downloads
        w.addJavascriptInterface(new Bridge(), "AndroidBridge");

        w.setWebViewClient(new WebViewClient() {

            // سرو کردن کل برنامه از assets — بدون هیچ سرور
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest req) {
                Uri u = req.getUrl();
                String host = u.getHost();
                if (!"localhost".equals(host)) return null; // درخواست خارجی — عادی پیش برود

                String path = u.getPath();
                if (path == null || path.isEmpty() || "/".equals(path)) path = "/index.html";
                if (path.contains("..")) return notFound(); // امنیت: خروج از ریشه ممنوع

                // مسیرهای API باید توسط موتور JS پاسخ بگیرند؛ اگر زودتر رسیدند (قبل از نصب پچ)
                // یک پاسخ JSON 404 تمیز برگردانیم — صفحهٔ HTML اشتباه نشان داده نشود
                if (path.startsWith("api/")) return notFound();

                try {
                    InputStream is = getAssets().open(ASSET_ROOT + path.substring(1));
                    Map<String, String> headers = new HashMap<>();
                    // فایل‌های استاتیک هش‌دار برای همیشه کش می‌شوند؛ بقیه همیشه تازه
                    headers.put("Cache-Control",
                            path.startsWith("/_next/static/")
                                    ? "public, max-age=31536000, immutable"
                                    : "no-cache");
                    String charset = isTextMime(path) ? "utf-8" : null;
                    WebResourceResponse resp =
                            new WebResourceResponse(guessMime(path), charset, 200, "OK", headers, is);
                    return resp;
                } catch (IOException e) {
                    return notFound();
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView v, String url) {
                Uri u = Uri.parse(url);
                String sch = u.getScheme() == null ? "" : u.getScheme();
                if (sch.equals("http") || sch.equals("https")) return false; // داخل اپ بماند
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) {}
                return true; // tel:/mailto:/whatsapp و... به بیرون
            }
        });

        w.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (fileUpload != null) fileUpload.onReceiveValue(null);
                fileUpload = cb;
                try {
                    startActivityForResult(p.createIntent(), FILE_REQ);
                } catch (Exception e) {
                    fileUpload = null;
                    return false;
                }
                return true;
            }
        });

        // دانلودها: data: URL (پشتیبان JSON) مستقیم ذخیره می‌شود؛ blob: پشتیبانی نمی‌شود
        w.setDownloadListener((url, ua, contentDisposition, mimetype, contentLength) -> {
            try {
                if (url.startsWith("data:") && url.contains(";base64,")) {
                    int comma = url.indexOf(',');
                    byte[] bytes = Base64.decode(url.substring(comma + 1), Base64.DEFAULT);
                    String name = URLUtil.guessFileName(url, contentDisposition, mimetype);
                    saveBytesToDownloads(name, bytes);
                    return;
                }
                if (url.startsWith("blob:")) {
                    Toast.makeText(MainActivity.this,
                            "ذخیرهٔ این فایل ممکن نیست — از پشتیبان‌گیری JSON استفاده کنید",
                            Toast.LENGTH_LONG).show();
                    return;
                }
                // http/https — مسیر کلاسیک (برای سازگاری آینده)
                DownloadManager.Request r = new DownloadManager.Request(Uri.parse(url));
                r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                String name = URLUtil.guessFileName(url, contentDisposition, mimetype);
                r.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
                if (ua != null) r.addRequestHeader("User-Agent", ua);
                String ck = CookieManager.getInstance().getCookie(url);
                if (ck != null) r.addRequestHeader("Cookie", ck);
                ((DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE)).enqueue(r);
                Toast.makeText(this, "دانلود شروع شد: " + name, Toast.LENGTH_SHORT).show();
            } catch (Exception e) {
                Toast.makeText(this, "ذخیرهٔ فایل ناموفق بود", Toast.LENGTH_SHORT).show();
            }
        });
        return w;
    }

    // ---------------- MIME ----------------

    private static boolean isTextMime(String path) {
        String p = path.toLowerCase();
        return p.endsWith(".html") || p.endsWith(".js") || p.endsWith(".css")
                || p.endsWith(".json") || p.endsWith(".svg") || p.endsWith(".txt")
                || p.endsWith(".map") || p.endsWith(".webmanifest");
    }

    private static String guessMime(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".html") || p.endsWith(".htm")) return "text/html";
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "application/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".json") || p.endsWith(".map")) return "application/json";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".gif")) return "image/gif";
        if (p.endsWith(".webp")) return "image/webp";
        if (p.endsWith(".ico")) return "image/x-icon";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".woff")) return "font/woff";
        if (p.endsWith(".ttf")) return "font/ttf";
        if (p.endsWith(".otf")) return "font/otf";
        if (p.endsWith(".txt")) return "text/plain";
        if (p.endsWith(".webmanifest")) return "application/manifest+json";
        return "application/octet-stream";
    }

    private WebResourceResponse notFound() {
        String body = "{\"error\":\"فایل یا مسیر درخواستی یافت نشد\"}";
        Map<String, String> headers = new HashMap<>();
        headers.put("Content-Type", "application/json; charset=utf-8");
        headers.put("Cache-Control", "no-store");
        try {
            return new WebResourceResponse("application/json", "utf-8", 404, "Not Found",
                    headers, new java.io.ByteArrayInputStream(body.getBytes("UTF-8")));
        } catch (Exception e) {
            return null;
        }
    }

    // ---------------- ذخیرهٔ فایل در Downloads ----------------

    /** ذخیرهٔ بایت‌ها در پوشهٔ Downloads — اندروید ۱۰+ با MediaStore، قدیمی‌تر با فایل مستقیم */
    private void saveBytesToDownloads(String name, byte[] bytes) {
        try {
            String safeName = name.replaceAll("[^a-zA-Z0-9._\\-\u0600-\u06FF]", "_");
            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues cv = new ContentValues();
                cv.put(MediaStore.Downloads.DISPLAY_NAME, safeName);
                cv.put(MediaStore.Downloads.MIME_TYPE, "application/json");
                cv.put(MediaStore.Downloads.IS_PENDING, 1);
                Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                if (uri == null) throw new IOException("insert failed");
                OutputStream os = getContentResolver().openOutputStream(uri);
                if (os == null) throw new IOException("stream null");
                os.write(bytes);
                os.flush();
                os.close();
                ContentValues done = new ContentValues();
                done.put(MediaStore.Downloads.IS_PENDING, 0);
                getContentResolver().update(uri, done, null, null);
            } else {
                File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                if (!dir.exists()) dir.mkdirs();
                File f = new File(dir, safeName);
                FileOutputStream fos = new FileOutputStream(f);
                fos.write(bytes);
                fos.flush();
                fos.close();
                MediaScannerConnection.scanFile(this, new String[]{f.getAbsolutePath()}, null, null);
            }
            Toast.makeText(this, "در Downloads ذخیره شد: " + safeName, Toast.LENGTH_LONG).show();
        } catch (Exception e) {
            Toast.makeText(this, "ذخیرهٔ فایل ناموفق بود", Toast.LENGTH_LONG).show();
        }
    }

    /** پل Java ↔ JS — از src/lib/local-api/bridge.ts صدا زده می‌شود */
    private class Bridge {
        @JavascriptInterface
        public boolean saveFile(String name, String base64) {
            try {
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                saveBytesToDownloads(name, bytes);
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public void toast(String msg) {
            if (msg == null) return;
            runOnUiThread(() -> Toast.makeText(MainActivity.this, msg, Toast.LENGTH_SHORT).show());
        }
    }

    // ---------------- چرخهٔ حیات ----------------

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        if (req == FILE_REQ && fileUpload != null) {
            fileUpload.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(res, data));
            fileUpload = null;
            return;
        }
        super.onActivityResult(req, res, data);
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) {
            web.goBack();
            return;
        }
        long now = System.currentTimeMillis();
        if (now - lastBack < 2000) {
            super.onBackPressed();
        } else {
            lastBack = now;
            Toast.makeText(this, "برای خروج دوباره برگشت را بزنید", Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
