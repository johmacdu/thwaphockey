# Selectable app icons

A user can choose which app icon shows on their home screen, in **Settings -> App icon**
(Profile tab, native app only). Each icon is the real Sass doing a skill, in a color.

**4 skills x 5 colors = 20 icons:** Hands, Shooting, Passing, Dryland x Green, Blue,
Orange, Purple, Pink. All built from the real mascot cutouts (`login/sass-*.webp`) and
exported square + fully opaque (no alpha) so iOS applies its own rounded mask.

## Files

- `scripts/gen_app_icons.py` — the generator (source of truth for skills + colors).
- `app-icons/manifest.json` — drives the in-app picker (skills, colors, icon keys, preview paths).
- `app-icons/preview/<skill>-<color>.png` — 256px previews, served to the web picker.
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

- **Light / dark variants** (iOS 18 auto-switch): add dark versions via an asset-catalog
  appearance set. The generator already knows how to make a darkened background.
