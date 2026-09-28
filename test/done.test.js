// test/done.test.js
//
// Unit tests for api/done.js: the mark-done handler (no PIN gate). The store is
// faked so a successful POST actually bumps the in-memory player. 
// number + SEASON_YEAR (default 2027). Lewie is #72 -> "722027".

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FakeRedis } from './fakeRedis.js';

const fake = new FakeRedis();
vi.mock('@upstash/redis', () => ({
  Redis: class {
    constructor() {
      return fake;
    }
  },
}));

// A signing secret so we can mint real session tokens for the gate tests.
process.env.SESSION_TOKEN_SECRET = 'test-session-secret';
const { default: handler } = await import('../api/done.js');
const { mintSession } = await import('../lib/session_store.js');

// Minimal Express-like res double capturing status + json payload.
function makeRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    setHeader(k, v) {
      this.headers[k] = v;
    },
  };
}

const post = (body) => ({ method: 'POST', body });
// POST carrying a session cookie, for the Phase 1 server-session gate.
const postAs = (body, token) => ({ method: 'POST', body, headers: { cookie: `thwapSession=${token}` } });

beforeEach(() => {
  fake.map.clear();
});

describe('done handler', () => {
  it('rejects non-POST with 405', async () => {
    const res = makeRes();
    await handler({ method: 'GET' }, res);
    expect(res.statusCode).toBe(405);
  });

  it('400 on an unknown discipline', async () => {
    const res = makeRes();
    await handler(post({ player: 'lewie', discipline: 'skating' }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('bad discipline');
  });

  it('400 on an unknown player', async () => {
    const res = makeRes();
    await handler(post({ player: 'nobody', discipline: 'stick' }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('unknown player');
  });

  it('200 and bumps the player with NO pin (logged-in player logs own work)', async () => {
    const res = makeRes();
    await handler(post({ player: 'lewie', discipline: 'stick' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.player.stick).toBe(1);
    // The bump persisted through the faked store.
    expect(fake.map.get('player:lewie').stick).toBe(1);
  });

  it('accepts a raw JSON string body (Vercel unparsed case)', async () => {
    const res = makeRes();
    await handler(post(JSON.stringify({ player: 'lewie', discipline: 'shoot' })), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.player.shoot).toBe(1);
  });

  it('is case-insensitive on the player id', async () => {
    const res = makeRes();
    await handler(post({ player: 'Lewie', pin: '722027', discipline: 'dryland' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.player.dryland).toBe(1);
  });
});

// Phase 1 server-session gate: a valid session may only log its OWN player's
// work; a session for someone else is refused; no session still works (the
// transitional client-side login path, so already-signed-in users are not broken).
describe('done handler: server-session gate', () => {
  it('a valid session logs its OWN work (200)', async () => {
    const res = makeRes();
    const token = mintSession('lewie', 'parent@example.com');
    await handler(postAs({ player: 'lewie', discipline: 'stick' }, token), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.player.stick).toBe(1);
  });

  it('a session cannot log work as a DIFFERENT player (403)', async () => {
    const res = makeRes();
    const token = mintSession('lewie', 'parent@example.com');
    await handler(postAs({ player: 'william', discipline: 'stick' }, token), res);
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe('not your account');
    // Nothing was written for the spoofed target.
    expect(fake.map.get('player:william')).toBeUndefined();
  });

  it('a tampered session is ignored, and the write still succeeds (legacy path)', async () => {
    const res = makeRes();
    await handler(postAs({ player: 'lewie', discipline: 'shoot' }, 'not.a.real.token'), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.player.shoot).toBe(1);
  });

  it('no session at all still works (transitional)', async () => {
    const res = makeRes();
    await handler(post({ player: 'lewie', discipline: 'dryland' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.player.dryland).toBe(1);
  });
});
