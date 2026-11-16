package org.survivalos.app;

import android.util.Log;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;

/**
 * Flujo de bytes entre un dispositivo (USB serie, GNSS) y serial-hub (Node) por TCP en 127.0.0.1 (ADR 0020).
 * El puerto es efímero y acepta UNA conexión, que debe empezar con la clave de un solo uso + "\n": otra app del
 * dispositivo no puede colarse aunque vea el puerto.
 */
final class StreamRelay {
    /** Lado del dispositivo. */
    interface Device {
        /** Bytes de serial-hub hacia el dispositivo. */
        void write(byte[] data, int len) throws IOException;

        /** serial-hub cerró la conexión (o falló): liberar el dispositivo. */
        void close();
    }

    private static final String TAG = "SurvivalRelay";
    private static final SecureRandom RNG = new SecureRandom();

    final int port;
    final String key;
    private final ServerSocket server;
    private volatile OutputStream toHub;
    private volatile Socket client;
    private volatile boolean closed;
    private Device device;

    StreamRelay() throws IOException {
        byte[] k = new byte[16];
        RNG.nextBytes(k);
        StringBuilder sb = new StringBuilder();
        for (byte b : k) sb.append(String.format("%02x", b));
        key = sb.toString();
        server = new ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"));
        server.setSoTimeout(15_000);
        port = server.getLocalPort();
    }

    /** Espera a serial-hub en segundo plano y empieza a reenviar hacia `device`. */
    void start(Device device, String name) {
        this.device = device;
        Thread t = new Thread(() -> run(name), "relay-" + name);
        t.setDaemon(true);
        t.start();
    }

    private void run(String name) {
        try {
            Socket s = server.accept();
            server.close();
            s.setTcpNoDelay(true);
            InputStream in = s.getInputStream();
            // Clave: 32 hex + "\n".
            byte[] got = new byte[key.length() + 1];
            int n = 0;
            s.setSoTimeout(5000);
            while (n < got.length) {
                int r = in.read(got, n, got.length - n);
                if (r < 0) break;
                n += r;
            }
            byte[] want = (key + "\n").getBytes(StandardCharsets.US_ASCII);
            if (n != got.length || !MessageDigest.isEqual(got, want)) {
                s.close();
                close();
                return;
            }
            s.setSoTimeout(0);
            client = s;
            toHub = s.getOutputStream();
            byte[] buf = new byte[4096];
            int r;
            while (!closed && (r = in.read(buf)) >= 0) {
                if (r > 0) device.write(buf, r);
            }
        } catch (SocketTimeoutException e) {
            Log.w(TAG, name + ": serial-hub no se conectó");
        } catch (IOException e) {
            if (!closed) Log.i(TAG, name + ": " + e.getMessage());
        } finally {
            close();
        }
    }

    /** Bytes del dispositivo hacia serial-hub (se descartan hasta que se conecte). */
    void send(byte[] data, int len) {
        OutputStream o = toHub;
        if (o == null || closed) return;
        try {
            o.write(data, 0, len);
            o.flush();
        } catch (IOException e) {
            close();
        }
    }

    boolean isClosed() {
        return closed;
    }

    void close() {
        if (closed) return;
        closed = true;
        try {
            server.close();
        } catch (IOException ignored) {
            // nada
        }
        try {
            if (client != null) client.close();
        } catch (IOException ignored) {
            // nada
        }
        if (device != null) device.close();
    }
}
