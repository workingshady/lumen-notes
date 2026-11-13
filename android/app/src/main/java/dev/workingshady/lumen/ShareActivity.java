package dev.workingshady.lumen;

import android.graphics.Color;
import android.os.Bundle;

import de.mindlib.sendIntent.SendIntentActivity;

/**
 * Target of the system share sheet (design Lumen 12 · R3-5E "Save to Lumen").
 * A translucent Capacitor activity: the web app sees the intent via the send-intent plugin and shows only the
 * "Save to Lumen" sheet over the source app; SendIntent.finish() closes it after saving.
 */
public class ShareActivity extends SendIntentActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (getBridge() != null && getBridge().getWebView() != null) getBridge().getWebView().setBackgroundColor(Color.TRANSPARENT);
    }
}
