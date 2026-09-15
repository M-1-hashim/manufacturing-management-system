package com.setab.erp;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.SslErrorHandler;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;

/**
 * سِتب — نسخهٔ اندروید
 * WebView تمام‌صفحه که به سرور سِتب وصل می‌شود؛ بدون نیاز به نسخهٔ ویندوز.
 * - اولین اجرا: پنجرهٔ وارد کردن آدرس سرور (ذخیرهٔ دائمی)
 * - دکمهٔ ⚙ پایین صفحه: تغییر آدرس سرور در هر زمان
 * - دانلود فایل‌ها با DownloadManager (بل/فایل‌ها به Downloads می‌روند)
 * - دکمهٔ برگشت: عقب در صفحه، با دوبار زدن خارج می‌شود
 */
public class MainActivity extends Activity {

    private static final String PREFS = "setab_prefs";
    private static final String KEY_URL = "server_url";
    private static final int FILE_REQ = 71;
    private static final int PERM_REQ = 51;

    private WebView web;
    private ValueCallback<Uri[]> fileUpload;
    private long lastBack = 0;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#F3F6F4"));

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setTextZoom(100);
        // تشخیص اپ در سرور (برای پنهان کردن دکمه‌های دانلود ویندوز)
        s.setUserAgentString(s.getUserAgentString() + " SetabAndroid/1.0");
        // سرورهای شبکهٔ محلی با http یا گواهی self-signed کار می‌کنند
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        CookieManager.getInstance().setAcceptCookie(true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, String url) {
                Uri u = Uri.parse(url);
                String sch = u.getScheme() == null ? "" : u.getScheme();
                if (sch.equals("http") || sch.equals("https")) return false; // داخل اپ بماند
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) {}
                return true; // tel:/mailto:/whatsapp و... به بیرون
            }

            @Override
            public void onReceivedSslError(WebView v, SslErrorHandler handler, android.net.http.SslError error) {
                handler.proceed(); // شبکهٔ محلی با گواهی شخصی
            }

            @Override
            public void onReceivedError(WebView v, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) {
                    String desc = err.getDescription() == null ? "" : String.valueOf(err.getDescription());
                    showErrorPage(desc);
                }
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
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

        web.setDownloadListener((url, ua, contentDisposition, mimetype, contentLength) -> {
            try {
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
                try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Exception ignored) {}
            }
        });

        root.addView(web, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        // دکمهٔ تغییر آدرس سرور (⚙) — گوشهٔ پایین
        TextView gear = new TextView(this);
        gear.setText("\u2699");
        gear.setTextSize(20);
        gear.setTextColor(Color.WHITE);
        gear.setGravity(Gravity.CENTER);
        GradientDrawable gbg = new GradientDrawable();
        gbg.setShape(GradientDrawable.OVAL);
        gbg.setColor(0x66000000);
        gear.setBackground(gbg);
        int px = dp(40);
        FrameLayout.LayoutParams gp = new FrameLayout.LayoutParams(px, px, Gravity.BOTTOM | Gravity.START);
        gp.setMargins(dp(12), 0, dp(12), dp(16));
        root.addView(gear, gp);
        gear.setOnClickListener(v -> promptServerUrl(false));

        setContentView(root);

        // اجازهٔ دانلود برای اندروید ۷ تا ۹
        if (Build.VERSION.SDK_INT <= 28) {
            requestPermissions(new String[]{"android.permission.WRITE_EXTERNAL_STORAGE"}, PERM_REQ);
        }

        String saved = getSharedPreferences(PREFS, MODE_PRIVATE).getString(KEY_URL, "");
        if (saved == null || saved.isEmpty()) promptServerUrl(true);
        else web.loadUrl(saved);
    }

    private void showErrorPage(String desc) {
        String html = "<!DOCTYPE html><html><head><meta name='viewport' content='width=device-width, initial-scale=1'></head>"
                + "<body style='font-family:sans-serif;text-align:center;padding-top:64px;direction:rtl;background:#F3F6F4'>"
                + "<div style='font-size:44px'>&#9888;</div>"
                + "<h2 style='color:#b91c1c'>اتصال به سرور ممکن نشد</h2>"
                + "<p style='color:#374151;padding:0 24px'>به سرور سِتب وصل نشدیم.<br/>"
                + "اینترنت یا شبکهٔ وای‌فای را بررسی کنید؛ از دکمهٔ &#9881; پایین صفحه می‌توانید آدرس سرور را عوض کنید.</p>"
                + "<p style='color:#6b7280;font-size:12px'>" + desc.replaceAll("<", "&lt;") + "</p>"
                + "</body></html>";
        web.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
    }

    private void promptServerUrl(final boolean firstRun) {
        AlertDialog.Builder ab = new AlertDialog.Builder(this);
        ab.setTitle(firstRun ? "به سِتب خوش آمدید" : "آدرس سرور");
        ab.setMessage(firstRun
                ? "آدرس سروری که سیستم سِتب روی آن اجراست را وارد کنید (همان آدرسی که در مرورگر استفاده می‌شود):"
                : "آدرس سرور سِتب:");
        final EditText et = new EditText(this);
        et.setTextDirection(View.TEXT_DIRECTION_FIRST_STRONG);
        et.setHint("http://192.168.1.10:3000");
        et.setSingleLine(true);
        String cur = getSharedPreferences(PREFS, MODE_PRIVATE).getString(KEY_URL, "");
        et.setText(cur == null ? "" : cur);
        ab.setView(et);
        ab.setCancelable(false);
        ab.setPositiveButton("وصل شدن", (d, w) -> {
            String url = et.getText().toString().trim();
            if (url.isEmpty()) return;
            if (!url.startsWith("http://") && !url.startsWith("https://")) url = "http://" + url;
            if (!url.endsWith("/")) url = url + "/";
            getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(KEY_URL, url).apply();
            web.loadUrl(url);
        });
        ab.setNegativeButton(firstRun ? "خروج" : "لغو", (d, w) -> { if (firstRun) finish(); });
        ab.show();
    }

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

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
