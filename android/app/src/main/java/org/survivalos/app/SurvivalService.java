package org.survivalos.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.ServiceConnection;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.hardware.usb.UsbManager;
import android.net.wifi.WifiManager;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.SecureRandom;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Servicio en primer plano de Survivelia OS (ADR 0020): prepara la aplicación, arranca el lanzador de la portable
 * (portable/launcher.mjs) con el Node del APK y atiende el puente nativo. Mientras corre, los servicios siguen vivos
 * con la pantalla apagada (descargas, radio, GPS).
 */
public final class SurvivalService extends Service {
    enum Phase { IDLE, PREPARING, STARTING, READY, FAILED, STOPPED }

    interface Listener {
        void onState(Phase phase, String detail, int progress);
    }

    static final String ACTION_QUIT = "org.survivalos.app.QUIT";
    private static final String TAG = "SurvivalOS";
    private static final String CHANNEL = "survival";
    private static final int NOTIF_ID = 1;

    static volatile SurvivalService instance;
    private static final CopyOnWriteArrayList<Listener> listeners = new CopyOnWriteArrayList<>();
    static volatile Phase phase = Phase.IDLE;
    static volatile String detail = "";
    static volatile int progress = 0;
    /** URL de la interfaz (http://127.0.0.1:<puerto>) cuando está lista. */
    static volatile String url;
    /** Token de esta ejecución: cookie de la WebView y cabecera de los servicios. */
    static volatile String token;
    /** Por qué falló el arranque, si es por la carpeta de datos (la ventana ofrece el arreglo adecuado). */
    static final String FAIL_PERMISSION = "permission";
    static final String FAIL_MISSING = "missing";
    /** No es un fallo: se espera a que se monte la tarjeta (la ventana deja elegir otra carpeta mientras). */
    static final String WAIT_VOLUME = "waiting";
    static volatile String failure;

    private final Handler main = new Handler(Looper.getMainLooper());
    private Bridge bridge;
    private int bridgePort;
    private volatile Process node;
    private volatile boolean quitting;
    private int restarts;
    private long firstRestartAt;
    private UsbSerial usb;
    private Gnss gnss;
    private final Set<String> awakeJobs = new HashSet<>();
    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;
    private ServiceConnection routing;
    private String routingError;
    private int routingPort;

    static void addListener(Listener l) {
        listeners.add(l);
        l.onState(phase, detail, progress);
    }

    static void removeListener(Listener l) {
        listeners.remove(l);
    }

    private void setState(Phase p, String d, int pr) {
        phase = p;
        detail = d == null ? "" : d;
        progress = pr;
        main.post(() -> {
            for (Listener l : listeners) l.onState(p, detail, pr);
        });
    }

