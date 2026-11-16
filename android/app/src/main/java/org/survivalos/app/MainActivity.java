package org.survivalos.app;

import android.Manifest;
import android.animation.ObjectAnimator;
import android.animation.ValueAnimator;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.ActivityManager;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.provider.Settings;
import android.text.format.Formatter;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.view.animation.DecelerateInterpolator;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import android.window.OnBackInvokedDispatcher;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.List;

/**
 * Ventana de Survivelia OS (ADR 0020): la interfaz web a pantalla completa en una WebView, más lo que solo una
 * Activity puede hacer (elegir carpeta de datos, pedir permisos, fijar la pantalla, abrir el instalador).
 */
public final class MainActivity extends Activity implements SurvivalService.Listener {
    static volatile MainActivity current;

    private static final int REQ_FILES = 10;
    private static final int REQ_CHOOSER = 11;
    private static final int REQ_LOCATION = 12;
    private static final int REQ_NOTIFICATIONS = 13;
    private static final String KEY_ONBOARDED = "onboarded";

    private WebView web;
    private View splash;
    /** Halo del icono en la pantalla de arranque: se para al mostrarse la interfaz. */
    private ObjectAnimator glowAnim;
    private TextView status;
    private ProgressBar bar;
    private LinearLayout actions;
    private String loadedUrl;
    private ValueCallback<Uri[]> fileCallback;
    /** Carpeta elegida a la espera del permiso «todos los archivos». */
    private String pendingDir;

