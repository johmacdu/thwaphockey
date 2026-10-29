// test/web-signin-protection.test.js
//
// Web sign-in lock-down (api/login.js code-signin + verify). The player code is
// jersey number + season year, so it is guessable. These tests pin down that it
// is not enough on its own:
//   - code-signin is rate limited per IP, per team and per player, counted
//     before the lookup, and a 429 reveals nothing
//   - every failure (unknown player, wrong code, missing field) is the same 401
//   - a correct code on a NEW browser emails the parent a one-time code and does
//     NOT set a session; verify with that code does
//   - a browser the parent approved (remembered-device cookie) skips the parent
//   - a player with no parent email on file gets a distinct answer, only after
//     the code matched
//   - a browser that already holds a valid session keeps working
//   - watch-request is untouched

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

const { default: loginHandler } = await import('../api/login.js');
const sessionStore = await import('../lib/session_store.js');
const { verifySession, mintSession, SESSION_COOKIE } = sessionStore;
const rl = await import('../lib/rate_limit.js');

const PARENT = 'parent.lewie@example.com';
const PARENT2 = 'second.lewie@example.com';

function makeRes() {
  return {
    statusCode: 200, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
}
let ipSeq = 0;
const freshIp = () => ({ 'x-real-ip': `198.51.100.${(ipSeq += 1) % 250}` });
async function call(action, { method = 'POST', body = {}, headers } = {}) {
  const res = makeRes();
  await loginHandler({ method, body, query: { action }, headers: headers || freshIp() }, res);
  return res;
}
const signin = (body, headers) => call('code-signin', { body, headers });
const cookies = (res) => [].concat(res.headers['Set-Cookie'] || []);
const sessionTokenFrom = (res) => {
  const m = new RegExp(SESSION_COOKIE + '=([^;]*)').exec(cookies(res).join('\n'));
  return m ? decodeURIComponent(m[1]) : '';
};
const deviceCookieFrom = (res, pid) => {
  const name = sessionStore.deviceCookieName ? sessionStore.deviceCookieName(pid) : 'thwapDev_';
  const line = cookies(res).find((c) => c.startsWith(name + '='));
  return line ? line.split(';')[0] : '';
};
const sentEmails = () => global.fetch.mock.calls
  .filter((c) => String(c[0]).includes('resend'))
  .map((c) => JSON.parse(c[1].body));
const codeFrom = (mail) => (/code is: (\d{6})/.exec(mail.text) || [])[1];

function seedLewie(emails = [PARENT]) {
  fake.map.set('teamMember:lewie', {
    parentEmails: emails, parentEmail: emails[0] || '', parentEmail2: emails[1] || '',
    number: 72, firstName: 'Lewie',
  });
}

beforeEach(() => {
  fake.map.clear();
  setEnv();
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
});

describe('code-signin rate limits (same values as watch-request)', () => {
  it('uses the watch-request values', () => {
    expect([rl.PLAYER_LIMIT, rl.PLAYER_WINDOW_SEC]).toEqual([3, 900]);
    expect([rl.IP_LIMIT, rl.IP_WINDOW_SEC]).toEqual([10, 3600]);
    expect([rl.TEAM_LIMIT, rl.TEAM_WINDOW_SEC]).toEqual([20, 3600]);
  });

  it('per player: the 4th try in 15 minutes is 429, even from new IPs', async () => {
    const codes = [];
    for (let i = 0; i < 4; i += 1) codes.push((await signin({ playerId: 'lewie', code: '112027' })).statusCode);
    expect(codes).toEqual([401, 401, 401, 429]);
  });

  it('per IP: the 11th try in an hour is 429, even for different players', async () => {
    const ip = { 'x-real-ip': '203.0.113.9' };
    const codes = [];
    for (let i = 0; i < 11; i += 1) codes.push((await signin({ playerId: 'ghost' + i, code: '12027' }, ip)).statusCode);
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes[10]).toBe(429);
  });

  it('per team: the 21st try in an hour is 429, across players and IPs', async () => {
    const codes = [];
    for (let i = 0; i < 21; i += 1) codes.push((await signin({ playerId: 'ghost' + i, teamCode: 'flyers10', code: '12027' })).statusCode);
    expect(codes.slice(0, 20).every((c) => c === 401)).toBe(true);
    expect(codes[20]).toBe(429);
  });

  it('a request with no team code counts against the Jr. Rangers 10U team bucket', async () => {
    for (let i = 0; i < 20; i += 1) await signin({ playerId: 'ghost' + i, code: '12027' });
    const r = await signin({ playerId: 'lewie', teamCode: 'RANGERS72', code: '722027' });
    expect(r.statusCode).toBe(429);
  });

  it('a 429 reveals nothing: an unknown player and a real one get the same answer', async () => {
    seedLewie();
    let real; let ghost;
    for (let i = 0; i < 4; i += 1) {
      real = await signin({ playerId: 'lewie', code: '722027' });
      ghost = await signin({ playerId: 'ghost', code: '722027' });
    }
    expect(real.statusCode).toBe(429);
    expect(ghost.statusCode).toBe(429);
    expect(real.body).toEqual(ghost.body);
    expect(real.body).toEqual({ error: 'too many requests, try again later' });
  });

  it('counts before the lookup: limits are spent even when the player is unknown', async () => {
    await signin({ playerId: 'ghost', code: '12027' });
    const keys = [...fake.map.keys()].filter((k) => String(k).startsWith('rl:code-signin:'));
    expect(keys.length).toBe(3); // ip, team, pid
    expect(keys.join(' ')).not.toContain('198.51.100'); // the IP is hashed
  });
});

