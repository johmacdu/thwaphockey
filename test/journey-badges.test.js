// test/journey-badges.test.js
//
// Season Book badges: pure math in lib/journey.js (no store).

import { describe, it, expect } from 'vitest';
import { BADGES, badgesFor, bestStreak, fullWeeks, starsFor } from '../lib/journey.js';

const TODAY = '2026-10-28';
const ev = (date, disc, n = 1) => Array.from({ length: n }, () => ({ date, disc }));
const byId = (r) => Object.fromEntries(r.badges.map((b) => [b.id, b]));
// `n` consecutive YYYY-MM-DD dates from `start`.
const range = (start, n) => {
  const base = Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)) - 1, Number(start.slice(8, 10)));
  return Array.from({ length: n }, (_, i) => new Date(base + i * 86400000).toISOString().slice(0, 10));
};

describe('badge list', () => {
  it('has 32 badges in art order, the first eight unchanged', () => {
    expect(BADGES).toHaveLength(32);
    expect(BADGES.slice(0, 8).map((b) => b.name)).toEqual(['Dangler', 'Sniper', 'Engine', 'Tape to Tape', 'Hockey Brain', 'On a Heater', 'Full Week', 'Hype Squad']);
    BADGES.forEach((b, i) => {
      expect(b.art).toBe(`badge-${String(i + 1).padStart(2, '0')}.webp`);
      expect(b.id).toBeTruthy();
      expect(b.name).toBeTruthy();
      expect(Array.isArray(b.stars) && b.stars.length >= 1).toBe(true);
      for (let k = 1; k < b.stars.length; k++) expect(b.stars[k] > b.stars[k - 1]).toBe(true); // rising
    });
  });
  it('the five journey milestones are one-and-done (a single star), the rest have three', () => {
    expect(BADGES.filter((b) => b.stars.length === 1).map((b) => b.id)).toEqual(['calledup', 'gametime', 'topshelf', 'seasonsweep', 'openingnight']);
    expect(BADGES.filter((b) => b.stars.length === 3)).toHaveLength(27);
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

  it('badgeStars is the sum of every badge\'s stars', () => {
    const r = badgesFor({ events: ev('2026-10-01', 'stick', 60), cheersSent: 5 }, TODAY);
    expect(r.badgeStars).toBe(r.badges.reduce((s, b) => s + b.stars, 0));
    const b = byId(r);
    expect(b.dangler.stars).toBe(3); // 60 hands drills
    expect(b.hypesquad.stars).toBe(1); // 5 cheers
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

describe('badgesFor: batch-2 badges', () => {
  it('days feed First Shift and Rink Rat', () => {
    const b = byId(badgesFor({ days: range('2026-09-01', 5) }, TODAY));
    expect([b.firstshift.count, b.firstshift.stars]).toEqual([5, 2]);
    expect([b.rinkrat.count, b.rinkrat.stars]).toEqual([5, 0]);
  });
  it('Grinder counts every drill this season, any discipline', () => {
    const events = [...ev('2026-10-01', 'stick', 50), ...ev('2026-10-02', 'pass', 40)];
    expect(byId(badgesFor({ events }, TODAY)).grinder).toMatchObject({ count: 90, stars: 1 });
  });
  it('Complete Player is the fewest drills across the five core skills', () => {
    const d = '2026-10-01';
    const full = ['stick', 'shoot', 'pass', 'dryland', 'iq'].flatMap((x) => ev(d, x, 5));
    expect(byId(badgesFor({ events: full }, TODAY)).completeplayer).toMatchObject({ count: 5, stars: 1 });
    const gap = ['stick', 'shoot', 'pass', 'dryland'].flatMap((x) => ev(d, x, 9)).concat(ev(d, 'iq', 4));
    expect(byId(badgesFor({ events: gap }, TODAY)).completeplayer.count).toBe(4); // the weakest skill caps it
  });
  it('elite discipline badges stack on top of the base ones', () => {
    const b = byId(badgesFor({ events: ev('2026-10-01', 'shoot', 180) }, TODAY));
    expect(b.sniper.stars).toBe(3); // base, caps at 60
    expect([b.bardown.count, b.bardown.stars]).toEqual([180, 2]); // elite: 100/175/250
  });
  it('goalies get Brick Wall for Net play in the Bar Down slot', () => {
    const r = badgesFor({ events: ev('2026-10-01', 'netplay', 120), goalie: true }, TODAY);
    expect(byId(r).brickwall).toMatchObject({ count: 120, stars: 1 });
    expect(r.badges.some((x) => x.id === 'bardown')).toBe(false);
  });
  it('week badges read their own minimum (any / 3+ / 4+ days)', () => {
    const days = [...range('2026-10-05', 3), ...range('2026-10-12', 4), '2026-10-19']; // 3-day, 4-day, 1-day weeks
    const b = byId(badgesFor({ days }, TODAY));
    expect(b.clockwork.count).toBe(3); // weeks with 1+ day
    expect(b.hattrickweek.count).toBe(2); // weeks with 3+ days
    expect(b.lockedin.count).toBe(1); // weeks with 4+ days
  });
  it('No Days Off is the long streak; Month Maker counts months', () => {
    const b = byId(badgesFor({ days: [...range('2026-09-15', 21), '2026-10-20'] }, TODAY));
    expect([b.nodaysoff.count, b.nodaysoff.stars]).toEqual([21, 1]);
    expect(b.monthmaker.count).toBe(2); // September and October
  });
  it('Weekend Warrior counts Sat/Sun; Winter Warrior counts Dec-Feb', () => {
    // Sat 2026-10-03, Sun 2026-10-04 are weekend days.
    expect(byId(badgesFor({ days: ['2026-10-03', '2026-10-04', '2026-10-05'] }, TODAY)).weekendwarrior.count).toBe(2);
    expect(byId(badgesFor({ days: ['2026-12-10', '2027-01-05', '2027-02-02', '2026-11-30'] }, '2027-02-15')).winterwarrior.count).toBe(3);
  });
  it('Big Week is the most drills in one Monday week; Comeback Kid counts returns after a 5+ day gap', () => {
    const events = [...ev('2026-10-05', 'stick', 20), ...ev('2026-10-14', 'stick', 5)]; // 20 in one week, 5 the next
    expect(byId(badgesFor({ events }, TODAY)).bigweek).toMatchObject({ count: 20, stars: 2 });
    const days = ['2026-09-01', '2026-09-02', '2026-09-10', '2026-09-20']; // two gaps of 8 and 10 days
    expect(byId(badgesFor({ days }, TODAY)).comebackkid.count).toBe(2);
  });
  it('milestones are one star: tier reached, finished, and opening night', () => {
    const b19 = byId(badgesFor({ days: range('2026-09-01', 19) }, TODAY));
    expect([b19.calledup.count, b19.calledup.stars, b19.calledup.next]).toEqual([1, 1, null]); // reached Practice Ice
    expect(byId(badgesFor({ days: range('2026-09-01', 18) }, TODAY)).calledup.stars).toBe(0); // not yet
    expect(byId(badgesFor({ days: range('2026-09-01', 91) }, '2027-03-31')).seasonsweep.stars).toBe(1); // finished
    expect(byId(badgesFor({ days: ['2026-09-10'] }, TODAY)).openingnight.stars).toBe(1); // within first two weeks
    expect(byId(badgesFor({ days: ['2026-09-20'] }, TODAY)).openingnight.stars).toBe(0); // after the opener
  });
  it('carries short/kind through so the page can phrase any badge', () => {
    const b = byId(badgesFor({ days: range('2026-09-01', 5) }, TODAY));
    expect(b.firstshift.kind).toBe('days');
    expect(b.firstshift.short).toBe('days');
    expect(b.clockwork.min).toBe(1);
  });
});

describe('weeksWith / weeksTrained', () => {
  it('counts Monday-based weeks with at least N training days', async () => {
    const { weeksWith, journeyFor } = await import('../lib/journey.js');
    // Week of Sep 7: 1 day. Week of Sep 14: 2 days. Week of Sep 28: 1 day.
    const days = ['2026-09-07', '2026-09-14', '2026-09-20', '2026-09-28'];
    expect(weeksWith(days, 1)).toBe(3);
    expect(weeksWith(days, 2)).toBe(1);
    expect(weeksWith([], 1)).toBe(0);
    // journeyFor exposes weeks of hockey for the finale, this season only.
    expect(journeyFor([...days, '2026-08-30', '2026-09-07'], '2026-10-28').weeksTrained).toBe(3);
  });
});
