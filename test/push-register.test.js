// test/push-register.test.js
//
// Guards for the native push-token registration added for the Capacitor iOS/
// Android shell:
//   - lib/teams_store.savePushToken stores the device record and indexes the
//     token under the signed-in player (capped), deduping a re-register;
//   - api/coach.js ?action=push-register is POST-only and 400s without a token;
//   - index.html inlines the native bridge that registers push and defines
//     window.thwapHaptic (a no-op in a plain browser).
// Redis is faked exactly like test/beta-banner.test.js.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { FakeRedis } from './fakeRedis.js';

const fake = new FakeRedis();
vi.mock('@upstash/redis', () => ({ Redis: class { constructor() { return fake; } } }));

function setEnv() {
  process.env.KV_REST_API_URL = 'https://fake';
  process.env.KV_REST_API_TOKEN = 'fake';
  process.env.PHOTO_TOKEN_SECRET = 'test-secret-please-change';
  process.env.SESSION_TOKEN_SECRET = 'session-secret-please-change';
  process.env.THWAP_ADMIN_TOKEN = 'admin-test-token';
}
setEnv();

const await_seed = await import('../api/coach.js');
const { _handlers } = await_seed;
const store = await import('../lib/teams_store.js');

function makeRes() {
  return {
    statusCode: 200, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
}
const post = (body = {}) => ({ method: 'POST', query: {}, headers: {}, body });

beforeEach(() => {
  fake.map.clear();
  setEnv();
});

describe('lib/teams_store.savePushToken', () => {
  it('stores the device record keyed by token', async () => {
    const r = await store.savePushToken({ token: 'abc123', platform: 'ios', player: 'lewie' });
    expect(r.ok).toBe(true);
    const rec = await fake.get('pushToken:abc123');
    expect(rec.token).toBe('abc123');
    expect(rec.platform).toBe('ios');
    expect(rec.player).toBe('lewie');
    expect(rec.updatedAt).toBeTruthy();
  });

  it('indexes the token under the player so a push can target their devices', async () => {
    await store.savePushToken({ token: 'tok-1', platform: 'android', player: 'Lewie' });
    const list = await fake.get('playerPush:lewie');
    expect(list).toEqual(['tok-1']);
  });

  it('dedupes a re-register of the same token (no pile-up)', async () => {
    await store.savePushToken({ token: 'tok-1', platform: 'ios', player: 'lewie' });
    await store.savePushToken({ token: 'tok-1', platform: 'ios', player: 'lewie' });
    const list = await fake.get('playerPush:lewie');
    expect(list).toEqual(['tok-1']);
  });

  it('accepts a token with no player (device registered before sign-in)', async () => {
    const r = await store.savePushToken({ token: 'anon-tok', platform: 'ios', player: '' });
    expect(r.ok).toBe(true);
    expect(await fake.get('pushToken:anon-tok')).toBeTruthy();
  });

  it('rejects a missing token', async () => {
    const r = await store.savePushToken({ token: '', platform: 'ios', player: 'lewie' });
    expect(r.ok).toBe(false);
  });
});

describe('api/coach.js ?action=push-register', () => {
  const { _seed } = await_seed;
  async function cookieFor(pid) {
    const { mintSession, SESSION_COOKIE } = await import('../lib/session_store.js');
    return `${SESSION_COOKIE}=${encodeURIComponent(mintSession(pid, `${pid}@example.com`))}`;
  }
  const withCookie = (req, cookie) => ({ ...req, headers: { ...(req.headers || {}), cookie } });
  async function seedCoachToken() {
    const r = makeRes();
    await _handlers.coachLogin(post({ email: _seed.SEED_COACH_EMAIL, password: _seed.SEED_COACH_PASSWORD }), r);
    return r.body.token;
  }
  async function strangerCoachToken() {
    const r = makeRes();
    await _handlers.coachRegister(post({ email: 'stranger@example.com', password: 'secret123', name: 'Stranger' }), r);
    return r.body.token;
  }

  it('is POST-only', async () => {
    const res = makeRes();
    await _handlers.pushRegister({ method: 'GET', query: {}, headers: {} }, res);
    expect(res.statusCode).toBe(405);
  });

  it('400s without a token', async () => {
    const res = makeRes();
    await _handlers.pushRegister(withCookie(post({ platform: 'ios' }), await cookieFor('lewie')), res);
    expect(res.statusCode).toBe(400);
  });

  it('401s without a session and writes nothing', async () => {
    const res = makeRes();
    await _handlers.pushRegister(post({ token: 'xyz', platform: 'ios', player: 'lewie' }), res);
    expect(res.statusCode).toBe(401);
    expect(await fake.get('pushToken:xyz')).toBeFalsy();
    expect(await fake.get('playerPush:lewie')).toBeFalsy();
  });

  it('403s when signed in as one player but linking another, and writes nothing', async () => {
    const res = makeRes();
    await _handlers.pushRegister(withCookie(post({ token: 'xyz', platform: 'ios', player: 'lewie' }), await cookieFor('alder')), res);
    expect(res.statusCode).toBe(403);
    expect(await fake.get('pushToken:xyz')).toBeFalsy();
    expect(await fake.get('playerPush:lewie')).toBeFalsy();
    expect(await fake.get('playerPush:alder')).toBeFalsy();
  });

  it('registers for the signed-in player (player taken from the session when the body omits it)', async () => {
    const res = makeRes();
    await _handlers.pushRegister(withCookie(post({ token: 'xyz', platform: 'ios' }), await cookieFor('lewie')), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect((await fake.get('pushToken:xyz')).player).toBe('lewie');
    expect(await fake.get('playerPush:lewie')).toEqual(['xyz']);
  });

  it('registers when the body player matches the session (the native bridge shape)', async () => {
    const res = makeRes();
    await _handlers.pushRegister(withCookie(post({ token: 'abc', platform: 'android', player: 'Lewie' }), await cookieFor('lewie')), res);
    expect(res.statusCode).toBe(200);
    expect(await fake.get('playerPush:lewie')).toEqual(['abc']);
  });

  it('lets a coach who runs the team register for a player on it', async () => {
    const coachToken = await seedCoachToken();
    const res = makeRes();
    await _handlers.pushRegister(post({ token: 'ctok', platform: 'ios', player: _seed.SEED_CHILD_PLAYER_ID, coachToken }), res);
    expect(res.statusCode).toBe(200);
    expect(await fake.get(`playerPush:${_seed.SEED_CHILD_PLAYER_ID}`)).toEqual(['ctok']);
  });

  it('403s a coach who does not run the player\'s team, and writes nothing', async () => {
    await seedCoachToken();
    const coachToken = await strangerCoachToken();
    const res = makeRes();
    await _handlers.pushRegister(post({ token: 'stok', platform: 'ios', player: _seed.SEED_CHILD_PLAYER_ID, coachToken }), res);
    expect(res.statusCode).toBe(403);
    expect(await fake.get('pushToken:stok')).toBeFalsy();
  });
});

describe('index.html native bridge (no-op on web, active in the shell)', () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');

  it('defines window.thwapHaptic so site code can call it unconditionally', () => {
    expect(html).toMatch(/window\.thwapHaptic\s*=\s*function/);
  });

  it('gates native behavior on Capacitor.isNativePlatform()', () => {
    expect(html).toMatch(/isNativePlatform/);
  });

  it('posts the device token to the current /api/push register endpoint', () => {
    expect(html).toMatch(/\/api\/push\?action=register/);
  });

  it('stashes the device token so the disable path can unregister it', () => {
    expect(html).toMatch(/thwapNotifToken/);
  });

  it('no longer auto-registers against the stale /api/coach push-register endpoint', () => {
    expect(html).not.toMatch(/action=push-register/);
  });
});
