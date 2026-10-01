// test/coach-plan-gating.test.js
//
// EXECUTION test (not a string guard): boots index.html in jsdom, runs its inline
// scripts, and drives the player-home "Team plan" gating logic with a mocked
// /api/coach?action=get-plan response. Regression guard for the bug where the
// coach's per-day Weekly Training Plan did NOT gate the player home.
//
// Two root causes this guards:
//   1. The gate queried .nav-stick/.nav-shoot/.nav-dryland, which are declared
//      LATER in the document than the gate's own <script>, so at parse time the
//      rows did not exist, the gate returned early, and the plan fetch never ran.
//      The fix defers the gate to DOMContentLoaded.
//   2. The gate read the day plan as an ARRAY (onCats.indexOf), but the server
//      normalizes every day to an OBJECT ({stick:[...],shoot:[...]}) where a
//      PRESENT key means that category is ON (an off category has no key; an empty
//      array is still ON). .indexOf on an object was undefined -> threw -> swallowed
//      by .catch -> every discipline showed every day. The fix reads both shapes.
//
// Weekend catch-up (product rule): on Sat/Sun, when the coach has NOT explicitly set
// categories for the day, Hands (stick) + Shooting stay available as optional catch-up
// and Dryland rests. An explicit weekend plan is authoritative, same as a weekday.
//
// The weekday is pinned via the real ?day=N override (dayIndex/thwapWeekday honor it):
//   day=4 -> Mon(1), day=5 -> Tue(2), day=6 -> Wed(3), day=0 -> Thu(4),
//   day=1 -> Fri(5), day=2 -> Sat(6, weekend), day=3 -> Sun(0, weekend).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');

// ?day= value that produces each weekday (see mapping above).
const DAYPARAM = { mon: 4, tue: 5, wed: 6, thu: 0, fri: 1, sat: 2, sun: 3 };

async function boot({ planResponse, fetchRejects = false, day = 'mon' }) {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: `https://thwaphockey.com/?day=${DAYPARAM[day]}`,
    beforeParse(window) {
      window.scrollTo = () => {};
      // jsdom has no media playback; the splash hit sound calls .play()
      window.HTMLMediaElement.prototype.play = () => Promise.resolve();
      window.fetch = (u) => {
        const url = String(u);
        if (url.indexOf('action=get-plan') >= 0) {
          if (fetchRejects) return Promise.reject(new Error('network down'));
          return Promise.resolve({ ok: true, json: () => Promise.resolve(planResponse) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: false }) });
      };
    },
  });
  // let DOMContentLoaded + the async .then gate settle
  await new Promise((r) => setTimeout(r, 80));
  return dom.window;
}

function disp(win, cls) {
  const el = win.document.querySelector(cls);
  return el ? el.style.display : '(missing)';
}

