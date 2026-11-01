// test/profile-redesign.test.js
//
// EXECUTION test: boots index.html in jsdom as the native app and checks the
// redesigned Profile tab: Sound / Dark mode / Notifications are role=switch
// controls whose aria-checked follows the real state, the App icon row opens a
// #appicon sub-page holding the picker, and the row summary follows the pick.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');

const MANIFEST = {
  skills: [{ id: 'hands', label: 'Hands' }, { id: 'shooting', label: 'Shooting' }],
  colors: [{ id: 'green', label: 'Green' }, { id: 'purple', label: 'Purple' }],
  icons: [
    { skill: 'hands', color: 'green', iosKey: 'AltIcon-HandsGreen', androidAlias: 'IconHandsGreen', preview: 'app-icons/preview/hands-green.png' },
    { skill: 'hands', color: 'purple', iosKey: 'AltIcon-HandsPurple', androidAlias: 'IconHandsPurple', preview: 'app-icons/preview/hands-purple.png' },
    { skill: 'shooting', color: 'green', iosKey: 'AltIcon-ShootingGreen', androidAlias: 'IconShootingGreen', preview: 'app-icons/preview/shooting-green.png' },
    { skill: 'shooting', color: 'purple', iosKey: 'AltIcon-ShootingPurple', androidAlias: 'IconShootingPurple', preview: 'app-icons/preview/shooting-purple.png' },
  ],
};

async function boot({ pick = null, theme = 'light' } = {}) {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://thwaphockey.com/#profile',
    beforeParse(window) {
      window.scrollTo = () => {};
      window.HTMLMediaElement.prototype.play = () => Promise.resolve();
      window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios', Plugins: {} };
      window.localStorage.setItem('thwapTheme', theme);
      if (pick) window.localStorage.setItem('thwapAppIcon', JSON.stringify(pick));
      window.fetch = (u) => {
        if (String(u).indexOf('app-icons/manifest.json') >= 0) return Promise.resolve({ ok: true, json: () => Promise.resolve(MANIFEST) });
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: false }) });
      };
    },
  });
  await new Promise((r) => setTimeout(r, 90));
  return dom.window;
}

const click = (win, el) => el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));

describe('Profile redesign: settings switches', () => {
  it('Sound, Dark mode and Notifications are labelled role=switch controls', async () => {
    const win = await boot();
    for (const id of ['profSfxToggle', 'profThemeToggle', 'profNotif']) {
      const b = win.document.getElementById(id);
      expect(b.getAttribute('role')).toBe('switch');
      expect(['true', 'false']).toContain(b.getAttribute('aria-checked'));
      const lab = win.document.getElementById(b.getAttribute('aria-labelledby'));
      expect(lab).toBeTruthy();
    }
    expect(win.document.getElementById('profThemeLab').textContent).toBe('Dark mode');
  });

  it('Dark mode switch reflects and flips the theme', async () => {
    const win = await boot({ theme: 'light' });
    const sw = win.document.getElementById('profThemeToggle');
    expect(sw.getAttribute('aria-checked')).toBe('false');
    click(win, sw);
    expect(win.document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(sw.getAttribute('aria-checked')).toBe('true');
  });

  it('Sound switch tracks the mute state and keeps aria-pressed in step', async () => {
    const win = await boot();
    const sw = win.document.getElementById('profSfxToggle');
    const before = sw.getAttribute('aria-checked');
    click(win, sw);
    const after = sw.getAttribute('aria-checked');
    expect(after).not.toBe(before);
    expect(sw.getAttribute('aria-pressed')).toBe(after);
    expect(sw.innerHTML).toBe(''); // a switch, not the footer speaker icon
  });

  it('tapping the row label flips its switch', async () => {
    const win = await boot();
    const sw = win.document.getElementById('profNotif');
    const before = sw.getAttribute('aria-checked');
    click(win, win.document.getElementById('profNotifLab'));
    expect(sw.getAttribute('aria-checked')).not.toBe(before);
  });
});

describe('Profile redesign: App icon row and sub-page', () => {
  it('the row links to the #appicon page, which holds the picker grid', async () => {
    const win = await boot();
    expect(win.document.getElementById('profAppIconRow').getAttribute('href')).toBe('#appicon');
    const page = win.document.getElementById('appicon');
    expect(page.classList.contains('page')).toBe(true);
    expect(page.querySelector('#appIconGrid')).toBeTruthy();
    expect(page.querySelector('a.prof-back').getAttribute('href')).toBe('#profile');
    expect(win.document.querySelectorAll('#appIconGrid .appicon-cell').length).toBe(4);
  });

  it('the row summary shows the current pick and updates when it changes', async () => {
    const win = await boot({ pick: { skill: 'hands', color: 'purple' } });
    const lab = win.document.getElementById('profAppIconLab');
    const mini = win.document.getElementById('profAppIconMini');
    expect(lab.textContent).toBe('Hands, Purple');
    expect(mini.hidden).toBe(false);
    expect(mini.getAttribute('src')).toContain('hands-purple.png');
    const cell = [...win.document.querySelectorAll('#appIconGrid .appicon-cell')]
      .find((c) => c.getAttribute('data-ios') === 'AltIcon-ShootingGreen');
    click(win, cell);
    expect(lab.textContent).toBe('Shooting, Green');
    expect(mini.getAttribute('src')).toContain('shooting-green.png');
  });

  it('with no pick yet the row shows no summary', async () => {
    const win = await boot();
    expect(win.document.getElementById('profAppIconLab').textContent).toBe('');
    expect(win.document.getElementById('profAppIconMini').hidden).toBe(true);
  });
});

describe('Profile redesign: chrome', () => {
  it('hides the close X and brand header on Profile while the tab bar shows', () => {
    expect(html).toContain('body.is-native.is-authed:not(.login-locked) #profile>.glassclose,\nbody.is-native.is-authed:not(.login-locked) #profile>.topbar{display:none}');
  });
  it('the App icon page is never routable on the web, like #profile', () => {
    expect(html).toContain('body:not(.is-native) #appicon.page:target{display:none}');
  });
});
