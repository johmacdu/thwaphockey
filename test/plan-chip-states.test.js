// test/plan-chip-states.test.js
//
// The coach Plan page chips must show THREE clearly distinct states:
//   OFF      -- category not scheduled that day (soft grey, muted)
//   REQUIRED -- scheduled, counts toward "all done" (solid lime)
//   OPTIONAL -- a bonus, shown to players but never required (solid blue + label)
//
// Reported bug: toggling a category to "optional" and tapping Save in the drill
// picker didn't visibly change the chip. The DATA path was correct (render() runs
// on picker Save and sets `plancat on optional`), but the old optional style was a
// washed-out soft background with a dashed border -- it read like a de-emphasized
// OFF chip, not a confident third state. This asserts (a) the three state CSS rules
// are present and distinct, and (b) the picker Save flow flips the chip to optional.
//
// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');

describe('Plan chip states are three distinct, non-washed-out colors', () => {
  it('REQUIRED chip is a solid lime fill', () => {
    expect(html).toMatch(/\.plancat\.on\{background:var\(--lime\);color:var\(--ink\)/);
  });
  it('OPTIONAL chip is a solid blue fill (a confident third state, not a dashed/soft lime)', () => {
    expect(html).toMatch(/\.plancat\.on\.optional\{background:var\(--blue\);color:var\(--ink\)/);
    // must NOT be the old washed-out soft+dashed treatment that read like OFF
    expect(html).not.toMatch(/\.plancat\.on\.optional\{background:var\(--soft\)/);
  });
  it('OFF chip (base .plancat) is the soft/muted grey state', () => {
    expect(html).toMatch(/\.plancat\{[^}]*background:var\(--soft\)[^}]*color:var\(--muted\)/);
  });
});

describe('Picker Save flips the chip to the optional state (data path)', () => {
  it('toggling optional mode + Save gives the chip "on optional" and an optional sub-label', async () => {
    const dom = new JSDOM(html, {
      runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/#plan',
      beforeParse(w) {
        w.fetch = (u) => String(u).includes('get-plan')
          ? Promise.resolve({ json: () => Promise.resolve({ ok: true, plan: { wed: { stick: ['Toe Drags', 'Figure 8s'] } } }) })
          : Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
        w.scrollTo = () => {};
        w.localStorage.setItem('thwapCoach', JSON.stringify({ token: 't', email: 'c', name: 'C', teams: ['R'], teamList: [{ code: 'R', name: 'Rangers', ageGroup: '10U' }] }));
      },
    });
    const w = dom.window, d = w.document;
    await new Promise((r) => setTimeout(r, 500));
    const chip = () => [...d.querySelectorAll('.plancat')].find((c) => c.getAttribute('data-day') === 'wed' && c.getAttribute('data-cat') === 'stick');

    expect(chip()).toBeTruthy();
    expect(chip().className).toContain('on');            // seeded as required
    expect(chip().className).not.toContain('optional');

    chip().click();                                      // open the picker
    await new Promise((r) => setTimeout(r, 120));
    expect(w.location.hash).toBe('#drillpick');
    d.getElementById('dpkModeOpt').click();              // toggle to optional
    d.getElementById('dpkSave').click();                 // save
    await new Promise((r) => setTimeout(r, 180));

    expect(chip().className).toContain('optional');      // chip now reflects optional
    expect(chip().querySelector('.plancat-opt')).toBeTruthy();
  });
});
