// test/store.test.js
//
// Unit tests for lib/store.js: honest streak logic, Monday-based weekly split,
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
  monthTrend,
  disciplinesFor,
  GOALIE_IDS,
  getCheers,
  listCheers,
  sendCheer,
  getRecentCheerers,
  getFires,
  listFires,
  sendFire,
  getRecentFirers,
  isRosterPlayer,
} = await import('../lib/store.js');

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
    expect(await weekCount('lewie')).toEqual({ stick: 0, shoot: 0, dryland: 0, netplay: 0 });
  });

  it('counts only events within the current Monday-based week', async () => {
    fake._seed(eventsKey('lewie'), [
      { date: '2026-01-11', disc: 'stick' }, // Sunday BEFORE this week - excluded
      { date: '2026-01-12', disc: 'stick' }, // Monday - included
      { date: '2026-01-13', disc: 'shoot' }, // Tuesday - included
      { date: '2026-01-14', disc: 'stick' }, // Wednesday (today) - included
    ]);
    expect(await weekCount('lewie')).toEqual({ stick: 2, shoot: 1, dryland: 0, netplay: 0 });
  });

  it('ignores events with an unknown discipline', async () => {
    fake._seed(eventsKey('lewie'), [
      { date: '2026-01-13', disc: 'stick' },
      { date: '2026-01-13', disc: 'bogus' },
    ]);
    expect(await weekCount('lewie')).toEqual({ stick: 1, shoot: 0, dryland: 0, netplay: 0 });
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
    expect(await weekCount('lewie')).toEqual({ stick: 1, shoot: 1, dryland: 0, netplay: 0 });
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
    expect(lewie).toEqual({ id: 'lewie', stick: 1, shoot: 1, dryland: 0, netplay: 0 });
    const johnny = board.find((p) => p.id === 'johnny');
    expect(johnny).toEqual({ id: 'johnny', stick: 0, shoot: 0, dryland: 0, netplay: 0 });
  });
});

describe('monthTrend', () => {
  it('returns 4 weekly buckets oldest-first with this week last', async () => {
    // 'now' is pinned Wed 2026-01-14 in this suite. This week's Monday is 2026-01-12.
    // Seed events: 2 this week, and 1 in a prior week (2026-01-07 = last week).
    fake._seed(eventsKey('alder'), [
      { date: '2026-01-13', disc: 'stick' },   // this week
      { date: '2026-01-14', disc: 'shoot' },   // this week
      { date: '2026-01-07', disc: 'dryland' }, // last week
    ]);
    const trend = await monthTrend('alder', 4);
    expect(trend.length).toBe(4);
    // oldest-first: index 3 is this week
    expect(trend[3].total).toBe(2);
    expect(trend[3].stick).toBe(1);
    expect(trend[3].shoot).toBe(1);
    // last week is index 2
    expect(trend[2].total).toBe(1);
    expect(trend[2].dryland).toBe(1);
    // the two oldest weeks are empty
    expect(trend[0].total).toBe(0);
    expect(trend[1].total).toBe(0);
  });
});

describe('position-aware disciplines (goalie Net play)', () => {
  it('gives skaters stick/shoot/dryland', () => {
    expect(disciplinesFor('lewie')).toEqual(['stick', 'shoot', 'dryland']);
    expect(disciplinesFor('alder')).toEqual(['stick', 'shoot', 'dryland']);
  });

  it('gives the goalie stick/netplay/dryland (no shoot)', () => {
    expect(GOALIE_IDS).toContain('johnny');
    expect(disciplinesFor('johnny')).toEqual(['stick', 'netplay', 'dryland']);
    expect(disciplinesFor('JOHNNY')).toEqual(['stick', 'netplay', 'dryland']);
    expect(disciplinesFor('johnny')).not.toContain('shoot');
  });

  it('bumps and counts netplay for the goalie in the weekly split', async () => {
    await bumpPlayer('johnny', 'netplay');
    const wk = await weekCount('johnny');
    expect(wk.netplay).toBe(1);
    expect(wk.shoot).toBe(0);
    const stored = await getPlayer('johnny');
    expect(stored.netplay).toBe(1);
  });
});

