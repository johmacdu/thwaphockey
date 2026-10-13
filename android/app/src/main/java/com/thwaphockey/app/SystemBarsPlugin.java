package com.thwaphockey.app;

import android.app.Activity;
import android.view.Window;

import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Local Capacitor plugin for native system-bar theming (see docs/native-system-bars.md).
 * Registered as "SystemBars" so index.html's thwapSyncNavBar() picks it up via
 * window.Capacitor.Plugins.SystemBars.setStyle({ dark }).
 *
 * targetSdk 35 (Android 15) forces edge-to-edge: the status and navigation bars are
 * transparent and android:navigationBarColor / statusBarColor are ignored, so the bar
 * COLOUR comes from the app content behind them (the themed body gradient + tab-bar
 * panel). What still has to follow the in-app light/dark toggle is the bar ICON
 * contrast. This sets the NAVIGATION bar icon appearance; the STATUS bar is left to
 * the @capacitor/status-bar plugin (thwapSyncStatusBar), so the two don't fight.
 *
 * Light bars (dark icons) when the app is in LIGHT theme; dark bars (light icons) in dark.
 */
@CapacitorPlugin(name = "SystemBars")
public class SystemBarsPlugin extends Plugin {

    @PluginMethod()
    public void setStyle(PluginCall call) {
        final boolean dark = Boolean.TRUE.equals(call.getBoolean("dark", false));
        final Activity activity = getActivity();
        if (activity == null) {
            call.reject("No activity available to theme the system bars");
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                Window window = activity.getWindow();
                WindowInsetsControllerCompat controller =
                    new WindowInsetsControllerCompat(window, window.getDecorView());
                // dark icons on the nav bar only when the app is in LIGHT theme
                controller.setAppearanceLightNavigationBars(!dark);
            } catch (Exception ignored) {
                // Non-fatal: on very old devices / unusual window states we simply
                // leave the system default nav-bar appearance in place.
            }
        });
        call.resolve();
    }
}
