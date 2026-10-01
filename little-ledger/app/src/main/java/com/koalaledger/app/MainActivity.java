package com.koalaledger.app;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.AtomicFile;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.HashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final String HOST = "koala-ledger.local";
    private static final int EXPORT_FILE = 201, IMPORT_FILE = 202;
    private WebView webView;
    private LedgerFiles files;
    private final ExecutorService documentWorker = Executors.newSingleThreadExecutor();
    private final ExecutorService rateWorker = Executors.newSingleThreadExecutor();
    private volatile String latestRateRequest = "";
    private byte[] pendingExport;
    private boolean documentBusy;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        FrameLayout frame = new FrameLayout(this);
        frame.setBackgroundColor(Color.rgb(248, 247, 240));
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(248, 247, 240));
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        frame.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        setContentView(frame);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        frame.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets system = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                view.setPadding(system.left, system.top, system.right, system.bottom); return WindowInsets.CONSUMED;
            }
            view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets.consumeSystemWindowInsets();
        });
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setAllowFileAccess(false);
        webView.getSettings().setAllowContentAccess(false);
        webView.getSettings().setSupportMultipleWindows(false);
        webView.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        files = new LedgerFiles(); webView.addJavascriptInterface(files, "LedgerNative");
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return true; }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (!"https".equals(request.getUrl().getScheme()) || !HOST.equals(request.getUrl().getHost())) return rejected();
                String path = request.getUrl().getPath(), asset, mime;
                if ("/".equals(path) || "/index.html".equals(path)) { asset = "index.html"; mime = "text/html"; }
                else if ("/ledger.css".equals(path)) { asset = "ledger.css"; mime = "text/css"; }
                else if ("/bootstrap.js".equals(path) || "/ledger-core.js".equals(path) || "/ledger-en.js".equals(path) || "/ledger-ui.js".equals(path) || "/icons.js".equals(path)) { asset = path.substring(1); mime = "application/javascript"; }
                else if ("/images/koala-avatar.png".equals(path) || "/images/koala-idle.png".equals(path) || "/images/koala-open.png".equals(path) || "/images/koala-wave.png".equals(path) || "/images/category-soft.png".equals(path) || "/images/category-life.png".equals(path) || "/images/category-hobbies.png".equals(path) || "/images/category-money.png".equals(path)) { asset = path.substring(1); mime = "image/png"; }
                else if ("/fonts/zen-maru-gothic-regular.woff2".equals(path) || "/fonts/zen-maru-gothic-medium.woff2".equals(path) || "/fonts/zen-maru-gothic-bold.woff2".equals(path) || "/fonts/noto-sans-kr.woff2".equals(path)) { asset = path.substring(1); mime = "font/woff2"; }
                else return rejected();
                try {
                    HashMap<String, String> headers = new HashMap<>();
                    headers.put("Cache-Control", "no-store");
                    headers.put("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'");
                    return new WebResourceResponse(mime, "UTF-8", 200, "OK", headers, getAssets().open(asset));
                } catch (IOException error) { return rejected(); }
            }
        });
        webView.loadUrl("https://" + HOST + "/index.html");
        if (Build.VERSION.SDK_INT >= 33) getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
    }
    private WebResourceResponse rejected() { return new WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden", null, new ByteArrayInputStream(new byte[0])); }
    @Override public void onBackPressed() { handleBack(); }
    private void handleBack() { webView.evaluateJavascript("Boolean(window.ledgerGoBack && window.ledgerGoBack())", result -> { if (!"true".equals(result)) finish(); }); }
    @Override protected void onResume() {
        super.onResume();
        if (webView != null) webView.evaluateJavascript("window.ledgerRefreshToday && window.ledgerRefreshToday(" + JSONObject.quote(LocalDate.now(ZoneId.of("Asia/Tokyo")).toString()) + ")", null);
    }
    @Override protected void onDestroy() {
        documentWorker.shutdown();
        rateWorker.shutdownNow();
        if (webView != null) { webView.removeJavascriptInterface("LedgerNative"); webView.destroy(); webView = null; }
        super.onDestroy();
    }
    private void javascript(String script) { runOnUiThread(() -> { if (webView != null && !isFinishing()) webView.evaluateJavascript(script, null); }); }
    private void documentResult(String status) {
        runOnUiThread(() -> { documentBusy = false; pendingExport = null; javascript("window.ledgerFileResult && window.ledgerFileResult({status:" + JSONObject.quote(status) + "})"); });
    }
    @Override protected void onActivityResult(int request, int result, Intent intent) {
        super.onActivityResult(request, result, intent);
        if (request != EXPORT_FILE && request != IMPORT_FILE) return;
        if (result != RESULT_OK || intent == null || intent.getData() == null) { documentResult("cancelled"); return; }
        Uri uri = intent.getData(); byte[] exportBytes = pendingExport;
        documentWorker.execute(() -> {
            try {
                if (request == EXPORT_FILE) {
                    if (exportBytes == null) throw new IOException("No pending export");
                    try (OutputStream stream = getContentResolver().openOutputStream(uri, "wt")) { if (stream == null) throw new IOException("No output stream"); stream.write(exportBytes); stream.flush(); }
                    documentResult("success");
                } else {
                    byte[] bytes;
                    try (InputStream stream = getContentResolver().openInputStream(uri)) { if (stream == null) throw new IOException("No input stream"); bytes = boundedRead(stream); }
                    String text = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
                    if (text.startsWith("\uFEFF")) text = text.substring(1);
                    String imported = text;
                    runOnUiThread(() -> { documentBusy = false; javascript("window.ledgerImportReady && window.ledgerImportReady(" + JSONObject.quote(imported) + ")"); });
                }
            } catch (Exception error) { documentResult("error"); }
        });
    }
    private static byte[] boundedRead(InputStream stream) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream(); byte[] buffer = new byte[8192]; int length;
        while ((length = stream.read(buffer)) != -1) { if (out.size() + length > LedgerValidator.MAX_BYTES) throw new IOException("File too large"); out.write(buffer, 0, length); }
        return out.toByteArray();
    }

    public final class LedgerFiles {
        // Keep the original filename so an in-place update opens the existing ledger.
        private final AtomicFile dataFile = new AtomicFile(new File(getFilesDir(), "ledger-v1.json"));
        private final AtomicFile legacyFile = new AtomicFile(new File(getFilesDir(), "ledger-legacy-v1.json"));
        private final AtomicFile previousVersionFile = new AtomicFile(new File(getFilesDir(), "ledger-before-multicurrency.json"));
        private final AtomicFile previousSchemaFile = new AtomicFile(new File(getFilesDir(), "ledger-before-v4.json"));
        private final AtomicFile previousCollectionFile = new AtomicFile(new File(getFilesDir(), "ledger-before-v5.json"));
        private final AtomicFile previousCurrencyFile = new AtomicFile(new File(getFilesDir(), "ledger-before-currency-switch.json"));
        private final AtomicFile quoteCacheFile = new AtomicFile(new File(getFilesDir(), "exchange-quotes.json"));
        private final AtomicFile restoreFile = new AtomicFile(new File(getFilesDir(), "ledger-before-restore.json"));
        private boolean exists(AtomicFile file) { return file.getBaseFile().exists() || new File(file.getBaseFile().getPath() + ".bak").exists(); }
        private String rawData() throws IOException { return exists(dataFile) ? new String(dataFile.readFully(), StandardCharsets.UTF_8) : "{\"version\":1,\"currency\":\"JPY\",\"transactions\":[],\"budgets\":{}}"; }
        private void atomicWrite(AtomicFile file, byte[] data) throws IOException {
            FileOutputStream stream = null;
            try { stream = file.startWrite(); stream.write(data); file.finishWrite(stream); }
            catch (IOException error) { if (stream != null) file.failWrite(stream); throw error; }
        }
        private byte[] checked(String data) throws Exception {
            if (data == null || data.length() > LedgerValidator.MAX_BYTES) throw new IOException("File too large");
            byte[] bytes = data.getBytes(StandardCharsets.UTF_8); if (bytes.length > LedgerValidator.MAX_BYTES) throw new IOException("File too large");
            LedgerValidator.validate(new JSONObject(data)); return bytes;
        }
        private void preserveLegacy() throws Exception {
            if (exists(dataFile)) {
                byte[] bytes = dataFile.readFully();
                int version = new JSONObject(new String(bytes, StandardCharsets.UTF_8)).getInt("version");
                if (version == 1 && !exists(legacyFile)) atomicWrite(legacyFile, bytes);
                if (version < 3 && !exists(previousVersionFile)) atomicWrite(previousVersionFile, bytes);
                if (version < 4 && !exists(previousSchemaFile)) atomicWrite(previousSchemaFile, bytes);
                if (version < 5 && !exists(previousCollectionFile)) atomicWrite(previousCollectionFile, bytes);
            }
        }
        private void preserveCurrency(String nextData) throws Exception {
            if (!exists(dataFile)) return;
            byte[] bytes = dataFile.readFully();
            if (LedgerValidator.hasCurrencyChange(new JSONObject(new String(bytes, StandardCharsets.UTF_8)), new JSONObject(nextData))) atomicWrite(previousCurrencyFile, bytes);
        }
        private synchronized void rememberQuote(JSONObject quote) {
            try {
                JSONObject cache;
                try { cache = new JSONObject(new String(quoteCacheFile.readFully(), StandardCharsets.UTF_8)); }
                catch (Exception unavailable) { cache = new JSONObject(); }
                cache.put(quote.getString("currency") + "_" + quote.getString("base"), quote);
                atomicWrite(quoteCacheFile, cache.toString().getBytes(StandardCharsets.UTF_8));
            } catch (Exception ignored) { /* A successful quote can still be used for this record. */ }
        }
        private synchronized JSONObject cachedQuote(String source, String target) throws Exception {
            byte[] bytes = quoteCacheFile.readFully();
            if (bytes.length > 65536) throw new IOException("Invalid quote cache");
            JSONObject cache = new JSONObject(new String(bytes, StandardCharsets.UTF_8)).getJSONObject(source + "_" + target);
            return ExchangeRateClient.fromCache(cache.toString(), source, target);
        }
        @JavascriptInterface public void requestExchangeRate(String source, String target, String requestId) {
            if (!ExchangeRateClient.supported(source) || !ExchangeRateClient.supported(target) || source.equals(target) || requestId == null || !requestId.matches("[A-Za-z0-9_-]{1,80}")) return;
            latestRateRequest = requestId;
            final long requestedAt = System.currentTimeMillis();
            rateWorker.execute(() -> {
                if (!requestId.equals(latestRateRequest)) return;
                JSONObject result;
                try { result = ExchangeRateClient.fetch(source, target).put("updatedAt", requestedAt); rememberQuote(result); }
                catch (Exception error) {
                    try { result = cachedQuote(source, target); }
                    catch (Exception noCache) {
                        result = new JSONObject();
                        try { result.put("currency", source).put("base", target).put("status", "error"); } catch (Exception ignored) { return; }
                    }
                }
                try { result.put("id", requestId); } catch (Exception ignored) { return; }
                javascript("window.ledgerRateReady && window.ledgerRateReady(" + result + ")");
            });
        }
        @JavascriptInterface public String today() { return LocalDate.now(ZoneId.of("Asia/Tokyo")).toString(); }
        @JavascriptInterface public synchronized String readData() {
            try { String data = rawData(); checked(data); return data; }
            catch (Exception error) { return "{\"error\":\"read_failed\"}"; }
        }
        @JavascriptInterface public synchronized boolean writeData(String data) {
            try { byte[] bytes = checked(data); preserveLegacy(); preserveCurrency(data); atomicWrite(dataFile, bytes); return true; }
            catch (Exception error) { return false; }
        }
        @JavascriptInterface public synchronized boolean restoreData(String data) {
            try {
                byte[] bytes = checked(data);
                // Snapshot raw bytes even when the original cannot be parsed; never erase that evidence.
                atomicWrite(restoreFile, rawData().getBytes(StandardCharsets.UTF_8));
                try { preserveLegacy(); } catch (Exception invalidOriginal) { /* The raw snapshot above is the recovery copy. */ }
                atomicWrite(dataFile, bytes); return true;
            } catch (Exception error) { return false; }
        }
        @JavascriptInterface public synchronized boolean hasRestoreSnapshot() {
            try { if (!exists(restoreFile)) return false; checked(new String(restoreFile.readFully(), StandardCharsets.UTF_8)); return true; }
            catch (Exception error) { return false; }
        }
        @JavascriptInterface public synchronized String undoRestore() {
            try {
                String data = new String(restoreFile.readFully(), StandardCharsets.UTF_8); byte[] bytes = checked(data);
                atomicWrite(dataFile, bytes); restoreFile.delete(); return data;
            } catch (Exception error) { return "{\"error\":\"undo_failed\"}"; }
        }
        private String exportFilename(String kind) {
            String language = "zh";
            try {
                JSONObject stored = new JSONObject(rawData());
                JSONObject preferences = stored.optJSONObject(stored.optInt("version") == 5 ? "preferences" : "design");
                if (preferences != null) language = preferences.optString("language", "zh");
            } catch (Exception ignored) { /* An export can still use a default filename. */ }
            boolean backup = "backup".equals(kind);
            String label = "en".equals(language) ? "Little-Ledger-" + (backup ? "Backup-" : "Details-") : "ja".equals(language) ? "ちいさな帳簿-" + (backup ? "バックアップ-" : "明細-") : "ko".equals(language) ? "꼬마가계부-" + (backup ? "백업-" : "내역-") : "小小账本-" + (backup ? "备份-" : "明细-");
            return label + today() + (backup ? ".json" : ".csv");
        }
        @JavascriptInterface public void exportDocument(String kind, String payload) {
            try {
                byte[] bytes = payload.getBytes(StandardCharsets.UTF_8);
                if (bytes.length > LedgerValidator.MAX_BYTES || (!"backup".equals(kind) && !"csv".equals(kind))) throw new IOException("Invalid export");
                if ("backup".equals(kind)) LedgerValidator.backup(payload);
                String filename = exportFilename(kind);
                runOnUiThread(() -> {
                    if (documentBusy) return;
                    documentBusy = true; pendingExport = bytes;
                    Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("backup".equals(kind) ? "application/json" : "text/csv");
                    intent.putExtra(Intent.EXTRA_TITLE, filename);
                    try { startActivityForResult(intent, EXPORT_FILE); } catch (Exception error) { documentResult("error"); }
                });
            } catch (Exception error) { documentResult("error"); }
        }
        @JavascriptInterface public void requestImport() {
            runOnUiThread(() -> {
                if (documentBusy) return;
                documentBusy = true;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
                intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/json", "text/plain", "application/octet-stream"});
                try { startActivityForResult(intent, IMPORT_FILE); } catch (Exception error) { documentResult("error"); }
            });
        }
    }
}
