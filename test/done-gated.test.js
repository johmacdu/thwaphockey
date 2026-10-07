// test/done-gated.test.js
//
// Seasonal-billing server enforcement for the player's mark-done path in
// api/done.js. Mirrors test/coach.test.js + test/billing-endpoint.test.js: Redis
// is faked, @upstash/redis is mocked, and the handler is dynamically imported
// AFTER the mock so its module-load Redis clients use the fake.
//
// Enforcement must be a complete no-op unless BILLING_ENFORCED=1, must block a
// gated team's player from recording a completion (402), and must FAIL OPEN when
// the player's team can't be resolved.

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

process.env.SESSION_TOKEN_SECRET = 'test-session-secret';
const { default: handler } = await import('../api/done.js');
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

const postAs = (body, token) => ({ method: 'POST', body, headers: { cookie: `thwapSession=${token}` } });

beforeEach(() => {
  fake.map.clear();
  // Lewie is a seeded skater; put him on a team so his membership resolves.
  fake._seed('teamMember:lewie', { id: 'lewie', teamCode: 'RANGERS10U', firstName: 'Lewie', status: 'active' });
});

afterEach(() => {
  delete process.env.BILLING_ENFORCED;
});

describe('done handler: seasonal-billing gate', () => {
  it('blocks the mark write (402) when billing is enforced and the team is not active', async () => {
    process.env.BILLING_ENFORCED = '1';
    const res = makeRes();
    const token = mintSession('lewie', 'parent@example.com');
    await handler(postAs({ player: 'lewie', discipline: 'stick' }, token), res);
    expect(res.statusCode).toBe(402);
    expect(res.body).toMatchObject({ gated: true });
    // Nothing was recorded for the gated team's player.
    expect(fake.map.get('player:lewie')).toBeUndefined();
  });

  it('allows the mark write (200) with enforcement OFF (default)', async () => {
    const res = makeRes();
    const token = mintSession('lewie', 'parent@example.com');
    await handler(postAs({ player: 'lewie', discipline: 'stick' }, token), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.player.stick).toBe(1);
    expect(fake.map.get('player:lewie').stick).toBe(1);
  });

  it('FAILS OPEN (200) when enforced but the player has no resolvable team', async () => {
    // No membership record for this player -> teamCode indeterminate -> allow.
    fake.map.delete('teamMember:lewie');
    process.env.BILLING_ENFORCED = '1';
    const res = makeRes();
    const token = mintSession('lewie', 'parent@example.com');
    await handler(postAs({ player: 'lewie', discipline: 'stick' }, token), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.player.stick).toBe(1);
  });
});
