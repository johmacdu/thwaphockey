// test/watch-approval.test.js
//
// Apple Watch parent approval (api/login.js watch-* actions, lib/watch_store.js,
// lib/rate_limit.js). Children's data, so the abuse paths get as much coverage as
// the happy path: token handed out once, approve links single use and expiring,
// Not me, revocation on session and done, rate limits on both emailed-code
// endpoints, no parent email or existence leak, secret entropy, a non-Rangers
// player, and the web sign-in left unchanged.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
  delete process.env.SITE_URL;
}
setEnv();

const { default: loginHandler, _handlers, watchEmailText } = await import('../api/login.js');
const { default: doneHandler } = await import('../api/done.js');
const { verifySession, mintSession, SESSION_COOKIE, mintDeviceToken, deviceCookieName } = await import('../lib/session_store.js');
const watch = await import('../lib/watch_store.js');
const rl = await import('../lib/rate_limit.js');
const { setTeam, addMember } = await import('../lib/teams_store.js');

const PARENT = 'parent.lewie@example.com';
const PARENT2 = 'second.lewie@example.com';
const IP = { 'x-real-ip': '203.0.113.7' };

function makeRes() {
  return {
    statusCode: 200, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
}
async function call(action, { method = 'GET', body, query = {}, headers = IP } = {}) {
  const res = makeRes();
  await loginHandler({ method, body, headers, query: { action, ...query } }, res);
  return res;
}
const cookie = (token) => ({ ...IP, cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` });

function seedMember(pid, emails, number = 72, extra = {}) {
  fake.map.set('teamMember:' + pid, {
    parentEmails: emails, parentEmail: emails[0] || '', parentEmail2: emails[1] || '',
    number, firstName: pid, ...extra,
  });
}

// Every email the stubbed Resend received, parsed.
function sentEmails() {
  return global.fetch.mock.calls
    .filter((c) => String(c[0]).includes('resend'))
    .map((c) => JSON.parse(c[1].body));
}
function linkFrom(mail, kind) {
  const m = new RegExp(`/watch-approve#${kind}=([A-Za-z0-9._-]+)`).exec(mail.text);
  return m ? m[1] : null;
}

async function requestWatch(extra = {}) {
  return call('watch-request', {
    method: 'POST',
    body: { playerId: 'lewie', code: '722027', deviceLabel: "Lewie's Apple Watch", ...extra },
  });
}

async function approveFlow() {
  seedMember('lewie', [PARENT]);
  const r = await requestWatch();
  const t = linkFrom(sentEmails().at(-1), 't');
  const a = await call('watch-approve', { method: 'POST', body: { t, decision: 'approve' } });
  const s = await call('watch-status', { query: { requestId: r.body.requestId } });
  return { r, t, a, s };
}

beforeEach(() => {
  fake.map.clear();
  setEnv();
  vi.useRealTimers();
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
});
afterEach(() => { vi.useRealTimers(); });

describe('watch-request', () => {
  it('rejects GET, and is 503 when email or sessions are not set up', async () => {
    expect((await call('watch-request')).statusCode).toBe(405);
    delete process.env.RESEND_API_KEY;
    expect((await requestWatch()).statusCode).toBe(503);
  });

  it('emails each parent on file an Approve link and a manage link, answers sent:true', async () => {
    seedMember('lewie', [PARENT, PARENT2]);
    const res = await requestWatch();
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, requestId: expect.any(String), sent: true });
    const mails = sentEmails();
    expect(mails.map((m) => m.to[0]).sort()).toEqual([PARENT, PARENT2].sort());
    expect(mails[0].subject).toBe("Approve Lewie's watch for Thwap Hockey");
    expect(linkFrom(mails[0], 't')).toBeTruthy();
    expect(linkFrom(mails[0], 'm')).toBeTruthy();
    expect(mails[0].text).toContain('https://thwaphockey.com/watch-approve#t=');
    // each parent gets their OWN approve token
    expect(linkFrom(mails[0], 't')).not.toBe(linkFrom(mails[1], 't'));
  });

  it('links point at SITE_URL, never at a forged Host header', async () => {
    seedMember('lewie', [PARENT]);
    await call('watch-request', {
      method: 'POST',
      headers: { ...IP, host: 'evil.example', 'x-forwarded-host': 'evil.example' },
      body: { playerId: 'lewie', code: '722027' },
    });
    expect(sentEmails()[0].text).not.toContain('evil.example');
  });

  it('a bad jersey code is 401 and sends nothing', async () => {
    seedMember('lewie', [PARENT]);
    const res = await requestWatch({ code: '999999' });
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'bad code' });
    expect(sentEmails()).toHaveLength(0);
  });

  it('an unknown player gets the same 401 as a bad code (no roster probing)', async () => {
    const unknown = await requestWatch({ playerId: 'nobody' });
    seedMember('lewie', [PARENT]);
    const bad = await requestWatch({ code: '000000' });
    expect(unknown.statusCode).toBe(bad.statusCode);
    expect(unknown.body).toEqual(bad.body);
  });

  it('no parent email on file -> sent:false, and never an address or a count', async () => {
    seedMember('lewie', []);
    const res = await requestWatch();
    expect(res.statusCode).toBe(200);
    expect(res.body.sent).toBe(false);
    expect(Object.keys(res.body).sort()).toEqual(['ok', 'requestId', 'sent']);
  });

  it('cleans the device label (no control characters, no angle brackets, 40 chars max)', async () => {
    expect(watch.cleanLabel('<script>x</script>\n\u0007Hi')).not.toMatch(/[<>\n\u0007]/);
    expect(watch.cleanLabel('x'.repeat(100))).toHaveLength(40);
    expect(watch.cleanLabel('')).toBe('Apple Watch');
    expect(watch.cleanLabel(null)).toBe('Apple Watch');
  });
});

