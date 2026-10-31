# Selectable app icons

A user can choose which app icon shows on their home screen, in **Settings -> App icon**
(Profile tab, native app only). Each icon is the real Sass doing a skill, in a color.

**4 skills x 5 colors = 20 icons:** Hands, Shooting, Passing, Dryland x Green, Blue,
Orange, Purple, Pink. All built from the real mascot cutouts (`login/sass-*.webp`) and
exported square + fully opaque (no alpha) so iOS applies its own rounded mask.

## Files

- `scripts/gen_app_icons.py` — the generator (source of truth for skills + colors).
- `app-icons/manifest.json` — drives the in-app picker (skills, colors, icon keys, preview paths).
- `app-icons/preview/<skill>-<color>.png` (+ `-dark.png`) — 256px light/dark previews for the web picker.
- `app-icons/ios-appearance/<AltIcon>.appiconset/` — staged iOS 18 appearance sets (light + dark 1024 + `Contents.json`), ready to drop into the asset catalog.
- `ios/App/App/AltIcon-<Skill><Color>@2x.png` (120) + `@3x.png` (180) — the iOS alternate icons.
- `ios/App/App/Info.plist` — `CFBundleIcons -> CFBundleAlternateIcons` declares all 20.
- `android/.../res/mipmap-<density>/ic_<skill>_<color>.png` — legacy square launcher (48-192, for API 23-25).
- `android/.../res/mipmap-<density>/ic_<skill>_<color>_fg.png` — adaptive-icon foreground (Sass on transparent, inside the safe zone).
- `android/.../res/mipmap-anydpi-v26/ic_<skill>_<color>.xml` — adaptive icon (API 26+): `@color` background + `@mipmap` foreground.
- `android/.../res/values/ic_launcher_colors.xml` — the per-variant background colors.
- `android/.../AndroidManifest.xml` — one `<activity-alias>` per icon (all `enabled="false"` by default).

The current primary icon (`ic_launcher` / `AppIcon`) is unchanged — these are additive alternates.

## Regenerate / add colors or skills

1. Edit `SKILLS` / `COLORS` in `scripts/gen_app_icons.py`.
2. `python3 scripts/gen_app_icons.py` (needs Pillow). This rewrites the previews, iOS alternates,
   all Android mipmaps/XML/colors, `manifest.json`, and (idempotently) the manifest aliases.
3. Re-run the Info.plist patch (or add matching `CFBundleAlternateIcons` entries by hand).
   The Android `<activity-alias>` block is patched in automatically on first run (guarded by a marker);
   if you *remove* skills/colors, delete the stale aliases + mipmaps by hand.
4. Commit, and deploy so the web previews are live for the picker.

## Finishing the native switch (the one step a build is needed for)

The picker remembers the choice (`localStorage.thwapAppIcon`) and calls `applyNative()`,
which looks for a native bridge. iOS changing an icon is `UIApplication.setAlternateIconName`,
which the WebView can't call on its own — add ONE of:

- **A community plugin** (e.g. `capacitor-plugin-dynamic-icon`): install it; the picker already
  calls `Plugins.DynamicAppIcon/CapacitorDynamicIcon/AppIcon.change({ name })`.
- **A tiny custom bridge:** in the native shell, expose `window.thwapSetNativeIcon(name)` that runs
  `UIApplication.shared.setAlternateIconName(name)` on the main thread. The icon keys are the
  `iosKey` values in `manifest.json` (e.g. `AltIcon-HandsGreen`).

iOS shows a system alert when the icon changes — that's expected OS behavior.

### Light / dark (iOS 18)

Every icon has a light and a dark version (the dark background is the color pulled ~45% toward
brand ink — a deep version of the same color). iOS 18 shows the matching one with the home-screen
appearance, automatically, with no extra picker choice.

Delivery is the asset catalog (loose `CFBundleIconFiles` PNGs can't carry appearance variants).
The generator stages one appearance set per icon in `app-icons/ios-appearance/<AltIcon>.appiconset/`
(light + dark 1024 + a `Contents.json` with the `luminosity` appearances). To wire it (native-side,
needs an Xcode build — kept out of this change so it doesn't collide with the alternate-icon switch):

1. Copy the `*.appiconset` folders into `ios/App/App/Assets.xcassets/`.
2. Build settings: `INCLUDE_ALL_APPICON_ASSETS = YES` and add every set name to
   `ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES` (the `appearanceSet` values in `manifest.json`,
   minus `.appiconset`).
3. `setAlternateIconName` keeps using the same name; iOS then picks light vs dark itself.

The picker preview already auto-switches with the **system** appearance (via a `<picture>` +
`prefers-color-scheme`), so it mirrors what iOS will show — independent of the in-app theme toggle.

**Android note:** there's no equivalent launcher light/dark swap — Android's dark-mode icon story is
*themed* (monochrome) icons tinted by the wallpaper, a different mechanism. Left as a later option.

### Android

The assets and the 20 `<activity-alias>` entries are already generated and in the manifest (all
disabled by default, so the primary `ic_launcher` is what ships). Switching is
`PackageManager.setComponentEnabledSetting`: **enable the chosen alias and disable every other
alias + the `MainActivity` launcher component**, so exactly one launcher entry is ever enabled.
Add ONE of:

- **A community plugin** (e.g. `capacitor-plugin-dynamic-icon`): install it; the picker already
  calls `Plugins.DynamicAppIcon/CapacitorDynamicIcon/AppIcon.change({ name })`. On Android the
  `name` it passes is the **`androidAlias`** from `manifest.json` (e.g. `IconHandsGreen`), the
  alias' `android:name` without the leading dot.
- **A tiny custom bridge:** expose `window.thwapSetNativeIcon(name, meta)` in the native shell;
  on Android, flip the component states via `PackageManager`. `meta` carries `{ios, android, platform}`.

Android applies the new icon on the next launcher refresh; many launchers only repaint after the
app is backgrounded (and some briefly drop the icon), so a short "your icon will update shortly"
note is worth showing. The `MainActivity` keeps its own `LAUNCHER` filter as the default icon.

## Follow-ups (not in this PR)

- **Tinted (monochrome) iOS icons** — the third iOS 18 appearance; would need a grayscale Sass.
- **Android themed icons** — a `<monochrome>` adaptive layer for wallpaper-tinted dark-mode launchers.

## Default icon (what every kid sees before picking one)

The default iPhone and Android icon is Sass stickhandling on Thwap lime (`#B9F06B`). The
approved master is `app-icons/primary/thwap-icon-1024.png` (1024 square, opaque). The watch app
uses the same art and ships with the watch redesign.

Regenerate every platform file from the master with:

```bash
python3 scripts/gen_primary_icon.py            # needs Pillow (pip install Pillow==11.0.0)
```

It writes the iPhone `AppIcon-512@2x.png`, the Android legacy square and round mipmaps
(48 to 192px), and the Android adaptive foreground (Sass inside the 66% safe zone of the 108dp
canvas, so launcher masks never crop his stick or the puck) over a lime background color.
The 20 selectable alternates above are separate and unchanged.
