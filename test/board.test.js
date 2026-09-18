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
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-14T20:00:00.000Z')); // Wed, Vancouver
});

afterEach(() => {
  vi.useRealTimers();
});

describe('board handler', () => {
  it('rejects non-GET with 405', async () => {
    const res = makeRes();
    await handler({ method: 'POST', query: {} }, res);
    expect(res.statusCode).toBe(405);
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
    expect(lewie).toEqual({ id: 'lewie', stick: 1, shoot: 0, dryland: 1 });
  });
});
