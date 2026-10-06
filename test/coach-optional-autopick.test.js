// test/coach-optional-autopick.test.js
//
// EXECUTION test: boots index.html in jsdom AS A COACH (thwapCoach token set), lets
// the Weekly Plan grid render, then drives the drill picker to prove the auto-pick
// convenience:
//   - Marking a category OPTIONAL and tapping Save with NOTHING picked auto-fills a
//     sensible random set within the ~15 min/category budget, and tags it optional.
//   - A REQUIRED category saved with nothing picked stays OFF (no auto-pick) -- the
//     coach picks required drills deliberately.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');

// Budget caps (DAY_MIN=15, DAY_COUNT below) -> most drills that still fit 15 min.
const MAX_FOR = { stick: 3, shoot: 5, dryland: 6 };

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
      // Empty plan -> the coach UI seeds sensible defaults (Sat/Sun stay empty).
      window.fetch = (u) => {
        if (String(u).indexOf('get-plan') >= 0) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, plan: { sat: {} } }) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: false }) });
      };
    },
  });
  await new Promise((r) => setTimeout(r, 150)); // let loadPlan() + render() settle
  return dom.window;
}

function chip(win, day, cat) {
  return win.document.querySelector('.plancat[data-day="' + day + '"][data-cat="' + cat + '"]');
}
function count(c) {
  const n = c && c.querySelector('.plancat-n');
  return n ? parseInt(n.textContent, 10) || 0 : 0;
}

describe('Coach optional auto-pick (just tap Save)', () => {
  it('OPTIONAL + Save with nothing picked auto-fills drills within the 15 min budget and tags it optional', async () => {
    const win = await bootCoach();
    // Saturday Hands starts empty (off).
    const before = chip(win, 'sat', 'stick');
    expect(before).toBeTruthy();
    expect(before.classList.contains('on')).toBe(false);

    before.click(); // open the drill picker for sat/stick
    win.document.getElementById('dpkModeOpt').click(); // choose Optional
    win.document.getElementById('dpkSave').click(); // Save with nothing staged

    const after = chip(win, 'sat', 'stick');
    expect(after.classList.contains('on')).toBe(true); // now on
    expect(after.classList.contains('optional')).toBe(true); // tagged optional
    const n = count(after);
    expect(n).toBeGreaterThanOrEqual(1); // at least one drill auto-picked
    expect(n).toBeLessThanOrEqual(MAX_FOR.stick); // never past the ~15 min budget
    // the optional label is shown on the chip
    expect(after.querySelector('.plancat-opt')).toBeTruthy();
  });

  it('REQUIRED + Save with nothing picked stays OFF (no auto-pick)', async () => {
    const win = await bootCoach();
    const before = chip(win, 'sat', 'shoot');
    before.click(); // open picker (defaults to Required)
    win.document.getElementById('dpkSave').click(); // Save with nothing staged, still Required

    const after = chip(win, 'sat', 'shoot');
    expect(after.classList.contains('on')).toBe(false); // off, not auto-filled
    expect(count(after)).toBe(0);
  });
});
