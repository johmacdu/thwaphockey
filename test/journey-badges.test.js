// test/journey-badges.test.js
//
// Season Book badges: pure math in lib/journey.js (no store).

import { describe, it, expect } from 'vitest';
import { BADGES, badgesFor, bestStreak, fullWeeks, starsFor } from '../lib/journey.js';

const TODAY = '2026-10-28';
const ev = (date, disc, n = 1) => Array.from({ length: n }, () => ({ date, disc }));
const byId = (r) => Object.fromEntries(r.badges.map((b) => [b.id, b]));

describe('badge list', () => {
  it('has 8 badges in art order with 3 rising star thresholds each', () => {
    expect(BADGES.map((b) => b.name)).toEqual(['Dangler', 'Sniper', 'Engine', 'Tape to Tape', 'Hockey Brain', 'On a Heater', 'Full Week', 'Hype Squad']);
    BADGES.forEach((b, i) => {
      expect(b.art).toBe(`badge-0${i + 1}.webp`);
      expect(b.stars).toHaveLength(3);
      expect(b.stars[0] < b.stars[1] && b.stars[1] < b.stars[2]).toBe(true);
    });
  });
});

describe('starsFor', () => {
  it.each([[0, 0], [9, 0], [10, 1], [29, 1], [30, 2], [60, 3], [500, 3]])('%i drills -> %i stars', (n, s) => {
    expect(starsFor(n, [10, 30, 60])).toBe(s);
  });
});

describe('bestStreak', () => {
  it('finds the longest run, not the latest one', () => {
    expect(bestStreak([])).toBe(0);
    expect(bestStreak(['2026-09-01'])).toBe(1);
    expect(bestStreak(['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-10', '2026-09-11'])).toBe(3);
  });
  it('crosses month ends', () => {
    expect(bestStreak(['2026-09-29', '2026-09-30', '2026-10-01'])).toBe(3);
  });
});

describe('fullWeeks', () => {
  it('counts Monday-based weeks with 4+ training days', () => {
    // Mon Sep 7 - Sun Sep 13: 4 days (counts). Mon Sep 14 week: 3 days (does not).
    const days = ['2026-09-07', '2026-09-08', '2026-09-12', '2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16'];
    expect(fullWeeks(days)).toBe(1);
  });
  it('does not join a Sunday to the next Monday', () => {
    expect(fullWeeks(['2026-09-12', '2026-09-13', '2026-09-14', '2026-09-15'])).toBe(0);
  });
});

describe('badgesFor', () => {
  it('a new player has every badge at 0 stars', () => {
    const r = badgesFor({}, TODAY);
    expect(r.badgeStars).toBe(0);
    expect(r.badges.every((b) => b.stars === 0 && b.count === 0)).toBe(true);
    expect(byId(r).dangler.next).toBe(10);
  });

  it('counts each drill type this season only', () => {
    const events = [
      ...ev('2026-08-31', 'stick', 50), // last season: ignored
      ...ev('2026-09-02', 'stick', 12),
      ...ev('2026-10-01', 'shoot', 30),
      ...ev('2026-10-02', 'dryland', 8),
      ...ev('2026-10-03', 'pass', 1),
      ...ev('2026-10-04', 'iq', 30),
      ...ev('2026-11-01', 'stick', 99), // after today: ignored
    ];
    const b = byId(badgesFor({ events }, TODAY));
    expect([b.dangler.count, b.dangler.stars, b.dangler.next]).toEqual([12, 1, 30]);
    expect([b.sniper.count, b.sniper.stars]).toEqual([30, 2]);
    expect([b.engine.count, b.engine.stars]).toEqual([8, 1]);
    expect([b.tapetotape.count, b.tapetotape.stars]).toEqual([1, 0]);
    expect([b.hockeybrain.stars, b.hockeybrain.next]).toEqual([3, null]);
  });

  it('goalies get Net Boss for Net play in the Sniper slot', () => {
    const events = [...ev('2026-10-01', 'netplay', 10), ...ev('2026-10-01', 'shoot', 40)];
    const r = badgesFor({ events, goalie: true }, TODAY);
    expect(r.badges[1]).toMatchObject({ id: 'netboss', name: 'Net Boss', art: 'badge-02.webp', count: 10, stars: 1 });
    expect(r.badges.some((b) => b.id === 'sniper')).toBe(false);
    expect(badgesFor({ events }, TODAY).badges[1]).toMatchObject({ id: 'sniper', count: 40, stars: 2 });
  });

  it('streak, full weeks and cheers feed their badges', () => {
    const days = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13'];
    const b = byId(badgesFor({ days, cheersSent: 21 }, TODAY));
    expect([b.onaheater.count, b.onaheater.stars]).toEqual([7, 2]);
    expect([b.fullweek.count, b.fullweek.stars]).toEqual([1, 0]);
    expect([b.hypesquad.count, b.hypesquad.stars]).toEqual([21, 2]);
  });

  it('badgeStars is the total across all 8', () => {
    const r = badgesFor({ events: ev('2026-10-01', 'stick', 60), cheersSent: 5 }, TODAY);
    expect(r.badgeStars).toBe(4);
  });

  it('Jan-Mar counts toward the season that began in September', () => {
    const r = badgesFor({ events: [...ev('2026-09-10', 'stick', 5), ...ev('2027-02-10', 'stick', 5)] }, '2027-03-01');
    expect(byId(r).dangler).toMatchObject({ count: 10, stars: 1 });
  });

  it('ignores malformed events', () => {
    const r = badgesFor({ events: [null, { date: 'nope', disc: 'stick' }, { disc: 'stick' }, ...ev('2026-10-01', 'stick')] }, TODAY);
    expect(byId(r).dangler.count).toBe(1);
  });
});