describe('one answer for every failure (no roster leak)', () => {
  it('unknown player, wrong code and missing fields all get the same 401', async () => {
    seedLewie();
    const answers = [
      await signin({ playerId: 'nobody', code: '722027' }),
      await signin({ playerId: 'lewie', code: '112027' }),
      await signin({ playerId: 'lewie' }),
      await signin({ code: '722027' }),
      await signin({}),
      await signin({ playerId: 'lewie', teamCode: 'FLYERS10', code: '722027' }),
    ];
    for (const r of answers) {
      expect(r.statusCode).toBe(401);
      expect(r.body).toEqual({ error: 'bad code' });
      expect(r.headers['Set-Cookie']).toBeUndefined();
    }
    expect(sentEmails()).toHaveLength(0);
  });

  it('verify answers an unknown player exactly like a player with no code pending', async () => {
    seedLewie();
    const ghost = await call('verify', { body: { playerId: 'nobody', code: '123456' } });
    const real = await call('verify', { body: { playerId: 'lewie', code: '123456' } });
    expect(ghost.statusCode).toBe(401);
    expect(ghost.body).toEqual(real.body);
  });
});

describe('a new device needs the parent', () => {
  it('a correct code on a new browser emails the parents on file and sets NO session', async () => {
    seedLewie([PARENT, PARENT2]);
    const r = await signin({ playerId: 'lewie', code: '722027', keep: true });
    expect(r.statusCode).toBe(200);
    expect(r.body.ok).toBe(false);
    expect(r.body.needsParentCode).toBe(true);
    expect(r.body.sent).toBe(true);
    expect(r.headers['Set-Cookie']).toBeUndefined();
    const mails = sentEmails();
    expect(mails.map((m) => m.to[0]).sort()).toEqual([PARENT, PARENT2].sort());
    expect(mails[0].subject).toBe('Lewie is signing in on a new device');
    expect(mails[0].text).toContain('Lewie is signing in to Thwap Hockey on a new device.');
    expect(mails[0].text).not.toMatch(/[\u2014\u2013\u00b7]/);
    expect(codeFrom(mails[0])).toMatch(/^\d{6}$/);
    // The answer never carries an address or how many parents are on file.
    expect(JSON.stringify(r.body)).not.toContain('@');
  });

  it('verify with the emailed code sets the session and remembers the browser', async () => {
    seedLewie();
    await signin({ playerId: 'lewie', code: '722027', keep: true });
    const v = await call('verify', { body: { playerId: 'lewie', code: codeFrom(sentEmails()[0]), keep: true } });
    expect(v.statusCode).toBe(200);
    expect(v.body.ok).toBe(true);
    const claims = verifySession(sessionTokenFrom(v));
    expect(claims && claims.playerId).toBe('lewie');
    const dev = deviceCookieFrom(v, 'lewie');
    expect(dev).toMatch(/^thwapDev_[0-9a-f]{16}=/);
    const line = cookies(v).find((c) => c.startsWith('thwapDev_'));
    expect(line).toContain('HttpOnly');
    expect(line).toContain('Path=/api/login');
    expect(line).toMatch(/Max-Age=2592000/);
  });

  it('a wrong parent code does not sign in', async () => {
    seedLewie();
    await signin({ playerId: 'lewie', code: '722027' });
    const good = codeFrom(sentEmails()[0]);
    const wrong = good === '000000' ? '111111' : '000000';
    const v = await call('verify', { body: { playerId: 'lewie', code: wrong } });
    expect(v.statusCode).toBe(401);
    expect(v.headers['Set-Cookie']).toBeUndefined();
  });

  it('keep off (a shared computer) signs in but never remembers the browser', async () => {
    seedLewie();
    await signin({ playerId: 'lewie', code: '722027', keep: false });
    const v = await call('verify', { body: { playerId: 'lewie', code: codeFrom(sentEmails()[0]), keep: false } });
    expect(v.statusCode).toBe(200);
    expect(cookies(v).some((c) => c.startsWith('thwapDev_'))).toBe(false);
  });

  it('quiet (the silent self-heal) never emails a parent or stores a code', async () => {
    seedLewie();
    const r = await signin({ playerId: 'lewie', code: '722027', quiet: true });
    expect(r.body).toEqual({ ok: false, needsParentCode: true, sent: false });
    expect(r.headers['Set-Cookie']).toBeUndefined();
    expect(sentEmails()).toHaveLength(0);
    expect(fake.map.has('otp:pid:lewie')).toBe(false);
  });
});

