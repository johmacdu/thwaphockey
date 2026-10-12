// test/passing-discipline.test.js
//
// EXECUTION test: boots index.html in jsdom and checks the Passing discipline is
// live -- PASS_DAYS holds the two real sessions, the #pass page renders the
// drills (name, theme, cue, steps), the nav card dropped "Coming soon", and
// finishing passing is accepted by the shared celebration (thwapCategoryDone).
//
// The weekday is forced via ?day= so a known session renders. day=4 -> Monday
// (weekday slot 0 -> PASS_DAYS[0], the first session).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');

async function boot(day) {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: `https://thwaphockey.com/?day=${day}#pass`,
    beforeParse(window) {
      window.scrollTo = () => {};
      window.HTMLMediaElement.prototype.play = () => Promise.resolve();
      window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: false }) });
    },
  });
  await new Promise((r) => setTimeout(r, 80));
  return dom.window;
}

describe('Passing discipline (live)', () => {
  it('PASS_DAYS holds two sessions of five drills each, fully formed', async () => {
    const win = await boot(4);
    const days = win.PASS_DAYS;
    expect(Array.isArray(days)).toBe(true);
    expect(days.length).toBe(2);
    const flat = days.flat();
    expect(flat.length).toBe(10);
    flat.forEach((dr) => {
      expect(typeof dr.name).toBe('string');
      expect(typeof dr.theme).toBe('string');
      expect(typeof dr.cue).toBe('string');
      expect(Array.isArray(dr.steps) && dr.steps.length).toBeTruthy();
    });
    // The coach's named drills are present.
    const names = flat.map((d) => d.name);
    expect(names).toContain('Target Net Passing');
    expect(names).toContain('Backhand Receiving');
    expect(names).toContain('Timed Accuracy Circuit');
  });

  it('renders the full session on the #pass page (names, theme, steps)', async () => {
    const win = await boot(4); // Monday -> session 1
    const rows = win.document.querySelectorAll('#passList .exrow');
    expect(rows.length).toBe(5);
    const text = win.document.getElementById('passList').textContent;
    expect(text).toContain('Target Net Passing');
    expect(text).toContain('Fundamental Accuracy'); // theme
    expect(text).toContain('follow-through at the target'); // a step
    // No stray "Coming soon" anywhere on the passing card.
    expect(win.document.querySelector('.nav-pass').textContent).not.toContain('Coming soon');
  });

  it('finishing passing is accepted by the shared celebration (pass is a real discipline)', async () => {
    const win = await boot(4);
    expect(typeof win.thwapCategoryDone).toBe('function');
    win.thwapCategoryDone('pass');
    const d = new Date();
    const dk = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    // The once-per-day guard is only set when the discipline is allowed (so this
    // proves 'pass' was NOT early-returned as an unknown discipline).
    expect(win.localStorage.getItem(`thwapCatCeleb|${dk}|pass`)).toBe('1');
  });
});
