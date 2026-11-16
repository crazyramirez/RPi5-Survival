package org.survivalos.app;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;

/**
 * Entrega al instalador de Android el APK de actualización ya verificado (SHA-256) por portable-admin.mjs. Solo
 * sirve un fichero fijo de la caché de la app, de solo lectura y con permiso temporal (grantUriPermissions).
 */
public final class ApkProvider extends ContentProvider {
    static final String NAME = "update.apk";

    static File file(android.content.Context ctx) {
        return new File(new File(ctx.getCacheDir(), "update"), NAME);
    }

    static Uri uri(android.content.Context ctx) {
        return Uri.parse("content://" + ctx.getPackageName() + ".apk/" + NAME);
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!NAME.equals(uri.getLastPathSegment()) || !"r".equals(mode)) throw new FileNotFoundException();
        return ParcelFileDescriptor.open(file(getContext()), ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public String getType(Uri uri) {
        return "application/vnd.android.package-archive";
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        MatrixCursor c = new MatrixCursor(new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE});
        File f = file(getContext());
        if (f.exists()) c.addRow(new Object[]{NAME, f.length()});
        return c;
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        throw new UnsupportedOperationException();
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        throw new UnsupportedOperationException();
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        throw new UnsupportedOperationException();
    }
}
