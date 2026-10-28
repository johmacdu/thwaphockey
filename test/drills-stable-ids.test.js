// test/drills-stable-ids.test.js
//
// Drill ids are positional ('stick:0', 'shoot:2', 'dryland:3') and done
// records in KV reference them, so the id -> drill name mapping must never move
// by accident. test/fixtures/drill-ids.json freezes the library order and the
// weekday mapping as it was when the library moved into lib/drills.js. Dryland
// varies by date as well as weekday; its per-date ids are frozen in
// test/fixtures/drill-rotation.snapshot.json (drills-equivalence.test.js).
//
// Changing this fixture means changing what an existing done record points at.
// Do it only together with a KV migration.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import * as m from '../lib/drills.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const frozen = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/drill-ids.json'), 'utf8'));
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri'];

describe('drill ids stay stable', () => {
  it('library order is frozen', () => {
    expect(m.DRILLS.map((d) => d.name)).toEqual(frozen.library.DRILLS);
    expect(m.SHOOT_DAYS.map((x) => x.map((d) => d.name))).toEqual(frozen.library.SHOOT_DAYS);
    expect(m.NETPLAY_DAYS.map((x) => x.map((d) => d.name))).toEqual(frozen.library.NETPLAY_DAYS);
    expect(m.WORKOUTS.map((w) => w.id + ': ' + w.drills.map((d) => d.name).join(' / '))).toEqual(frozen.library.WORKOUTS);
  });

  it('every weekday maps the same ids to the same drills, in any week', () => {
    // three different weeks: the mapping depends on the weekday only
    for (const monday of ['2026-09-07', '2026-10-26', '2027-03-01']) {
      const mon = m.dayIndexForDate(monday);
      DAYS.forEach((w, k) => {
        const di = mon + k;
        expect(m.stickForDay(di).map((d, i) => 'stick:' + i + '=' + d.name)).toEqual(frozen.weekday.stick[w]);
        expect(m.shootForDay(di, false).map((d, i) => 'shoot:' + i + '=' + d.name)).toEqual(frozen.weekday.shoot[w]);
        expect(m.shootForDay(di, true, true).map((d, i) => 'shoot:' + i + '=' + d.name)).toEqual(frozen.weekday.netplay[w]);
      });
    }
  });

  it('todayList ids are the web ids (goalie Net play rows keep the shoot: prefix)', () => {
    const di = m.dayIndexForDate('2026-10-28');
    const skater = m.todayList(di, {});
    expect(skater.drills.filter((d) => d.discipline === 'stick').map((d) => d.id + '=' + d.name)).toEqual(frozen.weekday.stick.wed);
    expect(skater.drills.filter((d) => d.discipline === 'shoot').map((d) => d.id + '=' + d.name)).toEqual(frozen.weekday.shoot.wed);
    const goalie = m.todayList(di, { goalie: true, netplayEnabled: true });
    expect(goalie.drills.filter((d) => d.discipline === 'netplay').map((d) => d.id + '=' + d.name)).toEqual(frozen.weekday.netplay.wed);
    expect(goalie.drills.some((d) => d.discipline === 'shoot')).toBe(false);
  });
});
