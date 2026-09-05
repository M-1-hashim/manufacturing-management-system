package af.mfg.erp;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Bundle;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;
import android.webkit.DownloadListener;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.Toast;

/**
 * مدیریت تولید — نسخه اندروید (WebView)
 * به سرور محلی روی کامپیوتر (همان شبکه) وصل می‌شود؛ آدرس سرور قابل تغییر است.
 */
public class MainActivity extends Activity {

    private static final String DEFAULT_URL = "http://192.168.1.10:3000";
    private static final String PREFS = "mfg_erp";
    private static final String KEY_URL = "server_url";

    private WebView web;
    private ProgressBar progress;
    private ScrollView errorBox;
    private SharedPreferences prefs;
    private String serverUrl;
    private long lastBackAt = 0;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        serverUrl = prefs.getString(KEY_URL, null);
        setContentView(R.layout.activity_main);

        web = (WebView) findViewById(R.id.web);
        progress = (ProgressBar) findViewById(R.id.progress);
        errorBox = (ScrollView) findViewById(R.id.error_box);

        Button retry = (Button) findViewById(R.id.btn_retry);
        Button change = (Button) findViewById(R.id.btn_change);
        retry.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { hideError(); reload(); }
        });
        change.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { promptServerUrl(); }
        });

        if (serverUrl == null) {
            showServerError();
        } else {
            setupWebView();
        }
    }

    private void setupWebView() {
        setTitle(R.string.app_name);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        if (Build.VERSION.SDK_INT >= 21) {
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                // همه‌چیز داخل برنامه باز می‌شود
                return false;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) showServerError();
            }

            @SuppressWarnings("deprecation")
            @Override
            public void onReceivedError(WebView view, int code, String desc, String failingUrl) {
                if (failingUrl != null && failingUrl.equals(serverUrl)) showServerError();
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (url != null && !url.startsWith("data:")) hideError();
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                if (newProgress >= 100) {
                    progress.setVisibility(View.GONE);
                } else {
                    progress.setVisibility(View.VISIBLE);
                    progress.setProgress(newProgress);
                }
            }
        });

        web.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String ua, String cd, String mime, long len) {
                Toast.makeText(MainActivity.this, R.string.blob_download_note, Toast.LENGTH_LONG).show();
            }
        });

        loadServer();
    }

    private void loadServer() {
        hideError();
        if (serverUrl != null && web != null) {
            web.loadUrl(serverUrl);
        }
    }

    private void reload() {
        if (serverUrl == null) {
            promptServerUrl();
        } else {
            loadServer();
        }
    }

    private void showServerError() {
        errorBox.setVisibility(View.VISIBLE);
    }

    private void hideError() {
        errorBox.setVisibility(View.GONE);
    }

    // ---------- دیالوگ آدرس سرور ----------

    private void promptServerUrl() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (18 * getResources().getDisplayMetrics().density);
        box.setPadding(pad, pad / 2, pad, 0);

        final EditText input = new EditText(this);
        input.setSingleLine(true);
        input.setTextDirection(View.TEXT_DIRECTION_LTR);
        input.setText(serverUrl != null ? serverUrl : DEFAULT_URL);
        input.setSelection(input.getText().length());
        box.addView(input);

        android.widget.TextView help = new android.widget.TextView(this);
        help.setText(R.string.server_dlg_help);
        help.setTextSize(13);
        help.setPadding(0, pad / 2, 0, 0);
        box.addView(help);

        new AlertDialog.Builder(this)
                .setTitle(R.string.server_dlg_title)
                .setView(box)
                .setPositiveButton(R.string.server_dlg_ok, new android.content.DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(android.content.DialogInterface dlg, int which) {
                        String url = normalizeUrl(input.getText().toString());
                        if (url == null) {
                            Toast.makeText(MainActivity.this, "آدرس نامعتبر است", Toast.LENGTH_SHORT).show();
                            return;
                        }
                        serverUrl = url;
                        prefs.edit().putString(KEY_URL, url).apply();
                        if (web == null) {
                            setupWebView();
                        } else {
                            loadServer();
                        }
                        Toast.makeText(MainActivity.this, url, Toast.LENGTH_SHORT).show();
                    }
                })
                .setNegativeButton(R.string.server_dlg_cancel, null)
                .show();
    }

    private static String normalizeUrl(String raw) {
        if (raw == null) return null;
        String url = raw.trim();
        if (url.length() == 0) return null;
        if (!url.contains("://")) url = "http://" + url;
        while (url.endsWith("/")) url = url.substring(0, url.length() - 1);
        return url;
    }

    // ---------- منو ----------

    @Override
    public boolean onCreateOptionsMenu(Menu menu) {
        menu.add(Menu.NONE, 1, Menu.NONE, R.string.menu_reload);
        menu.add(Menu.NONE, 2, Menu.NONE, R.string.menu_server);
        menu.add(Menu.NONE, 3, Menu.NONE, R.string.menu_exit);
        return true;
    }

    @Override
    public boolean onOptionsItemSelected(MenuItem item) {
        switch (item.getItemId()) {
            case 1: reload(); return true;
            case 2: promptServerUrl(); return true;
            case 3: finishAffinity(); return true;
        }
        return super.onOptionsItemSelected(item);
    }

    // ---------- دکمه برگشت ----------

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) {
            web.goBack();
            return;
        }
        long now = System.currentTimeMillis();
        if (now - lastBackAt < 2200) {
            super.onBackPressed();
        } else {
            lastBackAt = now;
            Toast.makeText(this, R.string.exit_confirm, Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.destroy();
        }
        super.onDestroy();
    }
}