describe('approval happy path', () => {
  it('request -> parent approves -> watch picks up a working 30-day token', async () => {
    const { r, t, a, s } = await approveFlow();
    expect(r.body.sent).toBe(true);
    expect(t).toBeTruthy();
    expect(a.body).toMatchObject({ ok: true, status: 'approved', player: { name: 'Lewie' }, deviceLabel: "Lewie's Apple Watch" });
    expect(typeof a.body.manage).toBe('string');
    expect(s.body.status).toBe('approved');
    expect(s.body.player).toEqual({ id: 'lewie', name: 'Lewie', number: 72 });
    const days = (s.body.exp - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);

    // The watch sends the token as a Cookie header (design doc section 5.3).
    const sess = await call('session', { headers: cookie(s.body.token) });
    expect(sess.body).toEqual({ authed: true, player: { id: 'lewie', name: 'Lewie', number: 72 } });

    // Consent is recorded through recordConsent, against the approving parent.
    const consent = fake.map.get('consent:lewie');
    expect(consent.method).toBe('email');
    expect(consent.emailHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('pending until the parent acts', async () => {
    seedMember('lewie', [PARENT]);
    const r = await requestWatch();
    const s = await call('watch-status', { query: { requestId: r.body.requestId } });
    expect(s.body).toEqual({ status: 'pending' });
  });

  it('the watch token checks off drills on /api/done (GET and POST)', async () => {
    const { s } = await approveFlow();
    const res = makeRes();
    await doneHandler({ method: 'POST', headers: cookie(s.body.token), body: { player: 'lewie', discipline: 'stick', drillId: 'stick:0', drillName: 'Figure 8' } }, res);
    expect(res.statusCode).toBe(200);
    const g = makeRes();
    await doneHandler({ method: 'GET', headers: cookie(s.body.token), query: {} }, g);
    expect(g.statusCode).toBe(200);
    expect(g.body.drills).toContain('stick:0');
  });

  it('the watch token cannot write for another player', async () => {
    seedMember('alder', ['a@example.com'], 7);
    const { s } = await approveFlow();
    const res = makeRes();
    await doneHandler({ method: 'POST', headers: cookie(s.body.token), body: { player: 'alder', discipline: 'stick', drillId: 'stick:0' } }, res);
    expect(res.statusCode).toBe(403);
  });
});

describe('token handed out once', () => {
  it('a second poll after pickup gets no token', async () => {
    const { r, s } = await approveFlow();
    expect(s.body.token).toBeTruthy();
    const again = await call('watch-status', { query: { requestId: r.body.requestId } });
    expect(again.body).toEqual({ status: 'expired' });
  });

  it('two polls at the same moment: only one gets the token', async () => {
    seedMember('lewie', [PARENT]);
    const r = await requestWatch();
    const t = linkFrom(sentEmails().at(-1), 't');
    await call('watch-approve', { method: 'POST', body: { t, decision: 'approve' } });
    const [a, b] = await Promise.all([
      call('watch-status', { query: { requestId: r.body.requestId } }),
      call('watch-status', { query: { requestId: r.body.requestId } }),
    ]);
    expect([a.body.token, b.body.token].filter(Boolean)).toHaveLength(1);
  });

  it('the raw watch token and raw requestId are never stored', async () => {
    const { r, t, s } = await approveFlow();
    const dump = JSON.stringify([...fake.map.entries()]);
    expect(dump).not.toContain(s.body.token);
    expect(dump).not.toContain(r.body.requestId);
    expect(dump).not.toContain(t);
  });

  it('an unknown requestId reads as expired', async () => {
    const s = await call('watch-status', { query: { requestId: watch.randomSecret() } });
    expect(s.body).toEqual({ status: 'expired' });
    const empty = await call('watch-status', { query: {} });
    expect(empty.body).toEqual({ status: 'expired' });
  });
});

describe('approve link', () => {
  it('GET only shows what is being approved and does NOT approve (email scanners)', async () => {
    seedMember('lewie', [PARENT]);
    const r = await requestWatch();
    const t = linkFrom(sentEmails().at(-1), 't');
    const peek = await call('watch-approve', { query: { t } });
    expect(peek.body).toMatchObject({ ok: true, status: 'pending', player: { name: 'Lewie' }, deviceLabel: "Lewie's Apple Watch" });
    expect(JSON.stringify(peek.body)).not.toContain('@');
    await call('watch-approve', { query: { t } });
    const s = await call('watch-status', { query: { requestId: r.body.requestId } });
    expect(s.body.status).toBe('pending');
  });

  it('is single use', async () => {
    const { t } = await approveFlow();
    const again = await call('watch-approve', { method: 'POST', body: { t, decision: 'approve' } });
    expect(again.body).toEqual({ ok: false, status: 'expired' });
    expect(fake.map.get('watch:lewie')).toHaveLength(1);
  });

  it('one parent approving burns the other parent\'s link', async () => {
    seedMember('lewie', [PARENT, PARENT2]);
    await requestWatch();
    const [m1, m2] = sentEmails();
    await call('watch-approve', { method: 'POST', body: { t: linkFrom(m1, 't'), decision: 'approve' } });
    const second = await call('watch-approve', { method: 'POST', body: { t: linkFrom(m2, 't'), decision: 'approve' } });
    expect(second.body.status).toBe('expired');
  });

  it('two parents tapping at the same moment approve only one watch', async () => {
    seedMember('lewie', [PARENT, PARENT2]);
    await requestWatch();
    const [m1, m2] = sentEmails();
    const [a, b] = await Promise.all([
      call('watch-approve', { method: 'POST', body: { t: linkFrom(m1, 't'), decision: 'approve' } }),
      call('watch-approve', { method: 'POST', body: { t: linkFrom(m2, 't'), decision: 'approve' } }),
    ]);
    expect([a.body.status, b.body.status].filter((x) => x === 'approved')).toHaveLength(1);
    expect(fake.map.get('watch:lewie')).toHaveLength(1);
  });

  it('expires after 15 minutes: no approval, and the watch sees expired', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-28T20:00:00Z') });
    seedMember('lewie', [PARENT]);
    const r = await requestWatch();
    const t = linkFrom(sentEmails().at(-1), 't');
    vi.setSystemTime(new Date('2026-10-28T20:15:01Z'));
    expect((await call('watch-approve', { query: { t } })).body.status).toBe('expired');
    expect((await call('watch-approve', { method: 'POST', body: { t, decision: 'approve' } })).body.status).toBe('expired');
    expect((await call('watch-status', { query: { requestId: r.body.requestId } })).body.status).toBe('expired');
    expect(fake.map.get('watch:lewie')).toBeUndefined();
  });

  it('still works at 14 minutes', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-28T20:00:00Z') });
    seedMember('lewie', [PARENT]);
    const r = await requestWatch();
    const t = linkFrom(sentEmails().at(-1), 't');
    vi.setSystemTime(new Date('2026-10-28T20:14:00Z'));
    expect((await call('watch-approve', { method: 'POST', body: { t, decision: 'approve' } })).body.status).toBe('approved');
    expect((await call('watch-status', { query: { requestId: r.body.requestId } })).body.status).toBe('approved');
  });

  it('refuses when the email it was sent to is no longer on file', async () => {
    seedMember('lewie', [PARENT]);
    await requestWatch();
    const t = linkFrom(sentEmails().at(-1), 't');
    seedMember('lewie', ['new.parent@example.com']);
    const a = await call('watch-approve', { method: 'POST', body: { t, decision: 'approve' } });
    expect(a.body.status).toBe('expired');
    expect(fake.map.get('consent:lewie')).toBeUndefined();
  });

  it('rejects a bad decision and a made-up token', async () => {
    seedMember('lewie', [PARENT]);
    await requestWatch();
    const t = linkFrom(sentEmails().at(-1), 't');
    expect((await call('watch-approve', { method: 'POST', body: { t, decision: 'yes' } })).statusCode).toBe(400);
    const fakeT = watch.randomSecret();
    expect((await call('watch-approve', { method: 'POST', body: { t: fakeT, decision: 'approve' } })).body.status).toBe('expired');
    expect((await call('watch-approve', { method: 'DELETE' })).statusCode).toBe(405);
  });
});

describe('Not me', () => {
  it('denies: the watch sees denied, gets no token, no consent is recorded', async () => {
    seedMember('lewie', [PARENT, PARENT2]);
    const r = await requestWatch();
    const [m1, m2] = sentEmails();
    const d = await call('watch-approve', { method: 'POST', body: { t: linkFrom(m1, 't'), decision: 'deny' } });
    expect(d.body).toEqual({ ok: true, status: 'denied' });
    const s = await call('watch-status', { query: { requestId: r.body.requestId } });
    expect(s.body).toEqual({ status: 'denied' });
    expect(fake.map.get('consent:lewie')).toBeUndefined();
    expect(fake.map.get('watch:lewie')).toBeUndefined();
    // the other parent's link is dead too
    const late = await call('watch-approve', { method: 'POST', body: { t: linkFrom(m2, 't'), decision: 'approve' } });
    expect(late.body.status).toBe('expired');
  });
});

describe('remove a watch', () => {
  it('the manage link lists the watch with no token hash, and Remove kills the session at once', async () => {
    const { s } = await approveFlow();
    const m = linkFrom(sentEmails().at(-1), 'm');
    const list = await call('watch-list', { query: { t: m } });
    expect(list.body.ok).toBe(true);
    expect(list.body.player).toEqual({ name: 'Lewie' });
    expect(list.body.watches).toHaveLength(1);
    expect(Object.keys(list.body.watches[0]).sort()).toEqual(['approvedAt', 'deviceId', 'exp', 'label']);

    const rv = await call('watch-revoke', { method: 'POST', body: { t: m, deviceId: list.body.watches[0].deviceId } });
    expect(rv.body).toEqual({ ok: true, removed: true });

    expect((await call('session', { headers: cookie(s.body.token) })).body).toEqual({ authed: false });
    const g = makeRes();
    await doneHandler({ method: 'GET', headers: cookie(s.body.token), query: {} }, g);
    expect(g.statusCode).toBe(401);
    const p = makeRes();
    await doneHandler({ method: 'POST', headers: cookie(s.body.token), body: { player: 'lewie', discipline: 'stick', drillId: 'stick:1' } }, p);
    expect(p.statusCode).toBe(401);
    expect((await call('watch-list', { query: { t: m } })).body.watches).toHaveLength(0);
  });

  it('the manage link returned on approval also works', async () => {
    const { a } = await approveFlow();
    expect((await call('watch-list', { query: { t: a.body.manage } })).body.watches).toHaveLength(1);
  });

  it('a manage link is signed: tampering with the player id fails', async () => {
    const { a } = await approveFlow();
    const forged = a.body.manage.replace(/^lewie\./, 'alder.');
    expect((await call('watch-list', { query: { t: forged } })).statusCode).toBe(401);
    expect((await call('watch-revoke', { method: 'POST', body: { t: forged, deviceId: '0'.repeat(32) } })).statusCode).toBe(401);
  });

  it('a manage link expires after 30 days', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-28T20:00:00Z') });
    const tok = watch.mintManageToken('lewie');
    expect(watch.verifyManageToken(tok)).toBeTruthy();
    vi.setSystemTime(new Date('2026-11-27T20:00:01Z'));
    expect(watch.verifyManageToken(tok)).toBeNull();
  });

  it('a watch token is not a manage link, and a manage link is not a session', async () => {
    const { a, s } = await approveFlow();
    expect((await call('watch-list', { query: { t: s.body.token } })).statusCode).toBe(401);
    expect((await call('session', { headers: cookie(a.body.manage) })).body).toEqual({ authed: false });
  });

  it('a watch removed between Approve and pickup never gets a token', async () => {
    seedMember('lewie', [PARENT]);
    const r = await requestWatch();
    const t = linkFrom(sentEmails().at(-1), 't');
    const a = await call('watch-approve', { method: 'POST', body: { t, decision: 'approve' } });
    const list = await call('watch-list', { query: { t: a.body.manage } });
    await call('watch-revoke', { method: 'POST', body: { t: a.body.manage, deviceId: list.body.watches[0].deviceId } });
    const s = await call('watch-status', { query: { requestId: r.body.requestId } });
    expect(s.body).toEqual({ status: 'denied' });
  });

  it('the watch signing out removes it from the list', async () => {
    const { a, s } = await approveFlow();
    await call('logout', { method: 'POST', headers: cookie(s.body.token) });
    expect((await call('session', { headers: cookie(s.body.token) })).body.authed).toBe(false);
    expect((await call('watch-list', { query: { t: a.body.manage } })).body.watches).toHaveLength(0);
  });

  it('rejects a malformed deviceId', async () => {
    const { a } = await approveFlow();
    expect((await call('watch-revoke', { method: 'POST', body: { t: a.body.manage, deviceId: '../x' } })).statusCode).toBe(400);
  });
});