    // ------------------------------------------------------------------ ciclo de vida

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        current = this;
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        buildUi();
        immersive();
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::back);
        }
        if (Storage.dataDir(this) == null) chooseStorage();
        else start();
    }

    @Override
    protected void onResume() {
        super.onResume();
        current = this;
        immersive();
        // Vuelta a primer plano: la pantalla comprueba si hay versión nueva (ADR 0021; plugin update-wake).
        if (web != null) web.evaluateJavascript("window.dispatchEvent(new Event('app-resume'))", null);
        // Vuelta de Ajustes tras conceder (o no) «Acceso a todos los archivos».
        if (pendingDir != null) {
            String dir = pendingDir;
            pendingDir = null;
            if (Storage.hasAllFilesAccess(this)) useDir(dir);
            else filesDenied();
        }
    }

    @Override
    protected void onDestroy() {
        SurvivalService.removeListener(this);
        if (current == this) current = null;
        if (web != null) web.destroy();
        super.onDestroy();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        // USB conectado (nodo LoRa, GPS): basta con traer la app; serial-hub lo detecta solo.
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) immersive();
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        back();
    }

    private void back() {
        if (web != null && web.getVisibility() == View.VISIBLE && web.canGoBack()) web.goBack();
        else moveTaskToBack(true); // los servicios siguen: no se cierra con «atrás»
    }

    private void immersive() {
        WindowInsetsController c = getWindow().getInsetsController();
        if (c != null) {
            c.hide(WindowInsets.Type.systemBars());
            c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        }
    }

    // ------------------------------------------------------------------ interfaz

    @SuppressLint("SetJavaScriptEnabled")
    private void buildUi() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(16, 20, 18));
        // Con la ventana de borde a borde, el teclado no redimensiona solo: se deja hueco abajo.
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            int ime = insets.getInsets(WindowInsets.Type.ime()).bottom;
            v.setPadding(0, 0, 0, ime);
            return insets;
        });

        web = new WebView(this);
        web.setVisibility(View.INVISIBLE);
        web.setBackgroundColor(Color.rgb(16, 20, 18));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setTextZoom(100);
        s.setBuiltInZoomControls(false);
        s.setSupportMultipleWindows(false);
        s.setUserAgentString(s.getUserAgentString() + " SurvivalOS-Android");
        WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if ("127.0.0.1".equals(u.getHost()) || "localhost".equals(u.getHost())) return false;
                // Enlaces externos (fuentes, licencias): al navegador del sistema, nunca dentro de la app.
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                } catch (ActivityNotFoundException ignored) {
                    // sin navegador
                }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = cb;
                try {
                    startActivityForResult(params.createIntent(), REQ_CHOOSER);
                } catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });
        web.setDownloadListener((url, ua, disposition, mime, length) -> download(url, disposition, mime));
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        root.addView(buildSplash(), new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
    }

    /**
     * Pantalla de arranque: fondo topográfico (res/drawable-nodpi/splash_bg.webp, generado para la app), el icono
     * en un halo del color de acento que «respira» mientras carga, nombre, lema, estado, barra fina y versión.
     */
    private View buildSplash() {
        final int accent = Color.rgb(140, 191, 150);
        final int ink = Color.rgb(243, 239, 228);
        FrameLayout sp = new FrameLayout(this);
        sp.setBackgroundColor(Color.rgb(9, 13, 11));

        ImageView bg = new ImageView(this);
        bg.setImageResource(R.drawable.splash_bg);
        bg.setScaleType(ImageView.ScaleType.CENTER_CROP);
        bg.setAlpha(0f);
        sp.addView(bg, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        bg.animate().alpha(1f).setDuration(900).start();

        View shade = new View(this);
        shade.setBackground(new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
            new int[] { Color.argb(150, 5, 8, 7), Color.argb(60, 5, 8, 7), Color.argb(225, 5, 8, 7) }));
        sp.addView(shade, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setGravity(Gravity.CENTER);
        col.setPadding(dp(32), dp(32), dp(32), dp(32));

        // Icono con halo.
        FrameLayout badge = new FrameLayout(this);
        View glow = new View(this);
        GradientDrawable halo = new GradientDrawable();
        halo.setShape(GradientDrawable.OVAL);
        halo.setGradientType(GradientDrawable.RADIAL_GRADIENT);
        halo.setGradientRadius(dp(110));
        halo.setColors(new int[] { Color.argb(110, 140, 191, 150), Color.argb(0, 140, 191, 150) });
        glow.setBackground(halo);
        badge.addView(glow, new FrameLayout.LayoutParams(dp(220), dp(220), Gravity.CENTER));
        ImageView icon = new ImageView(this);
        icon.setImageResource(R.mipmap.ic_launcher);
        icon.setElevation(dp(12));
        badge.addView(icon, new FrameLayout.LayoutParams(dp(112), dp(112), Gravity.CENTER));
        col.addView(badge, new LinearLayout.LayoutParams(dp(220), dp(220)));
        icon.setScaleX(0.82f);
        icon.setScaleY(0.82f);
        icon.setAlpha(0f);
        icon.animate().scaleX(1f).scaleY(1f).alpha(1f).setDuration(700).setInterpolator(new DecelerateInterpolator(2f)).start();
        ObjectAnimator breathe = ObjectAnimator.ofFloat(glow, View.ALPHA, 0.45f, 1f);
        breathe.setDuration(1800);
        breathe.setRepeatMode(ValueAnimator.REVERSE);
        breathe.setRepeatCount(ValueAnimator.INFINITE);
        breathe.start();
        glowAnim = breathe;

        TextView title = new TextView(this);
        title.setText(R.string.app_name);
        title.setTextColor(ink);
        title.setTextSize(30);
        title.setLetterSpacing(0.08f);
        title.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        title.setGravity(Gravity.CENTER);
        title.setShadowLayer(dp(12), 0, dp(2), Color.argb(160, 0, 0, 0));
        col.addView(title);

        TextView tagline = new TextView(this);
        tagline.setText(R.string.splash_tagline);
        tagline.setTextColor(Color.argb(190, 243, 239, 228));
        tagline.setTextSize(15);
        tagline.setGravity(Gravity.CENTER);
        tagline.setPadding(0, dp(6), 0, 0);
        col.addView(tagline);

        status = new TextView(this);
        status.setTextColor(Color.argb(200, 243, 239, 228));
        status.setTextSize(15);
        status.setGravity(Gravity.CENTER);
        status.setPadding(0, dp(36), 0, dp(14));
        col.addView(status);

        bar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        bar.setMax(100);
        bar.setProgressTintList(ColorStateList.valueOf(accent));
        bar.setIndeterminateTintList(ColorStateList.valueOf(accent));
        bar.setProgressBackgroundTintList(ColorStateList.valueOf(Color.argb(60, 255, 255, 255)));
        bar.setMinHeight(dp(4));
        bar.setMaxHeight(dp(4));
        col.addView(bar, new LinearLayout.LayoutParams(dp(260), dp(4)));

        actions = new LinearLayout(this);
        actions.setGravity(Gravity.CENTER);
        actions.setPadding(0, dp(20), 0, 0);
        col.addView(actions);
        sp.addView(col, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        TextView ver = new TextView(this);
        try {
            ver.setText("v" + getPackageManager().getPackageInfo(getPackageName(), 0).versionName);
        } catch (PackageManager.NameNotFoundException ignored) {
            // sin versión
        }
        ver.setTextColor(Color.argb(120, 243, 239, 228));
        ver.setTextSize(12);
        ver.setLetterSpacing(0.1f);
        FrameLayout.LayoutParams vp = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        vp.bottomMargin = dp(28);
        sp.addView(ver, vp);

        splash = sp;
        return sp;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private void setStatus(String text, int pct, boolean indeterminate) {
        status.setText(text);
        bar.setVisibility(View.VISIBLE);
        bar.setIndeterminate(indeterminate);
        bar.setProgress(pct);
        actions.removeAllViews();
    }

    private void addButton(int text, Runnable r) {
        Button b = new Button(this);
        b.setText(text);
        b.setOnClickListener(v -> r.run());
        actions.addView(b);
    }

    // ------------------------------------------------------------------ servicio

    private void start() {
        SurvivalService.ensureRunning(this);
        SurvivalService.addListener(this);
        if (!Storage.prefs(this).getBoolean(KEY_ONBOARDED, false)) onboarding(0);
    }

    @Override
    public void onState(SurvivalService.Phase phase, String detail, int progress) {
        switch (phase) {
            case PREPARING:
                setStatus(detail + " " + progress + " %", progress, false);
                break;
            case STARTING:
            case IDLE:
                setStatus(getString(R.string.state_starting), 0, true);
                break;
            case READY:
                show(detail);
                break;
            case FAILED:
                web.setVisibility(View.INVISIBLE);
                splash.setVisibility(View.VISIBLE);
                if (glowAnim != null) glowAnim.resume();
                status.setText(detail);
                bar.setVisibility(View.GONE);
                actions.removeAllViews();
                addButton(R.string.btn_retry, () -> {
                    stopService(new Intent(this, SurvivalService.class));
                    status.postDelayed(this::start, 800);
                });
                addButton(R.string.btn_other_storage, this::chooseStorage);
                break;
            case STOPPED:
                break;
        }
    }

    /** Carga la interfaz con la cookie del token (la guarda de Node rechaza lo que no la lleve). */
    private void show(String url) {
        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setCookie(url, "survival_app=" + SurvivalService.token + "; Path=/; HttpOnly; SameSite=Strict", ok -> {
            cm.flush();
            if (!url.equals(loadedUrl)) {
                loadedUrl = url;
                web.loadUrl(url + "/");
            } else {
                web.reload();
            }
            web.setVisibility(View.VISIBLE);
            splash.setVisibility(View.GONE);
            if (glowAnim != null) glowAnim.pause();
        });
    }

    // ------------------------------------------------------------------ carpeta de datos

    private void chooseStorage() {
        List<Storage.Option> opts = Storage.options(this);
        String[] labels = new String[opts.size()];
        for (int i = 0; i < opts.size(); i++) {
            Storage.Option o = opts.get(i);
            String free = o.freeBytes >= 0 ? getString(R.string.storage_free, Formatter.formatShortFileSize(this, o.freeBytes)) : "";
            labels[i] = o.label + "\n" + free + " · " + getString(o.deletedOnUninstall ? R.string.storage_deleted : R.string.storage_keeps);
        }
        new AlertDialog.Builder(this)
                .setTitle(R.string.storage_title)
                .setCancelable(false)
                .setItems(labels, (d, which) -> {
                    Storage.Option o = opts.get(which);
                    if (o.needsPermission && !Storage.hasAllFilesAccess(this)) askFiles(o.path);
                    else useDir(o.path);
                })
                .show();
    }

    private void askFiles(String dir) {
        new AlertDialog.Builder(this)
                .setTitle(R.string.perm_files_title)
                .setMessage(R.string.perm_files_body)
                .setCancelable(false)
                .setPositiveButton(R.string.btn_continue, (d, w) -> {
                    pendingDir = dir;
                    if (Build.VERSION.SDK_INT >= 30) {
                        try {
                            startActivity(new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:" + getPackageName())));
                        } catch (ActivityNotFoundException e) {
                            startActivity(new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION));
                        }
                    } else {
                        requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE, Manifest.permission.READ_EXTERNAL_STORAGE}, REQ_FILES);
                    }
                })
                .setNegativeButton(R.string.btn_other_storage, (d, w) -> chooseStorage())
                .show();
    }

    private void filesDenied() {
        new AlertDialog.Builder(this)
                .setMessage(R.string.perm_files_denied)
                .setCancelable(false)
                .setPositiveButton(R.string.btn_other_storage, (d, w) -> chooseStorage())
                .show();
    }

    private void useDir(String dir) {
        Storage.setDataDir(this, dir);
        if (SurvivalService.instance != null) {
            // Cambio de carpeta: se reinician los servicios (los datos anteriores se quedan donde estaban).
            stopService(new Intent(this, SurvivalService.class));
            loadedUrl = null;
            status.postDelayed(this::start, 800);
        } else {
            start();
        }
    }

    // ------------------------------------------------------------------ permisos (primer arranque y desde Mantenimiento)

    /** Primer arranque: notificaciones → ubicación (GNSS) → batería sin restricciones. Cada paso se puede saltar. */
    private void onboarding(int step) {
        if (step == 0) {
            if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFICATIONS);
            } else onboarding(1);
        } else if (step == 1) {
            if (getPackageManager().hasSystemFeature(PackageManager.FEATURE_LOCATION_GPS) && checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                new AlertDialog.Builder(this)
                        .setTitle(R.string.perm_location_title)
                        .setMessage(R.string.perm_location_body)
                        .setPositiveButton(R.string.btn_continue, (d, w) -> requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_LOCATION))
                        .setNegativeButton(R.string.btn_later, (d, w) -> onboarding(2))
                        .setCancelable(false)
                        .show();
            } else onboarding(2);
        } else if (step == 2) {
            android.os.PowerManager pm = getSystemService(android.os.PowerManager.class);
            if (pm != null && !pm.isIgnoringBatteryOptimizations(getPackageName())) {
                new AlertDialog.Builder(this)
                        .setTitle(R.string.perm_battery_title)
                        .setMessage(R.string.perm_battery_body)
                        .setPositiveButton(R.string.btn_continue, (d, w) -> {
                            runAction("permission-battery");
                            onboarding(3);
                        })
                        .setNegativeButton(R.string.btn_later, (d, w) -> onboarding(3))
                        .setCancelable(false)
                        .show();
            } else onboarding(3);
        } else {
            Storage.prefs(this).edit().putBoolean(KEY_ONBOARDED, true).apply();
        }
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        super.onRequestPermissionsResult(code, perms, results);
        if (code == REQ_FILES) {
            String dir = pendingDir;
            pendingDir = null;
            if (dir != null && Storage.hasAllFilesAccess(this)) useDir(dir);
            else filesDenied();
        } else if (code == REQ_NOTIFICATIONS) {
            if (!Storage.prefs(this).getBoolean(KEY_ONBOARDED, false)) onboarding(1);
        } else if (code == REQ_LOCATION) {
            // Con permiso, el servicio pasa a ser también «de ubicación» (GNSS con la pantalla apagada).
            SurvivalService s = SurvivalService.instance;
            if (s != null) s.goForeground();
            if (!Storage.prefs(this).getBoolean(KEY_ONBOARDED, false)) onboarding(2);
        }
    }

    /** Acciones pedidas desde la interfaz web (Mantenimiento → Android) a través del puente. */
    void runAction(String action) {
        try {
            switch (action) {
                case "permission-location":
                    requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_LOCATION);
                    break;
                case "permission-notifications":
                    if (Build.VERSION.SDK_INT >= 33) requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFICATIONS);
                    break;
                case "permission-files":
                    if (Build.VERSION.SDK_INT >= 30) startActivity(new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:" + getPackageName())));
                    else requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQ_FILES);
                    break;
                case "permission-battery":
                    startActivity(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getPackageName())));
                    break;
                case "permission-install":
                    startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName())));
                    break;
                case "app-settings":
                    startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName())));
                    break;
                case "storage":
                    chooseStorage();
                    break;
                case "install-apk":
                    if (!getPackageManager().canRequestPackageInstalls()) {
                        Toast.makeText(this, R.string.install_permission, Toast.LENGTH_LONG).show();
                        runAction("permission-install");
                        return;
                    }
                    startActivity(new Intent(Intent.ACTION_VIEW)
                            .setDataAndType(ApkProvider.uri(this), "application/vnd.android.package-archive")
                            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK));
                    break;
                default:
                    break;
            }
        } catch (ActivityNotFoundException e) {
            runAction("app-settings");
        }
    }

    /** «Fijar la pantalla» (modo quiosco de Android): Survivelia OS queda delante hasta que se desfije. */
    void setKiosk(boolean on) {
        try {
            if (on) startLockTask();
            else stopLockTask();
        } catch (Exception ignored) {
            // no permitido en este dispositivo
        }
    }

    boolean inLockTask() {
        ActivityManager am = getSystemService(ActivityManager.class);
        return am != null && am.getLockTaskModeState() != ActivityManager.LOCK_TASK_MODE_NONE;
    }

    // ------------------------------------------------------------------ ficheros

    @Override
    protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code == REQ_CHOOSER && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
            fileCallback = null;
        }
    }

    /** Exportaciones (GPX, copias…): se descargan con el token y se guardan en Descargas. */
    private void download(String url, String disposition, String mime) {
        String name = URLUtil.guessFileName(url, disposition, mime);
        new Thread(() -> {
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                c.setRequestProperty("x-survival-token", SurvivalService.token);
                c.setConnectTimeout(5000);
                c.setReadTimeout(120_000);
                if (c.getResponseCode() != 200) throw new Exception("HTTP " + c.getResponseCode());
                ContentValues v = new ContentValues();
                v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                v.put(MediaStore.MediaColumns.MIME_TYPE, mime == null || mime.isEmpty() ? "application/octet-stream" : mime);
                Uri dest = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                if (dest == null) throw new Exception("MediaStore");
                try (InputStream in = c.getInputStream(); OutputStream out = getContentResolver().openOutputStream(dest)) {
                    byte[] buf = new byte[64 * 1024];
                    int r;
                    while ((r = in.read(buf)) > 0) out.write(buf, 0, r);
                }
                runOnUiThread(() -> Toast.makeText(this, getString(R.string.download_saved, name), Toast.LENGTH_LONG).show());
            } catch (Exception e) {
                runOnUiThread(() -> Toast.makeText(this, getString(R.string.download_failed, String.valueOf(e.getMessage())), Toast.LENGTH_LONG).show());
            }
        }, "download").start();
    }
}