describe('a remembered device skips the parent step', () => {
  async function approve() {
    seedLewie();
    await signin({ playerId: 'lewie', code: '722027', keep: true });
    const v = await call('verify', { body: { playerId: 'lewie', code: codeFrom(sentEmails()[0]), keep: true } });
    global.fetch.mockClear();
    return deviceCookieFrom(v, 'lewie');
  }

  it('the same browser signs in with the player code alone, no email', async () => {
    const dev = await approve();
    const r = await signin({ playerId: 'lewie', code: '722027', keep: true }, { ...freshIp(), cookie: dev });
    expect(r.statusCode).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(verifySession(sessionTokenFrom(r)).playerId).toBe('lewie');
    expect(sentEmails()).toHaveLength(0);
  });

  it('still needs the right player code', async () => {
    const dev = await approve();
    const r = await signin({ playerId: 'lewie', code: '112027' }, { ...freshIp(), cookie: dev });
    expect(r.statusCode).toBe(401);
    expect(r.body).toEqual({ error: 'bad code' });
  });

  it('only covers the player the parent approved (a sibling still needs their parent)', async () => {
    const dev = await approve();
    fake.map.set('teamMember:brooklyn', { parentEmails: ['parent.b@example.com'], parentEmail: 'parent.b@example.com', number: 92, firstName: 'Brooklyn' });
    const r = await signin({ playerId: 'brooklyn', code: '922027' }, { ...freshIp(), cookie: dev.replace(/^[^=]+/, sessionStore.deviceCookieName('brooklyn')) });
    expect(r.body.needsParentCode).toBe(true);
    expect(r.headers['Set-Cookie']).toBeUndefined();
  });

  it('a forged or expired device cookie does not count', async () => {
    seedLewie();
    const name = sessionStore.deviceCookieName('lewie');
    const expired = sessionStore.mintDeviceToken('lewie', Date.now() - 31 * 24 * 3600 * 1000);
    for (const tok of [`${Date.now() + 1e9}.deadbeef`, expired]) {
      const r = await signin({ playerId: 'lewie', code: '722027' }, { ...freshIp(), cookie: `${name}=${tok}` });
      expect(r.body.needsParentCode).toBe(true);
      expect(r.headers['Set-Cookie']).toBeUndefined();
    }
  });
});

