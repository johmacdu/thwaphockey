// test/android-app-icons.test.js
//
// Consistency test for the Android selectable app icons. Without an Android build
// we can't verify the launcher switch, but we CAN guarantee the generated assets,
// colors and <activity-alias> entries stay in lockstep with app-icons/manifest.json
// so a stale regen or hand-edit can't ship a half-wired variant.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const manifest = JSON.parse(readFileSync(resolve(root, 'app-icons/manifest.json'), 'utf8'));
const androidManifest = readFileSync(resolve(root, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
const colorsXml = readFileSync(resolve(root, 'android/app/src/main/res/values/ic_launcher_colors.xml'), 'utf8');
const DENSITIES = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'];

describe('Android selectable app icons', () => {
  it('every manifest icon carries an androidAlias and an iosKey', () => {
    expect(manifest.icons.length).toBe(20);
    for (const ic of manifest.icons) {
      expect(ic.androidAlias, `${ic.skill}/${ic.color} androidAlias`).toMatch(/^Icon[A-Z]/);
      expect(ic.iosKey).toMatch(/^AltIcon-/);
    }
  });

  it('has exactly one <activity-alias> per variant, all disabled by default and targeting MainActivity', () => {
    const aliasCount = (androidManifest.match(/<activity-alias/g) || []).length;
    expect(aliasCount).toBe(manifest.icons.length);
    for (const ic of manifest.icons) {
      const res = `ic_${ic.skill}_${ic.color}`;
      const block = androidManifest.match(
        new RegExp(`<activity-alias[\\s\\S]*?android:name="\\.${ic.androidAlias}"[\\s\\S]*?</activity-alias>`),
      );
      expect(block, `alias .${ic.androidAlias}`).toBeTruthy();
      expect(block[0]).toContain('android:enabled="false"');
      expect(block[0]).toContain('android:targetActivity=".MainActivity"');
      expect(block[0]).toContain(`android:icon="@mipmap/${res}"`);
      expect(block[0]).toContain('android.intent.category.LAUNCHER');
    }
  });

  it('ships a background color + adaptive xml + legacy & foreground mipmaps for every variant', () => {
    for (const ic of manifest.icons) {
      const res = `ic_${ic.skill}_${ic.color}`;
      expect(colorsXml, `${res}_bg color`).toContain(`<color name="${res}_bg">${ic.hex}</color>`);
      expect(existsSync(resolve(root, `android/app/src/main/res/mipmap-anydpi-v26/${res}.xml`)), `${res}.xml`).toBe(true);
      for (const d of DENSITIES) {
        expect(existsSync(resolve(root, `android/app/src/main/res/mipmap-${d}/${res}.png`)), `${res} ${d} legacy`).toBe(true);
        expect(existsSync(resolve(root, `android/app/src/main/res/mipmap-${d}/${res}_fg.png`)), `${res} ${d} fg`).toBe(true);
      }
    }
  });

  it('keeps the primary launcher component intact (default icon unchanged)', () => {
    expect(androidManifest).toContain('android:icon="@mipmap/ic_launcher"');
    expect(androidManifest.match(/<\/application>/g).length).toBe(1);
    // MainActivity still owns a LAUNCHER filter so the default icon survives
    const main = androidManifest.match(/<activity[\s\S]*?\.MainActivity[\s\S]*?<\/activity>/);
    expect(main[0]).toContain('android.intent.category.LAUNCHER');
  });
});
