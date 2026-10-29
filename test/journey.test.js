// test/journey.test.js
//
// Season Book math (lib/journey.js): tier pacing, season windows, and the
// per-month training-day rows. Pure functions, so no store and no clock.

import { describe, it, expect } from 'vitest';
import { STEP_THRESHOLDS, progressFor, seasonWindow, journeyFor } from '../lib/journey.js';

describe('pacing', () => {
  it('first step takes 3 days, every later step 8, 12 steps in all', () => {
    expect(STEP_THRESHOLDS).toEqual([3, 11, 19, 27, 35, 43, 51, 59, 67, 75, 83, 91]);
  });

  it.each([
    // days, stepsDone, tier, step, daysToNextStep
    [0, 0, 'Locker Room', 1, 3],
    [2, 0, 'Locker Room', 1, 1],
    [3, 1, 'Locker Room', 2, 8],
    [11, 2, 'Locker Room', 3, 8],
    [19, 3, 'Practice Ice', 1, 8],
    [23, 3, 'Practice Ice', 1, 4],
    [43, 6, 'Game Ready', 1, 8],
    [90, 11, 'Legend', 3, 1],
  ])('%i days -> %i steps, %s step %i, %i to go', (days, stepsDone, tier, step, toGo) => {
    const p = progressFor(days);
    expect(p).toMatchObject({ stepsDone, tier, step, daysToNextStep: toGo, complete: false });
  });

  it('caps at the top step and never overflows', () => {
    for (const days of [91, 96, 200]) {
      expect(progressFor(days)).toMatchObject({ stepsDone: 12, complete: true, tier: 'Legend', step: 3, daysToNextStep: 0 });
    }
  });

  it('treats junk input as zero days', () => {
    for (const bad of [undefined, null, -5, 'abc', NaN]) {
      expect(progressFor(bad)).toMatchObject({ trainingDays: 0, stepsDone: 0 });
    }
  });
});

describe('seasonWindow', () => {
  it('Sep-Dec belongs to that year', () => {
    expect(seasonWindow('2026-09-01')).toEqual({ key: 'fw-2026', label: '2026-27', start: '2026-09-01', end: '2027-03-31' });
    expect(seasonWindow('2026-12-31').key).toBe('fw-2026');
  });

  it('Jan-Mar belongs to the season that began the prior Sep', () => {
    expect(seasonWindow('2027-01-15').key).toBe('fw-2026');
    expect(seasonWindow('2027-03-31').key).toBe('fw-2026');
  });

  it('Apr-Aug shows the season just finished', () => {
    expect(seasonWindow('2027-04-01').key).toBe('fw-2026');
    expect(seasonWindow('2027-08-31').key).toBe('fw-2026');
  });

  it('rejects a malformed date', () => {
    expect(() => seasonWindow('Oct 27')).toThrow();
  });
});

describe('journeyFor', () => {
  it('counts unique in-season days, ignoring other seasons, junk and future dates', () => {
    const days = [
      '2026-08-31',              // before the season
      '2026-09-02', '2026-09-02', // duplicate counts once
      '2026-09-10', '2026-10-01', '2026-10-27',
      '2026-10-30',              // after today
      'bad', 42, null,
    ];
    const j = journeyFor(days, '2026-10-27');
    expect(j.trainingDays).toBe(4);
    expect(j.season.key).toBe('fw-2026');
    expect(j.seasonOver).toBe(false);
    expect(j.months).toEqual([
      { month: '2026-09', days: 2 },
      { month: '2026-10', days: 2 },
    ]);
  });

  it('lists every month through March and marks the season over in April', () => {
    const j = journeyFor(['2026-11-05', '2027-03-31'], '2027-04-10');
    expect(j.seasonOver).toBe(true);
    expect(j.months.map((m) => m.month)).toEqual(
      ['2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03'],
    );
    expect(j.trainingDays).toBe(2);
  });

  it('handles a player with no history', () => {
    const j = journeyFor(undefined, '2026-09-01');
    expect(j).toMatchObject({ trainingDays: 0, tier: 'Locker Room', step: 1, daysToNextStep: 3 });
    expect(j.months).toEqual([{ month: '2026-09', days: 0 }]);
  });
});

describe('journeyFor step dates', () => {
  it('gives the date each step was reached, null when not yet', async () => {
    const days = Array.from({ length: 12 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`);
    const j = journeyFor(days, '2026-10-01');
    expect(j.stepThresholds).toEqual(STEP_THRESHOLDS);
    expect(j.stepDates.slice(0, 3)).toEqual(['2026-09-03', '2026-09-11', null]);
  });
});
