# Native verification checklist

One consolidated, on-device checklist for the recently merged native work. Every
feature here is native-only (gated on `body.is-native`); the plain website at
thwaphockey.com is untouched. Where a one-time native setup step is needed it is
called out, with a pointer to the authoritative README/doc rather than a long copy.

> Tip: there is an in-app helper. On a device, open the **Profile** tab and tap
> **Developer -> Native diagnostics**. It shows, read-only: platform, the
> `is-native` / `is-ios` / `is-android` flags, which Capacitor plugins are present
> (StatusBar, SystemBars, DynamicAppIcon/CapacitorDynamicIcon/AppIcon, Haptics,
> Share), the current theme, the safe-area insets (top/bottom), and the selected
> app icon. Use it as a fast "is the bridge wired?" readout while going through the
> steps below. It is hidden and inert on the plain web.

## 0. Build / sync (do this first)

The native shell loads the remote web app (Capacitor `server.url`), so a JS-only
change is picked up by reloading the app. A **sync + native build is required**
whenever native code, plugins, icons, or `capacitor.config.json` change.

iOS:

```
npx cap sync ios
npx cap open ios        # opens ios/App/App.xcworkspace in Xcode
# In Xcode: pick a Simulator or a device, press Run.
```

Android:

```
npx cap sync android
npx cap open android     # opens android/ in Android Studio
# In Android Studio: pick an emulator or a device, press Run.
```

`npx cap sync` copies web assets and, importantly, picks up the **local Capacitor
plugins** (`AppIconPlugin`, `SystemBars`) and any installed community plugins.

Automated coverage (run before pushing, must stay green):

```
npx vitest run --exclude '**/worktrees/**'
```

The JS wiring for every feature below has a jsdom test (see "Automated test" lines);
the device steps confirm the pieces jsdom cannot see (actual bars, actual icons).

---

## 1. Selectable app icons (iOS alternate icons + Android activity-aliases)

What it is: Profile -> Settings -> **App icon** lets the user pick a Sass skill x
color. The choice is saved to `localStorage.thwapAppIcon` and applied through the
`DynamicAppIcon` / `CapacitorDynamicIcon` / `AppIcon` bridge (iOS uses the
`iosKey`, Android uses the `androidAlias`; see `app-icons/README.md`).

One-time native setup (the step a build is needed for), per `app-icons/README.md`
"Finishing the native switch":

- The assets are already generated and committed: iOS alternates in
  `ios/App/App/` + `CFBundleAlternateIcons` in `Info.plist`; Android mipmaps + one
  `<activity-alias>` per icon in `AndroidManifest.xml` (all `enabled="false"` by
  default, so the primary `ic_launcher` / `AppIcon` ships).
- Install a dynamic-icon plugin **or** add the tiny custom bridge, exactly as
  `app-icons/README.md` describes:
  - iOS: `UIApplication.setAlternateIconName` (community plugin, or expose
    `window.thwapSetNativeIcon(name)`).
  - Android: `PackageManager.setComponentEnabledSetting` must **enable the chosen
    alias and disable every other alias + the `MainActivity` launcher component**,
    so exactly one launcher entry is ever enabled.

Verify:

1. Open Profile -> App icon. Confirm a grid of skill x color cells renders (driven
   by `app-icons/manifest.json`) and the current pick is outlined/checked.
2. Tap a different icon. The selection mark moves, and the choice persists across
   app relaunch (check Native diagnostics -> **App icon** reflects the new key).
3. iOS: a system alert appears ("You have changed the icon...") and the home-screen
   icon changes. That alert is expected OS behavior.
4. Android: background the app; the launcher repaints to the new icon shortly after
   (some launchers only repaint on background, and may briefly drop the icon).
