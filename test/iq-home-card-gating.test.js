// test/iq-home-card-gating.test.js
//
// EXECUTION test (not a string guard): boots index.html in jsdom, runs its inline
// scripts, and asserts the Hockey IQ home nav card (.nav-iq) is shown ONLY on
// Thursday (wd=4) and Friday (wd=5), hidden every other day.
//
// Regression guard for the reported bug: the Hockey IQ card appeared on Wednesday.
// The player-home day gate (the "Team plan" block) toggled .nav-stick/.nav-shoot/
// .nav-dryland by day but never touched .nav-iq, so the IQ card stayed visible on
// every day even though the quiz itself (iqToday()) is Thu/Fri only. The fix gates
// .nav-iq on the same Vancouver weekday (wd!==4 && wd!==5 -> display:none).
//
// Day is pinned via the real ?day=N override. thwapWeekday() = ((((N%7)+7)%7)+4)%7,
// so: day=6 -> Wed(3), day=0 -> Thu(4), day=1 -> Fri(5), day=4 -> Mon(1),
//     day=5 -> Tue(2), day=2 -> Sat(6), day=3 -> Sun(0).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');

// ?day= value -> resulting weekday (wd) -> label.
const CASES = [
  { day: 3, wd: 0, label: 'Sunday',    expectShown: false },
  { day: 4, wd: 1, label: 'Monday',    expectShown: false },
  { day: 5, wd: 2, label: 'Tuesday',   expectShown: false },
  { day: 6, wd: 3, label: 'Wednesday', expectShown: false }, // the reported bug
  { day: 0, wd: 4, label: 'Thursday',  expectShown: true },
  { day: 1, wd: 5, label: 'Friday',    expectShown: true },
  { day: 2, wd: 6, label: 'Saturday',  expectShown: false },
];

async function boot(day) {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: `https://thwaphockey.com/?day=${day}`,
    beforeParse(window) {
      window.scrollTo = () => {};
      window.HTMLMediaElement.prototype.play = () => Promise.resolve();
      // Authed player so the home screen (and its day gate) is active.
      window.document.cookie = 'thwapAuth=1';
      try { window.localStorage.setItem('bfPlayer', 'Teddy'); } catch (e) {}
      // No coach plan: the IQ gate lives in the built-in default and does not
      // depend on the plan fetch, but keep fetch quiet so the gate runs clean.
      window.fetch = () =>
        Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: false }) });
    },
  });
  await new Promise((r) => setTimeout(r, 80));
  return dom.window;
}

function iqShown(win) {
  const el = win.document.querySelector('.nav-iq');
  if (!el) return '(missing)';
  return el.style.display !== 'none';
}

describe('Hockey IQ home card is Thursday/Friday only', () => {
  for (const c of CASES) {
    it(`${c.label} (?day=${c.day}, wd=${c.wd}): nav-iq ${c.expectShown ? 'shown' : 'hidden'}`, async () => {
      const win = await boot(c.day);
      expect(iqShown(win)).toBe(c.expectShown);
    });
  }

  it('Wednesday specifically does not show the Hockey IQ card (the reported bug)', async () => {
    const win = await boot(6); // wd=3, Wednesday
    const el = win.document.querySelector('.nav-iq');
    expect(el).toBeTruthy();
    expect(el.style.display).toBe('none');
  });
});
