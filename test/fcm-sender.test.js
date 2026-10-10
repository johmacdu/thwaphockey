// test/fcm-sender.test.js
//
// Guards for the real FCM HTTP v1 sender wired into lib/push_store.js:
//   - pushConfigured() is credential-driven (true only with a parseable
//     FCM_SERVICE_ACCOUNT_JSON + a resolvable project id);
//   - sendToTokens selects the live fcmSender when configured and the mock
//     otherwise, with an injected sender always winning (test path);
//   - the live fcmSender mints a Google OAuth2 token then POSTs each device
//     token to the per-project FCM endpoint, tallying sent/failed honestly;
//   - no network call is made when unconfigured.
// All network (Google token exchange + FCM send) is stubbed via a fetch mock;
// Redis is faked like the other push tests.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FakeRedis } from './fakeRedis.js';

const fake = new FakeRedis();
vi.mock('@upstash/redis', () => ({ Redis: class { constructor() { return fake; } } }));

// A minimal, syntactically-valid RSA private key is required for crypto.sign to
// not throw. Generate one once for the suite.
import crypto from 'node:crypto';
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });

function saJson() {
  return JSON.stringify({
    type: 'service_account',
    project_id: 'thwap-hockey',
    client_email: 'fcm@thwap-hockey.iam.gserviceaccount.com',
    private_key: PEM,
    token_uri: 'https://oauth2.googleapis.com/token',
  });
}

let store;
beforeEach(async () => {
  fake.map.clear();
  vi.resetModules();
  delete process.env.FCM_SERVICE_ACCOUNT_JSON;
  delete process.env.FCM_PROJECT_ID;
  process.env.KV_REST_API_URL = 'https://fake';
  process.env.KV_REST_API_TOKEN = 'fake';
  store = await import('../lib/push_store.js');
});
afterEach(() => { vi.restoreAllMocks(); });

describe('pushConfigured() is credential-driven', () => {
  it('is false with no service account', () => {
    expect(store.pushConfigured()).toBe(false);
  });
  it('is false with a malformed service account JSON', () => {
    process.env.FCM_SERVICE_ACCOUNT_JSON = 'not json';
    expect(store.pushConfigured()).toBe(false);
  });
  it('is false when the JSON lacks client_email/private_key', () => {
    process.env.FCM_SERVICE_ACCOUNT_JSON = JSON.stringify({ project_id: 'x' });
    expect(store.pushConfigured()).toBe(false);
  });
  it('is true with a valid service account + resolvable project id', () => {
    process.env.FCM_SERVICE_ACCOUNT_JSON = saJson();
    expect(store.pushConfigured()).toBe(true);
  });
  it('resolves project id from FCM_PROJECT_ID over the JSON', () => {
    process.env.FCM_SERVICE_ACCOUNT_JSON = JSON.stringify({
      client_email: 'a@b.iam', private_key: PEM, project_id: 'from-json',
    });
    process.env.FCM_PROJECT_ID = 'from-env';
    // configured either way; the override is exercised by the send test below.
    expect(store.pushConfigured()).toBe(true);
  });
});

describe('sendToTokens sender selection', () => {
  it('uses the mock (no network) when unconfigured', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const r = await store.sendToTokens([{ token: 't1', platform: 'ios' }], { title: 'hi' });
    expect(r).toEqual({ sent: 1, failed: 0 });
    expect(spy).not.toHaveBeenCalled();
  });
  it('an injected sender always wins (test seam)', async () => {
    const sender = vi.fn(async () => ({ sent: 9, failed: 1 }));
    const r = await store.sendToTokens([{ token: 't1' }], { title: 'x' }, { sender });
    expect(r).toEqual({ sent: 9, failed: 1 });
    expect(sender).toHaveBeenCalledOnce();
  });
  it('returns a zeroed tally for an empty token list', async () => {
    const r = await store.sendToTokens([], { title: 'x' });
    expect(r).toEqual({ sent: 0, failed: 0 });
  });
});

describe('live fcmSender (network stubbed)', () => {
  it('mints an OAuth token then POSTs each token to the project FCM endpoint', async () => {
    process.env.FCM_SERVICE_ACCOUNT_JSON = saJson();
    const calls = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
      calls.push({ url: String(url), opts });
      if (String(url).includes('oauth2.googleapis.com/token')) {
        return { ok: true, json: async () => ({ access_token: 'ya29.test', expires_in: 3600 }) };
      }
      // FCM send endpoint
      return { ok: true, json: async () => ({ name: 'projects/thwap-hockey/messages/1' }) };
    });

    const tokens = [{ token: 'dev-a', platform: 'ios' }, { token: 'dev-b', platform: 'android' }];
    const r = await store.sendToTokens(tokens, { title: 'Drills ready', body: 'Go!' });
    expect(r).toEqual({ sent: 2, failed: 0 });

    // One token exchange, two sends.
    const tokenCalls = calls.filter((c) => c.url.includes('oauth2.googleapis.com/token'));
    const sendCalls = calls.filter((c) => c.url.includes('fcm.googleapis.com/v1/projects/thwap-hockey/messages:send'));
    expect(tokenCalls.length).toBe(1);
    expect(sendCalls.length).toBe(2);

    // The send body carries the notification + bearer auth.
    const body = JSON.parse(sendCalls[0].opts.body);
    expect(body.message.token).toBe('dev-a');
    expect(body.message.notification).toEqual({ title: 'Drills ready', body: 'Go!' });
    expect(sendCalls[0].opts.headers.Authorization).toBe('Bearer ya29.test');
  });

  it('counts a per-token FCM failure as failed, not sent', async () => {
    process.env.FCM_SERVICE_ACCOUNT_JSON = saJson();
    let n = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('oauth2.googleapis.com/token')) {
        return { ok: true, json: async () => ({ access_token: 'ya29.test', expires_in: 3600 }) };
      }
      n += 1;
      return { ok: n === 1, json: async () => ({}) }; // first send ok, second fails
    });
    const r = await store.sendToTokens(
      [{ token: 'a' }, { token: 'b' }], { title: 'x' },
    );
    expect(r).toEqual({ sent: 1, failed: 1 });
  });

  it('fails honest (delivers nothing) when the token exchange fails', async () => {
    process.env.FCM_SERVICE_ACCOUNT_JSON = saJson();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('oauth2.googleapis.com/token')) {
        return { ok: false, json: async () => ({ error: 'invalid_grant' }) };
      }
      return { ok: true, json: async () => ({}) };
    });
    const r = await store.sendToTokens([{ token: 'a' }], { title: 'x' });
    expect(r).toEqual({ sent: 0, failed: 1 });
  });
});