describe('cheers (teammate high-fives)', () => {
  it('getCheers is 0 for a player who has never been cheered', async () => {
    expect(await getCheers('lewie')).toBe(0);
  });

  it('isRosterPlayer accepts roster ids (any case) and rejects others', () => {
    expect(isRosterPlayer('lewie')).toBe(true);
    expect(isRosterPlayer('LEWIE')).toBe(true);
    expect(isRosterPlayer('nobody')).toBe(false);
    expect(isRosterPlayer('')).toBe(false);
  });

  it('rejects a self-cheer and does not increment', async () => {
    const res = await sendCheer('lewie', 'lewie');
    expect(res).toEqual({ ok: false, error: 'self' });
    expect(await getCheers('lewie')).toBe(0);
  });

  it('rejects an off-roster sender or target', async () => {
    expect(await sendCheer('nobody', 'lewie')).toEqual({ ok: false, error: 'bad id' });
    expect(await sendCheer('lewie', 'nobody')).toEqual({ ok: false, error: 'bad id' });
    expect(await getCheers('lewie')).toBe(0);
  });

  it('a first cheer increments the recipient and returns the new count', async () => {
    const res = await sendCheer('lewie', 'william');
    expect(res).toEqual({ ok: true, count: 1 });
    expect(await getCheers('william')).toBe(1);
    // The sender received nothing.
    expect(await getCheers('lewie')).toBe(0);
  });

  it('a second same-day cheer is idempotent (no double count)', async () => {
    await sendCheer('lewie', 'william');
    const again = await sendCheer('lewie', 'william');
    expect(again).toEqual({ ok: true, already: true });
    expect(await getCheers('william')).toBe(1); // still 1, not 2
  });

  it('a DIFFERENT sender can also cheer the same teammate the same day', async () => {
    await sendCheer('lewie', 'william');
    const other = await sendCheer('maddux', 'william');
    expect(other).toEqual({ ok: true, count: 2 });
    expect(await getCheers('william')).toBe(2);
  });

  it('allows the same sender to cheer again the NEXT day', async () => {
    await sendCheer('lewie', 'william');
    expect(await getCheers('william')).toBe(1);
    pinDate('2026-01-15'); // next Vancouver day
    const next = await sendCheer('lewie', 'william');
    expect(next).toEqual({ ok: true, count: 2 });
    expect(await getCheers('william')).toBe(2);
  });

  it('listCheers returns the whole roster with counts, zeroed where unset', async () => {
    await sendCheer('lewie', 'william');
    await sendCheer('maddux', 'william');
    await sendCheer('lewie', 'teddy');
    const all = await listCheers();
    expect(all).toHaveLength(ROSTER.length);
    const byId = Object.fromEntries(all.map((c) => [c.id, c.cheers]));
    expect(byId.william).toBe(2);
    expect(byId.teddy).toBe(1);
    expect(byId.lewie).toBe(0); // sender never gains cheers
    expect(byId.johnny).toBe(0); // untouched player
  });

  it('getRecentCheerers is empty for a player who has never been cheered', async () => {
    expect(await getRecentCheerers('william')).toEqual([]);
  });

  it('records who cheered a player, newest first, with timestamps', async () => {
    await sendCheer('lewie', 'william');
    await sendCheer('maddux', 'william');
    const givers = await getRecentCheerers('william');
    expect(givers.map((g) => g.from)).toEqual(['maddux', 'lewie']); // newest first
    expect(givers.every((g) => typeof g.at === 'number' && g.at > 0)).toBe(true);
  });

  it('a same-day duplicate cheer does NOT add a second giver entry', async () => {
    await sendCheer('lewie', 'william');
    await sendCheer('lewie', 'william'); // deduped, no-op
    const givers = await getRecentCheerers('william');
    expect(givers.filter((g) => g.from === 'lewie')).toHaveLength(1);
  });

  it('getRecentCheerers only returns real roster givers', async () => {
    await sendCheer('lewie', 'william');
    const givers = await getRecentCheerers('william');
    expect(givers.every((g) => isRosterPlayer(g.from))).toBe(true);
  });
});

