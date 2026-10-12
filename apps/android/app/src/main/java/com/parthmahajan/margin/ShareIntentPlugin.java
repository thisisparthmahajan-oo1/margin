package com.parthmahajan.margin;

import android.content.Intent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Receives links shared to Margin from other apps (Android share sheet, ACTION_SEND text/plain)
 * and forwards them to the web layer as a "shared" event. Events are retained until a listener
 * is attached, so a share that cold-starts the app is still delivered once the page has loaded.
 */
@CapacitorPlugin(name = "ShareIntent")
public class ShareIntentPlugin extends Plugin {

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
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction()) || !"text/plain".equals(intent.getType())) {
            return;
        }
        String text = intent.getStringExtra(Intent.EXTRA_TEXT);
        if (text == null || text.trim().isEmpty()) return;
        // Consume the intent so a configuration change doesn't deliver the same share twice.
        intent.setAction(Intent.ACTION_MAIN);

        JSObject data = new JSObject();
        data.put("text", text);
        notifyListeners("shared", data, true);
    }
}
