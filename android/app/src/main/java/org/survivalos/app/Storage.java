package org.survivalos.app;

import android.Manifest;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Environment;
import android.os.StatFs;
import android.os.storage.StorageManager;
import android.os.storage.StorageVolume;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * Dónde viven los datos (mapas, Wikipedia, modelos, bóveda…; ADR 0020) y qué volúmenes extraíbles hay.
 *
 * - Carpeta «SurvivalOS» en la memoria interna o en la microSD: sobrevive a desinstalar la app; necesita el permiso
 *   «Acceso a todos los archivos» (Android 11+) o el de almacenamiento (Android 10).
 * - Carpeta privada de la app en la memoria interna o en la microSD: sin permisos, pero Android la BORRA al
 *   desinstalar (se avisa al elegirla).
 */
final class Storage {
    static final String PREFS = "survival";
    static final String KEY_DATA = "dataDir";
    static final String FOLDER = "SurvivalOS";

    static final class Option {
        final String path;
        final String label;
        final boolean removable;
        final boolean needsPermission;
        final boolean deletedOnUninstall;
        final long freeBytes;

        Option(String path, String label, boolean removable, boolean needsPermission, boolean deletedOnUninstall) {
            this.path = path;
            this.label = label;
            this.removable = removable;
            this.needsPermission = needsPermission;
            this.deletedOnUninstall = deletedOnUninstall;
            this.freeBytes = free(new File(path).getParentFile() != null && !new File(path).exists() ? new File(path).getParentFile() : new File(path));
        }
    }

    private Storage() {
    }

    static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** Carpeta de datos elegida, o null si aún no se ha elegido. */
    static String dataDir(Context ctx) {
        return prefs(ctx).getString(KEY_DATA, null);
    }

    static void setDataDir(Context ctx, String path) {
        prefs(ctx).edit().putString(KEY_DATA, path).apply();
    }

    static boolean hasAllFilesAccess(Context ctx) {
        if (Build.VERSION.SDK_INT >= 30) return Environment.isExternalStorageManager();
        return ctx.checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED;
    }

    static long free(File f) {
        try {
            File d = f;
            while (d != null && !d.exists()) d = d.getParentFile();
            if (d == null) return -1;
            StatFs s = new StatFs(d.getPath());
            return s.getAvailableBytes();
        } catch (Exception e) {
            return -1;
        }
    }

    /** Raíz de un volumen (API 30: getDirectory; API 29: ruta por reflexión, igual que el sistema). */
    static File volumeDir(StorageVolume v) {
        if (Build.VERSION.SDK_INT >= 30) return v.getDirectory();
        try {
            return (File) StorageVolume.class.getMethod("getPathFile").invoke(v);
        } catch (Exception e) {
            return null;
        }
    }

    /** Opciones para elegir dónde guardar los datos, la recomendada primero. */
    static List<Option> options(Context ctx) {
        List<Option> out = new ArrayList<>();
        StorageManager sm = (StorageManager) ctx.getSystemService(Context.STORAGE_SERVICE);
        // Carpetas «SurvivalOS» (sobreviven a desinstalar).
        File primary = Environment.getExternalStorageDirectory();
        out.add(new Option(new File(primary, FOLDER).getPath(), ctx.getString(R.string.storage_internal), false, true, false));
        if (sm != null) {
            for (StorageVolume v : sm.getStorageVolumes()) {
                File dir = volumeDir(v);
                if (!v.isRemovable() || dir == null || !Environment.MEDIA_MOUNTED.equals(v.getState())) continue;
                // Algunas marcas llaman a la microSD «disk»: nombre propio y, si hay varias, la descripción del sistema.
                out.add(new Option(new File(dir, FOLDER).getPath(), ctx.getString(R.string.storage_removable, v.getDescription(ctx)), true, true, false));
            }
        }
        // Carpetas privadas de la app (sin permisos; se borran al desinstalar).
        File[] priv = ctx.getExternalFilesDirs(null);
        for (int i = 0; i < priv.length; i++) {
            if (priv[i] == null) continue;
            String label = ctx.getString(i == 0 ? R.string.storage_private_internal : R.string.storage_private_sd);
            out.add(new Option(priv[i].getPath(), label, i > 0, false, true));
        }
        // La que más espacio tiene, primero (entre las que sobreviven a desinstalar).
        out.sort((a, b) -> a.deletedOnUninstall != b.deletedOnUninstall ? (a.deletedOnUninstall ? 1 : -1) : Long.compare(b.freeBytes, a.freeBytes));
        return out;
    }

    /**
     * Volúmenes extraíbles montados → <privado>/volumes.json, que lee portable/usb.mjs (memorias USB y microSD para
     * importar y hacer copias de seguridad).
     */
    static void writeVolumes(Context ctx) {
        JSONArray arr = new JSONArray();
        StorageManager sm = (StorageManager) ctx.getSystemService(Context.STORAGE_SERVICE);
        if (sm != null) {
            for (StorageVolume v : sm.getStorageVolumes()) {
                try {
                    File dir = volumeDir(v);
                    if (!v.isRemovable() || v.getUuid() == null || dir == null) continue;
                    JSONObject o = new JSONObject();
                    o.put("uuid", v.getUuid());
                    o.put("path", dir.getPath());
                    o.put("label", v.getDescription(ctx));
                    o.put("removable", true);
                    o.put("state", Environment.MEDIA_MOUNTED.equals(v.getState()) ? "mounted" : v.getState());
                    arr.put(o);
                } catch (Exception ignored) {
                    // volumen raro: se omite
                }
            }
        }
        File out = new File(ctx.getFilesDir(), "volumes.json");
        File tmp = new File(ctx.getFilesDir(), "volumes.json.tmp");
        try (FileOutputStream f = new FileOutputStream(tmp)) {
            f.write(arr.toString().getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            return;
        }
        //noinspection ResultOfMethodCallIgnored
        tmp.renameTo(out);
    }
}
