// test/dryland-coach-plan.test.js
//
// Guards that the player dryland page FOLLOWS THE COACH:
//   - When the coach plan picks specific dryland drill names for today's weekday,
//     the dryland list shows EXACTLY those drills (no WORKOUTS rotation / trim).
//   - When the coach left dryland unspecified (empty / absent), it FALLS BACK to
//     the built-in WORKOUTS day through trimDrills, which anchors the 20-Minute
//     Run on a conditioning day.
//
// The coach plan is served by /api/coach?action=get-plan; this harness stubs fetch
// to return a plan keyed to today's weekday so the assertion is deterministic.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');

// weekday key for ?day=0 (dayIndex 0 -> Thursday -> 'thu')
const WD = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
function dayKeyFor(dayParam) {
  const wd = ((((dayParam % 7) + 7) % 7) + 4) % 7;
  return WD[wd];
}

async function boot(dayParam, planForToday) {
  const dayKey = dayKeyFor(dayParam);
  const plan = planForToday ? { [dayKey]: planForToday } : null;
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://thwaphockey.com/?day=' + dayParam,
    beforeParse(window) {
      window.fetch = (url) => {
        const u = String(url || '');
        if (u.indexOf('get-plan') >= 0) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, plan }) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: false }) });
      };
      window.scrollTo = () => {};
    },
  });
  // allow the async get-plan + re-render hook to settle
  await new Promise((r) => setTimeout(r, 120));
  return dom;
}

function drylandNames(win) {
  const list = win.document.getElementById('drylandList');
  if (!list) return [];
  return [...list.querySelectorAll('.exrow')].map(
    (r) => (r.querySelector('h3')?.textContent || '').replace('Done', '').trim()
  );
}

describe('Dryland follows the coach plan when he picks drills', () => {
  it('shows EXACTLY the coach-picked dryland drills (no trim) when the plan has them', async () => {
    // Coach picked three specific dryland drills for today.
    const picked = ['20-Minute Run', 'Box Jumps', 'Plank with Shoulder Taps'];
    const dom = await boot(0, { dryland: picked });
    const names = drylandNames(dom.window);
    // exactly the coach's picks, in his order, nothing trimmed or added
    expect(names).toEqual(picked);
    dom.window.close();
  });

  it('falls back to the built-in WORKOUTS day (run anchored) when the coach left dryland unspecified', async () => {
    // Plan present but dryland empty for today -> fallback rotation applies.
    // ?day=1 maps to slot 4 (w2fri), a conditioning day that carries the 20-Minute Run.
    const dom = await boot(1, { dryland: [] });
    const names = drylandNames(dom.window);
    // fallback is a conditioning day: run is anchored, list is non-empty and <= 5
    expect(names.length).toBeGreaterThan(0);
    expect(names.length).toBeLessThanOrEqual(5);
    expect(names).toContain('20-Minute Run');
    dom.window.close();
  });

  it('exposes the coach-plan helpers on window', async () => {
    const dom = await boot(0, { dryland: ['Sprints'] });
    expect(typeof dom.window.thwapCoachDrillNames).toBe('function');
    expect(typeof dom.window.thwapDrylandFromNames).toBe('function');
    // the picked name maps back to a full drill object
    const built = dom.window.thwapDrylandFromNames(['Sprints']);
    expect(built.length).toBe(1);
    expect(built[0].name).toBe('Sprints');
    dom.window.close();
  });
});
