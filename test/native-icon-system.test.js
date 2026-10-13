// test/native-icon-system.test.js
//
// EXECUTION test: the unified drawn icon set is native-only. In the Capacitor
// shell (body.is-native) emoji are swapped for .twi SVGs across the tab bar, the
// coach by-skill panel, the standings totals and the lock glyphs; on the plain
// web the product keeps its emoji untouched.
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
      if (native) window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios', Plugins: {} };
      window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: false }) });
    },
  });
  await new Promise((r) => setTimeout(r, 100));
  return dom.window;
}

describe('Unified native drawn icon set', () => {
  it('swaps the tab bar emoji for drawn .twi SVGs in the native shell', async () => {
    const win = await boot(true);
    expect(win.document.documentElement.classList.contains('is-native')).toBe(true);
    const icos = win.document.querySelectorAll('.tabbar-btn[data-tab] .tabbar-ico');
    expect(icos.length).toBeGreaterThan(0);
    // every tab icon is now an SVG, none still an emoji text node
    for (const el of icos) {
      expect(el.querySelector('svg.twi'), `${el.closest('.tabbar-btn').getAttribute('data-tab')} icon`).toBeTruthy();
      expect(el.textContent.trim()).toBe('');
    }
  });

  it('leaves the tab bar emoji untouched on the plain web', async () => {
    const win = await boot(false);
    expect(win.document.documentElement.classList.contains('is-native')).toBe(false);
    const home = win.document.querySelector(".tabbar-btn[data-tab='home'] .tabbar-ico");
    expect(home.querySelector('svg')).toBeNull();
    expect(home.textContent.trim().length).toBeGreaterThan(0); // still the emoji
  });

  it('thwapGlyph returns an SVG natively and the emoji fallback on the web', async () => {
    const nativeWin = await boot(true);
    expect(nativeWin.thwapGlyph('stick', '🏒')).toContain('<svg');
    expect(nativeWin.thwapGlyph('trophy', '🏆')).toContain('twi');
    const webWin = await boot(false);
    expect(webWin.thwapGlyph('stick', '🏒')).toBe('🏒');
    expect(webWin.thwapGlyph('trophy', '🏆')).toBe('🏆');
  });

  it('exposes a bold colourful glyph for every emoji site (tab bar, disciplines, lock, trophy, star, team, profile, plan)', async () => {
    const win = await boot(true);
    const G = win.THWAP_GLYPHS;
    for (const name of ['stick', 'net', 'bolt', 'brain', 'target', 'star', 'people', 'trophy', 'person', 'clipboard', 'lock']) {
      expect(G[name], name).toContain('<svg');
      expect(G[name], `${name} is colourful`).toMatch(/(fill|stroke)='#[0-9A-Fa-f]/); // kid-friendly filled colour, not a mono outline
    }
  });

  it('swaps the coach "read" lock glyph (.idpdev-lock) for the drawn padlock natively', async () => {
    const win = await boot(true);
    const lock = win.document.querySelector('.idpdev-lock');
    expect(lock).toBeTruthy();
    expect(lock.querySelector('svg.twi')).toBeTruthy();
  });
});
