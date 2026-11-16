package org.survivalos.app;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.usb.UsbConstants;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbManager;
import android.os.Build;
import android.util.Log;

import com.hoho.android.usbserial.driver.CdcAcmSerialDriver;
import com.hoho.android.usbserial.driver.ProbeTable;
import com.hoho.android.usbserial.driver.UsbSerialDriver;
import com.hoho.android.usbserial.driver.UsbSerialPort;
import com.hoho.android.usbserial.driver.UsbSerialProber;
import com.hoho.android.usbserial.util.SerialInputOutputManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Puertos USB-serie (nodos Meshtastic, GPS USB, placas ESP32) con usb-serial-for-android (ADR 0020).
 * Los mismos VID que reconoce serial-hub (KNOWN_VIDS); ruta «usb:<id de dispositivo>».
 */
final class UsbSerial {
    private static final String TAG = "SurvivalUsb";
    private static final String ACTION_PERMISSION = "org.survivalos.app.USB_PERMISSION";
    /** Placas con USB nativo CDC-ACM que la tabla por defecto no siempre conoce (ESP32-S2/S3, RP2040, nRF52…). */
    private static final int[] CDC_VIDS = {0x303a, 0x239a, 0x2e8a, 0x1915, 0x2886, 0x1546};

    private final Context ctx;
    private final UsbManager usb;
    private final UsbSerialProber prober;

    UsbSerial(Context ctx) {
        this.ctx = ctx.getApplicationContext();
        this.usb = (UsbManager) ctx.getSystemService(Context.USB_SERVICE);
        ProbeTable table = UsbSerialProber.getDefaultProbeTable();
        this.prober = new UsbSerialProber(table);
    }

    private UsbSerialDriver driverFor(UsbDevice d) {
        UsbSerialDriver drv = prober.probeDevice(d);
        if (drv != null) return drv;
        // CDC-ACM genérico: placas conocidas con interfaz de datos, y cualquier aparato con interfaz de
        // comunicaciones (receptores GNSS de cualquier fabricante: serial-hub solo escucha NMEA en los desconocidos).
        boolean known = false;
        for (int vid : CDC_VIDS) if (d.getVendorId() == vid) known = true;
        for (int i = 0; i < d.getInterfaceCount(); i++) {
            int cls = d.getInterface(i).getInterfaceClass();
            if (cls == UsbConstants.USB_CLASS_COMM || (known && cls == UsbConstants.USB_CLASS_CDC_DATA)) return new CdcAcmSerialDriver(d);
        }
        return null;
    }

    private static String hex4(int v) {
        return String.format(Locale.ROOT, "%04x", v);
    }

    private static String label(UsbDevice d) {
        String name = null;
        try {
            String m = d.getManufacturerName();
            String p = d.getProductName();
            name = ((m != null ? m + " " : "") + (p != null ? p : "")).trim();
        } catch (SecurityException ignored) {
            // sin permiso aún
        }
        return name == null || name.isEmpty() ? "USB " + hex4(d.getVendorId()) + ":" + hex4(d.getProductId()) : name;
    }

    /** [{ path, label, vid, pid, permission }] */
    JSONArray list() throws Exception {
        JSONArray out = new JSONArray();
        if (usb == null) return out;
        for (UsbDevice d : usb.getDeviceList().values()) {
            if (driverFor(d) == null) continue;
            JSONObject o = new JSONObject();
            o.put("path", "usb:" + d.getDeviceId());
            o.put("label", label(d));
            o.put("vid", hex4(d.getVendorId()));
            o.put("pid", hex4(d.getProductId()));
            o.put("permission", usb.hasPermission(d));
            out.put(o);
        }
        return out;
    }

    List<String> paths() {
        List<String> out = new ArrayList<>();
        if (usb == null) return out;
        for (UsbDevice d : usb.getDeviceList().values()) if (driverFor(d) != null) out.add("usb:" + d.getDeviceId());
        return out;
    }

    private UsbDevice find(String path) {
        if (usb == null || !path.startsWith("usb:")) return null;
        for (UsbDevice d : usb.getDeviceList().values()) if (path.equals("usb:" + d.getDeviceId())) return d;
        return null;
    }

    /** Pide el permiso USB (diálogo de Android) y espera la respuesta. */
    private boolean ensurePermission(UsbDevice d) throws InterruptedException {
        if (usb.hasPermission(d)) return true;
        CountDownLatch done = new CountDownLatch(1);
        AtomicBoolean granted = new AtomicBoolean(false);
        BroadcastReceiver r = new BroadcastReceiver() {
            @Override
            public void onReceive(Context c, Intent i) {
                granted.set(i.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false));
                done.countDown();
            }
        };
        IntentFilter f = new IntentFilter(ACTION_PERMISSION);
        if (Build.VERSION.SDK_INT >= 33) ctx.registerReceiver(r, f, Context.RECEIVER_NOT_EXPORTED);
        else ctx.registerReceiver(r, f);
        try {
            Intent i = new Intent(ACTION_PERMISSION).setPackage(ctx.getPackageName());
            int flags = Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0;
            usb.requestPermission(d, PendingIntent.getBroadcast(ctx, d.getDeviceId(), i, flags));
            done.await(60, TimeUnit.SECONDS);
        } finally {
            ctx.unregisterReceiver(r);
        }
        return granted.get() || usb.hasPermission(d);
    }

    /** Abre el puerto (8N1, DTR activo, RTS inactivo) y lo sirve por un StreamRelay. */
    StreamRelay open(String path, int baud) throws Exception {
        UsbDevice d = find(path);
        if (d == null) throw new Bridge.BridgeError(404, "Dispositivo USB no conectado");
        UsbSerialDriver drv = driverFor(d);
        if (drv == null || drv.getPorts().isEmpty()) throw new Bridge.BridgeError(400, "No es un puerto serie USB conocido");
        if (!ensurePermission(d)) throw new Bridge.BridgeError(403, "Permiso USB denegado");
        UsbDeviceConnection conn = usb.openDevice(d);
        if (conn == null) throw new Bridge.BridgeError(409, "No se pudo abrir el dispositivo USB");
        UsbSerialPort port = drv.getPorts().get(0);
        try {
            port.open(conn);
            port.setParameters(baud, 8, UsbSerialPort.STOPBITS_1, UsbSerialPort.PARITY_NONE);
        } catch (IOException e) {
            try {
                port.close();
            } catch (IOException ignored) {
                // nada
            }
            throw new Bridge.BridgeError(409, "No se pudo configurar el puerto: " + e.getMessage());
        }
        try {
            port.setDTR(true);
            port.setRTS(false);
        } catch (Exception ignored) {
            // algunos adaptadores no tienen líneas de control
        }
        StreamRelay relay = new StreamRelay();
        SerialInputOutputManager io = new SerialInputOutputManager(port, new SerialInputOutputManager.Listener() {
            @Override
            public void onNewData(byte[] data) {
                relay.send(data, data.length);
            }

            @Override
            public void onRunError(Exception e) {
                Log.i(TAG, path + ": " + e.getMessage());
                relay.close();
            }
        });
        relay.start(new StreamRelay.Device() {
            @Override
            public void write(byte[] data, int len) throws IOException {
                byte[] b = len == data.length ? data : java.util.Arrays.copyOf(data, len);
                port.write(b, 2000);
            }

            @Override
            public void close() {
                io.stop();
                try {
                    port.close();
                } catch (IOException ignored) {
                    // ya cerrado (dispositivo retirado)
                }
            }
        }, path);
        io.start();
        return relay;
    }
}
