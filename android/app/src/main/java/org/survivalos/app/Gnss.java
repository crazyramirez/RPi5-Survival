package org.survivalos.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Context;
import android.content.pm.PackageManager;
import android.location.GnssStatus;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.location.OnNmeaMessageListener;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.SystemClock;

import java.nio.charset.StandardCharsets;
import java.util.Calendar;
import java.util.Locale;
import java.util.TimeZone;

/**
 * GNSS interno de la tablet como «puerto» NMEA para serial-hub (ADR 0020, ruta android:gnss).
 *
 * Se reenvían las frases NMEA que entrega el propio receptor (OnNmeaMessageListener). Si un fabricante no las
 * entrega, se componen GGA y RMC con la posición real de Location y los satélites de GnssStatus; lo que Android no
 * da (HDOP, altitud sobre el nivel del mar en Android < 14) se deja vacío: nunca se inventa.
 *
 * La precisión que calcula Android (Location.getAccuracy) se envía como GST si el receptor no manda el suyo: así
 * navegación puede comparar el GNSS interno con un GPS USB conectado a la vez y quedarse con el mejor.
 */
final class Gnss {
    static final String PATH = "android:gnss";

    private final Context ctx;
    private final LocationManager lm;

    Gnss(Context ctx) {
        this.ctx = ctx.getApplicationContext();
        this.lm = (LocationManager) ctx.getSystemService(Context.LOCATION_SERVICE);
    }

    boolean hasHardware() {
        return lm != null && ctx.getPackageManager().hasSystemFeature(PackageManager.FEATURE_LOCATION_GPS)
                && lm.getAllProviders().contains(LocationManager.GPS_PROVIDER);
    }

    boolean hasPermission() {
        return ctx.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    @SuppressLint("MissingPermission")
    StreamRelay open() throws Exception {
        if (!hasHardware()) throw new Bridge.BridgeError(404, "Esta tablet no tiene receptor GNSS");
        if (!hasPermission()) throw new Bridge.BridgeError(403, "Falta el permiso de ubicación");
        StreamRelay relay = new StreamRelay();
        HandlerThread thread = new HandlerThread("gnss");
        thread.start();
        Handler h = new Handler(thread.getLooper());
        final long[] lastNmea = {0};
        final long[] lastGst = {0};
        final int[] used = {-1};
        final int[] visible = {-1};

        OnNmeaMessageListener nmea = (message, timestamp) -> {
            String line = message.trim();
            // Solo frases con checksum correcto (algunos receptores, y el emulador, lo calculan mal): si no llega
            // ninguna válida, se componen con Location.
            if (!validNmea(line)) return;
            lastNmea[0] = SystemClock.elapsedRealtime();
            if (line.length() > 6 && line.startsWith("GST", 3)) lastGst[0] = lastNmea[0];
            byte[] b = (line + "\r\n").getBytes(StandardCharsets.US_ASCII);
            relay.send(b, b.length);
        };
        GnssStatus.Callback status = new GnssStatus.Callback() {
            @Override
            public void onSatelliteStatusChanged(GnssStatus s) {
                int u = 0;
                for (int i = 0; i < s.getSatelliteCount(); i++) if (s.usedInFix(i)) u++;
                used[0] = u;
                visible[0] = s.getSatelliteCount();
            }
        };
        LocationListener loc = new LocationListener() {
            @Override
            public void onLocationChanged(Location l) {
                checkClock(l);
                long now = SystemClock.elapsedRealtime();
                // Sin NMEA del fabricante en los últimos 5 s: frases compuestas con los datos reales.
                if (now - lastNmea[0] >= 5000) {
                    for (String s : synth(l, used[0])) {
                        byte[] b = (s + "\r\n").getBytes(StandardCharsets.US_ASCII);
                        relay.send(b, b.length);
                    }
                }
                // Precisión de Android como GST si el receptor no envía el suyo.
                String gst = now - lastGst[0] >= 5000 ? gst(l) : null;
                if (gst != null) {
                    byte[] b = (gst + "\r\n").getBytes(StandardCharsets.US_ASCII);
                    relay.send(b, b.length);
                }
            }

            @Override
            public void onProviderDisabled(String provider) {
                // ubicación desactivada en Ajustes: no hay datos (serial-hub muestra «sin fijación»)
            }

            @Override
            public void onProviderEnabled(String provider) {
                // vuelve a haber datos
            }
        };
        lm.addNmeaListener(nmea, h);
        lm.registerGnssStatusCallback(status, h);
        lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000, 0, loc, thread.getLooper());
        relay.start(new StreamRelay.Device() {
            @Override
            public void write(byte[] data, int len) {
                // serial-hub no envía nada al GNSS interno
            }

            @Override
            public void close() {
                lm.removeUpdates(loc);
                lm.removeNmeaListener(nmea);
                lm.unregisterGnssStatusCallback(status);
                thread.quitSafely();
            }
        }, PATH);
        return relay;
    }

    // ------------------------------------------------------------------ hora verificada por GNSS (ADR 0011)

    private long lastClockWrite;