describe('watch session token', () => {
  it('expires after 30 days on session and done', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-28T20:00:00Z') });
    const { s } = await approveFlow();
    vi.setSystemTime(new Date('2026-11-27T20:00:01Z'));
    expect((await call('session', { headers: cookie(s.body.token) })).body).toEqual({ authed: false });
    const g = makeRes();
    await doneHandler({ method: 'GET', headers: cookie(s.body.token), query: {} }, g);
    expect(g.statusCode).toBe(401);
  });

  it('a forged watch token (signed like a web session) is refused', async () => {
    await approveFlow();
    const dev = fake.map.get('watch:lewie')[0].deviceId;
    // Same shape, but signed the web-session way: must not pass either check.
    const forged = mintSession('lewie', 'x').split('.');
    const fakeTok = `lewie.w${dev}.${forged[2]}.${forged[3]}`;
    expect((await call('session', { headers: cookie(fakeTok) })).body.authed).toBe(false);
  });

  it('the plain web verifySession never accepts a watch token', async () => {
    const { s } = await approveFlow();
    expect(verifySession(s.body.token)).toBeNull();
  });

  it('a sixth watch drops the oldest', async () => {
    seedMember('lewie', [PARENT]);
    const tokens = [];
    for (let i = 0; i < 6; i += 1) {
      fake.map.delete([...fake.map.keys()].find((k) => k.startsWith('rl:watch-request:pid')));
      const r = await requestWatch({ deviceLabel: 'Watch ' + i });
      const t = linkFrom(sentEmails().at(-1), 't');
      await call('watch-approve', { method: 'POST', body: { t, decision: 'approve' } });
      tokens.push((await call('watch-status', { query: { requestId: r.body.requestId } })).body.token);
    }
    expect(fake.map.get('watch:lewie')).toHaveLength(5);
    expect((await call('session', { headers: cookie(tokens[0]) })).body.authed).toBe(false);
    expect((await call('session', { headers: cookie(tokens[5]) })).body.authed).toBe(true);
  });
});

