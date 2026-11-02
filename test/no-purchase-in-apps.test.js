// test/no-purchase-in-apps.test.js
//
// EXECUTION test: inside the iOS and Android apps, Thwap never shows signup, a
// price, a buy button or a link to pay. Teams join and pay on the website only
// (App Store guideline 3.1.1 / 3.1.3, Google Play payments policy). The website
// is unchanged.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');

const COACH = JSON.stringify({ token: 't', email: 'dana@example.com', name: 'Dana', teams: ['FALCONS42'], teamList: [{ code: 'FALCONS42', name: 'Falcons 10U' }] });

async function boot({ app = false, storage = {} } = {}) {
  const calls = [];
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://thwaphockey.com/', virtualConsole: new VirtualConsole(),
    beforeParse(window) {
      window.scrollTo = () => {};
      window.HTMLMediaElement.prototype.play = () => Promise.resolve();
      if (app) window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios', Plugins: {} };
      for (const [k, v] of Object.entries(storage)) window.localStorage.setItem(k, v);
      window.fetch = (u) => {
        calls.push(String(u));
        return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
      };
    },
  });
  await new Promise((r) => setTimeout(r, 120));
  const w = dom.window;
  const $ = (id) => w.document.getElementById(id);
  const shown = (el) => w.getComputedStyle(el).display !== 'none';
  return { w, $, shown, calls };
}

const SURFACES = (t) => [
  t.$('navWaitlist'), t.$('navWaitlistK'),
  t.$('waitCoach').closest('p'), t.$('loginCoachLine'),
  t.$('coachSignupForm'), t.$('waitForm'), t.$('chBilling'),
  t.$('jnTodoPay').closest('li'), // Join Thwap checklist: "Pay for Thwap"
];

describe('in the iOS and Android apps', () => {
  it('hides every signup and purchase surface', async () => {
    const t = await boot({ app: true });
    expect(t.w.document.documentElement.classList.contains('is-native')).toBe(true);
    for (const el of SURFACES(t)) {
      expect(el, 'surface exists').toBeTruthy();
      expect(t.shown(el), el.id || el.className).toBe(false);
    }
    // Sign In stays.
    expect(t.shown(t.$('navSignIn'))).toBe(true);
  });

  it('a lapsed team sees plain words: no button, no price, no code box', async () => {
    const t = await boot({ app: true });
    t.w.thwapPaywall({ gated: true, currentSeason: 'fw-2026' }, 'FALCONS42');
    expect(t.$('paywall').hidden).toBe(false);
    expect(t.$('paywallMsg').textContent).toBe("Your team's season has ended. Your team manager can renew it.");
    expect(t.$('paywallActions').innerHTML).toBe('');
    expect(t.$('paywall').querySelector('button, a, input')).toBeNull();
    expect(t.$('paywall').textContent).not.toMatch(/\$|code|thwaphockey\.com/i);
  });

  it('a kid sees no button either', async () => {
    const t = await boot({ app: true });
    t.w.thwapPaywall({ gated: true }, '');
    expect(t.$('paywall').querySelector('button')).toBeNull();
  });

  it('never loads the coach billing card', async () => {
    const t = await boot({ app: true, storage: { thwapCoach: COACH } });
    expect(t.calls.some((u) => /api\/billing\?action=screen/.test(u))).toBe(false);
  });
});

describe('on the website (unchanged)', () => {
  it('still shows the waitlist link', async () => {
    const t = await boot();
    expect(t.w.document.documentElement.classList.contains('is-native')).toBe(false);
    expect(t.shown(t.$('navWaitlist'))).toBe(true);
  });

  it('a lapsed coach still gets Renew', async () => {
    const t = await boot();
    t.w.thwapPaywall({ gated: true, currentSeason: 'fw-2026' }, 'FALCONS42');
    expect(t.$('paywallMsg').textContent).toBe('Your season has ended. Renew to keep training.');
    expect(t.$('pwRenew')).toBeTruthy();
  });
});
