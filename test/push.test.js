// test/push.test.js
//
// Unit tests for the push NOTIFICATION PLUMBING: lib/push_store.js (token store +
// injected sender) and api/push.js (session-gated register/unregister, admin-gated
// send, method/validation before auth), plus a frontend smoke that the Profile
// Notifications toggle exists and wireProfile references it.
//
// @upstash/redis is replaced with the in-memory FakeRedis so these are true unit
// tests (no network, no live store). The frontend block parses index.html.
//
// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { FakeRedis } from './fakeRedis.js';

// One shared fake; both push_store.js and the api modules capture it via new Redis().
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

// Import AFTER the mock + env are set.
const store = await import('../lib/push_store.js');
const { _handlers } = await import('../api/push.js');
const { mintSession } = await import('../lib/session_store.js');

function makeRes() {
  return {
    statusCode: 200, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
}
// A request carrying a valid player session cookie for `pid`.
function sessionReq(pid, body = {}, method = 'POST') {
  const token = mintSession(pid, `${pid}@example.com`);
  return { method, body, query: {}, headers: { cookie: `thwapSession=${token}` } };
}
const post = (body = {}, query = {}, headers = {}) => ({ method: 'POST', body, query, headers });

beforeEach(() => {
  fake.map.clear();
  setEnv();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('push_store token store', () => {
  it('registerToken stores a token and listTokens reads it back', async () => {
    await store.registerToken('lewie', { token: 'tok-1', platform: 'ios', ua: 'test-ua' });
    const toks = await store.listTokens('lewie');
    expect(toks.length).toBe(1);
    expect(toks[0].token).toBe('tok-1');
    expect(toks[0].platform).toBe('ios');
  });

  it('dedups by token (re-register refreshes, never duplicates)', async () => {
    await store.registerToken('lewie', { token: 'tok-1', platform: 'web' });
    await store.registerToken('lewie', { token: 'tok-1', platform: 'android' });
    const toks = await store.listTokens('lewie');
    expect(toks.length).toBe(1);
    expect(toks[0].platform).toBe('android'); // refreshed, moved to newest
  });

  it('caps at 10 newest tokens', async () => {
    for (let i = 0; i < 14; i += 1) {
      await store.registerToken('lewie', { token: `tok-${i}`, platform: 'web' });
    }
    const toks = await store.listTokens('lewie');
    expect(toks.length).toBe(10);
    // The oldest 4 are dropped; the newest (tok-13) survives.
    expect(toks.map((t) => t.token)).toContain('tok-13');
    expect(toks.map((t) => t.token)).not.toContain('tok-0');
  });

  it('normalizes an unknown platform to web', async () => {
    await store.registerToken('lewie', { token: 'tok-x', platform: 'symbian' });
    const toks = await store.listTokens('lewie');
    expect(toks[0].platform).toBe('web');
  });

  it('a blank token is ignored (no record stored)', async () => {
    await store.registerToken('lewie', { token: '   ', platform: 'web' });
    expect((await store.listTokens('lewie')).length).toBe(0);
  });

  it('unregisterToken removes a token; a missing token is a no-op', async () => {
    await store.registerToken('lewie', { token: 'tok-1', platform: 'web' });
    await store.registerToken('lewie', { token: 'tok-2', platform: 'web' });
    const after = await store.unregisterToken('lewie', 'tok-1');
    expect(after.map((t) => t.token)).toEqual(['tok-2']);
    const same = await store.unregisterToken('lewie', 'nope');
    expect(same.map((t) => t.token)).toEqual(['tok-2']);
  });

  it('listTokens is an empty array for a fresh player (never throws)', async () => {
    expect(await store.listTokens('nobody')).toEqual([]);
  });

  it('sendToTokens uses the INJECTED sender, not the network', async () => {
    const seen = [];
    const sender = async (tokens, payload) => { seen.push({ n: tokens.length, payload }); return { sent: tokens.length, failed: 0 }; };
    const result = await store.sendToTokens(
      [{ token: 'a' }, { token: 'b' }],
      { title: 'x' },
      { sender },
    );
    expect(result).toEqual({ sent: 2, failed: 0 });
    expect(seen).toEqual([{ n: 2, payload: { title: 'x' } }]);
  });

  it('sendToTokens short-circuits on an empty token list', async () => {
    let called = false;
    const sender = async () => { called = true; return { sent: 0, failed: 0 }; };
    const result = await store.sendToTokens([], { title: 'x' }, { sender });
    expect(result).toEqual({ sent: 0, failed: 0 });
    expect(called).toBe(false);
  });

  it('default sender is the mock (reports sent, no network) and pushConfigured is false', async () => {
    const result = await store.sendToTokens([{ token: 'a' }], { title: 'x' });
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(0);
    expect(store.pushConfigured()).toBe(false);
  });
});

describe('api/push register + unregister (player session-gated)', () => {
  it('register is 401 with no session', async () => {
    const res = makeRes();
    await _handlers.register(post({ token: 'tok-1', platform: 'web' }), res);
    expect(res.statusCode).toBe(401);
  });

  it('register stores a token keyed to the SESSION player, not the body', async () => {
    const res = makeRes();
    // Body tries to claim a different player; the session is lewie, so lewie wins.
    await _handlers.register(sessionReq('lewie', { token: 'tok-1', platform: 'ios', playerId: 'oliver' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.count).toBe(1);
    expect((await store.listTokens('lewie')).length).toBe(1);
    expect((await store.listTokens('oliver')).length).toBe(0);
  });

  it('register sets Cache-Control no-store', async () => {
    const res = makeRes();
    await _handlers.register(sessionReq('lewie', { token: 'tok-1' }), res);
    expect(res.headers['Cache-Control']).toBe('no-store');
  });

  it('unregister (session-gated) drops the token', async () => {
    await store.registerToken('lewie', { token: 'tok-1', platform: 'web' });
    const res = makeRes();
    await _handlers.unregister(sessionReq('lewie', { token: 'tok-1' }), res);
    expect(res.statusCode).toBe(200);
    expect((await store.listTokens('lewie')).length).toBe(0);
  });

  it('unregister is 401 with no session', async () => {
    const res = makeRes();
    await _handlers.unregister(post({ token: 'tok-1' }), res);
    expect(res.statusCode).toBe(401);
  });
});

describe('api/push send (admin-gated)', () => {
  it('is 401 without admin auth', async () => {
    const res = makeRes();
    await _handlers.send(post({ playerId: 'lewie', payload: { title: 'x' } }), res);
    expect(res.statusCode).toBe(401);
  });

  it('fans out via the mock to a player with the shared admin key', async () => {
    await store.registerToken('lewie', { token: 'tok-1', platform: 'web' });
    const res = makeRes();
    await _handlers.send(post(
      { playerId: 'lewie', payload: { title: 'x' } },
      { key: 'admin-test-token' },
    ), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.sent).toBe(1);
    expect(res.body.failed).toBe(0);
    expect(res.body.pushConfigured).toBe(false);
  });

  it('accepts the shared admin key as a Bearer token', async () => {
    const res = makeRes();
    const req = { method: 'POST', body: { playerId: 'lewie', payload: { title: 'x' } }, query: {}, headers: { authorization: 'Bearer admin-test-token' } };
    await _handlers.send(req, res);
    expect(res.statusCode).toBe(200);
  });

  it('rejects an unknown player (400, before auth)', async () => {
    const res = makeRes();
    await _handlers.send(post({ playerId: 'nobody', payload: { title: 'x' } }, { key: 'admin-test-token' }), res);
    expect(res.statusCode).toBe(400);
  });
});

describe('method + validation fire BEFORE auth (stored lesson)', () => {
  it('register rejects a non-POST method with 405 even with no session', async () => {
    const res = makeRes();
    await _handlers.register({ method: 'GET', body: {}, query: {}, headers: {} }, res);
    expect(res.statusCode).toBe(405);
  });

  it('register validates a missing token with 400 before the session check', async () => {
    const res = makeRes();
    await _handlers.register(post({}), res); // no token, no session
    expect(res.statusCode).toBe(400); // validation first, not 401
  });

  it('send validates a missing target with 400 before the admin check', async () => {
    const res = makeRes();
    await _handlers.send(post({ payload: { title: 'x' } }), res); // no playerId/team, no auth
    expect(res.statusCode).toBe(400); // validation first, not 401
  });

  it('send validates a missing payload with 400 before the admin check', async () => {
    const res = makeRes();
    await _handlers.send(post({ playerId: 'lewie' }), res); // no payload, no auth
    expect(res.statusCode).toBe(400); // validation first, not 401
  });
});

describe('index.html Notifications toggle (frontend smoke)', () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
  const doc = new DOMParser().parseFromString(html, 'text/html');

  it('has the Notifications toggle row in the Profile tab', () => {
    expect(doc.getElementById('profNotif')).toBeTruthy();
    expect(doc.getElementById('profNotifRow')).toBeTruthy();
  });

  it('wireProfile references profNotif', () => {
    expect(html).toContain("getElementById('profNotif')");
  });

  it('registration is runtime feature-detected via window.Capacitor, not a static import', () => {
    // The plugin is reached only through window.Capacitor.Plugins.PushNotifications
    // at runtime (so web/preview, which has no plugin, no-ops), never via a bundler
    // import. index.html ships no ES module graph, so a feature-detect is the only
    // correct path; assert the detection string is present.
    expect(html).toContain('Capacitor.Plugins.PushNotifications');
    // And the frontend never imports the package by module specifier.
    expect(html).not.toContain("from '@capacitor/push-notifications'");
    expect(html).not.toContain("import('@capacitor/push-notifications')");
  });
});
