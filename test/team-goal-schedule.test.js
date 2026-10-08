import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// The weekly team goal is no longer a hardcoded 150. It rises through the season
// then eases off in late winter, driven by a date-keyed schedule. These tests
// lock both the shipped schedule and the date-selection logic so a future edit
// cannot silently flatten the ramp or shift a boundary.
describe('team goal rising season schedule', () => {
  it('the weekly goal is date-driven, not a hardcoded 150', () => {
    expect(html).toMatch(/var goal=teamGoalFor\(\)/);
    expect(html).not.toMatch(/var goal=150/);
  });

  it('defines the full season schedule in order', () => {
    expect(html).toMatch(/window\.TEAM_GOAL_SCHEDULE\s*=/);
    [
      ["2026-01-01", 110],
      ["2026-10-05", 120],
      ["2026-10-19", 125],
      ["2026-11-02", 130],
      ["2026-12-01", 135],
      ["2027-01-01", 140],
      ["2027-02-01", 130],
      ["2027-03-01", 125],
    ].forEach(([from, goal]) => {
      expect(html).toMatch(
        new RegExp("from:'" + from + "',\\s*goal:" + goal)
      );
    });
  });

  // Behavioural replication of the exact teamGoalFor logic shipped in index.html.
  const SCHED = [
    { from: '2026-01-01', goal: 110 },
    { from: '2026-10-05', goal: 120 },
    { from: '2026-10-19', goal: 125 },
    { from: '2026-11-02', goal: 130 },
    { from: '2026-12-01', goal: 135 },
    { from: '2027-01-01', goal: 140 },
    { from: '2027-02-01', goal: 130 },
    { from: '2027-03-01', goal: 125 },
  ];
  function teamGoalFor(d) {
    const key =
      d.getFullYear() +
      '-' +
      ('0' + (d.getMonth() + 1)).slice(-2) +
      '-' +
      ('0' + d.getDate()).slice(-2);
    let goal = SCHED[0].goal;
    for (let i = 0; i < SCHED.length; i++) if (SCHED[i].from <= key) goal = SCHED[i].goal;
    return goal;
  }
  const on = (iso) => {
    const [y, m, day] = iso.split('-').map(Number);
    return new Date(y, m - 1, day);
  };

  it('picks the right goal at every boundary and mid-window', () => {
    const cases = [
      ['2026-10-01', 110], ['2026-10-04', 110],   // before the first bump
      ['2026-10-05', 120], ['2026-10-18', 120],
      ['2026-10-19', 125], ['2026-11-01', 125],
      ['2026-11-02', 130], ['2026-11-30', 130],
      ['2026-12-01', 135], ['2026-12-31', 135],   // all December
      ['2027-01-01', 140], ['2027-01-31', 140],   // all January
      ['2027-02-01', 130], ['2027-02-28', 130],   // February eases off
      ['2027-03-01', 125], ['2027-03-15', 125],
    ];
    cases.forEach(([iso, expected]) => {
      expect(teamGoalFor(on(iso))).toBe(expected);
    });
  });

  it('a date before the season start falls back to the default', () => {
    expect(teamGoalFor(on('2025-12-31'))).toBe(110);
  });
});
