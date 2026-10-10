// test/native-sheets-statusbar-haptics.test.js
//
// Guards three native-shell-only follow-ups:
//   1. Native bottom-sheet modals -- the .sheet drawers (self-edit, add-player,
//      coach info, schedule, gates) present as bottom sheets in the app.
//   2. StatusBar theme sync -- window.thwapSyncStatusBar matches the native
//      status bar to the app's light/dark theme via @capacitor/status-bar,
//      called from the theme controller's apply().
//   3. Haptics -- thwapHaptic (previously defined but never called) now fires at
//      the proven reward moments: each discipline done-state, a full ring tap
//      (streak), and sticker placement.
// Everything is gated on body.is-native / Capacitor native, so the plain
// website at thwaphockey.com is untouched. Source + structural assertions,
// matching the native-capacitor.test.js style.
//
// @vitest-environment jsdom

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
const nativeCss = () => html.match(/<style id='native-css'>([\s\S]*?)<\/style>/)[1];

describe('Native bottom-sheet modals (.sheet drawers)', () => {
  it('re-anchors .sheet-panel to the bottom, full width, rounded top, native only', () => {
    const css = nativeCss();
    expect(css).toMatch(/body\.is-native \.sheet-panel\{[^}]*bottom:0/);
    expect(css).toMatch(/body\.is-native \.sheet-panel\{[^}]*width:100%/);
    expect(css).toMatch(/body\.is-native \.sheet-panel\{[^}]*border-radius:18px 18px 0 0/);
  });
  it('clears the home indicator and reuses the slide-up keyframe with reduced-motion opt-out', () => {
    const css = nativeCss();
    expect(css).toMatch(/body\.is-native \.sheet-panel\{[^}]*env\(safe-area-inset-bottom/);
    expect(css).toMatch(/body\.is-native \.sheet-panel\{[^}]*animation:thwapSheetUp/);
    expect(css).toMatch(/prefers-reduced-motion:reduce\)\{body\.is-native \.sheet-panel\{animation:none\}/);
  });
  it('leaves the web drawer (right-side slide-in) untouched outside is-native', () => {
    // the base rule still anchors right with a left border
    expect(html).toMatch(/\.sheet-panel\{position:absolute;top:0;right:0;bottom:0;width:min\(420px/);
  });
});

describe('StatusBar theme sync (native only)', () => {
  it('defines window.thwapSyncStatusBar gated on Capacitor native with the StatusBar plugin', () => {
    expect(html).toMatch(/window\.thwapSyncStatusBar=function\(dark\)/);
    expect(html).toMatch(/C\.isNativePlatform==='function'&&C\.isNativePlatform\(\)\)\)return/);
    expect(html).toMatch(/SB=C\.Plugins&&C\.Plugins\.StatusBar/);
  });
  it('sets the bar style and background to match the theme (dark vs light)', () => {
    expect(html).toMatch(/setStyle\(\{style:dark\?'DARK':'LIGHT'\}\)/);
    expect(html).toMatch(/setBackgroundColor\(\{color:dark\?'#101A14':'#F3F7F4'\}\)/);
  });
  it('is called from the theme controller apply(), so it fires on load and on toggle', () => {
    expect(html).toMatch(/setAttribute\('data-theme',dark\?'dark':'light'\);try\{if\(window\.thwapSyncStatusBar\)window\.thwapSyncStatusBar\(dark\)/);
  });
  it('is defined before the theme controller runs (source order)', () => {
    const helperAt = html.indexOf('window.thwapSyncStatusBar=function');
    const applyAt = html.indexOf("var KEY='thwapTheme'");
    expect(helperAt).toBeGreaterThan(-1);
    expect(applyAt).toBeGreaterThan(helperAt);
  });
});

describe('Haptics fire at the reward moments', () => {
  it('thwapHaptic is defined with streak / done / light tiers', () => {
    expect(html).toMatch(/window\.thwapHaptic=function\(kind\)/);
    expect(html).toMatch(/kind==='streak'\)\{H\.notification\(\{type:'SUCCESS'\}\)/);
    expect(html).toMatch(/kind==='done'\)\{H\.impact\(\{style:'MEDIUM'\}\)/);
  });
  it('fires a done haptic alongside each discipline reward sfx', () => {
    expect((html.match(/thwapSfx\('drylandReward'\); \}catch\(e\)\{\} try\{ if\(window\.thwapHaptic\)thwapHaptic\('done'\)/g) || []).length).toBe(1);
    expect((html.match(/thwapSfx\('handsReward'\); \}catch\(e\)\{\} try\{ if\(window\.thwapHaptic\)thwapHaptic\('done'\)/g) || []).length).toBe(1);
    expect((html.match(/thwapSfx\('shootReward'\); \}catch\(e\)\{\} try\{ if\(window\.thwapHaptic\)thwapHaptic\('done'\)/g) || []).length).toBe(1);
  });
  it('fires a streak haptic when a full ring is tapped (the THWAP! pop)', () => {
    expect(html).toMatch(/t\.classList\.add\('go'\);\} try\{ if\(window\.thwapHaptic\)thwapHaptic\('streak'\)/);
  });
  it('fires a light tick at both sticker-placement sites', () => {
    expect((html.match(/last\.classList\.remove\('placed-pop'\); \},420\); \} \} try\{ if\(window\.thwapHaptic\)thwapHaptic\('tick'\)/g) || []).length).toBe(2);
  });
});
