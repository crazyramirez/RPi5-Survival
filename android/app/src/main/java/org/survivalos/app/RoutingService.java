package org.survivalos.app;

import android.app.Service;
import android.content.Intent;
import android.os.Binder;
import android.os.IBinder;
import android.os.Process;
import android.util.Log;

/**
 * BRouter (rutas sin conexión, ADR 0010) en el proceso «:routing» (ADR 0020). Es el mismo jar que usan la Pi y la
 * portable, ejecutado por Android sin JRE: RouteServer escucha en 127.0.0.1:<puerto> como allí.
 *
 * SurvivalService se enlaza (bind) con los parámetros en el Intent y se desenlaza para pararlo; RouteServer no
 * tiene parada limpia, así que al desenlazar se termina este proceso (los datos son de solo lectura).
 */
public final class RoutingService extends Service {
    static final String EXTRA_SEGMENTS = "segments";
    static final String EXTRA_PROFILES = "profiles";
    static final String EXTRA_CUSTOM = "customProfiles";
    static final String EXTRA_PORT = "port";
    static final String EXTRA_MAX_TIME = "maxRunningTime";
    private static final String TAG = "SurvivalRouting";

    private Thread server;

    @Override
    public IBinder onBind(Intent intent) {
        if (server == null) {
            String[] args = {
                    intent.getStringExtra(EXTRA_SEGMENTS),
                    intent.getStringExtra(EXTRA_PROFILES),
                    intent.getStringExtra(EXTRA_CUSTOM),
                    String.valueOf(intent.getIntExtra(EXTRA_PORT, 0)),
                    "1",
                    "127.0.0.1",
            };
            // Mismas opciones que la portable (lib.mjs → optionalServices) y que survival-routing en la Pi.
            System.setProperty("maxRunningTime", String.valueOf(intent.getIntExtra(EXTRA_MAX_TIME, 60)));
            System.setProperty("useRFCMimeType", "false");
            System.setProperty("usePOSTRequests", "false");
            server = new Thread(() -> {
                try {
                    Log.i(TAG, "BRouter en 127.0.0.1:" + args[3]);
                    btools.server.RouteServer.main(args);
                } catch (Throwable t) {
                    Log.e(TAG, "BRouter terminó", t);
                }
            }, "brouter");
            server.setDaemon(true);
            server.start();
        }
        return new Binder();
    }

    @Override
    public boolean onUnbind(Intent intent) {
        stopSelf();
        return false;
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        Process.killProcess(Process.myPid());
    }
}
