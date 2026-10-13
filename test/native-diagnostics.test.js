// test/native-diagnostics.test.js
//
// EXECUTION test: the native-only "Native diagnostics" panel in the Profile
// tab. It is inert and EMPTY on the plain web, and populated inside the
// Capacitor shell (body.is-native), reporting platform, the is-native /
// is-ios / is-android flags, which Capacitor plugins are present, the theme,
// the safe-area insets and the selected app icon. Read-only: an at-a-glance
// check that supports on-device verification (docs/native-verification.md).
//
// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');

async function boot(native) {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://thwaphockey.com/',
    beforeParse(window) {
      window.scrollTo = () => {};
      window.HTMLMediaElement.prototype.play = () => Promise.resolve();
      if (native) {
        window.Capacitor = {
          isNativePlatform: () => true,
          getPlatform: () => 'ios',
          Plugins: {
            StatusBar: { setStyle() {}, setBackgroundColor() {} },
            Haptics: { impact() {} },
          },
        };
      }
      window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: false }) });
    },
  });
  await new Promise((r) => setTimeout(r, 120));
  return dom.window;
}

const rowsOf = (win) => [...win.document.querySelectorAll('#diagPanel .diag-row')];
const byLabel = (rows, label) => rows.find((r) => r.querySelector('.diag-k').textContent === label);

describe('Native diagnostics panel', () => {
  it('ships the group + panel + toggle markup (always in the DOM)', async () => {
    const win = await boot(false);
    expect(win.document.getElementById('diagGroup')).toBeTruthy();
    expect(win.document.getElementById('diagPanel')).toBeTruthy();
    expect(win.document.getElementById('diagToggle')).toBeTruthy();
    // native-gated group: hidden on the plain web via .prof-group-native
    expect(win.document.getElementById('diagGroup').classList.contains('prof-group-native')).toBe(true);
  });

  it('is empty and inert on the plain web (no Capacitor)', async () => {
    const win = await boot(false);
    const panel = win.document.getElementById('diagPanel');
    expect(panel.children.length).toBe(0);
    expect(panel.hidden).toBe(true);
    // forcing a render on the web is a safe no-op: it returns early, stays empty
    expect(() => win.thwapRenderNativeDiag && win.thwapRenderNativeDiag()).not.toThrow();
    expect(panel.children.length).toBe(0);
  });

  it('is populated under body.is-native and reports the platform + flags', async () => {
    const win = await boot(true);
    expect(win.document.body.classList.contains('is-native')).toBe(true);
    const panel = win.document.getElementById('diagPanel');
    expect(panel.children.length).toBeGreaterThan(0);
    const rows = rowsOf(win);
    expect(byLabel(rows, 'Platform').querySelector('.diag-v').textContent).toBe('ios');
    expect(byLabel(rows, 'is-native').querySelector('.diag-v').textContent).toBe('Yes');
    expect(byLabel(rows, 'is-ios').querySelector('.diag-v').textContent).toBe('Yes');
    expect(byLabel(rows, 'is-android').querySelector('.diag-v').textContent).toBe('No');
  });

  it('feature-detects which Capacitor plugins are present', async () => {
    const win = await boot(true);
    const rows = rowsOf(win);
    // StatusBar + Haptics were provided to the mock; the rest were not.
    expect(byLabel(rows, 'StatusBar plugin').querySelector('.diag-v').textContent).toBe('Yes');
    expect(byLabel(rows, 'Haptics plugin').querySelector('.diag-v').textContent).toBe('Yes');
    expect(byLabel(rows, 'SystemBars plugin').querySelector('.diag-v').textContent).toBe('No');
    expect(byLabel(rows, 'Share plugin').querySelector('.diag-v').textContent).toBe('No');
    expect(byLabel(rows, 'App icon plugin').querySelector('.diag-v').textContent).toBe('No');
  });

  it('reports theme, safe-area insets and the selected app icon', async () => {
    const win = await boot(true);
    const keys = rowsOf(win).map((r) => r.querySelector('.diag-k').textContent);
    expect(keys).toContain('Theme');
    expect(keys).toContain('Safe area top');
    expect(keys).toContain('Safe area bottom');
    expect(keys).toContain('App icon');
  });

  it('toggling the entry expands and collapses the read-only panel', async () => {
    const win = await boot(true);
    const toggle = win.document.getElementById('diagToggle');
    const panel = win.document.getElementById('diagPanel');
    const group = win.document.getElementById('diagGroup');
    expect(panel.hidden).toBe(true);
    toggle.dispatchEvent(new win.Event('click', { bubbles: true }));
    expect(panel.hidden).toBe(false);
    expect(group.classList.contains('open')).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    toggle.dispatchEvent(new win.Event('click', { bubbles: true }));
    expect(panel.hidden).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });
});
