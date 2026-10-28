// test/journey-endpoint.test.js
//
// GET /api/board?action=journey: the signed-in player's Season Book. Store is
// faked and the clock pinned so "today" and the season window are deterministic.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FakeRedis } from './fakeRedis.js';

const fake = new FakeRedis();
vi.mock('@upstash/redis', () => ({
  Redis: class {
    constructor() {
      return fake;
    }
  },
}));

const { default: handler } = await import('../api/board.js');
const { mintSession } = await import('../lib/session_store.js');

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
}

function get(token) {
  const res = makeRes();
  const req = { method: 'GET', query: { action: 'journey' }, headers: token ? { cookie: `thwapSession=${token}` } : {} };
  return handler(req, res).then(() => res);
}

beforeEach(() => {
  fake.map.clear();
  process.env.SESSION_TOKEN_SECRET = 'test-session-secret';
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-27T20:00:00.000Z')); // Tue Oct 27, Vancouver
});

afterEach(() => {
  vi.useRealTimers();
});

describe('GET /api/board?action=journey', () => {
  it('401 without a session', async () => {
    const res = await get(null);
    expect(res.statusCode).toBe(401);
  });

  it('returns the signed-in player\'s own book from days:<id>', async () => {
    fake._seed('days:lewie', ['2026-08-30', '2026-09-03', '2026-09-04', '2026-10-01', '2026-10-27']);
    fake._seed('days:william', ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05']);
    const res = await get(mintSession('lewie', 'p@e.com'));
    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(res.body).toMatchObject({
      id: 'lewie',
      trainingDays: 4,
      tier: 'Locker Room',
      step: 2,
      daysToNextStep: 7,
      seasonOver: false,
    });
    expect(res.body.season.key).toBe('fw-2026');
    expect(res.body.months).toEqual([
      { month: '2026-09', days: 2 },
      { month: '2026-10', days: 2 },
    ]);
  });

  it('a player with no history starts at the first step', async () => {
    const res = await get(mintSession('teddy', 'p@e.com'));
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ id: 'teddy', trainingDays: 0, tier: 'Locker Room', step: 1, daysToNextStep: 3 });
  });

  it('is read-only: the store is unchanged after the call', async () => {
    fake._seed('days:lewie', ['2026-10-01']);
    const before = JSON.stringify([...fake.map.entries()]);
    await get(mintSession('lewie', 'p@e.com'));
    expect(JSON.stringify([...fake.map.entries()])).toBe(before);
  });

  it('cover uses the coach roster entry: first name, last initial, number, position, team', async () => {
    fake._seed('teamMember:lewie', { teamCode: 'JRR10', firstName: 'Lewie', lastName: 'MacDuffie', number: 81, position: 'forward' });
    fake._seed('team:JRR10', { code: 'JRR10', name: 'Jr. Rangers 10U' });
    const res = await get(mintSession('lewie', 'p@e.com'));
    expect(res.body.player).toEqual({ name: 'Lewie M.', number: 81, position: 'forward', team: 'Jr. Rangers 10U' });
  });

  it('cover falls back to the built-in roster when there is no coach entry', async () => {
    const res = await get(mintSession('alder', 'p@e.com'));
    expect(res.body.player).toEqual({ name: 'Alder', number: 71, position: null, team: null });
  });
});

describe('GET /api/board?action=journey badges', () => {
  it('returns the 8 badges and the star total from events, days and cheers sent', async () => {
    fake._seed('events:lewie', [
      ...Array.from({ length: 10 }, () => ({ date: '2026-10-01', disc: 'stick' })),
      { date: '2026-08-01', disc: 'stick' },
    ]);
    fake._seed('days:lewie', ['2026-10-01', '2026-10-02', '2026-10-03']);
    fake._seed('cheersent:fw-2026:lewie', 5);
    const res = await get(mintSession('lewie', 'p@e.com'));
    expect(res.statusCode).toBe(200);
    expect(res.body.badges).toHaveLength(8);
    const b = Object.fromEntries(res.body.badges.map((x) => [x.id, x]));
    expect(b.dangler).toMatchObject({ count: 10, stars: 1 });
    expect(b.onaheater).toMatchObject({ count: 3, stars: 1 });
    expect(b.hypesquad).toMatchObject({ count: 5, stars: 1 });
    expect(res.body.badgeStars).toBe(3);
  });

  it('the goalie sees Net Boss', async () => {
    const res = await get(mintSession('johnny', 'p@e.com'));
    expect(res.body.badges[1].id).toBe('netboss');
  });
});

describe('GET /api/board?action=journey safety', () => {
  it('401 for a forged or garbled session', async () => {
    expect((await get('not-a-real-token')).statusCode).toBe(401);
    const forged = mintSession('lewie', 'p@e.com').replace(/.$/, (c) => (c === 'a' ? 'b' : 'a'));
    expect((await get(forged)).statusCode).toBe(401);
  });

  it('never counts a teammate\'s training or cheers', async () => {
    fake._seed('days:william', ['2026-10-01', '2026-10-02', '2026-10-03']);
    fake._seed('events:william', Array.from({ length: 60 }, () => ({ date: '2026-10-01', disc: 'stick' })));
    fake._seed('cheersent:fw-2026:william', 50);
    const res = await get(mintSession('lewie', 'p@e.com'));
    expect(res.body.id).toBe('lewie');
    expect(res.body.trainingDays).toBe(0);
    expect(res.body.badgeStars).toBe(0);
  });

  it('a player with no history gets all 8 badges at zero', async () => {
    const res = await get(mintSession('teddy', 'p@e.com'));
    expect(res.body.badges).toHaveLength(8);
    expect(res.body.badges.every((b) => b.count === 0 && b.stars === 0)).toBe(true);
    expect(res.body.badges[1].id).toBe('sniper');
  });

  it('is read-only with badges too', async () => {
    fake._seed('days:lewie', ['2026-10-01']);
    fake._seed('events:lewie', [{ date: '2026-10-01', disc: 'stick' }]);
    fake._seed('cheersent:fw-2026:lewie', 3);
    const before = JSON.stringify([...fake.map.entries()]);
    await get(mintSession('lewie', 'p@e.com'));
    expect(JSON.stringify([...fake.map.entries()])).toBe(before);
  });
});
