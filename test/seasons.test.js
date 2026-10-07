// test/seasons.test.js
//
// Pure-logic unit tests for lib/seasons.js: season windows, key derivation across
// the calendar (Vancouver-local, including the Fall/Winter year rollover), parsing,
// prices, and labels. Dates are pinned at mid-month noon UTC so the Vancouver TZ
// offset never flips the month.

import { describe, it, expect } from 'vitest';
import {
  SEASONS,
  seasonIdForMonth,
  currentSeasonKey,
  parseSeasonKey,
  isSeasonKey,
  priceCentsForKey,
  labelForKey,
  nextSeasonKey,
  buyableSeasons,
} from '../lib/seasons.js';

const d = (iso) => new Date(iso);

describe('seasons', () => {
  it('maps every month to the right season id', () => {
    expect([9, 10, 11, 12, 1, 2, 3].map(seasonIdForMonth)).toEqual(
      ['fw', 'fw', 'fw', 'fw', 'fw', 'fw', 'fw']
    );
    expect([4, 5, 6].map(seasonIdForMonth)).toEqual(['sp', 'sp', 'sp']);
    expect([7, 8].map(seasonIdForMonth)).toEqual(['os', 'os']);
  });

  it('derives the current season key across the year, with the FW rollover', () => {
    expect(currentSeasonKey(d('2025-10-15T19:00:00Z'))).toBe('fw-2025');
    expect(currentSeasonKey(d('2025-12-20T19:00:00Z'))).toBe('fw-2025');
    expect(currentSeasonKey(d('2026-01-15T19:00:00Z'))).toBe('fw-2025'); // Jan -> prior Sept
    expect(currentSeasonKey(d('2026-03-20T19:00:00Z'))).toBe('fw-2025');
    expect(currentSeasonKey(d('2026-04-15T19:00:00Z'))).toBe('sp-2026');
    expect(currentSeasonKey(d('2026-06-20T19:00:00Z'))).toBe('sp-2026');
    expect(currentSeasonKey(d('2026-07-15T19:00:00Z'))).toBe('os-2026');
    expect(currentSeasonKey(d('2026-08-20T19:00:00Z'))).toBe('os-2026');
    expect(currentSeasonKey(d('2026-09-15T19:00:00Z'))).toBe('fw-2026');
  });

  it('parses, prices, and validates season keys', () => {
    expect(parseSeasonKey('fw-2025')).toMatchObject({ id: 'fw', year: 2025, priceCents: 35000 });
    expect(parseSeasonKey('sp-2026')).toMatchObject({ id: 'sp', year: 2026, priceCents: 9000 });
    expect(parseSeasonKey('os-2026')).toMatchObject({ id: 'os', year: 2026, priceCents: 6000 });
    expect(parseSeasonKey('nope')).toBeNull();
    expect(isSeasonKey('fw-2025')).toBe(true);
    expect(isSeasonKey('fw-25')).toBe(false);
    expect(priceCentsForKey('os-2026')).toBe(6000);
    expect(priceCentsForKey('bad')).toBe(0);
  });

  it('labels read nicely', () => {
    expect(labelForKey('fw-2025')).toBe('Fall/Winter 2025-26');
    expect(labelForKey('sp-2026')).toBe('Spring 2026');
    expect(labelForKey('os-2026')).toBe('Off-season 2026');
  });

  it('the three seasons total $500', () => {
    const total = SEASONS.fw.priceCents + SEASONS.sp.priceCents + SEASONS.os.priceCents;
    expect(total).toBe(50000);
  });

  it('steps to the next season in calendar order, with the FW rollover', () => {
    expect(nextSeasonKey('fw-2025')).toBe('sp-2026');
    expect(nextSeasonKey('sp-2026')).toBe('os-2026');
    expect(nextSeasonKey('os-2026')).toBe('fw-2026'); // Aug -> that September
    expect(nextSeasonKey('fw-2026')).toBe('sp-2027');
    expect(nextSeasonKey('bad')).toBeNull();
  });

  it('lists buyable seasons: the current one plus the next few, in order', () => {
    expect(buyableSeasons(d('2025-10-15T19:00:00Z'))).toEqual(['fw-2025', 'sp-2026', 'os-2026']);
    expect(buyableSeasons(d('2026-05-15T19:00:00Z'))).toEqual(['sp-2026', 'os-2026', 'fw-2026']);
    expect(buyableSeasons(d('2026-07-15T19:00:00Z'))).toEqual(['os-2026', 'fw-2026', 'sp-2027']);
    expect(buyableSeasons(d('2025-10-15T19:00:00Z'), 1)).toEqual(['fw-2025']);
  });
});
