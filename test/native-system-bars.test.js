// test/native-system-bars.test.js
//
// EXECUTION test: native system-bar theming. In the Android shell the in-app
// light/dark toggle drives the navigation-bar icon contrast through the local
// SystemBars plugin (thwapSyncNavBar -> SystemBars.setStyle({dark})). A real
// device is needed to SEE the bars, but we can verify the bridge is called with
// the right value on load and on toggle, and that it is inert on the web.
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
  const calls = { nav: [], status: [] };
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
          getPlatform: () => 'android',
          Plugins: {
            SystemBars: { setStyle: (o) => calls.nav.push(o) },
            StatusBar: { setStyle: (o) => calls.status.push(o), setBackgroundColor: () => {} },
          },
        };
      }
      window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: false }) });
    },
  });
  await new Promise((r) => setTimeout(r, 120));
  return { win: dom.window, calls };
}

describe('Native system-bar theming', () => {
  it('defines thwapSyncNavBar alongside thwapSyncStatusBar', async () => {
    const { win } = await boot(true);
    expect(typeof win.thwapSyncNavBar).toBe('function');
    expect(typeof win.thwapSyncStatusBar).toBe('function');
  });

  it('drives the nav-bar icon contrast from the theme on load (default light = light bars)', async () => {
    const { calls } = await boot(true);
    // the theme bootstrap applies the saved theme (default light) on load
    expect(calls.nav.length).toBeGreaterThan(0);
    expect(calls.nav.at(-1)).toEqual({ dark: false });
  });

  it('flips the nav bar to dark when the theme toggles to dark', async () => {
    const { win, calls } = await boot(true);
    const before = calls.nav.length;
    const toggle = win.document.getElementById('themeToggle') || win.document.getElementById('profThemeToggle');
    expect(toggle).toBeTruthy();
    toggle.dispatchEvent(new win.Event('click', { bubbles: true }));
    expect(calls.nav.length).toBeGreaterThan(before);
    expect(calls.nav.at(-1)).toEqual({ dark: true });
  });

  it('is inert on the plain web (no Capacitor): defined, no throw, no bridge calls', async () => {
    const { win } = await boot(false);
    expect(typeof win.thwapSyncNavBar).toBe('function');
    expect(() => win.thwapSyncNavBar(true)).not.toThrow(); // returns early without a native platform
  });
});
