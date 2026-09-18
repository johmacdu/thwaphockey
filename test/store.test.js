// test/store.test.js
//
// Unit tests for api/store.js: honest streak logic, Monday-based weekly split,
// idempotent day recording, dated events, and the board-shaping functions.
//
// The @upstash/redis client is replaced with an in-memory FakeRedis so these are
// true unit tests (no network, no live store). The system clock is pinned so
// streak/week math is deterministic. Dates are expressed in America/Vancouver.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FakeRedis } from './fakeRedis.js';

// One shared fake instance; store.js captures it at import via `new Redis()`.
const fake = new FakeRedis();
vi.mock('@upstash/redis', () => ({
  Redis: class {
    constructor() {
      return fake;
    }
  },
}));

// Import AFTER the mock is registered.
const {
  ROSTER,
  bumpPlayer,
  computeStreak,
  weekCount,
  weekBoard,
  listPlayers,
  getPlayer,
} = await import('../api/store.js');

// Helper: keys the store uses.
const daysKey = (id) => `days:${id}`;
const eventsKey = (id) => `events:${id}`;

// Pin "now" to a known Vancouver local date. 2026-01-14 12:00 local is a
// Wednesday. Using local noon avoids any UTC-rollover ambiguity at the edges.
// Vancouver in January is UTC-8, so 20:00 UTC == 12:00 local.
function pinDate(iso) {
  vi.setSystemTime(new Date(`${iso}T20:00:00.000Z`));
}

beforeEach(() => {
  fake.map.clear();
  vi.useFakeTimers();
  pinDate('2026-01-14'); // Wednesday
});

afterEach(() => {
  vi.useRealTimers();
});

describe('computeStreak', () => {
  it('is 0 for a player with no active days', async () => {
    expect(await computeStreak('lewie')).toBe(0);
  });

  it('counts consecutive days ending today', async () => {
    fake._seed(daysKey('lewie'), ['2026-01-12', '2026-01-13', '2026-01-14']);
    expect(await computeStreak('lewie')).toBe(3);
  });

  it('does not break when today is not done yet (latest is yesterday)', async () => {
    fake._seed(daysKey('lewie'), ['2026-01-12', '2026-01-13']); // today is the 14th
    expect(await computeStreak('lewie')).toBe(2);
  });

  it('is 0 when the latest active day is older than yesterday', async () => {
    fake._seed(daysKey('lewie'), ['2026-01-10', '2026-01-11']); // gap of 3 to today
    expect(await computeStreak('lewie')).toBe(0);
  });

  it('stops counting at the first gap', async () => {
    // 14,13 consecutive, then a gap (missing 12), then 11,10.
    fake._seed(daysKey('lewie'), ['2026-01-10', '2026-01-11', '2026-01-13', '2026-01-14']);
    expect(await computeStreak('lewie')).toBe(2);
  });

  it('dedupes duplicate day entries', async () => {
    fake._seed(daysKey('lewie'), ['2026-01-14', '2026-01-14', '2026-01-13']);
    expect(await computeStreak('lewie')).toBe(2);
  });

  it('handles unsorted input', async () => {
    fake._seed(daysKey('lewie'), ['2026-01-14', '2026-01-12', '2026-01-13']);
    expect(await computeStreak('lewie')).toBe(3);
  });
});

describe('weekCount (Monday-based)', () => {
  // Week containing Wed 2026-01-14 starts Mon 2026-01-12.
  it('is all zeros for a fresh player', async () => {
    expect(await weekCount('lewie')).toEqual({ stick: 0, shoot: 0, dryland: 0 });
  });

  it('counts only events within the current Monday-based week', async () => {
    fake._seed(eventsKey('lewie'), [
      { date: '2026-01-11', disc: 'stick' }, // Sunday BEFORE this week - excluded
      { date: '2026-01-12', disc: 'stick' }, // Monday - included
      { date: '2026-01-13', disc: 'shoot' }, // Tuesday - included
      { date: '2026-01-14', disc: 'stick' }, // Wednesday (today) - included
    ]);
    expect(await weekCount('lewie')).toEqual({ stick: 2, shoot: 1, dryland: 0 });
  });

  it('ignores events with an unknown discipline', async () => {
    fake._seed(eventsKey('lewie'), [
      { date: '2026-01-13', disc: 'stick' },
      { date: '2026-01-13', disc: 'bogus' },
    ]);
    expect(await weekCount('lewie')).toEqual({ stick: 1, shoot: 0, dryland: 0 });
  });
});

describe('bumpPlayer', () => {
  it('increments the cumulative count and stamps updatedAt', async () => {
    const res = await bumpPlayer('lewie', 'stick');
    expect(res.stick).toBe(1);
    expect(res.updatedAt).toBeTypeOf('string');
    const stored = await getPlayer('lewie');
    expect(stored.stick).toBe(1);
  });

  it('records today in days:<id> idempotently across two bumps same day', async () => {
    await bumpPlayer('lewie', 'stick');
    await bumpPlayer('lewie', 'shoot');
    const days = fake.map.get(daysKey('lewie'));
    expect(days).toEqual(['2026-01-14']); // one entry despite two bumps
  });

  it('appends a dated event per bump', async () => {
    await bumpPlayer('lewie', 'stick');
    await bumpPlayer('lewie', 'dryland');
    const events = fake.map.get(eventsKey('lewie'));
    expect(events).toEqual([
      { date: '2026-01-14', disc: 'stick' },
      { date: '2026-01-14', disc: 'dryland' },
    ]);
  });

  it('makes streak and weekCount real end to end', async () => {
    // Bump on the 13th, then advance to the 14th and bump again.
    pinDate('2026-01-13');
    await bumpPlayer('lewie', 'stick');
    pinDate('2026-01-14');
    await bumpPlayer('lewie', 'shoot');
    expect(await computeStreak('lewie')).toBe(2);
    expect(await weekCount('lewie')).toEqual({ stick: 1, shoot: 1, dryland: 0 });
  });
});

describe('listPlayers', () => {
  it('returns the full roster even when the store is empty', async () => {
    const players = await listPlayers();
    expect(players).toHaveLength(ROSTER.length);
    expect(players.every((p) => p.stick === 0 && p.streak === 0)).toBe(true);
  });

  it('replaces the stored streak with the computed one', async () => {
    // Seed a stale/fake stored streak plus real active days; computed wins.
    fake._seed('player:lewie', { stick: 5, shoot: 0, dryland: 0, streak: 99, stickers: 0, updatedAt: null });
    fake._seed(daysKey('lewie'), ['2026-01-13', '2026-01-14']);
    const players = await listPlayers();
    const lewie = players.find((p) => p.id === 'lewie');
    expect(lewie.stick).toBe(5); // cumulative preserved
    expect(lewie.streak).toBe(2); // computed, not the stored 99
  });
});

describe('weekBoard', () => {
  it('returns per-player current-week discipline counts for the whole roster', async () => {
    fake._seed(eventsKey('lewie'), [
      { date: '2026-01-11', disc: 'stick' }, // last week - excluded
      { date: '2026-01-14', disc: 'stick' }, // this week
      { date: '2026-01-14', disc: 'shoot' },
    ]);
    const board = await weekBoard();
    expect(board).toHaveLength(ROSTER.length);
    const lewie = board.find((p) => p.id === 'lewie');
    expect(lewie).toEqual({ id: 'lewie', stick: 1, shoot: 1, dryland: 0 });
    const johnny = board.find((p) => p.id === 'johnny');
    expect(johnny).toEqual({ id: 'johnny', stick: 0, shoot: 0, dryland: 0 });
  });
});
