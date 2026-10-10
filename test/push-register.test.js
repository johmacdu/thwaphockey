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

const { _handlers } = await import('../api/coach.js');
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
  it('is POST-only', async () => {
    const res = makeRes();
    await _handlers.pushRegister({ method: 'GET', query: {}, headers: {} }, res);
    expect(res.statusCode).toBe(405);
  });

  it('400s without a token', async () => {
    const res = makeRes();
    await _handlers.pushRegister(post({ platform: 'ios' }), res);
    expect(res.statusCode).toBe(400);
  });

  it('registers a token and returns ok', async () => {
    const res = makeRes();
    await _handlers.pushRegister(post({ token: 'xyz', platform: 'ios', player: 'lewie' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(await fake.get('pushToken:xyz')).toBeTruthy();
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
