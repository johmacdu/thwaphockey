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
  it('rejects a non-GET/POST method with 405', async () => {
    const res = makeRes();
    await handler({ method: 'DELETE' }, res);
    expect(res.statusCode).toBe(405);
  });

  it('400 on an unknown discipline', async () => {
    const res = makeRes();
    const token = mintSession('lewie', 'p@e.com');
    await handler(postAs({ player: 'lewie', discipline: 'skating' }, token), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('bad discipline');
  });

  it('400 on an unknown player', async () => {
    const res = makeRes();
    await handler(post({ player: 'nobody', discipline: 'stick' }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('unknown player');
  });

  it('200 and bumps the player with a valid session', async () => {
    const res = makeRes();
    const token = mintSession('lewie', 'parent@example.com');
    await handler(postAs({ player: 'lewie', discipline: 'stick' }, token), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.player.stick).toBe(1);
    // The bump persisted through the faked store.
    expect(fake.map.get('player:lewie').stick).toBe(1);
  });

  it('accepts a raw JSON string body (Vercel unparsed case)', async () => {
    const res = makeRes();
    const token = mintSession('lewie', 'p@e.com');
    await handler(postAs(JSON.stringify({ player: 'lewie', discipline: 'shoot' }), token), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.player.shoot).toBe(1);
  });

  it('is case-insensitive on the player id', async () => {
    const res = makeRes();
    const token = mintSession('lewie', 'p@e.com');
    await handler(postAs({ player: 'Lewie', discipline: 'dryland' }, token), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.player.dryland).toBe(1);
  });
});

// Phase 2 server-session gate: a valid session is REQUIRED and may only log its
// OWN player's work. No session -> 401; a session for a different player -> 403.
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

  it('a tampered session is rejected (401), no write', async () => {
    const res = makeRes();
    await handler(postAs({ player: 'lewie', discipline: 'shoot' }, 'not.a.real.token'), res);
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe('session required');
    expect(fake.map.get('player:lewie')).toBeUndefined();
  });

  it('no session at all is rejected (401)', async () => {
    const res = makeRes();
    await handler(post({ player: 'lewie', discipline: 'dryland' }), res);
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe('session required');
  });
});

// Position gate: a player may only log a discipline that applies to their
// position. Goalie (johnny, #1) trains Net play as the third discipline; a
// skater (lewie) trains Shooting. The server must refuse a mismatched write so a
// real kid's work can never be misfiled in the wrong slot.
describe('done handler: position gate', () => {
  it('a GOALIE can log netplay (200) and it lands in the netplay slot', async () => {
    const res = makeRes();
    const token = mintSession('johnny', 'parent@example.com');
    await handler(postAs({ player: 'johnny', discipline: 'netplay' }, token), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.player.netplay).toBe(1);
    expect(fake.map.get('player:johnny').netplay).toBe(1);
  });

  it('a GOALIE cannot log shoot (400), no write', async () => {
    const res = makeRes();
    const token = mintSession('johnny', 'parent@example.com');
    await handler(postAs({ player: 'johnny', discipline: 'shoot' }, token), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('discipline not for this position');
    expect(fake.map.get('player:johnny')).toBeUndefined();
  });

  it('a SKATER cannot log netplay (400), no write', async () => {
    const res = makeRes();
    const token = mintSession('lewie', 'parent@example.com');
    await handler(postAs({ player: 'lewie', discipline: 'netplay' }, token), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('discipline not for this position');
    expect(fake.map.get('player:lewie')).toBeUndefined();
  });

  it('a SKATER can log shoot (200)', async () => {
    const res = makeRes();
    const token = mintSession('lewie', 'parent@example.com');
    await handler(postAs({ player: 'lewie', discipline: 'shoot' }, token), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.player.shoot).toBe(1);
  });

  it('both positions can log the shared disciplines (stick, dryland)', async () => {
    for (const [pid, disc] of [['johnny', 'stick'], ['johnny', 'dryland'], ['lewie', 'stick']]) {
      const res = makeRes();
      const token = mintSession(pid, 'p@e.com');
      await handler(postAs({ player: pid, discipline: disc }, token), res);
      expect(res.statusCode).toBe(200);
    }
  });
});
