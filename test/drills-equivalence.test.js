// test/drills-equivalence.test.js
//
// The drill library, rotation and timer scripts moved out of index.html into
// lib/drills.js. This guards that the move changed nothing a kid sees:
//
//   1. index.html (booted in jsdom) and lib/drills.js produce byte-identical
//      drill lists for every day of the grid in test/helpers/drill-snapshot.js
//      (140 days from Mon 2026-08-24: week, month and year boundaries, every
//      weekend) x 4 player variants (skater, skater with a coach dryland plan,
//      goalie, goalie with Net play on);
//   2. both match test/fixtures/drill-rotation.snapshot.json, which was
//      captured from index.html BEFORE the move (names, ids, the line under
//      each name, cue, steps, Start/Done, timer hand-off, plus the library
//      arrays and every guided-timer step list, hashed).
//
// An intended drill change: edit lib/drills.js, run
//   node scripts/gen-drills-inline.mjs && node scripts/snapshot-drills.mjs
// and review the fixture diff.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { capturePage, captureModule, compact, timerSteps } from './helpers/drill-snapshot.js';
import * as lib from '../lib/drills.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
const fixture = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/drill-rotation.snapshot.json'), 'utf8'));

let page;
let mod;
beforeAll(async () => {
  page = await capturePage(html);
  mod = captureModule(lib);
}, 60000);

describe('shared drill library: web app and module are identical', () => {
  it('the page boots and walks the whole grid with no script errors', () => {
    expect(page.errors).toEqual([]);
    expect(page.grid.length).toBe(fixture.grid.days * fixture.grid.variants.length);
  });

  it('page and module give byte-identical drill lists on every grid day', () => {
    expect(JSON.stringify(mod.grid)).toBe(JSON.stringify(page.grid));
    expect(JSON.stringify(mod.library)).toBe(JSON.stringify(page.library));
  });

  it('both match the snapshot captured before the move', () => {
    const timers = timerSteps(page.grid, page.library.THWAP_DRILL_SCRIPT, lib.buildSteps);
    const now = compact(page, timers);
    expect(now.library).toEqual(fixture.library);
    expect(now.timers).toEqual(fixture.timers);
    // day by day, so a failure names the date and variant
    now.days.forEach((d, i) => expect(d).toEqual(fixture.days[i]));
    expect(now.days.length).toBe(fixture.days.length);
  });

  it('covers rest days, weekends, goalies and coach picks', () => {
    const states = new Set(page.grid.map((d) => `${d.variant}:${d.third.state}:${d.dryland.state}`));
    expect(states.has('goalie:soon:rest')).toBe(true);
    expect(states.has('goalie-netplay-on:drills:drills')).toBe(true);
    expect(states.has('skater:drills:rest')).toBe(true);
    const mondays = page.grid.filter((d) => d.variant === 'skater-coachplan' && d.weekday === 1);
    expect(mondays[0].dryland.rows.map((r) => r.name)).toEqual(['Wall Sit', '20-Minute Run', 'Sit-ups']);
  });
});
