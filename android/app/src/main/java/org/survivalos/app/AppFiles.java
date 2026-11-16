package org.survivalos.app;

import android.content.Context;
import android.content.res.AssetManager;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * La aplicación (web Nuxt, servicios Node, contenido, lanzador) va en assets/app.zip; se extrae a
 * <privado>/app la primera vez y tras cada actualización del APK (assets/app-build.txt cambia). La estructura es
 * la de la portable: <privado>/app, <privado>/runtime y los datos donde elija la persona (ADR 0020).
 */
final class AppFiles {
    interface Progress {
        void onProgress(int percent);
    }

    private AppFiles() {
    }

    static File appDir(Context ctx) {
        return new File(ctx.getFilesDir(), "app");
    }

    private static String readAsset(AssetManager am, String name) throws IOException {
        try (InputStream in = am.open(name); BufferedReader r = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
            String l = r.readLine();
            return l == null ? "" : l.trim();
        }
    }

    /** ¿Hace falta extraer? */
    static boolean upToDate(Context ctx) {
        try {
            String want = readAsset(ctx.getAssets(), "app-build.txt");
            File marker = new File(appDir(ctx), ".android-build");
            return marker.exists() && want.equals(new String(Files.readAllBytes(marker.toPath()), StandardCharsets.UTF_8).trim());
        } catch (IOException e) {
            return false;
        }
    }

    /** Extrae app.zip en <privado>/app.new y sustituye <privado>/app de una vez. */
    static void extract(Context ctx, Progress progress) throws IOException {
        AssetManager am = ctx.getAssets();
        String build = readAsset(am, "app-build.txt");
        int total = 1;
        try {
            total = Math.max(1, Integer.parseInt(readAsset(am, "app-files.txt")));
        } catch (NumberFormatException ignored) {
            // sin recuento: progreso aproximado
        }
        File base = ctx.getFilesDir();
        File tmp = new File(base, "app.new");
        deleteTree(tmp);
        String root = tmp.getCanonicalPath() + File.separator;
        byte[] buf = new byte[256 * 1024];
        int n = 0;
        try (ZipInputStream zin = new ZipInputStream(am.open("app.zip"))) {
            ZipEntry e;
            while ((e = zin.getNextEntry()) != null) {
                File out = new File(tmp, e.getName());
                if (!out.getCanonicalPath().startsWith(root)) throw new IOException("ruta no válida en app.zip: " + e.getName());
                if (e.isDirectory()) {
                    //noinspection ResultOfMethodCallIgnored
                    out.mkdirs();
                    continue;
                }
                //noinspection ResultOfMethodCallIgnored
                out.getParentFile().mkdirs();
                try (OutputStream o = new FileOutputStream(out)) {
                    int r;
                    while ((r = zin.read(buf)) > 0) o.write(buf, 0, r);
                }
                if (++n % 200 == 0) progress.onProgress(Math.min(99, n * 100 / total));
            }
        }
        try (OutputStream o = new FileOutputStream(new File(tmp, ".android-build"))) {
            o.write(build.getBytes(StandardCharsets.UTF_8));
        }
        File app = appDir(ctx);
        File old = new File(base, "app.old");
        deleteTree(old);
        if (app.exists() && !app.renameTo(old)) throw new IOException("no se pudo sustituir la aplicación");
        if (!tmp.renameTo(app)) throw new IOException("no se pudo instalar la aplicación");
        deleteTree(old);
        progress.onProgress(100);
    }

    static void deleteTree(File f) {
        if (f == null || !f.exists()) return;
        File[] children = Files.isSymbolicLink(f.toPath()) ? null : f.listFiles();
        if (children != null) for (File c : children) deleteTree(c);
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }
}
