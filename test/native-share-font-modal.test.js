// test/native-share-font-modal.test.js
//
// Guards three native-shell-only follow-ups from the Capacitor port:
//   1. Native share sheet  -- window.thwapShare uses @capacitor/share in the
//      shell, with Web Share API then clipboard fallbacks; wired to the
//      coach team-code reveal (the one real share affordance).
//   2. Per-platform system font -- is-ios -> San Francisco, is-android ->
//      Roboto, set alongside is-native from Capacitor.getPlatform().
//   3. Native modal -- the policy sheet presents as a bottom sheet in the app.
// Every rule is gated on body.is-native / is-ios / is-android, which are set
// ONLY inside the Capacitor shell, so the plain website is untouched. Source +
// structural assertions, matching the native-capacitor.test.js style.
//
// @vitest-environment jsdom

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8'));
const nativeCss = () => html.match(/<style id='native-css'>([\s\S]*?)<\/style>/)[1];
let doc;
beforeAll(() => { doc = new DOMParser().parseFromString(html, 'text/html'); });

describe('Platform classes (is-ios / is-android)', () => {
  it('derives the platform from Capacitor.getPlatform() alongside is-native', () => {
    expect(html).toMatch(/getPlatform&&C\.getPlatform\(\)/);
    expect(html).toMatch(/pf==='ios'\?'is-ios':\(pf==='android'\?'is-android':''\)/);
  });
  it('adds the platform class to both documentElement and body, only when native', () => {
    // the platform class is derived inside the isNativePlatform() guard block
    expect(html).toMatch(/isNativePlatform\(\)\)\{[^]*?if\(pc\)r\.classList\.add\(pc\)/);
    expect(html).toMatch(/if\(pc\)document\.body\.classList\.add\(pc\)/);
  });
});

describe('Per-platform system font (native only)', () => {
  it('iOS body uses the Apple system font, Android uses Roboto', () => {
    const css = nativeCss();
    expect(css).toMatch(/body\.is-ios\{font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text'/);
    expect(css).toMatch(/body\.is-android\{font-family:'Roboto'/);
  });
  it('keeps the brand faces (Archivo Black) off the platform-font override', () => {
    // the override targets body, not h1/.brand; brand heading rule is unchanged
    expect(html).toMatch(/h1,h2,h3,\.brand,\.big\{font-family:'Archivo Black'/);
  });
});

describe('Native modal (policy sheet as a bottom sheet)', () => {
  it('presents the policy sheet bottom-aligned and full-width in the app', () => {
    const css = nativeCss();
    expect(css).toMatch(/body\.is-native \.policy-sheet\{align-items:flex-end/);
    expect(css).toMatch(/body\.is-native \.policy-page\{[^}]*border-radius:18px 18px 0 0/);
    expect(css).toMatch(/env\(safe-area-inset-bottom/);
  });
  it('slides up with a reduced-motion opt-out', () => {
    const css = nativeCss();
    expect(css).toMatch(/@keyframes thwapSheetUp\{from\{transform:translateY\(100%\)\}/);
    expect(css).toMatch(/prefers-reduced-motion:reduce\)\{body\.is-native \.policy-page\{animation:none\}/);
  });
});

describe('Native share sheet (thwapShare)', () => {
  it('declares @capacitor/share as a dependency, pinned to the 7.x line', () => {
    expect(pkg.dependencies['@capacitor/share']).toMatch(/^\^?7\./);
  });
  it('exposes window.thwapShare and prefers the native Share plugin when native', () => {
    expect(html).toMatch(/window\.thwapShare=function/);
    expect(html).toMatch(/C\.Plugins&&C\.Plugins\.Share/);
    expect(html).toMatch(/S\.share\(\{title:title,text:text,url:url,dialogTitle:title\}\)/);
  });
  it('falls back to Web Share then clipboard on the plain web', () => {
    expect(html).toMatch(/if\(navigator\.share\)\{return navigator\.share/);
    expect(html).toMatch(/navigator\.clipboard&&navigator\.clipboard\.writeText/);
  });
  it('ships a Share button in the team-code reveal, hidden until the code lands', () => {
    const btn = doc.getElementById('csShare');
    expect(btn).toBeTruthy();
    expect(btn.hasAttribute('hidden')).toBe(true);
    expect(btn.textContent).toMatch(/Share the code/);
  });
  it('wires the Share button to thwapShare with the join message and shows it on reveal', () => {
    expect(html).toMatch(/if\(csShare\)\{ csShare\.hidden=false;/);
    expect(html).toMatch(/window\.thwapShare\(\{ title:'Join our Thwap team'/);
    expect(html).toMatch(/this team code: '\+code/);
  });
  it('shows a transient confirmation when the web path falls back to clipboard copy', () => {
    expect(html).toMatch(/r\.ok==='copied'[^]*?csShare\.textContent='Code copied'/);
  });
});
