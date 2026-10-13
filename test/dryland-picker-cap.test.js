// test/dryland-picker-cap.test.js
//
// Guards that the coach drill-picker refuses a 4th pick for one day in the
// categories now capped at 3/day: Dryland (lowered 6 -> 3) and Shooting
// (lowered 5 -> 3). Stickhandling was already 3. So a coach cannot save more
// than 3 drills for a single weekday in any skill category going forward,
// matching the 3/day cap applied everywhere (including Passing).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');

async function bootCoach() {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://thwaphockey.com/',
    beforeParse(window) {
      window.scrollTo = () => {};
      window.HTMLMediaElement.prototype.play = () => Promise.resolve();
      window.localStorage.setItem(
        'thwapCoach',
        JSON.stringify({ token: 't', teams: ['RANGERS72'], name: 'Jack Adams' })
      );
      // A real (non-empty) plan is returned so seedDefaults() does NOT run --
      // otherwise Tuesday dryland starts pre-seeded with 2 drills already staged,
      // which would make this test's own clicks start from a non-zero baseline.
      window.fetch = (u) => {
        if (String(u).indexOf('get-plan') >= 0) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ ok: true, plan: { mon: { stick: ['Stationary Side-to-Side'] }, tue: {} } }),
          });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: false }) });
      };
    },
  });
  await new Promise((r) => setTimeout(r, 150));
  return dom.window;
}

describe('Dryland picker budget caps at 3 drills/day', () => {
  it('refuses a 4th dryland pick for the same day (flashes over, does not add it)', async () => {
    const win = await bootCoach();
    const chip = win.document.querySelector('.plancat[data-day="tue"][data-cat="dryland"]');
    expect(chip).toBeTruthy();
    chip.click(); // open the drill picker for tue/dryland
    win.document.getElementById('dpkReset').click(); // start from zero staged picks

    const rows = [...win.document.querySelectorAll('#dpkList .dpk-row')];
    expect(rows.length).toBeGreaterThanOrEqual(4);
    // Pick the first 4 distinct drills.
    for (let i = 0; i < 4; i++) rows[i].querySelector('.dpk-main').click();

    const picked = win.document.querySelectorAll('#dpkList .dpk-row.picked');
    // Only 3 should have taken; the 4th click is refused by the budget guard.
    expect(picked.length).toBe(3);

    win.document.getElementById('dpkSave').click();
    const chipAfter = win.document.querySelector('.plancat[data-day="tue"][data-cat="dryland"]');
    const n = chipAfter.querySelector('.plancat-n');
    expect(parseInt(n.textContent, 10)).toBe(3);
  });
});

describe('Shooting picker budget caps at 3 drills/day', () => {
  it('refuses a 4th shoot pick for the same day (flashes over, does not add it)', async () => {
    const win = await bootCoach();
    const chip = win.document.querySelector('.plancat[data-day="tue"][data-cat="shoot"]');
    expect(chip).toBeTruthy();
    chip.click(); // open the drill picker for tue/shoot
    win.document.getElementById('dpkReset').click(); // start from zero staged picks

    const rows = [...win.document.querySelectorAll('#dpkList .dpk-row')];
    expect(rows.length).toBeGreaterThanOrEqual(4);
    for (let i = 0; i < 4; i++) rows[i].querySelector('.dpk-main').click();

    const picked = win.document.querySelectorAll('#dpkList .dpk-row.picked');
    // Only 3 should have taken; the 4th click is refused by the budget guard.
    expect(picked.length).toBe(3);

    win.document.getElementById('dpkSave').click();
    const chipAfter = win.document.querySelector('.plancat[data-day="tue"][data-cat="shoot"]');
    const n = chipAfter.querySelector('.plancat-n');
    expect(parseInt(n.textContent, 10)).toBe(3);
  });
});