describe('fire ("On fire" reactions)', () => {
  it('getFires is 0 for a player who has never been fired', async () => {
    expect(await getFires('lewie')).toBe(0);
  });

  it('rejects a self-fire and does not increment', async () => {
    const res = await sendFire('lewie', 'lewie');
    expect(res).toEqual({ ok: false, error: 'self' });
    expect(await getFires('lewie')).toBe(0);
  });

  it('rejects an off-roster sender or target', async () => {
    expect(await sendFire('nobody', 'lewie')).toEqual({ ok: false, error: 'bad id' });
    expect(await sendFire('lewie', 'nobody')).toEqual({ ok: false, error: 'bad id' });
    expect(await getFires('lewie')).toBe(0);
  });

  it('a first fire increments the recipient and returns the new count', async () => {
    const res = await sendFire('lewie', 'william');
    expect(res).toEqual({ ok: true, count: 1 });
    expect(await getFires('william')).toBe(1);
    expect(await getFires('lewie')).toBe(0);
  });

  it('a second same-day fire is idempotent (no double count)', async () => {
    await sendFire('lewie', 'william');
    const again = await sendFire('lewie', 'william');
    expect(again).toEqual({ ok: true, already: true });
    expect(await getFires('william')).toBe(1);
  });

  it('a DIFFERENT sender can also fire the same teammate the same day', async () => {
    await sendFire('lewie', 'william');
    const other = await sendFire('maddux', 'william');
    expect(other).toEqual({ ok: true, count: 2 });
    expect(await getFires('william')).toBe(2);
  });

  it('allows the same sender to fire again the NEXT day', async () => {
    await sendFire('lewie', 'william');
    expect(await getFires('william')).toBe(1);
    pinDate('2026-01-15');
    const next = await sendFire('lewie', 'william');
    expect(next).toEqual({ ok: true, count: 2 });
    expect(await getFires('william')).toBe(2);
  });

  it('listFires returns the whole roster with counts, zeroed where unset', async () => {
    await sendFire('lewie', 'william');
    await sendFire('maddux', 'william');
    await sendFire('lewie', 'teddy');
    const all = await listFires();
    expect(all).toHaveLength(ROSTER.length);
    const byId = Object.fromEntries(all.map((f) => [f.id, f.fires]));
    expect(byId.william).toBe(2);
    expect(byId.teddy).toBe(1);
    expect(byId.lewie).toBe(0); // sender never gains fires
    expect(byId.johnny).toBe(0); // untouched player
  });

  it('getRecentFirers records who fired a player, newest first, with timestamps', async () => {
    expect(await getRecentFirers('william')).toEqual([]);
    await sendFire('lewie', 'william');
    await sendFire('maddux', 'william');
    const firers = await getRecentFirers('william');
    expect(firers.map((g) => g.from)).toEqual(['maddux', 'lewie']); // newest first
    expect(firers.every((g) => typeof g.at === 'number' && g.at > 0)).toBe(true);
    // only real roster givers, and a same-day duplicate does not double-add
    await sendFire('lewie', 'william');
    const again = await getRecentFirers('william');
    expect(again.filter((g) => g.from === 'lewie')).toHaveLength(1);
    expect(again.every((g) => isRosterPlayer(g.from))).toBe(true);
  });

  it('a fire does NOT consume the same-day cheer slot (independent dedup)', async () => {
    // A sender can cheer AND fire the same teammate the same day; one does not
    // block the other because they use separate per-day dedup keys.
    const c = await sendCheer('lewie', 'william');
    const f = await sendFire('lewie', 'william');
    expect(c).toEqual({ ok: true, count: 1 });
    expect(f).toEqual({ ok: true, count: 1 });
    expect(await getCheers('william')).toBe(1);
    expect(await getFires('william')).toBe(1);
  });
});
