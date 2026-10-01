// test/board.test.js
//
// Unit tests for api/board.js: routes to all-time (listPlayers) by default and
// to the Monday-based week (weekBoard) on ?tf=week. Store is faked; clock pinned
// so week membership is deterministic.

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

// A signing secret so we can mint real session tokens for the cheer POST gate.
// (session_store reads the secret lazily at verify/mint time, so order is
// flexible, but set it alongside the import to mirror done.test.js.)
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

beforeEach(() => {
  fake.map.clear();
  process.env.SESSION_TOKEN_SECRET = 'test-session-secret';
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-14T20:00:00.000Z')); // Wed, Vancouver
});

afterEach(() => {
  vi.useRealTimers();
});

describe('board handler', () => {
  it('rejects a non-GET, non-POST method with 405', async () => {
    const res = makeRes();
    await handler({ method: 'DELETE', query: {} }, res);
    expect(res.statusCode).toBe(405);
  });

  it('rejects a POST with no recognized action with 400', async () => {
    const res = makeRes();
    await handler({ method: 'POST', query: {}, headers: {}, body: {} }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('unknown action');
  });

  it('sets a no-store cache header', async () => {
    const res = makeRes();
    await handler({ method: 'GET', query: {} }, res);
    expect(res.headers['Cache-Control']).toBe('no-store');
  });

  it('default returns cumulative all-time counts with a computed streak', async () => {
    fake._seed('player:lewie', { stick: 9, shoot: 4, dryland: 7, streak: 0, stickers: 0, updatedAt: null });
    fake._seed('days:lewie', ['2026-01-13', '2026-01-14']);
    const res = makeRes();
    await handler({ method: 'GET', query: {} }, res);
    const lewie = res.body.players.find((p) => p.id === 'lewie');
    expect(lewie.stick).toBe(9);
    expect(lewie.streak).toBe(2);
  });

  it('tf=week returns per-player current-week counts', async () => {
    fake._seed('events:lewie', [
      { date: '2026-01-11', disc: 'stick' }, // last week
      { date: '2026-01-14', disc: 'stick' },
      { date: '2026-01-14', disc: 'dryland' },
    ]);
    const res = makeRes();
    await handler({ method: 'GET', query: { tf: 'week' } }, res);
    const lewie = res.body.players.find((p) => p.id === 'lewie');
    expect(lewie).toEqual({ id: 'lewie', stick: 1, shoot: 0, dryland: 1, netplay: 0, cheers: 0, fire: 0 });
  });

  it('folds each player cheer count into the GET response', async () => {
    fake._seed('cheers:william', 7);
    const res = makeRes();
    await handler({ method: 'GET', query: {} }, res);
    const william = res.body.players.find((p) => p.id === 'william');
    expect(william.cheers).toBe(7);
    // Players never cheered still carry an explicit 0.
    const lewie = res.body.players.find((p) => p.id === 'lewie');
    expect(lewie.cheers).toBe(0);
  });
});

describe('board handler: POST ?action=cheer', () => {
  const cheer = (to, token, query = { action: 'cheer' }) => ({
    method: 'POST',
    query,
    headers: token ? { cookie: `thwapSession=${token}` } : {},
    body: { to },
  });

  it('401s without a session', async () => {
    const res = makeRes();
    await handler(cheer('william', null), res);
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe('session required');
    expect(fake.map.get('cheers:william')).toBeUndefined();
  });

  it('400s when "to" is missing', async () => {
    const res = makeRes();
    const token = mintSession('lewie', 'p@e.com');
    await handler(cheer(undefined, token), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('bad target');
  });

  it('400s on a self-cheer (to equals the session player)', async () => {
    const res = makeRes();
    const token = mintSession('lewie', 'p@e.com');
    await handler(cheer('lewie', token), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('bad target');
    expect(fake.map.get('cheers:lewie')).toBeUndefined();
  });

  it('400s on an off-roster target', async () => {
    const res = makeRes();
    const token = mintSession('lewie', 'p@e.com');
    await handler(cheer('nobody', token), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('bad target');
  });

  it('200 and increments on the first cheer, with the sender taken from the session', async () => {
    const res = makeRes();
    const token = mintSession('lewie', 'p@e.com');
    await handler(cheer('william', token), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, count: 1 });
    expect(fake.map.get('cheers:william')).toBe(1);
  });

  it('is idempotent: a same-day repeat returns already:true without double counting', async () => {
    const token = mintSession('lewie', 'p@e.com');
    await handler(cheer('william', token), makeRes());
    const res = makeRes();
    await handler(cheer('william', token), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, already: true });
    expect(fake.map.get('cheers:william')).toBe(1);
  });

  it('a raw JSON string body is parsed (Vercel unparsed case)', async () => {
    const res = makeRes();
    const token = mintSession('lewie', 'p@e.com');
    await handler({ method: 'POST', query: { action: 'cheer' }, headers: { cookie: `thwapSession=${token}` }, body: JSON.stringify({ to: 'teddy' }) }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.count).toBe(1);
    expect(fake.map.get('cheers:teddy')).toBe(1);
  });

  it('400s an unknown POST action', async () => {
    const res = makeRes();
    await handler({ method: 'POST', query: { action: 'bogus' }, headers: {}, body: {} }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('unknown action');
  });
});

describe('board handler: GET folds in fire counts', () => {
  it('folds each player fire count into the GET response, zeroed where unset', async () => {
    fake._seed('fire:teddy', 4);
    const res = makeRes();
    await handler({ method: 'GET', query: {} }, res);
    const teddy = res.body.players.find((p) => p.id === 'teddy');
    expect(teddy.fire).toBe(4);
    const lewie = res.body.players.find((p) => p.id === 'lewie');
    expect(lewie.fire).toBe(0);
  });
});

describe('board handler: POST ?action=fire', () => {
  const fire = (to, token) => ({
    method: 'POST',
    query: { action: 'fire' },
    headers: token ? { cookie: `thwapSession=${token}` } : {},
    body: { to },
  });

  it('401s without a session', async () => {
    const res = makeRes();
    await handler(fire('william', null), res);
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe('session required');
    expect(fake.map.get('fire:william')).toBeUndefined();
  });

  it('400s when "to" is missing', async () => {
    const res = makeRes();
    const token = mintSession('lewie', 'p@e.com');
    await handler(fire(undefined, token), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('bad target');
  });

  it('400s on a self-fire (to equals the session player)', async () => {
    const res = makeRes();
    const token = mintSession('lewie', 'p@e.com');
    await handler(fire('lewie', token), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('bad target');
    expect(fake.map.get('fire:lewie')).toBeUndefined();
  });

  it('400s on an off-roster target', async () => {
    const res = makeRes();
    const token = mintSession('lewie', 'p@e.com');
    await handler(fire('nobody', token), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('bad target');
  });

  it('200 and increments on the first fire, with the sender taken from the session', async () => {
    const res = makeRes();
    const token = mintSession('lewie', 'p@e.com');
    await handler(fire('william', token), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, count: 1 });
    expect(fake.map.get('fire:william')).toBe(1);
  });

  it('is idempotent: a same-day repeat returns already:true without double counting', async () => {
    const token = mintSession('lewie', 'p@e.com');
    await handler(fire('william', token), makeRes());
    const res = makeRes();
    await handler(fire('william', token), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, already: true });
    expect(fake.map.get('fire:william')).toBe(1);
  });

  it('a fire does NOT consume the same-day cheer slot (both land independently)', async () => {
    const token = mintSession('lewie', 'p@e.com');
    await handler({ method: 'POST', query: { action: 'cheer' }, headers: { cookie: `thwapSession=${token}` }, body: { to: 'william' } }, makeRes());
    const res = makeRes();
    await handler(fire('william', token), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, count: 1 });
    expect(fake.map.get('cheers:william')).toBe(1);
    expect(fake.map.get('fire:william')).toBe(1);
  });
});

describe('board handler: GET ?action=cheers-for (home-screen roll-up source)', () => {
  it('401 without a session (you can only read your own cheers)', async () => {
    const res = makeRes();
    await handler({ method: 'GET', query: { action: 'cheers-for' }, headers: {} }, res);
    expect(res.statusCode).toBe(401);
  });

  it('returns the signed-in player\'s own recent givers, newest first', async () => {
    // william received cheers from lewie then maddux (store writes newest-first).
    fake._seed('cheerfrom:william', [
      { from: 'maddux', at: 2000 },
      { from: 'lewie', at: 1000 },
    ]);
    const token = mintSession('william', 'p@e.com');
    const res = makeRes();
    await handler({ method: 'GET', query: { action: 'cheers-for' }, headers: { cookie: `thwapSession=${token}` } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.id).toBe('william');
    expect(res.body.givers.map((g) => g.from)).toEqual(['maddux', 'lewie']);
    expect(res.headers['Cache-Control']).toBe('no-store');
  });

  it('returns an empty list for a player nobody has cheered', async () => {
    const token = mintSession('teddy', 'p@e.com');
    const res = makeRes();
    await handler({ method: 'GET', query: { action: 'cheers-for' }, headers: { cookie: `thwapSession=${token}` } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.givers).toEqual([]);
  });
});