    // ------------------------------------------------------------------ ciclo de vida

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        usb = new UsbSerial(this);
        gnss = new Gnss(this);
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel(CHANNEL, getString(R.string.notif_channel), NotificationManager.IMPORTANCE_LOW));
        goForeground();
        IntentFilter f = new IntentFilter();
        f.addAction(Intent.ACTION_MEDIA_MOUNTED);
        f.addAction(Intent.ACTION_MEDIA_UNMOUNTED);
        f.addAction(Intent.ACTION_MEDIA_REMOVED);
        f.addAction(Intent.ACTION_MEDIA_EJECT);
        f.addDataScheme("file");
        registerReceiver(volumes, f);
        new Thread(this::boot, "survival-boot").start();
    }

    /** Tipo «uso especial» siempre; «ubicación» además si ya hay permiso (para leer el GNSS en segundo plano). */
    void goForeground() {
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE);
        PendingIntent quit = PendingIntent.getService(this, 1, new Intent(this, SurvivalService.class).setAction(ACTION_QUIT), PendingIntent.FLAG_IMMUTABLE);
        Notification n = new Notification.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(getString(R.string.app_name))
                .setContentText(getString(R.string.notif_running))
                .setContentIntent(open)
                .setOngoing(true)
                .addAction(new Notification.Action.Builder(null, getString(R.string.notif_quit), quit).build())
                .build();
        int type = ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE;
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) type |= ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION;
        try {
            startForeground(NOTIF_ID, n, type);
        } catch (Exception e) {
            startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_QUIT.equals(intent.getAction())) quit();
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        quitting = true;
        stopNode();
        try {
            unregisterReceiver(volumes);
        } catch (Exception ignored) {
            // ya quitado
        }
        stopRouting();
        if (bridge != null) bridge.stop();
        releaseLocks();
        instance = null;
        url = null;
        setState(Phase.STOPPED, "", 0);
        super.onDestroy();
    }

    /** «Cerrar Survivelia OS»: detiene todo y cierra la ventana. */
    void quit() {
        quitting = true;
        main.post(() -> {
            MainActivity a = MainActivity.current;
            if (a != null) a.finishAndRemoveTask();
        });
        new Thread(() -> {
            stopNode();
            main.post(() -> {
                stopForeground(STOP_FOREGROUND_REMOVE);
                stopSelf();
            });
        }, "survival-quit").start();
    }

    private final BroadcastReceiver volumes = new BroadcastReceiver() {
        @Override
        public void onReceive(Context c, Intent i) {
            Storage.writeVolumes(c);
            // La tarjeta con los datos apareció después de rendirse la espera: se arranca sin que haya que tocar nada.
            String data = Storage.dataDir(c);
            if (phase == Phase.FAILED && FAIL_MISSING.equals(failure) && node == null && data != null && Storage.volumeReady(c, data)) {
                failure = null;
                new Thread(SurvivalService.this::boot, "survival-boot").start();
            }
        }
    };

    // ------------------------------------------------------------------ arranque

    private void boot() {
        try {
            String data = Storage.dataDir(this);
            if (data == null) {
                setState(Phase.FAILED, getString(R.string.err_no_storage), 0);
                return;
            }
            File dataDir = new File(data);
            failure = null;
            // Carpeta SurvivalOS sin el permiso «todos los archivos» (revocado, o lo quitó la limpieza de la marca):
            // se pide otra vez en lugar de arrancar y fallar al leer.
            if (!Storage.isPrivate(this, data) && !Storage.hasAllFilesAccess(this)) {
                failure = FAIL_PERMISSION;
                setState(Phase.FAILED, getString(R.string.err_files_permission, data), 0);
                return;
            }
            // Tras reiniciar, la microSD tarda en montarse: se espera (hasta 3 min) sin tocar la carpeta elegida.
            if (!dataDir.isDirectory() && !Storage.volumeReady(this, data)) {
                String label = Storage.volumeLabel(this, data);
                failure = WAIT_VOLUME;
                setState(Phase.STARTING, getString(R.string.state_waiting_volume, label), 0);
                for (int i = 0; i < 90 && !quitting && !Storage.volumeReady(this, data); i++) Thread.sleep(2000);
                failure = null;
                if (quitting) return;
                if (!Storage.volumeReady(this, data)) {
                    failure = FAIL_MISSING;
                    setState(Phase.FAILED, getString(R.string.err_volume_missing, label, data), 0);
                    return;
                }
            }
            if (!dataDir.isDirectory() && !dataDir.mkdirs()) {
                failure = FAIL_MISSING;
                setState(Phase.FAILED, getString(R.string.err_storage, data), 0);
                return;
            }
            if (!AppFiles.upToDate(this)) {
                setState(Phase.PREPARING, getString(R.string.state_preparing), 0);
                AppFiles.extract(this, pct -> setState(Phase.PREPARING, getString(R.string.state_preparing), pct));
            }
            writeDefaults(dataDir);
            Storage.writeVolumes(this);
            byte[] t = new byte[24];
            new SecureRandom().nextBytes(t);
            StringBuilder sb = new StringBuilder();
            for (byte b : t) sb.append(String.format("%02x", b));
            token = sb.toString();
            bridge = new Bridge(token, this::handle);
            bridgePort = bridge.start();
            startNode(dataDir);
        } catch (Exception e) {
            Log.e(TAG, "arranque", e);
            setState(Phase.FAILED, String.valueOf(e.getMessage()), 0);
        }
    }

    /**
     * Idioma y país por defecto del equipo (<datos>/defaults.json, como `express defaults`): los de la tablet, solo
     * si aún no existe. La persona puede cambiarlos en la bienvenida.
     */
    private void writeDefaults(File dataDir) {
        File f = new File(dataDir, "defaults.json");
        if (f.exists()) return;
        try {
            Locale l = Locale.getDefault();
            JSONObject o = new JSONObject();
            String lang = l.getLanguage();
            o.put("locale", lang.equals("es") || lang.equals("en") || lang.equals("fr") || lang.equals("it") ? lang : JSONObject.NULL);
            String c3 = "";
            try {
                c3 = l.getISO3Country().toLowerCase(Locale.ROOT);
            } catch (Exception ignored) {
                // país sin código ISO3
            }
            o.put("country", c3.matches("[a-z]{3}") ? c3 : JSONObject.NULL);
            try (FileOutputStream out = new FileOutputStream(f)) {
                out.write((o.toString() + "\n").getBytes(StandardCharsets.UTF_8));
            }
        } catch (Exception e) {
            Log.w(TAG, "defaults.json: " + e.getMessage());
        }
    }

    private void startNode(File dataDir) throws Exception {
        setState(Phase.STARTING, getString(R.string.state_starting), 0);
        File lib = new File(getApplicationInfo().nativeLibraryDir);
        File app = AppFiles.appDir(this);
        File home = new File(getFilesDir(), "home");
        //noinspection ResultOfMethodCallIgnored
        home.mkdirs();
        File runFile = new File(dataDir, "run.json");
        //noinspection ResultOfMethodCallIgnored
        runFile.delete();
        ProcessBuilder pb = new ProcessBuilder(new File(lib, "libnode.so").getPath(), new File(app, "portable/launcher.mjs").getPath(), "--no-browser");
        pb.directory(getFilesDir());
        pb.redirectErrorStream(true);
        Map<String, String> env = pb.environment();
        env.put("HOME", home.getPath());
        env.put("TMPDIR", getCacheDir().getPath());
        env.put("LD_LIBRARY_PATH", lib.getPath());
        env.put("PATH", "/system/bin:/system/xbin");
        // Certificados: Node usa las raíces de Mozilla que trae dentro (--use-bundled-ca); el almacén de Android
        // tiene los nombres con el hash antiguo y OpenSSL 3 no los encuentra. Los binarios Go (pmtiles) leen el
        // directorio entero, sin depender del nombre: para ellos, SSL_CERT_DIR.
        env.put("SSL_CERT_DIR", "/system/etc/security/cacerts");
        env.put("NODE_OPTIONS", "--use-bundled-ca --import=" + new File(app, "portable/android-guard.mjs").toURI());
        env.put("SURVIVAL_ANDROID_TOKEN", token);
        env.put("SURVIVAL_ANDROID_BRIDGE", "http://127.0.0.1:" + bridgePort);
        env.put("SURVIVAL_ANDROID_LIB", lib.getPath());
        env.put("SURVIVAL_ANDROID_PRIVATE", getFilesDir().getPath());
        env.put("SURVIVAL_PORTABLE_DATA", dataDir.getPath());
        env.put("NUXT_PUBLIC_ANDROID", "true");
        Process p = pb.start();
        node = p;
        Thread out = new Thread(() -> pump(p), "node-out");
        out.setDaemon(true);
        out.start();
        Thread watch = new Thread(() -> watch(p, dataDir, runFile), "node-watch");
        watch.setDaemon(true);
        watch.start();
    }

    private void pump(Process p) {
        try (BufferedReader r = new BufferedReader(new InputStreamReader(p.getInputStream(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = r.readLine()) != null) Log.i(TAG, line);
        } catch (Exception ignored) {
            // proceso terminado
        }
    }

    /** Espera a que la web responda (run.json + /api/health) y vigila el proceso. */
    private void watch(Process p, File dataDir, File runFile) {
        boolean ready = false;
        for (int i = 0; i < 240 && p.isAlive() && !ready && !quitting; i++) {
            try {
                Thread.sleep(500);
                if (!runFile.exists()) continue;
                String u = new JSONObject(new String(Files.readAllBytes(runFile.toPath()), StandardCharsets.UTF_8)).getString("url");
                if (healthy(u)) {
                    url = u;
                    ready = true;
                    restarts = 0;
                    setState(Phase.READY, u, 100);
                }
            } catch (Exception ignored) {
                // aún no
            }
        }
        if (!ready && p.isAlive() && !quitting) {
            setState(Phase.FAILED, getString(R.string.err_timeout), 0);
        }
        try {
            int code = p.waitFor();
            Log.w(TAG, "Node terminó con código " + code);
        } catch (InterruptedException ignored) {
            return;
        }
        url = null;
        if (quitting) return;
        // El lanzador se cerró solo («Cerrar Survivelia OS») o falló: se relanza hasta 5 veces en 10 minutos.
        long now = System.currentTimeMillis();
        if (now - firstRestartAt > 600_000) {
            firstRestartAt = now;
            restarts = 0;
        }
        if (++restarts > 5) {
            setState(Phase.FAILED, getString(R.string.err_crash, new File(dataDir, "logs").getPath()), 0);
            return;
        }
        main.postDelayed(() -> {
            try {
                if (!quitting) startNode(dataDir);
            } catch (Exception e) {
                setState(Phase.FAILED, String.valueOf(e.getMessage()), 0);
            }
        }, 2000L * restarts);
    }

    static boolean healthy(String u) {
        try {
            HttpURLConnection c = (HttpURLConnection) new URL(u + "/api/health").openConnection();
            c.setConnectTimeout(2000);
            c.setReadTimeout(4000);
            c.setRequestProperty("x-survival-token", token);
            int code = c.getResponseCode();
            c.disconnect();
            return code < 500 || code == 503;
        } catch (Exception e) {
            return false;
        }
    }

    private void stopNode() {
        Process p = node;
        node = null;
        if (p == null) return;
        p.destroy(); // SIGTERM: el lanzador cierra sus servicios
        try {
            for (int i = 0; i < 50 && p.isAlive(); i++) Thread.sleep(100);
        } catch (InterruptedException ignored) {
            // seguir
        }
        if (p.isAlive()) p.destroyForcibly();
    }

    // ------------------------------------------------------------------ puente

    private JSONObject handle(String method, String path, JSONObject body) throws Exception {
        boolean post = "POST".equals(method);
        switch (path) {
            case "/device/info":
                return deviceInfo();
            case "/serial/ports":
                return new JSONObject().put("ports", serialPorts());
            case "/serial/open": {
                if (!post) break;
                String p = body.optString("path");
                StreamRelay r = Gnss.PATH.equals(p) ? gnss.open() : usb.open(p, body.optInt("baud", 115200));
                return new JSONObject().put("port", r.port).put("key", r.key);
            }
            case "/routing/start":
                if (!post) break;
                startRouting(body);
                return new JSONObject().put("ok", true);
            case "/routing/stop":
                if (!post) break;
                stopRouting();
                return new JSONObject().put("ok", true);
            case "/routing/status":
                return new JSONObject().put("running", routingRunning()).put("error", routingError == null ? JSONObject.NULL : routingError);
            case "/power/keep-awake":
                if (!post) break;
                keepAwake(body.optString("job", "?"), body.optBoolean("on"));
                return new JSONObject().put("ok", true);
            case "/app/status":
                return appStatus();
            case "/app/quit":
                if (!post) break;
                quitting = true; // antes de que el lanzador salga: que no se relance
                main.postDelayed(this::quit, 300);
                return new JSONObject().put("ok", true);
            case "/app/install-apk":
                if (!post) break;
                installApk(body.optString("path"));
                return new JSONObject().put("ok", true);
            case "/app/action":
                if (!post) break;
                return activityAction(body.optString("action"), body);
            default:
                break;
        }
        throw new Bridge.BridgeError(404, "no encontrado");
    }

    private JSONArray serialPorts() throws Exception {
        JSONArray ports = usb.list();
        if (gnss.hasHardware() && gnss.hasPermission()) {
            ports.put(new JSONObject().put("path", Gnss.PATH).put("label", getString(R.string.gnss_label)).put("vid", JSONObject.NULL).put("pid", JSONObject.NULL));
        }
        return ports;
    }

    private JSONObject deviceInfo() throws Exception {
        Intent b = registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        JSONObject power = new JSONObject();
        if (b != null) {
            boolean present = b.getBooleanExtra(BatteryManager.EXTRA_PRESENT, true);
            int level = b.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
            int scale = b.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
            int mv = b.getIntExtra(BatteryManager.EXTRA_VOLTAGE, -1);
            int temp = b.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, Integer.MIN_VALUE);
            int plugged = b.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0);
            power.put("present", present);
            power.put("percent", level >= 0 && scale > 0 ? Math.round(level * 100f / scale) : JSONObject.NULL);
            power.put("voltageV", mv > 0 ? mv / 1000.0 : JSONObject.NULL);
            power.put("temperatureC", temp != Integer.MIN_VALUE ? temp / 10.0 : JSONObject.NULL);
            String src = plugged == BatteryManager.BATTERY_PLUGGED_AC ? "ac" : plugged == BatteryManager.BATTERY_PLUGGED_USB ? "usb"
                    : plugged == BatteryManager.BATTERY_PLUGGED_WIRELESS ? "wireless" : plugged == 8 ? "dock" : null;
            power.put("plugged", src == null ? JSONObject.NULL : src);
        } else {
            power.put("present", false);
        }
        JSONArray serial = new JSONArray();
        for (String p : usb.paths()) serial.put(p);
        if (gnss.hasHardware() && gnss.hasPermission()) serial.put(Gnss.PATH);
        // Hora de red del sistema (Android 13+): la que Android obtuvo por NTP. Coincide (±2 s) → hora verificada.
        Object netTime = JSONObject.NULL;
        if (Build.VERSION.SDK_INT >= 33) {
            try {
                long net = android.os.SystemClock.currentNetworkTimeClock().millis();
                netTime = Math.abs(net - System.currentTimeMillis()) <= 2000;
            } catch (Exception e) {
                netTime = false; // sin hora de red todavía
            }
        }
        return new JSONObject()
                .put("manufacturer", Build.MANUFACTURER)
                .put("model", Build.MODEL)
                .put("release", Build.VERSION.RELEASE)
                .put("sdk", Build.VERSION.SDK_INT)
                .put("power", power)
                .put("serialPorts", serial)
                .put("networkTimeOk", netTime);
    }

    private JSONObject appStatus() throws Exception {
        String data = Storage.dataDir(this);
        PowerManager pm = getSystemService(PowerManager.class);
        boolean privateDir = data != null && data.contains("/Android/data/");
        JSONObject perms = new JSONObject()
                .put("location", gnss.hasPermission())
                .put("gnssHardware", gnss.hasHardware())
                .put("notifications", Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)
                .put("allFiles", Storage.hasAllFilesAccess(this))
                .put("battery", pm != null && pm.isIgnoringBatteryOptimizations(getPackageName()))
                .put("installApps", getPackageManager().canRequestPackageInstalls());
        MainActivity a = MainActivity.current;
        return new JSONObject()
                .put("version", getPackageManager().getPackageInfo(getPackageName(), 0).versionName)
                .put("abi", Build.SUPPORTED_ABIS.length > 0 ? Build.SUPPORTED_ABIS[0] : "")
                .put("model", Build.MANUFACTURER + " " + Build.MODEL)
                .put("android", Build.VERSION.RELEASE)
                .put("dataDir", data == null ? JSONObject.NULL : data)
                .put("dataDeletedOnUninstall", privateDir)
                .put("freeBytes", data == null ? JSONObject.NULL : Storage.free(new File(data)))
                .put("permissions", perms)
                .put("kiosk", a != null && a.inLockTask());
    }

    /** Acciones que necesitan la ventana (permisos, fijar pantalla, cambiar carpeta de datos). */
    private JSONObject activityAction(String action, JSONObject body) throws Exception {
        MainActivity a = MainActivity.current;
        if (a == null) throw new Bridge.BridgeError(409, "Abre Survivelia OS para hacerlo");
        switch (action) {
            case "permission-location":
            case "permission-notifications":
            case "permission-files":
            case "permission-battery":
            case "permission-install":
            case "app-settings":
            case "bluetooth-settings":
            case "storage":
                main.post(() -> a.runAction(action));
                return new JSONObject().put("ok", true);
            case "install-update":
                // Volver a abrir el instalador con el APK ya verificado (si se cerró o faltaba el permiso).
                installApk(new File(new File(Storage.dataDir(this), "admin"), "update.apk").getPath());
                return new JSONObject().put("ok", true);
            case "kiosk":
                boolean on = body.optBoolean("on");
                main.post(() -> a.setKiosk(on));
                return new JSONObject().put("ok", true);
            default:
                throw new Bridge.BridgeError(400, "acción desconocida");
        }
    }

    // ------------------------------------------------------------------ BRouter

    private void startRouting(JSONObject p) {
        stopRouting();
        routingError = null;
        routingPort = p.optInt("port");
        Intent i = new Intent(this, RoutingService.class)
                .setAction("routing:" + routingPort)
                .putExtra(RoutingService.EXTRA_SEGMENTS, p.optString("segments"))
                .putExtra(RoutingService.EXTRA_PROFILES, p.optString("profiles"))
                .putExtra(RoutingService.EXTRA_CUSTOM, p.optString("customProfiles"))
                .putExtra(RoutingService.EXTRA_PORT, routingPort)
                .putExtra(RoutingService.EXTRA_MAX_TIME, p.optInt("maxRunningTime", 60));
        ServiceConnection c = new ServiceConnection() {
            @Override
            public void onServiceConnected(ComponentName name, IBinder service) {
                // BRouter arrancando en su proceso
            }

            @Override
            public void onServiceDisconnected(ComponentName name) {
                routingError = "el proceso de rutas se cerró";
            }
        };
        if (bindService(i, c, Context.BIND_AUTO_CREATE | Context.BIND_IMPORTANT)) routing = c;
        else routingError = "no se pudo iniciar el servicio de rutas";
    }

    private void stopRouting() {
        if (routing != null) {
            try {
                unbindService(routing);
            } catch (Exception ignored) {
                // ya desenlazado
            }
            routing = null;
        }
    }

    private boolean routingRunning() {
        if (routing == null || routingPort <= 0) return false;
        try (Socket s = new Socket()) {
            s.connect(new InetSocketAddress("127.0.0.1", routingPort), 1000);
            return true;
        } catch (Exception e) {
            // aún cargando (unos segundos) o caído
            return routingError == null;
        }
    }

    // ------------------------------------------------------------------ energía

    /** CPU y Wi-Fi despiertos mientras haya alguna tarea larga (descargas, copias). */
    private synchronized void keepAwake(String job, boolean on) {
        if (on) awakeJobs.add(job);
        else awakeJobs.remove(job);
        if (!awakeJobs.isEmpty() && wakeLock == null) {
            PowerManager pm = getSystemService(PowerManager.class);
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "SurvivalOS:jobs");
            wakeLock.acquire(12 * 3600_000L);
            WifiManager wm = getApplicationContext().getSystemService(WifiManager.class);
            if (wm != null) {
                wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "SurvivalOS:jobs");
                wifiLock.acquire();
            }
        } else if (awakeJobs.isEmpty()) {
            releaseLocks();
        }
    }

    private synchronized void releaseLocks() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        wakeLock = null;
        if (wifiLock != null && wifiLock.isHeld()) wifiLock.release();
        wifiLock = null;
    }

    // ------------------------------------------------------------------ actualizar

    /** Copia el APK verificado (<datos>/admin/update.apk) a la caché y abre el instalador del sistema. */
    private void installApk(String path) throws Exception {
        String data = Storage.dataDir(this);
        File src = new File(path).getCanonicalFile();
        File expected = new File(new File(data, "admin"), "update.apk").getCanonicalFile();
        if (!src.equals(expected) || !src.isFile()) throw new Bridge.BridgeError(400, "APK no válido");
        File dst = ApkProvider.file(this);
        //noinspection ResultOfMethodCallIgnored
        dst.getParentFile().mkdirs();
        try (FileInputStream in = new FileInputStream(src); FileOutputStream out = new FileOutputStream(dst)) {
            byte[] buf = new byte[1 << 20];
            int r;
            while ((r = in.read(buf)) > 0) out.write(buf, 0, r);
        }
        main.post(() -> {
            MainActivity a = MainActivity.current;
            if (a != null) a.runAction("install-apk");
        });
    }

    static void ensureRunning(Context ctx) {
        ctx.startForegroundService(new Intent(ctx, SurvivalService.class));
    }

    static boolean isUsbAttach(Intent i) {
        return i != null && UsbManager.ACTION_USB_DEVICE_ATTACHED.equals(i.getAction());
    }
}
