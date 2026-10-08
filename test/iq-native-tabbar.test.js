// test/iq-native-tabbar.test.js
//
// EXECUTION test: boots index.html in jsdom inside the Capacitor native shell
// (window.Capacitor.isNativePlatform() -> true, so body.is-native is set) and
// verifies Hockey IQ coexists with the native floating bottom tab bar:
//
//  1. On Thursday (wd=4) the Hockey IQ home nav card (.nav-iq) is visible on the
//     Train landing alongside the other discipline cards.
//  2. Opening the Hockey IQ page (#iq) keeps the TRAIN tab lit -- IQ is a Train
//     discipline, exactly like #stick/#shoot/#dryland/#drillpick/#pass.
//     Regression guard for the bug this file was added with: tabForHash() rolled
//     every other discipline sub-page up to Train but omitted #iq, so opening
//     Hockey IQ in the native app darkened the whole tab bar (no tab lit).
//  3. On a non-IQ day (Wednesday, wd=3) the card stays hidden even in native.
//
// Day is pinned via the real ?day=N override. thwapWeekday() = ((((N%7)+7)%7)+4)%7,
// so day=0 -> Thu(4), day=1 -> Fri(5), day=6 -> Wed(3).
//
// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');

// Boot index.html in jsdom pretending to be the iOS Capacitor shell.
async function boot(day) {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: `https://thwaphockey.com/?day=${day}`,
    beforeParse(window) {
      window.scrollTo = () => {};
      window.HTMLMediaElement.prototype.play = () => Promise.resolve();
      // Capacitor native shell: makes the bridge + the is-native flag fire.
      window.Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => 'ios',
        Plugins: {},
      };
      // Authed player so the home screen and its day gate are active.
      window.document.cookie = 'thwapAuth=1';
      try { window.localStorage.setItem('bfPlayer', 'Teddy'); } catch (e) {}
      // Keep the plan fetch quiet; the IQ gate is a built-in default and does
      // not depend on it.
      window.fetch = () =>
        Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: false }) });
    },
  });
  await new Promise((r) => setTimeout(r, 100));
  return dom.window;
}

function visible(win, el) {
  if (!el) return false;
  // Inline display:none is how the day gate hides a nav card.
  if (el.style && el.style.display === 'none') return false;
  const cs = win.getComputedStyle(el);
  return cs.display !== 'none' && cs.visibility !== 'hidden';
}

describe('Hockey IQ in the native tab layout', () => {
  it('sets body.is-native inside the Capacitor shell', async () => {
    const win = await boot(0); // Thursday
    expect(win.document.body.classList.contains('is-native')).toBe(true);
  });

  it('shows the Hockey IQ nav card on the Train landing on Thursday', async () => {
    const win = await boot(0); // Thursday
    const card = win.document.querySelector('.nav-iq');
    expect(card).toBeTruthy();
    expect(visible(win, card)).toBe(true);
  });

  it('hides the Hockey IQ nav card on a non-IQ day even in native', async () => {
    const win = await boot(6); // Wednesday
    const card = win.document.querySelector('.nav-iq');
    expect(card).toBeTruthy();
    expect(visible(win, card)).toBe(false);
  });

  it('renders the native tab bar alongside the IQ card (both present, no clash)', async () => {
    const win = await boot(0); // Thursday
    const bar = win.document.getElementById('tabbar');
    expect(bar).toBeTruthy();
    const card = win.document.querySelector('.nav-iq');
    // Both the IQ card and the native tab bar coexist on the same Train landing.
    expect(visible(win, card)).toBe(true);
    expect(bar.querySelectorAll('.tab-player .tabbar-btn').length).toBe(5);
  });

  it('keeps the Train tab lit when the Hockey IQ page (#iq) is open', async () => {
    const win = await boot(0); // Thursday
    win.location.hash = '#iq';
    // Fire the hashchange so paintTabs() recomputes the active tab.
    win.dispatchEvent(new win.Event('hashchange'));
    await new Promise((r) => setTimeout(r, 30));
    const bar = win.document.getElementById('tabbar');
    const trainBtn = bar.querySelector('.tab-player .tabbar-btn[href="#home"]');
    expect(trainBtn).toBeTruthy();
    // The regression: without #iq in tabForHash's roll-up, no tab is lit on #iq.
    expect(trainBtn.classList.contains('on')).toBe(true);
    // And exactly one tab is lit (Train), not zero and not several.
    const lit = [...bar.querySelectorAll('.tab-player .tabbar-btn.on')];
    expect(lit.length).toBe(1);
    expect(lit[0].getAttribute('href')).toBe('#home');
  });
});
