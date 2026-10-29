// test/hairstyle-grandfather.test.js
//
// Oct 28 2026: only Flow and Short are free; the other hair styles unlock
// through training. A kid who already wore a now-locked style keeps it: the
// look endpoint saves it to their grants once, so it is never taken away.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FakeRedis } from './fakeRedis.js';

const fake = new FakeRedis();
vi.mock('@upstash/redis', () => ({ Redis: class { constructor() { return fake; } } }));
function setEnv() {
  process.env.KV_REST_API_URL = 'https://fake';
  process.env.KV_REST_API_TOKEN = 'fake';
  process.env.PHOTO_TOKEN_SECRET = 'test-secret-please-change';
  process.env.SESSION_TOKEN_SECRET = 'session-secret-please-change';
}
setEnv();

const { handleLookGet } = await import('../lib/look_api.js');
const { setLook, getGrants } = await import('../lib/store.js');
const { mintSession, SESSION_COOKIE } = await import('../lib/session_store.js');

function makeRes() {
  return { statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(p) { this.body = p; return this; }, setHeader(k, v) { this.headers[k] = v; } };
}
async function look(id) {
  const res = makeRes();
  await handleLookGet({ method: 'GET', query: {}, headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(mintSession(id, 'p@example.com'))}` } }, res);
  return res.body;
}

beforeEach(() => { fake.map.clear(); setEnv(); });

describe('hair style grandfathering', () => {
  it('a kid already wearing Locs keeps Locs, and it is saved to grants', async () => {
    await setLook('lewie', { hairstyle: 'hairstyle-locs' });
    const j = await look('lewie');
    expect(j.look.hairstyle).toBe('hairstyle-locs');
    expect(j.unlocked).toContain('hairstyle-locs');
    expect(await getGrants('lewie')).toContain('hairstyle-locs');
  });
  it('a brand-new kid owns only Flow and Short', async () => {
    const j = await look('lewie'); // map is cleared, so no saved look yet
    expect(j.unlocked.filter((id) => id.startsWith('hairstyle-')).sort()).toEqual(['hairstyle-flow', 'hairstyle-short']);
  });
});
