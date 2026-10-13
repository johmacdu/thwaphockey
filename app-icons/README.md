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

The current primary App Store icon (`AppIcon`) is unchanged — these are additive alternates.

## Regenerate / add colors or skills

1. Edit `SKILLS` / `COLORS` in `scripts/gen_app_icons.py`.
2. `python3 scripts/gen_app_icons.py` (needs Pillow).
3. Re-run the Info.plist patch (or add matching `CFBundleAlternateIcons` entries by hand).
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

## Follow-ups (not in this PR)

- **Light / dark variants** (iOS 18 auto-switch): add dark versions via an asset-catalog
  appearance set. The generator already knows how to make a darkened background.
- **Android:** alternate launcher icons need an `activity-alias` per icon in the manifest,
  toggled with `PackageManager.setComponentEnabledSetting` (a relaunch is involved).
