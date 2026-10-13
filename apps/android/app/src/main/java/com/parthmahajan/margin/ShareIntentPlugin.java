package com.parthmahajan.margin;

import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import com.getcapacitor.JSObject;
import com.getcapacitor.Logger;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Receives what other apps share to Margin and forwards it to the web layer as a "shared" event:
 * - a link (ACTION_SEND text/plain): {@code { text }}
 * - a PDF (ACTION_SEND or ACTION_VIEW application/pdf): {@code { file: { path, name } }}, a copy in
 *   the app's cache, because the sending app's content:// URI can't be read from the WebView.
 * Events are retained until a listener is attached, so a share that cold-starts the app is still
 * delivered once the page has loaded.
 */
@CapacitorPlugin(name = "ShareIntent")
public class ShareIntentPlugin extends Plugin {

    private static final String PDF = "application/pdf";
    /** Copies older than this were already read by the web layer (or never will be). */
    private static final long STALE_COPY_MS = 60 * 60 * 1000;

    @Override
    public void load() {
        forward(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        forward(intent);
    }

    private void forward(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        String type = intent.getType();

        if (Intent.ACTION_SEND.equals(action) && "text/plain".equals(type)) {
            String text = intent.getStringExtra(Intent.EXTRA_TEXT);
            if (text == null || text.trim().isEmpty()) return;
            consume(intent);
            JSObject data = new JSObject();
            data.put("text", text);
            notifyListeners("shared", data, true);
        } else if (Intent.ACTION_SEND.equals(action) && PDF.equals(type)) {
            Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (uri == null) return;
            consume(intent);
            forwardFile(uri);
        } else if (Intent.ACTION_VIEW.equals(action) && intent.getData() != null && PDF.equals(type)) {
            Uri uri = intent.getData();
            consume(intent);
            forwardFile(uri);
        }
    }

    /** So a configuration change doesn't deliver the same share twice. */
    private void consume(Intent intent) {
        intent.setAction(Intent.ACTION_MAIN);
    }

    /** Copies off the main thread: PDFs can be large. */
    private void forwardFile(Uri uri) {
        new Thread(() -> {
            try {
                String name = displayName(uri);
                File dir = new File(getContext().getCacheDir(), "shared");
                if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("Can't create " + dir);
                removeStaleCopies(dir);
                File copy = new File(dir, System.currentTimeMillis() + "-" + name.replaceAll("[^\\w.\\- ]", "_"));
                try (InputStream in = getContext().getContentResolver().openInputStream(uri); OutputStream out = new FileOutputStream(copy)) {
                    if (in == null) throw new IllegalStateException("No data for " + uri);
                    byte[] buffer = new byte[64 * 1024];
                    for (int n; (n = in.read(buffer)) > 0; ) out.write(buffer, 0, n);
                }
                JSObject file = new JSObject();
                file.put("path", copy.getAbsolutePath());
                file.put("name", name);
                JSObject data = new JSObject();
                data.put("file", file);
                notifyListeners("shared", data, true);
            } catch (Exception e) {
                Logger.error("ShareIntent", "Couldn't read the shared file", e);
            }
        }).start();
    }

    private String displayName(Uri uri) {
        try (Cursor cursor = getContext().getContentResolver().query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst() && !cursor.isNull(0)) return cursor.getString(0);
        } catch (Exception ignored) {
            // fall through to the URI's last segment
        }
        String last = uri.getLastPathSegment();
        return last != null ? last : "Document.pdf";
    }

    private void removeStaleCopies(File dir) {
        File[] files = dir.listFiles();
        if (files == null) return;
        long cutoff = System.currentTimeMillis() - STALE_COPY_MS;
        for (File f : files) if (f.lastModified() < cutoff) f.delete();
    }
}
