// test/dryland-run-sprints.test.js
//
// EXECUTION + data guards for the two added dryland drills:
//   - '20-Minute Run' (MOVE key run20): NO timer, button reads 'Done', tapping it
//     marks done WITHOUT calling window.thwapDrillTimer; tap-again un-marks.
//   - 'Sprints' (MOVE key shuttle): shuttle run, WITH timer+voiceover, timing-map
//     rounds:5 / restSeconds:30.
//
// Mirrors the drill-render.test.js jsdom harness (boots index.html, runs its inline
// scripts, drives the real dryland drill list). The no-timer path is driven on the
// actual rendered row with window.thwapDrillTimer stubbed as a spy, so a regression
// that routes the no-timer drill through the runner would fail here.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');

// Boot index.html at a given ?day= and return the live window plus a timer spy.
async function bootDay(day) {
  const timerCalls = [];
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://thwaphockey.com/?day=' + day,
    beforeParse(window) {
      window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: false }) });
      window.scrollTo = () => {};
    },
  });
  await new Promise((r) => setTimeout(r, 50));
  // Install a spy for the guided runner so we can prove the no-timer drill never
  // calls it. The dryland render reads window.thwapDrillTimer at click time.
  dom.window.thwapDrillTimer = function (name) { timerCalls.push(name); };
  return { win: dom.window, timerCalls, dom };
}

// Find a weekday whose rendered dryland list contains a drill with the given name,
// scanning a window of day offsets. trimDrills shows up to 4 drills/day, so a given
// Speed drill only surfaces on some days; this locates one deterministically.
async function findDayShowing(name) {
  for (let day = -14; day <= 14; day++) {
    const { win, timerCalls, dom } = await bootDay(day);
    const list = win.document.getElementById('drylandList');
    const rows = list ? [...list.querySelectorAll('.exrow')] : [];
    const match = rows.find((r) => (r.querySelector('h3')?.textContent || '').replace('Done', '').trim() === name);
    if (match) return { win, timerCalls, dom, row: match };
    dom.window.close();
  }
  return null;
}

describe('Dryland: both new drills exist in MOVE and are scheduled', () => {
  it("MOVE has run20 (no-timer) and shuttle; d() names them '20-Minute Run' / 'Sprints'", () => {
    // run20: no video, no audio, flagged noTimer
    expect(html).toMatch(/run20:\{emoji:'[^']*', cue:'[^']*', video:'', audio:'', noTimer:true/);
    // shuttle: dry_17 voiceover
    expect(html).toMatch(/shuttle:\{emoji:'[^']*', cue:'[^']*', video:'', audio:'dry_17'/);
    // display-name map
    expect(html).toMatch(/run20:'20-Minute Run'/);
    expect(html).toMatch(/shuttle:'Sprints'/);
    // d() carries the noTimer flag through to each built drill object
    expect(html).toMatch(/steps:m\.steps, noTimer:m\.noTimer\|\|false/);
  });

  it('both drills are scheduled into the dryland conditioning (Speed) days alongside stairs+sprint', () => {
    // every speed day keeps stairs+sprint then the two new drills before reaction
    const speedDayRe = /d\('stairs','4 sets, 10 yards'\),d\('sprint','4 sets'\),d\('run20','20 minutes'\),d\('shuttle','5 reps, 20 feet'\),d\('reaction'/g;
    const count = (html.match(speedDayRe) || []).length;
    expect(count).toBe(4); // w1thu, w2fri, w3fri, w4fri
  });

  it("the 'Sprints' timing-map entry is rounds:5, restSeconds:30; '20-Minute Run' has NO timing entry", () => {
    expect(html).toMatch(/'Sprints':\{type:'rounds',rounds:5,workLabel:'Sprint',restSeconds:30\}/);
    expect(html).not.toMatch(/'20-Minute Run':\{/);
  });
});

describe('Dryland drills render live (no cross-IIFE ReferenceError)', () => {
  it('WORKOUTS exposes run20 + shuttle on the Speed days with the right display names/doses', async () => {
    const { win, dom } = await bootDay(0);
    const flat = (win.WORKOUTS || []).flatMap((w) => w.drills || []);
    const run = flat.find((d) => d.key === 'run20');
    const sh = flat.find((d) => d.key === 'shuttle');
    expect(run).toBeTruthy();
    expect(run.name).toBe('20-Minute Run');
    expect(run.noTimer).toBe(true);
    expect(run.audio).toBe('');
    expect(run.dose).toBe('20 minutes');
    expect(sh).toBeTruthy();
    expect(sh.name).toBe('Sprints');
    expect(sh.noTimer).toBe(false);
    expect(sh.audio).toBe('dry_17');
    expect(sh.dose).toBe('5 reps, 20 feet');
    dom.window.close();
  });
});

describe("'20-Minute Run' is Done-not-Begin: marks done with NO timer, and un-toggles", () => {
  it('renders a Done button (not Start) and tapping it marks done WITHOUT the guided runner', async () => {
    const found = await findDayShowing('20-Minute Run');
    expect(found, 'no day rendered the 20-Minute Run row').toBeTruthy();
    const { win, timerCalls, dom, row } = found;

    const btn = row.querySelector('.exdone');
    // Button reads 'Done' for a no-timer drill (not 'Start'/'Begin')
    expect(btn.textContent).toBe('Done');
    expect(row.classList.contains('done')).toBe(false);

    // Tap it: should mark done immediately and NOT invoke the timer.
    btn.dispatchEvent(new win.Event('click', { bubbles: true }));
    expect(row.classList.contains('done')).toBe(true);
    expect(btn.textContent).toBe('Done ✓');
    expect(timerCalls).toEqual([]); // the runner was never called

    // Tap again: un-mark still works, label returns to 'Done'.
    btn.dispatchEvent(new win.Event('click', { bubbles: true }));
    expect(row.classList.contains('done')).toBe(false);
    expect(btn.textContent).toBe('Done');
    expect(timerCalls).toEqual([]); // still never called
    dom.window.close();
  });
});

describe("'Sprints' keeps the timer path (runner is called on Start)", () => {
  it("renders a Start button and tapping it DOES call the guided runner with 'Sprints'", async () => {
    const found = await findDayShowing('Sprints');
    expect(found, 'no day rendered the Sprints row').toBeTruthy();
    const { win, timerCalls, dom, row } = found;

    const btn = row.querySelector('.exdone');
    expect(btn.textContent).toBe('Start'); // timed drill, not Done-direct

    btn.dispatchEvent(new win.Event('click', { bubbles: true }));
    // The runner is a stub, so it does not call back markDone; row stays not-done,
    // but the runner WAS invoked for the Sprints drill.
    expect(timerCalls).toContain('Sprints');
    dom.window.close();
  });
});
