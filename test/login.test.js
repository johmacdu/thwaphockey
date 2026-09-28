// test/login.test.js
//
// Tests for the parent sign-in endpoints. Redis is faked and fetch (Resend) is
// stubbed, mirroring test/photo.test.js. Covers: request-code validation and
// rate limiting, verify OTP -> session cookie, the session gate reading the
// cookie, logout clearing it, HMAC tamper/expiry rejection, and the fail-closed
// 503 path when the service is unconfigured.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FakeRedis } from './fakeRedis.js';

const fake = new FakeRedis();
vi.mock('@upstash/redis', () => ({ Redis: class { constructor() { return fake; } } }));

function setEnv() {
  process.env.KV_REST_API_URL = 'https://fake';
  process.env.KV_REST_API_TOKEN = 'fake';
  process.env.RESEND_API_KEY = 'rk_test';
  process.env.PHOTO_FROM_EMAIL = 'thwap@example.com';
  process.env.PHOTO_TOKEN_SECRET = 'test-secret-please-change';
  process.env.SESSION_TOKEN_SECRET = 'session-secret-please-change';
}
setEnv();

const { _handlers } = await import('../api/login.js');
const requestCode = _handlers.requestCode;
const verify = _handlers.verify;
const codeSignin = _handlers.codeSignin;
const session = _handlers.session;
const logout = _handlers.logout;
const { mintSession, verifySession, SESSION_COOKIE, SESSION_TTL_MS } = await import('../lib/session_store.js');

