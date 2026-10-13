// test/app-icon-picker.test.js
//
// EXECUTION test: boots index.html in jsdom and drives the Settings "App icon"
// picker -- it renders a cell per skill x color from the manifest, remembers the
// choice in localStorage, and fails safe when no native icon bridge is present.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');

const MANIFEST = {
  skills: [{ id: 'hands', label: 'Hands' }, { id: 'shooting', label: 'Shooting' }],
  colors: [{ id: 'green', label: 'Green', hex: '#8FD65E' }, { id: 'blue', label: 'Blue', hex: '#75B8FF' }],
  icons: [
    { skill: 'hands', color: 'green', iosKey: 'AltIcon-HandsGreen', androidAlias: 'IconHandsGreen', preview: 'app-icons/preview/hands-green.png', darkPreview: 'app-icons/preview/hands-green-dark.png' },
    { skill: 'hands', color: 'blue', iosKey: 'AltIcon-HandsBlue', androidAlias: 'IconHandsBlue', preview: 'app-icons/preview/hands-blue.png' },
    { skill: 'shooting', color: 'green', iosKey: 'AltIcon-ShootingGreen', androidAlias: 'IconShootingGreen', preview: 'app-icons/preview/shooting-green.png' },
    { skill: 'shooting', color: 'blue', iosKey: 'AltIcon-ShootingBlue', androidAlias: 'IconShootingBlue', preview: 'app-icons/preview/shooting-blue.png' },
  ],
};

async function boot(withCapacitor) {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://thwaphockey.com/',
    beforeParse(window) {
      window.scrollTo = () => {};
      window.HTMLMediaElement.prototype.play = () => Promise.resolve();
      window.fetch = (u) => {
        if (String(u).indexOf('app-icons/manifest.json') >= 0) return Promise.resolve({ ok: true, json: () => Promise.resolve(MANIFEST) });
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: false }) });
      };
      if (withCapacitor) withCapacitor(window);
    },
  });
  await new Promise((r) => setTimeout(r, 90));
  return dom.window;
}

describe('Settings app icon picker', () => {
  it('renders a cell per skill x color from the manifest', async () => {
    const win = await boot();
    const cells = win.document.querySelectorAll('#appIconGrid .appicon-cell');
    expect(cells.length).toBe(4);
    const labels = Array.from(win.document.querySelectorAll('#appIconGrid .appicon-skilllab')).map((e) => e.textContent);
    expect(labels).toEqual(['Hands', 'Shooting']);
  });

  it('selecting an icon remembers the choice and marks it, with no native bridge needed', async () => {
    const win = await boot();
    const cells = win.document.querySelectorAll('#appIconGrid .appicon-cell');
    const shootingBlue = Array.from(cells).find((c) => c.getAttribute('data-ios') === 'AltIcon-ShootingBlue');
    expect(shootingBlue).toBeTruthy();
    expect(() => shootingBlue.dispatchEvent(new win.Event('click', { bubbles: true }))).not.toThrow();
    expect(shootingBlue.classList.contains('sel')).toBe(true);
    const saved = JSON.parse(win.localStorage.getItem('thwapAppIcon'));
    expect(saved).toMatchObject({ skill: 'shooting', color: 'blue', iosKey: 'AltIcon-ShootingBlue', androidAlias: 'IconShootingBlue' });
    // only one selected at a time
    expect(win.document.querySelectorAll('#appIconGrid .appicon-cell.sel').length).toBe(1);
  });

  it('previews the dark variant via <picture> + prefers-color-scheme (mirrors the iOS 18 swap)', async () => {
    const win = await boot();
    const cell = Array.from(win.document.querySelectorAll('#appIconGrid .appicon-cell'))
      .find((c) => c.getAttribute('data-ios') === 'AltIcon-HandsGreen');
    const source = cell.querySelector('picture source');
    expect(source).toBeTruthy();
    expect(source.getAttribute('media')).toBe('(prefers-color-scheme: dark)');
    expect(source.getAttribute('srcset')).toContain('hands-green-dark.png');
    // light stays the <img> fallback
    expect(cell.querySelector('picture img').getAttribute('src')).toContain('hands-green.png');
  });

  it('routes the Android alias (not the iOS key) to the native bridge on Android', async () => {
    const calls = [];
    const win = await boot((window) => {
      window.Capacitor = {
        getPlatform: () => 'android',
        Plugins: { DynamicAppIcon: { change: (o) => { calls.push(o); return Promise.resolve(); } } },
      };
    });
    const cell = Array.from(win.document.querySelectorAll('#appIconGrid .appicon-cell'))
      .find((c) => c.getAttribute('data-ios') === 'AltIcon-HandsBlue');
    cell.dispatchEvent(new win.Event('click', { bubbles: true }));
    expect(calls).toEqual([{ name: 'IconHandsBlue' }]); // the activity-alias, not AltIcon-HandsBlue
  });
});