describe('rate limits', () => {
  it('watch-request: 3 per player per 15 minutes, then 429 with nothing revealed', async () => {
    seedMember('lewie', [PARENT]);
    for (let i = 0; i < 3; i += 1) expect((await requestWatch()).statusCode).toBe(200);
    const res = await requestWatch();
    expect(res.statusCode).toBe(429);
    expect(res.body).toEqual({ error: 'too many requests, try again later' });
  });

  it('watch-request: the limit also caps jersey code guessing', async () => {
    seedMember('lewie', [PARENT]);
    for (let i = 0; i < 3; i += 1) await requestWatch({ code: '10' + i + '2027' });
    expect((await requestWatch()).statusCode).toBe(429); // even the right code
  });

  it('watch-request: the player window resets after 15 minutes', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-28T20:00:00Z') });
    seedMember('lewie', [PARENT]);
    for (let i = 0; i < 3; i += 1) await requestWatch();
    expect((await requestWatch()).statusCode).toBe(429);
    vi.setSystemTime(new Date('2026-10-28T20:15:01Z'));
    expect((await requestWatch()).statusCode).toBe(200);
  });

  it('watch-request: 10 per IP per hour across players', async () => {
    const ids = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'b1', 'b2'];
    const codes = [];
    for (const id of ids) codes.push((await requestWatch({ playerId: id })).statusCode);
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes[10]).toBe(429);
    // a different IP is not blocked
    const other = await call('watch-request', { method: 'POST', headers: { 'x-real-ip': '198.51.100.9' }, body: { playerId: 'b3', code: '1' } });
    expect(other.statusCode).toBe(401);
  });

  it('request-code: 3 per player per 15 minutes', async () => {
    seedMember('lewie', [PARENT]);
    const codes = [];
    for (let i = 0; i < 4; i += 1) codes.push((await call('request-code', { method: 'POST', body: { playerId: 'lewie' } })).statusCode);
    expect(codes).toEqual([200, 200, 200, 429]);
  });

  it('request-code: 10 per IP per hour', async () => {
    const codes = [];
    for (let i = 0; i < 11; i += 1) codes.push((await call('request-code', { method: 'POST', body: { playerId: 'ghost' + i } })).statusCode);
    expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true);
    expect(codes[10]).toBe(429);
  });

  it('request-code: an unknown player is limited exactly like a real one (no existence leak)', async () => {
    seedMember('lewie', [PARENT]);
    const real = []; const ghost = [];
    for (let i = 0; i < 4; i += 1) {
      real.push((await call('request-code', { method: 'POST', body: { playerId: 'lewie' }, headers: { 'x-real-ip': '10.0.0.1' } })).statusCode);
      ghost.push((await call('request-code', { method: 'POST', body: { playerId: 'ghost' }, headers: { 'x-real-ip': '10.0.0.2' } })).statusCode);
    }
    expect(ghost).toEqual(real);
  });

  it('counters carry a TTL and never store a raw IP', async () => {
    await requestWatch({ playerId: 'nobody' });
    const keys = [...fake.map.keys()].filter((k) => k.startsWith('rl:'));
    expect(keys.length).toBe(2);
    for (const k of keys) {
      expect(k).not.toContain('203.0.113.7');
      expect(await fake.ttl(k)).toBeGreaterThan(0);
    }
  });

  it('a counter that lost its TTL heals instead of locking out forever', async () => {
    const kv = fake;
    for (let i = 0; i < 4; i += 1) await rl.hit(kv, 'x', 'id', 3, 60);
    const key = [...fake.map.keys()].find((k) => k.startsWith('rl:x:'));
    fake.ttls.delete(key); // simulate a lost expire
    await rl.hit(kv, 'x', 'id', 3, 60);
    expect(await fake.ttl(key)).toBeGreaterThan(0);
  });

  it('documents the chosen values', () => {
    expect([rl.PLAYER_LIMIT, rl.PLAYER_WINDOW_SEC, rl.IP_LIMIT, rl.IP_WINDOW_SEC]).toEqual([3, 900, 10, 3600]);
  });
});

