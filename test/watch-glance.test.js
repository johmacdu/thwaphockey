// test/watch-glance.test.js
//
// Apple Watch glance screens:
//   - GET /api/done?view=season  the journey scene and "N training days to <next>",
//     straight from lib/journey.js (the same book /api/board?action=journey sends
//     journey.html)
//   - GET /api/done?view=team    this week's team goal, the same goal and total
//     the Standings bar shows from /api/board?tf=week
// Both are session-gated, self-only, and answer for any team.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FakeRedis } from './fakeRedis.js';

const fake = new FakeRedis();
vi.mock('@upstash/redis', () => ({ Redis: class { constructor() { return fake; } } }));

function setEnv() {
  process.env.KV_REST_API_URL = 'https://fake';
  process.env.KV_REST_API_TOKEN = 'fake';
  process.env.SESSION_TOKEN_SECRET = 'session-secret-please-change';
}
setEnv();

const { default: done } = await import('../api/done.js');
const { default: board } = await import('../api/board.js');
const { mintSession } = await import('../lib/session_store.js');
const { setTeam, addMember } = await import('../lib/teams_store.js');
const { journeyFor, progressFor, badgesFor, nextStarFor } = await import('../lib/journey.js');

function makeRes() {
  return {
    statusCode: 200, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
}
const cookie = (pid) => ({ cookie: `thwapSession=${mintSession(pid, 'parent@example.com')}` });
const getAs = (pid, query = {}) => ({ method: 'GET', query, headers: pid ? cookie(pid) : {} });
async function call(handler, req) { const res = makeRes(); await handler(req, res); return res; }
function at(date) { vi.setSystemTime(new Date(`${date}T19:00:00Z`)); } // noon in Vancouver

// N consecutive training days from `start`.
function trainingDays(n, start = '2026-09-01') {
  const out = [];
  const d = new Date(`${start}T12:00:00Z`);
  for (let i = 0; i < n; i++) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

// The Standings bar total, copied from index.html render(): thirdOf() folds
// netplay into shoot while Net play is off, and adds it on its own when on.
function webBarTotal(players, netEnabled) {
  const t = { stick: 0, shoot: 0, dryland: 0, pass: 0, netplay: 0 };
  for (const p of players) {
    t.stick += p.stick || 0;
    t.shoot += netEnabled ? (p.shoot || 0) : (p.shoot || 0) + (p.netplay || 0);
    t.dryland += p.dryland || 0;
    t.pass += p.pass || 0;
    t.netplay += p.netplay || 0;
  }
  return t.stick + t.shoot + t.dryland + t.pass + (netEnabled ? t.netplay : 0);
}

beforeEach(async () => {
  fake.map.clear();
  setEnv();
  vi.useFakeTimers({ toFake: ['Date'] });
  at('2026-11-04'); // a Wednesday; this week starts Mon Nov 2
  await setTeam('FLYERS10', { name: 'Flyers 9U', createdAt: new Date().toISOString() });
  await addMember('FLYERS10', { playerId: 'zara', firstName: 'Zara', lastName: 'Quinn', number: 44, position: 'F' });
  await addMember('FLYERS10', { playerId: 'gus', firstName: 'Gus', lastName: 'Net', number: 30, position: 'G' });
});
afterEach(() => { vi.useRealTimers(); });

describe('GET /api/done?view=season and ?view=team: auth', () => {
  it('needs a session (401), answers only for yourself (403)', async () => {
    for (const view of ['season', 'team']) {
      expect((await call(done, getAs(null, { view }))).statusCode).toBe(401);
      expect((await call(done, getAs('lewie', { view, player: 'alder' }))).statusCode).toBe(403);
      const ok = await call(done, getAs('lewie', { view, player: 'lewie' }));
      expect(ok.statusCode).toBe(200);
      expect(ok.headers['Cache-Control']).toBe('no-store');
    }
  });

  it('refuses an inherited object key as a view (400, never hangs)', async () => {
    expect((await call(done, getAs('lewie', { view: 'constructor' }))).statusCode).toBe(400);
    expect((await call(done, getAs('lewie', { view: 'toString' }))).statusCode).toBe(400);
  });
});

describe('GET /api/done?view=season', () => {
  const cases = [
    ['no days yet', 0, 'Locker Room', 'Practice Ice', 19],
    ['mid Locker Room', 11, 'Locker Room', 'Practice Ice', 8],
    ['first day of Practice Ice', 19, 'Practice Ice', 'Game Ready', 24],
    ['mid Practice Ice', 35, 'Practice Ice', 'Game Ready', 8],
    ['Game Ready', 50, 'Game Ready', 'Legend', 17],
    ['Legend', 70, 'Legend', null, 0],
  ];
  for (const [label, n, tier, nextTier, toNext] of cases) {
    it(`${label}: matches lib/journey.js and the journey page`, async () => {
      at('2026-12-20');
      const days = trainingDays(n, '2026-09-01');
      fake._seed('days:lewie', days);
      const r = await call(done, getAs('lewie', { view: 'season' }));
      const book = journeyFor(days, '2026-12-20');
      expect(r.body).toMatchObject({
        ok: true, tier, nextTier, dotsToNextTier: toNext, trainingDays: n,
        dots: book.dots, totalDots: 91, tierIndex: book.tierIndex,
        dotsToFinish: book.dotsToFinish, complete: false, seasonOver: false,
      });
      // The exact numbers /api/board?action=journey sends journey.html.
      const web = await call(board, { method: 'GET', query: { action: 'journey' }, headers: cookie('lewie') });
      for (const k of ['tier', 'tierIndex', 'dots', 'totalDots', 'dotsToNextTier', 'dotsToFinish', 'trainingDays', 'complete', 'seasonOver']) {
        expect(r.body[k]).toEqual(web.body[k]);
      }
      expect(r.body.season).toEqual(web.body.season);
    });
  }

  it('the whole path done: complete, Legend, nothing to go', async () => {
    at('2027-01-15');
    const days = trainingDays(95, '2026-09-01');
    fake._seed('days:lewie', days);
    const r = await call(done, getAs('lewie', { view: 'season' }));
    expect(r.body).toMatchObject({ tier: 'Legend', nextTier: null, complete: true, dots: 91, dotsToNextTier: 0, dotsToFinish: 0 });
  });

  it('reads only the session player and any team', async () => {
    fake._seed('days:zara', trainingDays(20, '2026-10-01'));
    fake._seed('days:lewie', trainingDays(3, '2026-10-01'));
    const r = await call(done, getAs('zara', { view: 'season' }));
    expect(r.body).toMatchObject({ tier: 'Practice Ice', trainingDays: 20, dotsToNextTier: 23 });
  });
});

describe('GET /api/done?view=season: steps and badge stars', () => {
  const ev = (date, disc, n) => Array.from({ length: n }, () => ({ date, disc }));

  // [label, training days, step, stepsDone, daysToNextStep, nextScene]
  const steps = [
    ['first day', 0, 1, 0, 3, 'Practice Ice'],
    ['Practice Ice step 2', 30, 2, 4, 5, 'Game Ready'],
    ['last step before Game Ready', 38, 3, 5, 5, 'Game Ready'],
    ['one day left', 50, 1, 6, 1, 'Legend'],
    ['Legend step 3', 88, 3, 11, 3, null],
  ];
  for (const [label, n, step, stepsDone, daysToNextStep, nextScene] of steps) {
    it(`${label}: step ${step}, ${daysToNextStep} to go, same as progressFor and the journey page`, async () => {
      at('2026-12-20');
      fake._seed('days:lewie', trainingDays(n, '2026-09-01'));
      const r = await call(done, getAs('lewie', { view: 'season' }));
      expect(r.body).toMatchObject({ step, stepsDone, daysToNextStep, nextScene, complete: false });
      const p = progressFor(n);
      expect([r.body.step, r.body.stepsDone, r.body.daysToNextStep]).toEqual([p.step, p.stepsDone, p.daysToNextStep]);
      const web = await call(board, { method: 'GET', query: { action: 'journey' }, headers: cookie('lewie') });
      for (const k of ['step', 'stepsDone', 'daysToNextStep']) expect(r.body[k]).toBe(web.body[k]);
    });
  }

  it('the whole path done: step 3 of 3, no next scene, nothing to go', async () => {
    at('2027-01-15');
    fake._seed('days:lewie', trainingDays(95, '2026-09-01'));
    const r = await call(done, getAs('lewie', { view: 'season' }));
    expect(r.body).toMatchObject({ complete: true, step: 3, stepsDone: 12, daysToNextStep: 0, nextScene: null });
  });

  it('badgeStars and nextStar match badgesFor and /api/board?action=journey for the same stored data', async () => {
    at('2026-12-20');
    const days = trainingDays(30, '2026-09-01');
    const events = [...ev('2026-09-02', 'stick', 26), ...ev('2026-09-03', 'shoot', 9), ...ev('2026-09-04', 'dryland', 8),
      ...ev('2026-09-05', 'pass', 3), ...ev('2026-09-06', 'iq', 2)];
    fake._seed('days:lewie', days);
    fake._seed('events:lewie', events);
    fake._seed('cheersent:fw-2026:lewie', 4);
    const r = await call(done, getAs('lewie', { view: 'season' }));
    const web = await call(board, { method: 'GET', query: { action: 'journey' }, headers: cookie('lewie') });
    const direct = badgesFor({ events, days, cheersSent: 4, goalie: false }, '2026-12-20');
    expect(r.body.badgeStars).toBe(20);
    expect(r.body.badgeStars).toBe(web.body.badgeStars);
    expect(r.body.badgeStars).toBe(direct.badgeStars);
    // Sniper, Hype Squad, Month Maker and Comeback Kid are all 1 away: Sniper
    // comes first in BADGES order.
    expect(r.body.nextStar).toEqual({ id: 'sniper', name: 'Sniper', remaining: 1, unit: 'Shooting drill' });
    expect(r.body.nextStar).toEqual(nextStarFor(web.body.badges));
    expect(r.body.nextStar).toEqual(nextStarFor(direct.badges));
  });

  it('a goalie gets the Net play badge, same as the journey page', async () => {
    at('2026-12-20');
    const days = trainingDays(30, '2026-09-01');
    fake._seed('days:gus', days);
    fake._seed('events:gus', ev('2026-09-02', 'netplay', 9));
    const r = await call(done, getAs('gus', { view: 'season' }));
    const web = await call(board, { method: 'GET', query: { action: 'journey' }, headers: cookie('gus') });
    expect(r.body.nextStar).toEqual({ id: 'netboss', name: 'Net Boss', remaining: 1, unit: 'Net play drill' });
    expect(r.body.nextStar).toEqual(nextStarFor(web.body.badges));
    expect(r.body.badgeStars).toBe(web.body.badgeStars);
  });

  it('no data: zero stars and First Shift is next', async () => {
    const r = await call(done, getAs('lewie', { view: 'season' }));
    expect(r.body.badgeStars).toBe(0);
    expect(r.body.nextStar).toEqual({ id: 'firstshift', name: 'First Shift', remaining: 1, unit: 'training day' });
  });
});

describe('nextStarFor', () => {
  const b = (o) => ({ id: o.id || 'x', name: o.name || 'X', count: 0, next: 5, kind: 'disc', unit: 'Hands drills', ...o });

  it('skips 3-star badges and the tier, complete and opening milestones', () => {
    const out = nextStarFor([
      b({ id: 'calledup', kind: 'tier', count: 0, next: 1 }),
      b({ id: 'seasonsweep', kind: 'complete', count: 0, next: 1 }),
      b({ id: 'openingnight', kind: 'opening', count: 0, next: 1 }),
      b({ id: 'maxed', count: 70, next: null }),
      b({ id: 'dangler', name: 'Dangler', count: 6, next: 10 }),
    ]);
    expect(out).toEqual({ id: 'dangler', name: 'Dangler', remaining: 4, unit: 'Hands drills' });
  });

  it('smallest gap wins, ties go to BADGES order, null when nothing is left', () => {
    expect(nextStarFor([b({ id: 'a', count: 1 }), b({ id: 'b', count: 3 }), b({ id: 'c', count: 3 })]).id).toBe('b');
    expect(nextStarFor([b({ next: null })])).toBeNull();
    expect(nextStarFor([])).toBeNull();
  });

  it('says each unit naturally, singular at 1', () => {
    const say = (o, left) => nextStarFor([b({ ...o, count: 10 - left, next: 10 })]).unit;
    expect(say({ kind: 'disc', unit: 'Dryland workouts' }, 1)).toBe('Dryland workout');
    expect(say({ kind: 'disc', unit: 'Hockey IQ sessions' }, 2)).toBe('Hockey IQ sessions');
    expect(say({ kind: 'streak' }, 1)).toBe('day in a row');
    expect(say({ kind: 'streak' }, 4)).toBe('days in a row');
    expect(say({ kind: 'weeks', min: 4 }, 2)).toBe('weeks with 4 days');
    expect(say({ kind: 'weeks', min: 3 }, 1)).toBe('week with 3 days');
    expect(say({ kind: 'weeks', min: 1 }, 1)).toBe('week of training');
    expect(say({ kind: 'balance' }, 3)).toBe('drills in every skill');
    expect(say({ kind: 'bigweek' }, 1)).toBe('drill in your best week');
    expect(say({ kind: 'cheers' }, 1)).toBe('cheer for a teammate');
    expect(say({ kind: 'months' }, 2)).toBe('months of training');
    expect(say({ kind: 'comeback' }, 1)).toBe('comeback');
    expect(say({ kind: 'days' }, 1)).toBe('training day');
    expect(say({ kind: 'weekend' }, 2)).toBe('weekend days');
    expect(say({ kind: 'winterdays' }, 1)).toBe('winter day');
  });
});

describe('GET /api/done?view=team', () => {
  function ev(date, disc, n = 1) { return Array.from({ length: n }, () => ({ date, disc })); }

  it('Rangers: same goal and total as the Standings bar, own share, no player list', async () => {
    // Last week finished and hit the goal of 75, so this week's goal is 85.
    fake._seed('teamgoal:ladder', { weeks: [{ weekStart: '2026-10-26', goal: 75, total: 80, hit: true }] });
    fake._seed('events:lewie', [...ev('2026-11-02', 'stick', 4), ...ev('2026-11-03', 'dryland', 3), ...ev('2026-11-03', 'iq', 2), ...ev('2026-10-30', 'stick', 5)]);
    fake._seed('events:alder', [...ev('2026-11-04', 'shoot', 6), ...ev('2026-11-04', 'pass', 2)]);
    fake._seed('events:teddy', [...ev('2026-11-02', 'netplay', 5)]);

    const r = await call(done, getAs('lewie', { view: 'team' }));
    const web = await call(board, { method: 'GET', query: { tf: 'week' }, headers: cookie('lewie') });
    expect(web.body.teamGoal.goal).toBe(85);
    // Hockey IQ and last week's drills do not count, like the bar.
    expect(r.body).toMatchObject({
      ok: true, teamName: 'Rangers', week: { start: '2026-11-02', end: '2026-11-04' },
      goal: 85, total: 20, toGo: 65, mine: 7,
    });
    expect(r.body.goal).toBe(web.body.teamGoal.goal);
    expect(r.body.total).toBe(webBarTotal(web.body.players, false));
    expect(r.body.total).toBe(webBarTotal(web.body.players, true));
    expect(r.body).not.toHaveProperty('players');
  });

  it('a new team gets the starting goal of 75 and to go never drops below 0', async () => {
    fake._seed('events:zara', ev('2026-11-03', 'stick', 50));
    fake._seed('events:gus', ev('2026-11-03', 'netplay', 30));
    const r = await call(done, getAs('gus', { view: 'team' }));
    const web = await call(board, { method: 'GET', query: { tf: 'week' }, headers: cookie('gus') });
    expect(r.body).toMatchObject({ teamName: 'Flyers 9U', goal: 75, total: 80, toGo: 0, mine: 30 });
    expect(r.body.goal).toBe(web.body.teamGoal.goal);
    expect(r.body.total).toBe(webBarTotal(web.body.players, false));
  });

  it('never mixes teams', async () => {
    fake._seed('events:lewie', ev('2026-11-03', 'stick', 9));
    fake._seed('events:zara', ev('2026-11-03', 'stick', 4));
    const r = await call(done, getAs('zara', { view: 'team' }));
    expect(r.body).toMatchObject({ total: 4, mine: 4 });
  });
});
