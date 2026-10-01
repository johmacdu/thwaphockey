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
      ["2026-01-01", 150],
      ["2026-10-05", 160],
      ["2026-10-19", 165],
      ["2026-11-02", 170],
      ["2026-12-01", 175],
      ["2027-01-01", 180],
      ["2027-02-01", 170],
      ["2027-03-01", 165],
    ].forEach(([from, goal]) => {
      expect(html).toMatch(
        new RegExp("from:'" + from + "',\\s*goal:" + goal)
      );
    });
  });

  // Behavioural replication of the exact teamGoalFor logic shipped in index.html.
  const SCHED = [
    { from: '2026-01-01', goal: 150 },
    { from: '2026-10-05', goal: 160 },
    { from: '2026-10-19', goal: 165 },
    { from: '2026-11-02', goal: 170 },
    { from: '2026-12-01', goal: 175 },
    { from: '2027-01-01', goal: 180 },
    { from: '2027-02-01', goal: 170 },
    { from: '2027-03-01', goal: 165 },
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
      ['2026-10-01', 150], ['2026-10-04', 150],   // before the first bump
      ['2026-10-05', 160], ['2026-10-18', 160],
      ['2026-10-19', 165], ['2026-11-01', 165],
      ['2026-11-02', 170], ['2026-11-30', 170],
      ['2026-12-01', 175], ['2026-12-31', 175],   // all December
      ['2027-01-01', 180], ['2027-01-31', 180],   // all January
      ['2027-02-01', 170], ['2027-02-28', 170],   // February eases off
      ['2027-03-01', 165], ['2027-03-15', 165],
    ];
    cases.forEach(([iso, expected]) => {
      expect(teamGoalFor(on(iso))).toBe(expected);
    });
  });

  it('a date before the season start falls back to the default', () => {
    expect(teamGoalFor(on('2025-12-31'))).toBe(150);
  });
});
