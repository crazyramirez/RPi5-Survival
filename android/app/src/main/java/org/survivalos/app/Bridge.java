package org.survivalos.app;

import android.util.Log;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Puente nativo (ADR 0020): HTTP/1.1 mínimo en 127.0.0.1 para lo que Node no puede hacer en Android (USB, GNSS,
 * batería, BRouter, instalar un APK, fijar la pantalla…). Cualquier app del dispositivo puede conectarse a
 * loopback, así que toda petición debe traer la cabecera x-survival-token (la añade android-guard.mjs).
 */
final class Bridge {
    interface Handler {
        /** Devuelve el cuerpo JSON de la respuesta; lanza BridgeError para un código distinto de 200. */
        JSONObject handle(String method, String path, JSONObject body) throws Exception;
    }

    static final class BridgeError extends Exception {
        final int status;

        BridgeError(int status, String message) {
            super(message);
            this.status = status;
        }
    }

    private static final String TAG = "SurvivalBridge";
    private static final int MAX_BODY = 64 * 1024;

    private final String token;
    private final Handler handler;
    private final ExecutorService pool = Executors.newCachedThreadPool();
    private ServerSocket server;

    Bridge(String token, Handler handler) {
        this.token = token;
        this.handler = handler;
    }

    /** Arranca en un puerto libre de loopback y lo devuelve. */
    int start() throws IOException {
        server = new ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"));
        Thread t = new Thread(this::acceptLoop, "bridge-accept");
        t.setDaemon(true);
        t.start();
        return server.getLocalPort();
    }

    void stop() {
        try {
            if (server != null) server.close();
        } catch (IOException ignored) {
            // ya cerrado
        }
        pool.shutdownNow();
    }

    private void acceptLoop() {
        while (server != null && !server.isClosed()) {
            try {
                Socket s = server.accept();
                pool.execute(() -> serve(s));
            } catch (IOException e) {
                if (server.isClosed()) return;
                Log.w(TAG, "accept: " + e.getMessage());
            }
        }
    }

    private void serve(Socket s) {
        try (Socket sock = s) {
            sock.setSoTimeout(30_000);
            InputStream in = new BufferedInputStream(sock.getInputStream());
            String requestLine = readLine(in);
            if (requestLine == null) return;
            String[] parts = requestLine.split(" ");
            if (parts.length < 2) {
                respond(sock.getOutputStream(), 400, error("petición no válida"));
                return;
            }
            String method = parts[0];
            String path = parts[1];
            int q = path.indexOf('?');
            if (q >= 0) path = path.substring(0, q);
            Map<String, String> headers = new HashMap<>();
            String line;
            while ((line = readLine(in)) != null && !line.isEmpty()) {
                int c = line.indexOf(':');
                if (c > 0) headers.put(line.substring(0, c).trim().toLowerCase(Locale.ROOT), line.substring(c + 1).trim());
            }
            if (!sameToken(headers.get("x-survival-token"))) {
                respond(sock.getOutputStream(), 403, error("prohibido"));
                return;
            }
            int len = 0;
            try {
                len = Integer.parseInt(headers.getOrDefault("content-length", "0"));
            } catch (NumberFormatException ignored) {
                // sin cuerpo
            }
            if (len < 0 || len > MAX_BODY) {
                respond(sock.getOutputStream(), 413, error("cuerpo demasiado grande"));
                return;
            }
            byte[] buf = new byte[len];
            int read = 0;
            while (read < len) {
                int n = in.read(buf, read, len - read);
                if (n < 0) break;
                read += n;
            }
            JSONObject body = new JSONObject();
            if (len > 0) {
                try {
                    body = new JSONObject(new String(buf, 0, read, StandardCharsets.UTF_8));
                } catch (Exception e) {
                    respond(sock.getOutputStream(), 400, error("JSON no válido"));
                    return;
                }
            }
            try {
                respond(sock.getOutputStream(), 200, handler.handle(method, path, body));
            } catch (BridgeError e) {
                respond(sock.getOutputStream(), e.status, error(e.getMessage()));
            } catch (Exception e) {
                Log.w(TAG, method + " " + path + ": " + e);
                respond(sock.getOutputStream(), 500, error(String.valueOf(e.getMessage())));
            }
        } catch (IOException e) {
            // cliente desconectado
        }
    }

    private boolean sameToken(String got) {
        if (got == null) return false;
        return MessageDigest.isEqual(got.getBytes(StandardCharsets.UTF_8), token.getBytes(StandardCharsets.UTF_8));
    }

    private static JSONObject error(String msg) {
        JSONObject o = new JSONObject();
        try {
            o.put("error", msg);
        } catch (Exception ignored) {
            // nunca
        }
        return o;
    }

    private static void respond(OutputStream out, int status, JSONObject body) throws IOException {
        byte[] data = (body == null ? "{}" : body.toString()).getBytes(StandardCharsets.UTF_8);
        String head = "HTTP/1.1 " + status + " " + (status == 200 ? "OK" : "Error") + "\r\n"
                + "content-type: application/json; charset=utf-8\r\n"
                + "cache-control: no-store\r\n"
                + "content-length: " + data.length + "\r\n"
                + "connection: close\r\n\r\n";
        out.write(head.getBytes(StandardCharsets.US_ASCII));
        out.write(data);
        out.flush();
    }

    /** Línea terminada en CRLF (o LF), máximo 8 KB. */
    private static String readLine(InputStream in) throws IOException {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        int c;
        while ((c = in.read()) >= 0) {
            if (c == '\n') break;
            if (c != '\r') b.write(c);
            if (b.size() > 8192) throw new IOException("línea demasiado larga");
        }
        if (c < 0 && b.size() == 0) return null;
        return b.toString("UTF-8");
    }
}
