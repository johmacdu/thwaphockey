// test/native-app-icon-bridge.test.js
//
// Verifies the NATIVE sides of the selectable app-icon bridge (ios/App/App/AppIconPlugin.swift
// + android/.../AppIconPlugin.java) stay in lockstep with app-icons/manifest.json and the real
// platform manifests, so a stale edit on either native side can't ship a half-wired variant.
// We can't execute Swift/Java here, but we CAN parse the real source/manifest files and assert
// the key sets match -- no hardcoded expectations duplicated from memory.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const manifest = JSON.parse(readFileSync(resolve(root, 'app-icons/manifest.json'), 'utf8'));
const androidManifestXml = readFileSync(resolve(root, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
const infoPlist = readFileSync(resolve(root, 'ios/App/App/Info.plist'), 'utf8');
const androidPluginJava = readFileSync(
  resolve(root, 'android/app/src/main/java/com/thwaphockey/app/AppIconPlugin.java'),
  'utf8',
);
const iosPluginSwift = readFileSync(resolve(root, 'ios/App/App/AppIconPlugin.swift'), 'utf8');
const mainViewControllerSwift = readFileSync(resolve(root, 'ios/App/App/MainViewController.swift'), 'utf8');
const storyboard = readFileSync(resolve(root, 'ios/App/App/Base.lproj/Main.storyboard'), 'utf8');
const mainActivityJava = readFileSync(
  resolve(root, 'android/app/src/main/java/com/thwaphockey/app/MainActivity.java'),
  'utf8',
);

function androidAliasNamesFromManifestXml(xml) {
  const names = [];
  const re = /<activity-alias[\s\S]*?android:name="\.([A-Za-z0-9_]+)"/g;
  let m;
  while ((m = re.exec(xml))) names.push(m[1]);
  return names;
}

function iosAlternateIconKeysFromPlist(plist) {
  const section = plist.split('<key>CFBundleAlternateIcons</key>')[1] || '';
  const dictBody = section.split('</dict>\n\t</dict>')[0] || section;
  const names = [];
  const re = /<key>(AltIcon-[A-Za-z0-9]+)<\/key>/g;
  let m;
  while ((m = re.exec(dictBody))) names.push(m[1]);
  return names;
}

function javaStringArrayLiterals(javaSrc, arrayVarName) {
  const re = new RegExp(`${arrayVarName}\\s*=\\s*\\{([\\s\\S]*?)\\};`);
  const m = javaSrc.match(re);
  if (!m) return [];
  return Array.from(m[1].matchAll(/"([^"]+)"/g)).map((x) => x[1]);
}

describe('Native app-icon bridge stays in lockstep with the manifest', () => {
  it('every manifest androidAlias is a real <activity-alias> in AndroidManifest.xml', () => {
    const realAliases = new Set(androidAliasNamesFromManifestXml(androidManifestXml));
    expect(realAliases.size).toBe(20);
    for (const ic of manifest.icons) {
      expect(realAliases.has(ic.androidAlias), `${ic.androidAlias} declared in AndroidManifest.xml`).toBe(true);
    }
  });

  it("AppIconPlugin.java's ALL_ALIASES list matches AndroidManifest.xml exactly (parsed, not hardcoded)", () => {
    const realAliases = androidAliasNamesFromManifestXml(androidManifestXml).sort();
    const pluginAliases = javaStringArrayLiterals(androidPluginJava, 'ALL_ALIASES').sort();
    expect(pluginAliases.length).toBe(20);
    expect(pluginAliases).toEqual(realAliases);
    // and matches the manifest.json androidAlias set too
    const manifestAliases = manifest.icons.map((ic) => ic.androidAlias).sort();
    expect(pluginAliases).toEqual(manifestAliases);
  });

  // iOS alternate icons ship from the asset catalog (one AltIcon-*.appiconset each) and
  // are named in the App target's ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES; Xcode
  // then writes CFBundleAlternateIcons itself. The old hand-written Info.plist list
  // pointed at loose PNGs that were never in the target, and Apple rejected the build
  // (ITMS-90032), so this asserts the catalog wiring instead and that the stale plist
  // list cannot come back.
  it('every manifest iosKey is a real alternate app icon in the asset catalog and the build setting', () => {
    const pbx = readFileSync(resolve(root, 'ios/App/App.xcodeproj/project.pbxproj'), 'utf8');
    const settings = [...pbx.matchAll(/ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES = "([^"]*)";/g)].map((m) => m[1]);
    expect(settings.length, 'set for Debug and Release').toBe(2);
    for (const s of settings) {
      const names = new Set(s.split(/\s+/).filter(Boolean));
      expect(names.size).toBe(20);
      for (const ic of manifest.icons) expect(names.has(ic.iosKey), `${ic.iosKey} in the build setting`).toBe(true);
    }
    for (const ic of manifest.icons) {
      const dir = resolve(root, 'ios/App/App/Assets.xcassets', `${ic.iosKey}.appiconset`);
      const contents = JSON.parse(readFileSync(resolve(dir, 'Contents.json'), 'utf8'));
      for (const img of contents.images) {
        expect(img.size).toBe('1024x1024');
        expect(existsSync(resolve(dir, img.filename)), `${ic.iosKey}/${img.filename} exists`).toBe(true);
      }
    }
    expect(iosAlternateIconKeysFromPlist(infoPlist).length, 'no hand-written loose-file list in Info.plist').toBe(0);
  });

  it('Android: AppIconPlugin is a @CapacitorPlugin named DynamicAppIcon and MainActivity registers it', () => {
    expect(androidPluginJava).toMatch(/@CapacitorPlugin\(\s*name\s*=\s*"DynamicAppIcon"\s*\)/);
    expect(androidPluginJava).toContain('class AppIconPlugin extends Plugin');
    expect(mainActivityJava).toMatch(/registerPlugin\(\s*AppIconPlugin\.class\s*\)/);
    // registration must happen before super.onCreate(), per Capacitor's documented convention
    const idxRegister = mainActivityJava.indexOf('registerPlugin(AppIconPlugin.class)');
    const idxSuper = mainActivityJava.indexOf('super.onCreate(');
    expect(idxRegister).toBeGreaterThan(-1);
    expect(idxSuper).toBeGreaterThan(-1);
    expect(idxRegister).toBeLessThan(idxSuper);
  });

  it('Android: disables every other alias + MainActivity launcher when enabling one, and resets to MainActivity when name is empty', () => {
    expect(androidPluginJava).toContain('COMPONENT_ENABLED_STATE_ENABLED');
    expect(androidPluginJava).toContain('COMPONENT_ENABLED_STATE_DISABLED');
    expect(androidPluginJava).toContain('MainActivity');
    expect(androidPluginJava).toMatch(/for\s*\(\s*String alias\s*:\s*ALL_ALIASES\s*\)/);
  });

  it('iOS: AppIconPlugin is a CAPBridgedPlugin with jsName DynamicAppIcon and calls setAlternateIconName', () => {
    expect(iosPluginSwift).toMatch(/jsName\s*=\s*"DynamicAppIcon"/);
    expect(iosPluginSwift).toContain('CAPBridgedPlugin');
    expect(iosPluginSwift).toContain('setAlternateIconName');
    // runs on the main thread per the README's requirement
    expect(iosPluginSwift).toMatch(/DispatchQueue\.main\.async/);
  });

  it('iOS: the plugin instance is registered via a custom bridge view controller wired in the storyboard', () => {
    expect(mainViewControllerSwift).toContain('class MainViewController: CAPBridgeViewController');
    expect(mainViewControllerSwift).toMatch(/registerPluginInstance\(\s*AppIconPlugin\(\)\s*\)/);
    expect(storyboard).toMatch(/customClass="MainViewController"/);
  });
});