function makeRes() {
  return {
    statusCode: 200, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
}
const post = (body, headers = {}) => ({ method: 'POST', body, headers });
const get = (headers = {}) => ({ method: 'GET', headers });

beforeEach(() => {
  fake.map.clear();
  setEnv();
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
});

function codeFromLastEmail() {
  const call = global.fetch.mock.calls.at(-1);
  const sent = JSON.parse(call[1].body);
  const m = /code is: (\d{6})/.exec(sent.text);
  return m ? m[1] : null;
}

// Pull the session token out of a Set-Cookie header string.
function tokenFromSetCookie(setCookie) {
  const m = new RegExp(SESSION_COOKIE + '=([^;]*)').exec(setCookie || '');
  return m ? decodeURIComponent(m[1]) : '';
}

// Put a team member with on-file guardian emails into the fake store, so the
// OTP flow (which emails the parents ON FILE) has somewhere to send.
function seedMember(pid, emails, number = 72) {
  fake.map.set('teamMember:' + pid, {
    parentEmails: emails, parentEmail: emails[0] || '', parentEmail2: emails[1] || '',
    number, firstName: pid,
  });
}

describe('login request-code (OTP to on-file parents)', () => {
  it('rejects wrong method', async () => {
    const res = makeRes();
    await requestCode({ method: 'GET' }, res);
    expect(res.statusCode).toBe(405);
  });

  it('unknown player -> ok with sent:0 (no roster probing)', async () => {
    const res = makeRes();
    await requestCode(post({ playerId: 'nobody' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, sent: 0 });
  });

  it('player with no email on file -> ok with sent:0', async () => {
    const res = makeRes();
    await requestCode(post({ playerId: 'lewie' }), res); // not seeded
    expect(res.statusCode).toBe(200);
    expect(res.body.sent).toBe(0);
  });

  it('emails the code to EVERY on-file parent, keyed by player', async () => {
    seedMember('lewie', ['dad@x.com', 'mom@x.com']);
    const res = makeRes();
    await requestCode(post({ playerId: 'lewie' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.sent).toBe(2);
    const recipients = global.fetch.mock.calls.map((c) => JSON.parse(c[1].body).to[0]).sort();
    expect(recipients).toEqual(['dad@x.com', 'mom@x.com']);
    expect(codeFromLastEmail()).toMatch(/^\d{6}$/);
    // the OTP is stored keyed by the player, not by an email
    expect(fake.map.get('otp:pid:lewie')).toBeTruthy();
  });

  it('never emails a caller-supplied address', async () => {
    seedMember('lewie', ['dad@x.com']);
    const res = makeRes();
    await requestCode(post({ playerId: 'lewie', email: 'attacker@evil.com' }), res);
    const recipients = global.fetch.mock.calls.map((c) => JSON.parse(c[1].body).to[0]);
    expect(recipients).toEqual(['dad@x.com']);
    expect(recipients).not.toContain('attacker@evil.com');
  });

  it('rate-limits after the cap', async () => {
    seedMember('lewie', ['dad@x.com']);
    let last;
    for (let i = 0; i < 7; i += 1) {
      last = makeRes();
      await requestCode(post({ playerId: 'lewie' }), last);
    }
    expect(last.statusCode).toBe(429);
  });

  it('503 when email is not configured', async () => {
    delete process.env.RESEND_API_KEY;
    const res = makeRes();
    await requestCode(post({ playerId: 'lewie' }), res);
    expect(res.statusCode).toBe(503);
  });
});

describe('login verify (player-keyed OTP -> session)', () => {
  async function getCode(pid = 'lewie', emails = ['parent@e.com']) {
    seedMember(pid, emails);
    const r = makeRes();
    await requestCode(post({ playerId: pid }), r);
    return codeFromLastEmail();
  }

  it('rejects a wrong code', async () => {
    await getCode();
    const res = makeRes();
    await verify(post({ playerId: 'lewie', code: '000000' }), res);
    expect(res.statusCode).toBe(401);
  });

  it('sets an HTTP-only session cookie on a correct code', async () => {
    const code = await getCode();
    const res = makeRes();
    await verify(post({ playerId: 'lewie', code, keep: true }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.player.id).toBe('lewie');
    const sc = res.headers['Set-Cookie'];
    expect(sc).toContain(SESSION_COOKIE + '=');
    expect(sc).toContain('HttpOnly');
    expect(sc).toContain('SameSite=Lax');
    expect(sc).toMatch(/Max-Age=\d+/); // keep=true -> persistent
  });

  it('keep=false yields a session cookie (no Max-Age)', async () => {
    const code = await getCode();
    const res = makeRes();
    await verify(post({ playerId: 'lewie', code, keep: false }), res);
    expect(res.headers['Set-Cookie']).not.toMatch(/Max-Age=\d+/);
  });

  it('records consent (hashed) for the on-file parent', async () => {
    const code = await getCode('lewie', ['parent@e.com']);
    const res = makeRes();
    await verify(post({ playerId: 'lewie', code }), res);
    const consent = await fake.get('consent:lewie');
    expect(consent).toBeTruthy();
    expect(consent.emailHash).toBeTruthy();
    expect(JSON.stringify(consent)).not.toContain('parent@e.com');
  });
});

describe('login session gate', () => {
  it('reports not authed with no cookie', async () => {
    const res = makeRes();
    await session(get(), res);
    expect(res.body.authed).toBe(false);
  });

  it('reports authed for a valid cookie', async () => {
    const token = mintSession('lewie', 'p@e.com');
    const res = makeRes();
    await session(get({ cookie: `${SESSION_COOKIE}=${token}` }), res);
    expect(res.body.authed).toBe(true);
    expect(res.body.player.id).toBe('lewie');
  });

  it('rejects a tampered cookie', async () => {
    const token = mintSession('lewie', 'p@e.com') + 'x';
    const res = makeRes();
    await session(get({ cookie: `${SESSION_COOKIE}=${token}` }), res);
    expect(res.body.authed).toBe(false);
  });

  it('rejects an expired token', async () => {
    const past = Date.now() - SESSION_TTL_MS - 1000;
    const token = mintSession('lewie', 'p@e.com', past, 1);
    expect(verifySession(token)).toBeNull();
    const res = makeRes();
    await session(get({ cookie: `${SESSION_COOKIE}=${token}` }), res);
    expect(res.body.authed).toBe(false);
  });
});

describe('logout', () => {
  it('clears the cookie', async () => {
    const res = makeRes();
    await logout(post({}), res);
    expect(res.statusCode).toBe(200);
    const sc = res.headers['Set-Cookie'];
    expect(sc).toContain('Max-Age=0');
    expect(tokenFromSetCookie(sc)).toBe('');
  });
});

// Phase 1: server-verify the SAME jersey+year code the player types today, and
// issue the HTTP-only session cookie. Lewie is #72 -> "722027" (or "722026").
describe('login code-signin', () => {
  it('rejects non-POST', async () => {
    const res = makeRes();
    await codeSignin(get(), res);
    expect(res.statusCode).toBe(405);
  });

  it('rejects an unknown player', async () => {
    const res = makeRes();
    await codeSignin(post({ playerId: 'nobody', code: '722027' }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('unknown player');
  });

  it('rejects a wrong code', async () => {
    const res = makeRes();
    await codeSignin(post({ playerId: 'lewie', code: '112027' }), res);
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe('bad code');
  });

  it('sets an HTTP-only session cookie for the right code', async () => {
    const res = makeRes();
    await codeSignin(post({ playerId: 'lewie', code: '722027', email: 'p@example.com' }), res);
    expect(res.statusCode).toBe(200);
    const sc = res.headers['Set-Cookie'];
    expect(sc).toContain('HttpOnly');
    const claims = verifySession(tokenFromSetCookie(sc));
    expect(claims && claims.playerId).toBe('lewie');
  });

  it('accepts the prior season year too', async () => {
    const res = makeRes();
    await codeSignin(post({ playerId: 'lewie', code: '722026' }), res);
    expect(res.statusCode).toBe(200);
  });

  it('503 when sessions are not configured', async () => {
    delete process.env.SESSION_TOKEN_SECRET;
    delete process.env.PHOTO_TOKEN_SECRET;
    const res = makeRes();
    await codeSignin(post({ playerId: 'lewie', code: '722027' }), res);
    expect(res.statusCode).toBe(503);
  });
});