describe('no parent email on file', () => {
  it('a matching code answers needsParentEmail, with no session and no email', async () => {
    const r = await signin({ playerId: 'lewie', code: '722027' }); // ROSTER player, no member record
    expect(r.statusCode).toBe(200);
    expect(r.body).toEqual({ ok: false, needsParentEmail: true });
    expect(r.headers['Set-Cookie']).toBeUndefined();
    expect(sentEmails()).toHaveLength(0);
  });

  it('a wrong code never says needsParentEmail (it is only revealed after a match)', async () => {
    const r = await signin({ playerId: 'lewie', code: '112027' });
    expect(r.statusCode).toBe(401);
    expect(r.body).toEqual({ error: 'bad code' });
  });
});

describe('a browser with a valid session keeps working', () => {
  it('refreshes the session, sends no email and spends no rate limit', async () => {
    seedLewie();
    const tok = mintSession('lewie', PARENT);
    const headers = { 'x-real-ip': '203.0.113.50', cookie: `${SESSION_COOKIE}=${encodeURIComponent(tok)}` };
    for (let i = 0; i < 12; i += 1) {
      const r = await signin({ playerId: 'lewie', code: '722027', keep: true, quiet: true }, headers);
      expect(r.statusCode).toBe(200);
      expect(r.body.ok).toBe(true);
      const fresh = verifySession(sessionTokenFrom(r));
      expect(fresh.playerId).toBe('lewie');
      expect(fresh.emailHash).toBe(verifySession(tok).emailHash);
    }
    expect(sentEmails()).toHaveLength(0);
    expect([...fake.map.keys()].some((k) => String(k).startsWith('rl:code-signin:'))).toBe(false);
  });

  it('a session for a different player does not let you in as someone else', async () => {
    seedLewie();
    const tok = mintSession('brooklyn', 'b@example.com');
    const r = await signin({ playerId: 'lewie', code: '722027' }, { ...freshIp(), cookie: `${SESSION_COOKIE}=${tok}` });
    expect(r.body.needsParentCode).toBe(true);
    expect(r.headers['Set-Cookie']).toBeUndefined();
  });

  it('the session endpoint still accepts an existing session untouched', async () => {
    const tok = mintSession('lewie', PARENT);
    const r = await call('session', { method: 'GET', headers: { cookie: `${SESSION_COOKIE}=${tok}` } });
    expect(r.body.authed).toBe(true);
  });
});

describe('watch-request is untouched', () => {
  it('uses its own buckets: exhausting code-signin does not block watch-request', async () => {
    seedLewie();
    for (let i = 0; i < 4; i += 1) await signin({ playerId: 'lewie', code: '112027' });
    const w = await call('watch-request', { body: { teamCode: 'RANGERS72', code: '722027', deviceLabel: 'Apple Watch' } });
    expect(w.statusCode).toBe(200);
    expect(w.body.ok).toBe(true);
    expect([...fake.map.keys()].some((k) => String(k).startsWith('rl:watch-request:'))).toBe(true);
  });

  it('still answers a wrong code with 401 bad code', async () => {
    const w = await call('watch-request', { body: { teamCode: 'RANGERS72', code: '992027', deviceLabel: 'Apple Watch' } });
    expect(w.statusCode).toBe(401);
    expect(w.body).toEqual({ error: 'bad code' });
  });
});