describe('no email address or existence leak in any response', () => {
  it('no response body in the whole flow carries an email address', async () => {
    seedMember('lewie', [PARENT, PARENT2]);
    const bodies = [];
    const r = await requestWatch(); bodies.push(r.body);
    const t = linkFrom(sentEmails()[0], 't');
    const m = linkFrom(sentEmails()[0], 'm');
    bodies.push((await call('watch-approve', { query: { t } })).body);
    const a = await call('watch-approve', { method: 'POST', body: { t, decision: 'approve' } }); bodies.push(a.body);
    bodies.push((await call('watch-status', { query: { requestId: r.body.requestId } })).body);
    bodies.push((await call('watch-list', { query: { t: m } })).body);
    bodies.push((await requestWatch({ code: 'nope' })).body);
    const all = JSON.stringify(bodies);
    expect(all).not.toContain('@');
    expect(all).not.toContain('example.com');
  });
});

describe('secret entropy', () => {
  it('requestId and approve tokens are 256-bit random, url-safe and unique', async () => {
    const seen = new Set();
    for (let i = 0; i < 200; i += 1) seen.add(watch.randomSecret());
    expect(seen.size).toBe(200);
    for (const s of seen) {
      expect(s).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes base64url
      expect(Buffer.from(s, 'base64url')).toHaveLength(32);
    }
    seedMember('lewie', [PARENT]);
    const r = await requestWatch();
    expect(Buffer.from(r.body.requestId, 'base64url').length * 8).toBeGreaterThanOrEqual(128);
    const t = linkFrom(sentEmails().at(-1), 't');
    expect(Buffer.from(t, 'base64url').length * 8).toBeGreaterThanOrEqual(128);
  });

  it('device ids are 128-bit random hex', async () => {
    await approveFlow();
    expect(fake.map.get('watch:lewie')[0].deviceId).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('non-Rangers team', () => {
  it('a Flyers player can ask, be approved and sign in on the watch', async () => {
    await setTeam('FLYERS10', { name: 'Flyers 9U', createdAt: new Date().toISOString() });
    await addMember('FLYERS10', { playerId: 'zara', firstName: 'Zara', lastName: 'Quinn', number: 44, parentEmails: ['parent.zara@example.com'] });
    const wrongTeam = await call('watch-request', { method: 'POST', body: { playerId: 'zara', code: '442027', teamCode: 'RANGERS72' } });
    expect(wrongTeam.statusCode).toBe(401);
    const r = await call('watch-request', { method: 'POST', body: { playerId: 'zara', code: '442027', teamCode: 'flyers10' } });
    expect(r.body.sent).toBe(true);
    expect(sentEmails()[0].to).toEqual(['parent.zara@example.com']);
    const t = linkFrom(sentEmails()[0], 't');
    await call('watch-approve', { method: 'POST', body: { t, decision: 'approve' } });
    const s = await call('watch-status', { query: { requestId: r.body.requestId } });
    expect(s.body.player).toEqual({ id: 'zara', name: 'Zara', number: 44 });
    expect((await call('session', { headers: cookie(s.body.token) })).body.authed).toBe(true);
  });
});

describe('web sign-in unchanged', () => {
  it('code-signin on a parent-approved browser still issues a normal web session that /session and /done accept', async () => {
    const dev = `${deviceCookieName('lewie')}=${mintDeviceToken('lewie')}`;
    const res = await call('code-signin', { method: 'POST', body: { playerId: 'lewie', code: '722027', keep: true }, headers: { ...IP, cookie: dev } });
    expect(res.statusCode).toBe(200);
    const tok = decodeURIComponent(/thwapSession=([^;]*)/.exec(res.headers['Set-Cookie'])[1]);
    expect(tok.split('.')[1]).toMatch(/^[0-9a-f]{64}$/); // email hash slot, not a watch id
    expect(verifySession(tok)).toBeTruthy();
    expect((await call('session', { headers: cookie(tok) })).body.authed).toBe(true);
    const g = makeRes();
    await doneHandler({ method: 'GET', headers: cookie(tok), query: {} }, g);
    expect(g.statusCode).toBe(200);
  });

  it('web logout does not touch any watch', async () => {
    const { a } = await approveFlow();
    const web = mintSession('lewie', PARENT);
    await call('logout', { method: 'POST', headers: cookie(web) });
    expect((await call('watch-list', { query: { t: a.body.manage } })).body.watches).toHaveLength(1);
  });
});

describe('parent email copy', () => {
  it('says what is approved, that ignoring it does nothing, and has no em-dashes or middots', () => {
    const text = watchEmailText({ name: 'Lewie', label: 'Apple Watch', approveUrl: 'https://x/a', manageUrl: 'https://x/m' });
    expect(text).toContain('Lewie wants to use Thwap Hockey on a watch');
    expect(text).toContain('Nothing happens unless you tap Approve');
    expect(text).not.toMatch(/[\u2014\u2013\u00b7]/);
  });
});