describe('Coach Weekly Training Plan gates the player home', () => {
  it('OBJECT day with only some categories present: hides the absent, shows the present', async () => {
    // Monday plan: Hands (stick) ON only. shoot + dryland absent -> OFF.
    const win = await boot({ planResponse: { ok: true, plan: { mon: { stick: [] } } }, day: 'mon' });
    expect(disp(win, '.nav-stick')).toBe(''); // present key -> shown
    expect(disp(win, '.nav-shoot')).toBe('none'); // absent key -> hidden
    expect(disp(win, '.nav-dryland')).toBe('none'); // absent key -> hidden
  });

  it('OBJECT day with a category ON carrying drill names shows that category', async () => {
    // Tuesday plan: Dryland ON (with specific drills), stick + shoot OFF.
    const win = await boot({
      planResponse: { ok: true, plan: { tue: { dryland: ['Stair Sprints', 'Plank'] } } },
      day: 'tue',
    });
    expect(disp(win, '.nav-dryland')).toBe('');
    expect(disp(win, '.nav-stick')).toBe('none');
    expect(disp(win, '.nav-shoot')).toBe('none');
  });

  it('OBJECT day with all three categories present shows all three', async () => {
    const win = await boot({
      planResponse: { ok: true, plan: { wed: { stick: [], shoot: [], dryland: [] } } },
      day: 'wed',
    });
    expect(disp(win, '.nav-stick')).toBe('');
    expect(disp(win, '.nav-shoot')).toBe('');
    expect(disp(win, '.nav-dryland')).toBe('');
  });

  it('legacy ARRAY day shape still works (on-categories as a string array)', async () => {
    const win = await boot({ planResponse: { ok: true, plan: { thu: ['shoot'] } }, day: 'thu' });
    expect(disp(win, '.nav-shoot')).toBe('');
    expect(disp(win, '.nav-stick')).toBe('none');
    expect(disp(win, '.nav-dryland')).toBe('none');
  });

  it('fails open on fetch error: the built-in default is left in place', async () => {
    // Monday is not a built-in dryland day, so dryland is hidden by the pre-fetch
    // default; stick + shoot stay shown. The gate must not override on fetch error.
    const win = await boot({ planResponse: null, fetchRejects: true, day: 'mon' });
    expect(disp(win, '.nav-stick')).toBe('');
    expect(disp(win, '.nav-shoot')).toBe('');
    expect(disp(win, '.nav-dryland')).toBe('none');
  });

  it('fails open when the plan is unset: built-in default (Wed is a dryland day)', async () => {
    const win = await boot({ planResponse: { ok: true, plan: {} }, day: 'wed' });
    expect(disp(win, '.nav-stick')).toBe('');
    expect(disp(win, '.nav-shoot')).toBe('');
    expect(disp(win, '.nav-dryland')).toBe(''); // Wed is in the built-in Tue/Wed/Thu set
  });

  it('does not throw on a malformed object day; weekday with nothing explicit fails open', async () => {
    // Friday, a day present but with no known category keys -> nothing explicit ->
    // fail open to the built-in default (stick + shoot shown, dryland hidden Fri).
    // Crucially: no exception (the old code did onCats.indexOf and threw).
    const win = await boot({ planResponse: { ok: true, plan: { fri: { bogus: 1 } } }, day: 'fri' });
    expect(disp(win, '.nav-stick')).toBe('');
    expect(disp(win, '.nav-shoot')).toBe('');
    expect(disp(win, '.nav-dryland')).toBe('none');
  });

  describe('weekend catch-up survives the gate', () => {
    it('Saturday with an EMPTY plan keeps Hands + Shooting (optional); Dryland rests', async () => {
      const win = await boot({ planResponse: { ok: true, plan: {} }, day: 'sat' });
      expect(disp(win, '.nav-stick')).toBe(''); // Hands available as optional catch-up
      expect(disp(win, '.nav-shoot')).toBe(''); // Shooting available as optional catch-up
      expect(disp(win, '.nav-dryland')).toBe('none'); // Dryland rests on weekends
    });

    it('Sunday with the day ABSENT from the plan keeps Hands + Shooting; Dryland rests', async () => {
      const win = await boot({ planResponse: { ok: true, plan: { mon: { stick: [] } } }, day: 'sun' });
      expect(disp(win, '.nav-stick')).toBe('');
      expect(disp(win, '.nav-shoot')).toBe('');
      expect(disp(win, '.nav-dryland')).toBe('none');
    });

    it('Saturday where the coach EXPLICITLY set only Dryland is authoritative (honor the plan)', async () => {
      const win = await boot({ planResponse: { ok: true, plan: { sat: { dryland: [] } } }, day: 'sat' });
      expect(disp(win, '.nav-dryland')).toBe(''); // coach turned it on -> shown
      expect(disp(win, '.nav-stick')).toBe('none'); // not in the explicit plan
      expect(disp(win, '.nav-shoot')).toBe('none'); // not in the explicit plan
    });
  });
});