5. If no native bridge/plugin is installed yet, the pick is still remembered and the
   app must not crash; the installed icon simply will not change. (This is the "fails
   safe with no bridge" path.)

Automated test: `test/app-icon-picker.test.js`, `test/native-app-icon-bridge.test.js`,
`test/android-app-icons.test.js`.

---

## 2. Light / dark app-icon variants (iOS 18 appearance sets)

What it is: every alternate icon has a light and a dark version; iOS 18 shows the
one matching the home-screen appearance automatically, with no extra picker choice.
Staged in `app-icons/ios-appearance/<AltIcon>.appiconset/` (light + dark 1024 +
`Contents.json`).

One-time native setup (iOS, needs an Xcode build), per `app-icons/README.md`
"Light / dark (iOS 18)":

1. Copy the `*.appiconset` folders from `app-icons/ios-appearance/` into
   `ios/App/App/Assets.xcassets/`.
2. Xcode build settings:
   - `INCLUDE_ALL_APPICON_ASSETS = YES`
   - add every set name to `ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES`
     (the `appearanceSet` values in `manifest.json`, minus the `.appiconset`
     suffix).
3. `setAlternateIconName` keeps using the same name; iOS then picks light vs dark
   itself. (Delivery must be the asset catalog; loose `CFBundleIconFiles` PNGs
   cannot carry appearance variants.)

Verify (iOS 18+ device/simulator):

1. Set a non-default alternate icon (section 1).
2. Switch the system home-screen appearance between light and dark (or toggle the OS
   light/dark setting). The installed icon's background should swap between the light
   color and the deep/dark version of the same color, without re-picking.
3. The in-app picker preview already mirrors this via `<picture>` +
   `prefers-color-scheme` (follows the **system** appearance, not the in-app theme
   toggle), so the preview and the real icon should agree.

Android note: there is no equivalent launcher light/dark swap (Android's dark-icon
story is themed/monochrome icons, a different mechanism, left as a later option).

Automated test: `test/app-icon-dark-variants.test.js`.

---

## 3. Unified kid-friendly drawn icon set (native-only glyphs)

What it is: inside the app the emoji UI icons are replaced by a unified drawn SVG set
exposed as `window.THWAP_GLYPHS`, gated on `body.is-native`. On the web the original
emoji stay.

Verify:

1. In the app, confirm the UI icons render as the consistent drawn set (not OS
   emoji). On the plain web the same screens still show emoji.
2. Native diagnostics confirms you are in the native shell (`is-native = Yes`), which
   is the gate for the glyph swap.

Automated test: `test/native-icon-system.test.js`.

---

## 4. Status-bar theming (`@capacitor/status-bar`)

What it is: the status bar follows the in-app light/dark toggle. `thwapSyncStatusBar(dark)`
calls `StatusBar.setStyle` (and `setBackgroundColor` where applicable). Driven from
the theme bootstrap (`apply()` in `index.html`) on load and on every toggle.
See `docs/native-system-bars.md`.

Verify (needs a build; `npx cap sync ios` / `android`):

1. Launch the app in light theme: status-bar icons read as **dark** on a light bar.
2. Toggle to dark theme (Profile -> Appearance): status-bar icons flip to **light**
   on a dark bar, and the bar reads as part of the app (no white/black gap at the top).
3. Native diagnostics -> **StatusBar plugin** should read **Yes** on a build that
   bundles `@capacitor/status-bar`.

Automated test: `test/native-sheets-statusbar-haptics.test.js`, `test/native-system-bars.test.js`.

---

## 5. Android nav-bar contrast + window-background theme-sync (local `SystemBars` plugin)

What it is: on targetSdk 35 the bars are transparent (forced edge-to-edge), so what
is themed is the nav-bar **icon contrast** plus the native **window background**.
`thwapSyncNavBar(dark)` prefers `Capacitor.Plugins.SystemBars.setStyle({dark, bg})`
(the local `SystemBarsPlugin.java`, registered in `MainActivity`), falling back to a
third-party `NavigationBar` plugin or a `window.thwapSetNavBar` bridge. No-op on iOS
and the web. See `docs/native-system-bars.md`.

Verify (Android 15 device/emulator; `npx cap sync android` to pick up the plugin):

1. Launch in light theme: the bottom nav-bar icons read **dark**, and the nav strip
   shows the tab bar's panel color (no white/black gap at the bottom).
2. Toggle to dark theme: nav-bar icons flip to **light**, and the bar tracks the app.
3. Warm reload / resume in light theme must not flash dark (the window background is
   synced to the themed `bg`). A cold launch still shows the dark splash by design.
4. Native diagnostics -> **SystemBars plugin** should read **Yes** on the Android
   build (the local plugin); it reads **No** on iOS and the web.

Automated test: `test/native-system-bars.test.js`.

---

## 6. Theme + selected-icon persistence (storage keys)

Both are plain `localStorage`, surfaced read-only in Native diagnostics:

- Theme: `localStorage.thwapTheme` (`'light'` / `'dark'`), reflected by
  `<html data-theme>`; diagnostics shows the current value under **Theme**.
- App icon: `localStorage.thwapAppIcon` (the chosen `{skill,color,iosKey,androidAlias}`);
  diagnostics shows the active key under **App icon**.

Verify: change the theme and the app icon, relaunch the app, and confirm both stick
(diagnostics reflects the saved values).

---

## Native diagnostics view (how to reach it)

Profile tab -> **Developer** group -> **Native diagnostics** (native app only; the
group is hidden on the web). Tapping it expands a read-only panel. It never changes
state; it only reads flags, feature-detects `Capacitor.Plugins`, and reads the two
`localStorage` keys and the safe-area insets (via a probe element using
`env(safe-area-inset-*)`). Automated test: `test/native-diagnostics.test.js`.
