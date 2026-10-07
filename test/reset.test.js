// test/reset.test.js
//
// Tests for api/reset.js: the ONE-player hard-reset endpoint. It wipes a real
// player's counts/days/events on the live store and is gated by the shared
// SEED_KEY secret (same secret as api/seed.js).
//
// Contract, as READ from api/reset.js (not assumed):
//   - key is provided via the `x-seed-key` REQUEST HEADER (not query/body);
//   - SEED_KEY UNSET               -> 403 { error: 'reset disabled' }  (fail closed)
//   - SEED_KEY set, WRONG key      -> 403 { error: 'bad seed key' }
//   - SEED_KEY set, CORRECT key    -> 200 { reset, player } with counts zeroed
//   - non-POST                     -> 405
//   - missing/unknown player       -> 400
//
// The store is faked (test/fakeRedis.js) so the reset actually mutates in-memory
// state and we can assert the player's counts were zeroed.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FakeRedis } from './fakeRedis.js';

const fake = new FakeRedis();
vi.mock('@upstash/redis', () => ({ Redis: class { constructor() { return fake; } } }));

function setStoreEnv() {
  process.env.KV_REST_API_URL = 'https://fake';
  process.env.KV_REST_API_TOKEN = 'fake';
}
setStoreEnv();

const { default: handler } = await import('../api/reset.js');

// Express-like res double capturing status, json body, and headers.
function makeRes() {
  return {
    statusCode: 200, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
}

// POST helpers. Key travels in the x-seed-key header per the endpoint contract.
const post = (body = {}, headers = {}) => ({ method: 'POST', body, query: {}, headers });
const postWithKey = (body, key) => post(body, { 'x-seed-key': key });

// Seed a player directly into the fake store with non-zero counts so we can
// prove the reset zeroes them.
function seedPlayer(id, counts) {
  fake.map.set(`player:${id}`, { stick: 0, shoot: 0, dryland: 0, netplay: 0, iq: 0, streak: 0, stickers: 0, updatedAt: null, ...counts });
  fake.map.set(`days:${id}`, ['2026-09-01', '2026-09-02']);
  fake.map.set(`events:${id}`, [{ date: '2026-09-01', disc: 'stick' }, { date: '2026-09-02', disc: 'shoot' }]);
}

beforeEach(() => {
  fake.map.clear();
  setStoreEnv();
  delete process.env.SEED_KEY;
});

describe('reset.js: method + input guards', () => {
  it('rejects a non-POST with 405', async () => {
    process.env.SEED_KEY = 'the-secret';
    const res = makeRes();
    await handler({ method: 'GET', headers: {}, query: {} }, res);
    expect(res.statusCode).toBe(405);
  });

  it('400 when the key is valid but no player is named', async () => {
    process.env.SEED_KEY = 'the-secret';
    const res = makeRes();
    await handler(postWithKey({}, 'the-secret'), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('missing player');
  });

  it('400 on an unknown player (valid key)', async () => {
    process.env.SEED_KEY = 'the-secret';
    const res = makeRes();
    await handler(postWithKey({ player: 'nobody' }, 'the-secret'), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('unknown player');
  });
});

describe('reset.js: SEED_KEY gate', () => {
  it('403 (fail closed) when SEED_KEY is UNSET, even with a player named', async () => {
    // No SEED_KEY in env (beforeEach deletes it).
    seedPlayer('lewie', { stick: 5, shoot: 3 });
    const res = makeRes();
    await handler(postWithKey({ player: 'lewie' }, 'anything'), res);
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe('reset disabled');
    // The player's counts were NOT touched.
    expect(fake.map.get('player:lewie').stick).toBe(5);
  });

  it('403 when SEED_KEY is set but the request provides a WRONG key', async () => {
    process.env.SEED_KEY = 'the-real-secret';
    seedPlayer('lewie', { stick: 5, shoot: 3 });
    const res = makeRes();
    await handler(postWithKey({ player: 'lewie' }, 'wrong-key'), res);
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe('bad seed key');
    // Still untouched.
    expect(fake.map.get('player:lewie').stick).toBe(5);
  });

  it('403 when SEED_KEY is set but NO key is provided on the request', async () => {
    process.env.SEED_KEY = 'the-real-secret';
    seedPlayer('lewie', { stick: 5 });
    const res = makeRes();
    await handler(post({ player: 'lewie' }), res); // no x-seed-key header
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe('bad seed key');
    expect(fake.map.get('player:lewie').stick).toBe(5);
  });
});

describe('reset.js: success path zeroes the player', () => {
  it('200 + counts zeroed when SEED_KEY is set and the correct key is provided', async () => {
    process.env.SEED_KEY = 'the-real-secret';
    seedPlayer('lewie', { stick: 5, shoot: 3, dryland: 2, streak: 4, stickers: 7 });

    const res = makeRes();
    await handler(postWithKey({ player: 'lewie' }, 'the-real-secret'), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.reset).toBe('lewie');
    // Response reports the zeroed player.
    expect(res.body.player.stick).toBe(0);
    expect(res.body.player.shoot).toBe(0);
    expect(res.body.player.dryland).toBe(0);
    expect(res.body.player.streak).toBe(0);
    expect(res.body.player.stickers).toBe(0);

    // The store was actually mutated: counts zeroed, day + event history cleared.
    expect(fake.map.get('player:lewie').stick).toBe(0);
    expect(fake.map.get('player:lewie').shoot).toBe(0);
    expect(fake.map.has('days:lewie')).toBe(false);
    expect(fake.map.has('events:lewie')).toBe(false);
  });

  it('accepts the player id from the query string too (with a valid header key)', async () => {
    process.env.SEED_KEY = 'the-real-secret';
    seedPlayer('william', { stick: 9 });
    const res = makeRes();
    await handler({ method: 'POST', body: {}, query: { player: 'william' }, headers: { 'x-seed-key': 'the-real-secret' } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.reset).toBe('william');
    expect(fake.map.get('player:william').stick).toBe(0);
  });

  it('is case-insensitive on the player id', async () => {
    process.env.SEED_KEY = 'the-real-secret';
    seedPlayer('lewie', { stick: 4 });
    const res = makeRes();
    await handler(postWithKey({ player: 'Lewie' }, 'the-real-secret'), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.reset).toBe('lewie');
    expect(fake.map.get('player:lewie').stick).toBe(0);
  });
});
