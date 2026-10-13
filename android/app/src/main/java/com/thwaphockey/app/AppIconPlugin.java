package com.thwaphockey.app;

import android.app.Activity;
import android.content.ComponentName;
import android.content.pm.PackageManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Local Capacitor plugin for the selectable app-icon feature (see app-icons/README.md).
 * Registered as "DynamicAppIcon" so index.html's applyNative() picks it up via its
 * first lookup path: window.Capacitor.Plugins.DynamicAppIcon.change({ name }).
 *
 * On Android, `name` is the manifest's `androidAlias` (e.g. "IconHandsGreen"), the
 * <activity-alias android:name> value without its leading dot. Exactly one launcher
 * component must ever be enabled at a time, so changing the icon enables the chosen
 * alias and disables every other alias PLUS MainActivity's own LAUNCHER component.
 */
@CapacitorPlugin(name = "DynamicAppIcon")
public class AppIconPlugin extends Plugin {

    // Every selectable-icon activity-alias name declared in AndroidManifest.xml
    // (android:name values, without the leading "."), one per app-icons/manifest.json entry.
    private static final String[] ALL_ALIASES = {
        "IconHandsGreen", "IconHandsBlue", "IconHandsOrange", "IconHandsPurple", "IconHandsPink",
        "IconShootingGreen", "IconShootingBlue", "IconShootingOrange", "IconShootingPurple", "IconShootingPink",
        "IconPassingGreen", "IconPassingBlue", "IconPassingOrange", "IconPassingPurple", "IconPassingPink",
        "IconDrylandGreen", "IconDrylandBlue", "IconDrylandOrange", "IconDrylandPurple", "IconDrylandPink"
    };

    private static final String MAIN_ACTIVITY = "com.thwaphockey.app.MainActivity";

    @PluginMethod()
    public void change(PluginCall call) {
        setIcon(call);
    }

    @PluginMethod()
    public void setIcon(PluginCall call) {
        String name = call.getString("name");
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("No activity available to switch the app icon");
            return;
        }

        PackageManager pm = activity.getPackageManager();
        String pkg = activity.getPackageName();
        boolean resetToPrimary = (name == null || name.isEmpty());

        if (!resetToPrimary) {
            boolean known = false;
            for (String alias : ALL_ALIASES) {
                if (alias.equals(name)) { known = true; break; }
            }
            if (!known) {
                call.reject("Unknown app icon alias: " + name);
                return;
            }
        }

        try {
            // Disable every alternate alias except the one being enabled.
            for (String alias : ALL_ALIASES) {
                boolean isTarget = !resetToPrimary && alias.equals(name);
                pm.setComponentEnabledSetting(
                    new ComponentName(pkg, pkg + "." + alias),
                    isTarget ? PackageManager.COMPONENT_ENABLED_STATE_ENABLED : PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                    PackageManager.DONT_KILL_APP
                );
            }
            // MainActivity's own LAUNCHER entry is enabled only when resetting to the primary icon.
            pm.setComponentEnabledSetting(
                new ComponentName(pkg, MAIN_ACTIVITY),
                resetToPrimary ? PackageManager.COMPONENT_ENABLED_STATE_ENABLED : PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                PackageManager.DONT_KILL_APP
            );
        } catch (Exception e) {
            call.reject("Failed to set alternate icon: " + e.getMessage(), e);
            return;
        }

        JSObject ret = new JSObject();
        ret.put("name", resetToPrimary ? "" : name);
        call.resolve(ret);
    }
}
