# Native system-bar theming (status bar + Android nav bar, edge-to-edge)

Goal: the phone's system bars match the app instead of a default white/black, and the
app runs edge-to-edge. This is **native-only** (the website is untouched).

## The targetSdk 35 reality

The Android build targets SDK 35 (Android 15), which **forces edge-to-edge** — apps can't
opt out. The status bar and navigation bar are **transparent**, and the old
`android:statusBarColor` / `android:navigationBarColor` theme attributes are **ignored**.

So "colouring" the bars is not a thing anymore. Instead:

1. **The bar colour is whatever app content sits behind it.** That is already themed:
   the status-bar strip shows the `body` gradient (`var(--bg)`), and the nav-bar strip
   shows the bottom tab bar's panel (`var(--panel)`), because the tab bar extends its
   background into `env(safe-area-inset-bottom)`. Safe-area insets are handled throughout
   via `env(safe-area-inset-*)`, so nothing is hidden behind the bars.
2. **What must follow the in-app light/dark toggle is the bar ICON contrast** — dark icons
   on a light theme, light icons on a dark theme. That can't be set statically (the app
   has its own theme toggle, independent of the OS), so it's driven at runtime from JS.

## How it's wired

| Bar | Who sets the icon contrast | Call |
|-----|---------------------------|------|
| Status bar | `@capacitor/status-bar` (added earlier, #400) | `thwapSyncStatusBar(dark)` → `StatusBar.setStyle` |
| Android nav bar | local `SystemBars` plugin (this change) | `thwapSyncNavBar(dark)` → `SystemBars.setStyle({dark})` |

Both are called together from the theme bootstrap (`apply()` in `index.html`) on load and on
every toggle, so the bars always track the current theme. The two are deliberately split so
the nav-bar work does **not** touch #400's status-bar code.

- **`SystemBarsPlugin.java`** — a local Capacitor plugin (same pattern as `AppIconPlugin`),
  registered in `MainActivity`. `setStyle({dark})` flips the nav-bar icon appearance via
  `WindowInsetsControllerCompat.setAppearanceLightNavigationBars(!dark)`. No npm dependency.
- **`thwapSyncNavBar(dark)`** (in `index.html`) prefers `Capacitor.Plugins.SystemBars`, and
  falls back to a third-party `NavigationBar` plugin (`setColor({color, darkButtons})`, useful
  on pre-15 Android where colour still applies) or a `window.thwapSetNavBar` bridge. No-op on
  iOS (no nav bar) and on the web.

## iOS

iOS has no bottom navigation bar; the home indicator adapts to the content behind it
automatically. The status bar is handled by `thwapSyncStatusBar` + the system
(`UIViewControllerBasedStatusBarAppearance`). Nothing extra is needed here.

## Verifying (needs a build)

The JS wiring is covered by `test/native-system-bars.test.js`. The actual bar appearance can
only be seen on a device/emulator:

1. `npx cap sync android` (picks up the new local plugin).
2. Build + run on Android 15.
3. Toggle the in-app theme; the nav-bar icons should flip light/dark with the app, and the
   bar should read as part of the app (no white/black gap) top and bottom.

## Coordination

Additive to #400. It does **not** change `StatusBar.overlaysWebView`, `thwapSyncStatusBar`, or
the capacitor config. The only shared file is `MainActivity.java` (one `registerPlugin` line
next to the existing `AppIconPlugin`).