    /**
     * La fijación trae la hora UTC de los satélites. Si el reloj del sistema coincide (±2 s, descontando la edad de la
     * fijación), se deja constancia en <privado>/timesync.json con el mismo formato que survival-timesync en la Pi; el
     * panel muestra entonces «hora verificada por GNSS». Una app no puede ajustar el reloj: solo se comprueba.
     */
    private void checkClock(Location l) {
        if (!LocationManager.GPS_PROVIDER.equals(l.getProvider()) || l.getTime() <= 0) return;
        long now = System.currentTimeMillis();
        if (now - lastClockWrite < 60_000) return;
        long ageMs = (SystemClock.elapsedRealtimeNanos() - l.getElapsedRealtimeNanos()) / 1_000_000L;
        if (ageMs < 0 || ageMs > 10_000) return;
        long delta = Math.abs(l.getTime() - (now - ageMs));
        if (delta > 2000) return;
        lastClockWrite = now;
        java.io.File dir = ctx.getFilesDir();
        java.io.File tmp = new java.io.File(dir, "timesync.json.tmp");
        java.text.SimpleDateFormat iso = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT);
        iso.setTimeZone(TimeZone.getTimeZone("UTC"));
        String json = "{\"verifiedBy\":\"gnss\",\"verifiedAt\":\"" + iso.format(new java.util.Date(now)) + "\",\"deltaMs\":" + delta + "}";
        try (java.io.FileOutputStream o = new java.io.FileOutputStream(tmp)) {
            o.write(json.getBytes(StandardCharsets.UTF_8));
        } catch (java.io.IOException e) {
            return;
        }
        //noinspection ResultOfMethodCallIgnored
        tmp.renameTo(new java.io.File(dir, "timesync.json"));
    }

    // ------------------------------------------------------------------ NMEA compuesto

    static String[] synth(Location l, int satsUsed) {
        Calendar c = Calendar.getInstance(TimeZone.getTimeZone("UTC"), Locale.ROOT);
        c.setTimeInMillis(l.getTime());
        String time = String.format(Locale.ROOT, "%02d%02d%02d.%02d", c.get(Calendar.HOUR_OF_DAY), c.get(Calendar.MINUTE), c.get(Calendar.SECOND), c.get(Calendar.MILLISECOND) / 10);
        String date = String.format(Locale.ROOT, "%02d%02d%02d", c.get(Calendar.DAY_OF_MONTH), c.get(Calendar.MONTH) + 1, c.get(Calendar.YEAR) % 100);
        String lat = coord(Math.abs(l.getLatitude()), 2) + "," + (l.getLatitude() >= 0 ? "N" : "S");
        String lon = coord(Math.abs(l.getLongitude()), 3) + "," + (l.getLongitude() >= 0 ? "E" : "W");
        String alt = "";
        if (Build.VERSION.SDK_INT >= 34 && l.hasMslAltitude()) alt = String.format(Locale.ROOT, "%.1f", l.getMslAltitudeMeters());
        String sats = satsUsed >= 0 ? String.format(Locale.ROOT, "%02d", satsUsed) : "";
        String gga = "GPGGA," + time + "," + lat + "," + lon + ",1," + sats + ",," + alt + "," + (alt.isEmpty() ? "" : "M") + ",,,,";
        String speed = l.hasSpeed() ? String.format(Locale.ROOT, "%.2f", l.getSpeed() / 0.514444) : "";
        String course = l.hasBearing() ? String.format(Locale.ROOT, "%.1f", l.getBearing()) : "";
        String rmc = "GPRMC," + time + ",A," + lat + "," + lon + "," + speed + "," + course + "," + date + ",,,A";
        return new String[]{"$" + gga + "*" + checksum(gga), "$" + rmc + "*" + checksum(rmc)};
    }

    /**
     * GST con la precisión horizontal de Android (radio del 68 %), repartida por igual en latitud y longitud
     * (σ = r/√2, así √(σlat² + σlon²) = r). Sin precisión informada → null (no se envía).
     */
    static String gst(Location l) {
        if (!l.hasAccuracy() || l.getAccuracy() <= 0) return null;
        Calendar c = Calendar.getInstance(TimeZone.getTimeZone("UTC"), Locale.ROOT);
        c.setTimeInMillis(l.getTime());
        String time = String.format(Locale.ROOT, "%02d%02d%02d.%02d", c.get(Calendar.HOUR_OF_DAY), c.get(Calendar.MINUTE), c.get(Calendar.SECOND), c.get(Calendar.MILLISECOND) / 10);
        String sigma = String.format(Locale.ROOT, "%.1f", Math.max(0.1, l.getAccuracy() / Math.sqrt(2)));
        String alt = l.hasVerticalAccuracy() ? String.format(Locale.ROOT, "%.1f", l.getVerticalAccuracyMeters()) : "";
        String body = "GPGST," + time + ",,,,," + sigma + "," + sigma + "," + alt;
        return "$" + body + "*" + checksum(body);
    }

    /** 40.385390 → "4023.1234" (grados con 2 o 3 cifras + minutos). */
    static String coord(double deg, int degDigits) {
        int d = (int) Math.floor(deg);
        double m = (deg - d) * 60.0;
        if (m >= 59.99995) {
            d += 1;
            m = 0;
        }
        return String.format(Locale.ROOT, "%0" + degDigits + "d%07.4f", d, m);
    }

    /** «$…*HH» con el XOR correcto (lo mismo que comprueba serial-hub, nmea.ts). */
    static boolean validNmea(String line) {
        int star = line.lastIndexOf('*');
        if (!line.startsWith("$") || star < 2 || star + 3 != line.length()) return false;
        return checksum(line.substring(1, star)).equalsIgnoreCase(line.substring(star + 1));
    }

    static String checksum(String body) {
        int x = 0;
        for (int i = 0; i < body.length(); i++) x ^= body.charAt(i);
        return String.format(Locale.ROOT, "%02X", x);
    }
}
