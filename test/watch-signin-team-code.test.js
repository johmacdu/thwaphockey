// test/watch-signin-team-code.test.js
//
// Apple Watch sign-in step 5 (server):
//   - watch-request accepts { teamCode, code, deviceLabel } with no player id and
//     finds the ONE player on that team whose jersey code matches. Wrong team,
//     wrong code, unknown team and two players sharing a number are all the same
//     401. The older { playerId, code, teamCode? } shape still works.
//   - rate limits are counted before the lookup, including a per-team limit.
//   - the public team-players list is gone (team codes are not secret).
//   - GET /api/coach?action=my-game-goals accepts the watch session; a removed
//     watch is refused.
//   - the watch token is still refused by board, push, photo, look and coach
//     actions.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FakeRedis } from './fakeRedis.js';

const fake = new FakeRedis();
vi.mock('@upstash/redis', () => ({ Redis: class { constructor() { return fake; } } }));
vi.mock('@vercel/blob', () => ({ put: vi.fn(async () => ({ url: 'https://blob.example/x.png' })), del: vi.fn() }));

function setEnv() {
  process.env.KV_REST_API_URL = 'https://fake';
  process.env.KV_REST_API_TOKEN = 'fake';
  process.env.RESEND_API_KEY = 'rk_test';
  process.env.PHOTO_FROM_EMAIL = 'thwap@example.com';
  process.env.PHOTO_TOKEN_SECRET = 'test-secret-please-change';
  process.env.SESSION_TOKEN_SECRET = 'session-secret-please-change';
  process.env.BLOB_READ_WRITE_TOKEN = 'blob-test';
  delete process.env.SITE_URL;
}
setEnv();

const { default: loginHandler, _handlers: login } = await import('../api/login.js');
const { default: coachHandler, _handlers: coach } = await import('../api/coach.js');
const { default: boardHandler } = await import('../api/board.js');
const { default: pushHandler } = await import('../api/push.js');
const { default: photoRemove } = await import('../api/photo/remove.js');
const { mintSession, SESSION_COOKIE } = await import('../lib/session_store.js');
const { setTeam, addMember } = await import('../lib/teams_store.js');
const { findPlayerByTeamCode } = await import('../lib/signin_players.js');
const rl = await import('../lib/rate_limit.js');
const watch = await import('../lib/watch_store.js');

const PARENT = 'parent.lewie@example.com';
const ZARA_PARENT = 'parent.zara@example.com';
const IP = { 'x-real-ip': '203.0.113.7' };

function makeRes() {
  return {
    statusCode: 200, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
}
async function run(handler, req) { const res = makeRes(); await handler(req, res); return res; }
async function call(action, { method = 'GET', body, query = {}, headers = IP } = {}) {
  return run(loginHandler, { method, body, headers, query: { action, ...query } });
}
const cookie = (token) => ({ ...IP, cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` });
const ask = (body, headers = IP) => call('watch-request', { method: 'POST', body: { deviceLabel: 'Watch', ...body }, headers });

function sentEmails() {
  return global.fetch.mock.calls
    .filter((c) => String(c[0]).includes('resend'))
    .map((c) => JSON.parse(c[1].body));
}
const linkFrom = (mail, kind) => {
  const m = new RegExp(`/watch-approve#${kind}=([A-Za-z0-9._-]+)`).exec(mail.text);
  return m ? m[1] : null;
};

function seedLewie() {
  fake.map.set('teamMember:lewie', { parentEmails: [PARENT], parentEmail: PARENT, number: 72, firstName: 'Lewie' });
}
async function seedFlyers() {
  await setTeam('FLYERS10', { name: 'Flyers 9U', createdAt: new Date().toISOString() });
  await addMember('FLYERS10', { playerId: 'zara', firstName: 'Zara', lastName: 'Quinn', number: 44, parentEmails: [ZARA_PARENT] });
  await addMember('FLYERS10', { playerId: 'milo', firstName: 'Milo', lastName: 'Park', number: 8 });
}

// Full approval with the NEW shape; returns the watch token and manage link.
async function approvedWatch(body = { teamCode: 'RANGERS72', code: '722027' }) {
  const r = await ask(body);
  expect(r.statusCode).toBe(200);
  const t = linkFrom(sentEmails().at(-1), 't');
  const a = await call('watch-approve', { method: 'POST', body: { t, decision: 'approve' } });
  const s = await call('watch-status', { query: { requestId: r.body.requestId } });
  expect(s.body.status).toBe('approved');
  return { token: s.body.token, manage: a.body.manage, player: s.body.player };
}

beforeEach(() => {
  fake.map.clear();
  setEnv();
  vi.useRealTimers();
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
});
afterEach(() => { vi.useRealTimers(); });

describe('watch-request with team code + jersey code (no player id)', () => {
  it('finds the right Rangers player and emails their parent', async () => {
    seedLewie();
    const r = await ask({ teamCode: 'RANGERS72', code: '722027' });
    expect(r.statusCode).toBe(200);
    expect(r.body).toEqual({ ok: true, requestId: expect.any(String), sent: true });
    expect(sentEmails().map((m) => m.to[0])).toEqual([PARENT]);
    expect(sentEmails()[0].subject).toBe("Approve Lewie's watch for Thwap Hockey");
  });

  it('the prior season year works too', async () => {
    seedLewie();
    expect((await ask({ teamCode: 'RANGERS72', code: '722026' })).statusCode).toBe(200);
  });

  it('finds the right player on a non-Rangers team, approved token is for that player', async () => {
    await seedFlyers();
    const { token, player } = await approvedWatch({ teamCode: 'FLYERS10', code: '442027' });
    expect(player).toEqual({ id: 'zara', name: 'Zara', number: 44 });
    expect(sentEmails()[0].to).toEqual([ZARA_PARENT]);
    const sess = await call('session', { headers: cookie(token) });
    expect(sess.body).toEqual({ authed: true, player: { id: 'zara', name: 'Zara', number: 44 } });
  });

  it('the team code is case-insensitive', async () => {
    await seedFlyers();
    expect((await ask({ teamCode: 'flyers10', code: '442027' })).statusCode).toBe(200);
    seedLewie();
    expect((await ask({ teamCode: ' rangers72 ', code: '722027' })).statusCode).toBe(200);
  });

  it('wrong team, wrong code, unknown team and missing fields are the same 401, nothing sent', async () => {
    await seedFlyers();
    seedLewie();
    const cases = [
      { teamCode: 'FLYERS10', code: '722027' }, // Lewie's code, wrong team
      { teamCode: 'RANGERS72', code: '442027' }, // Zara's code, wrong team
      { teamCode: 'FLYERS10', code: '449999' }, // wrong season
      { teamCode: 'FLYERS10', code: '452027' }, // nobody wears 45
      { teamCode: 'NOPE99', code: '442027' }, // unknown team
      { teamCode: 'FLYERS10', code: '' },
      { teamCode: '', code: '442027' },
      { code: '442027' },
    ];
    for (const body of cases) {
      const r = await ask(body, { 'x-real-ip': '198.51.100.' + cases.indexOf(body) });
      expect(r.statusCode, JSON.stringify(body)).toBe(401);
      expect(r.body).toEqual({ error: 'bad code' });
    }
    expect(sentEmails()).toHaveLength(0);
  });

  it('two players with the same jersey number on one team: 401, never picks one', async () => {
    await seedFlyers();
    await addMember('FLYERS10', { playerId: 'ava', firstName: 'Ava', number: 44, parentEmails: ['ava.parent@example.com'] });
    const r = await ask({ teamCode: 'FLYERS10', code: '442027' });
    expect(r.statusCode).toBe(401);
    expect(r.body).toEqual({ error: 'bad code' });
    expect(sentEmails()).toHaveLength(0);
    expect(await findPlayerByTeamCode('FLYERS10', '442027')).toBe(null);
    // the other kid on the team is unaffected
    expect((await findPlayerByTeamCode('FLYERS10', '82027')).id).toBe('milo');
  });

  it('a new Rangers member wearing a ROSTER number makes that number ambiguous', async () => {
    seedLewie();
    await addMember('RANGERS72', { playerId: 'newkid', firstName: 'New', number: 72 });
    expect((await ask({ teamCode: 'RANGERS72', code: '722027' })).statusCode).toBe(401);
    expect(await findPlayerByTeamCode('RANGERS72', '712027')).toMatchObject({ id: 'alder' });
  });

  it('a player removed from the team members list cannot be found', async () => {
    await seedFlyers();
    fake.map.set('team:FLYERS10:members', ['milo']);
    expect((await ask({ teamCode: 'FLYERS10', code: '442027' })).statusCode).toBe(401);
  });

  it('the response never carries the player id, name or an address', async () => {
    seedLewie();
    const r = await ask({ teamCode: 'RANGERS72', code: '722027' });
    expect(Object.keys(r.body).sort()).toEqual(['ok', 'requestId', 'sent']);
    expect(JSON.stringify(r.body)).not.toMatch(/lewie|@/i);
  });
});

describe('watch-request older playerId shape still works', () => {
  it('playerId + code, with and without teamCode', async () => {
    seedLewie();
    expect((await ask({ playerId: 'lewie', code: '722027' })).statusCode).toBe(200);
    expect((await ask({ playerId: 'lewie', code: '722027', teamCode: 'rangers72' })).statusCode).toBe(200);
    expect((await ask({ playerId: 'lewie', code: '722027', teamCode: 'FLYERS10' }, { 'x-real-ip': '10.0.0.9' })).statusCode).toBe(401);
    expect((await ask({ playerId: 'alder', code: '722027' }, { 'x-real-ip': '10.0.0.9' })).statusCode).toBe(401); // Lewie's code on Alder
  });

  it('a playerId wins over team lookup: it is never re-resolved to someone else', async () => {
    await seedFlyers();
    // milo's id with zara's code on their shared team is still a bad code
    const r = await ask({ playerId: 'milo', code: '442027', teamCode: 'FLYERS10' });
    expect(r.statusCode).toBe(401);
  });
});

describe('watch-request rate limits', () => {
  it('per team: 20 per hour per team code, counted before the lookup', async () => {
    await seedFlyers();
    const codes = [];
    for (let i = 0; i < 21; i += 1) {
      // a fresh IP each time so only the team bucket can trip
      codes.push((await ask({ teamCode: i % 2 ? 'flyers10' : 'FLYERS10', code: `${100 + i}2027` }, { 'x-real-ip': `192.0.2.${i}` })).statusCode);
    }
    expect(codes.slice(0, 20).every((c) => c === 401)).toBe(true);
    expect(codes[20]).toBe(429);
    // even the right code is now refused for this team, with nothing revealed
    const right = await ask({ teamCode: 'FLYERS10', code: '442027' }, { 'x-real-ip': '192.0.2.200' });
    expect(right.statusCode).toBe(429);
    expect(right.body).toEqual({ error: 'too many requests, try again later' });
    // another team is not blocked
    seedLewie();
    expect((await ask({ teamCode: 'RANGERS72', code: '722027' }, { 'x-real-ip': '192.0.2.201' })).statusCode).toBe(200);
  });

  it('an unknown team is limited exactly like a real one (no existence leak)', async () => {
    await seedFlyers();
    const real = []; const ghost = [];
    for (let i = 0; i < 21; i += 1) {
      real.push((await ask({ teamCode: 'FLYERS10', code: '1' }, { 'x-real-ip': `198.18.0.${i}` })).statusCode);
      ghost.push((await ask({ teamCode: 'GHOST11', code: '1' }, { 'x-real-ip': `198.18.1.${i}` })).statusCode);
    }
    expect(ghost).toEqual(real);
  });

  it('per IP: 10 per hour, shared with the older shape', async () => {
    const codes = [];
    for (let i = 0; i < 6; i += 1) codes.push((await ask({ teamCode: 'T' + i, code: '1' })).statusCode);
    for (let i = 0; i < 5; i += 1) codes.push((await ask({ playerId: 'p' + i, code: '1' })).statusCode);
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes[10]).toBe(429);
  });

  it('per player: 3 per 15 minutes after a correct team + code, shared with the playerId shape', async () => {
    seedLewie();
    const codes = [];
    codes.push((await ask({ playerId: 'lewie', code: '722027' }, { 'x-real-ip': '10.1.0.1' })).statusCode);
    for (let i = 0; i < 3; i += 1) codes.push((await ask({ teamCode: 'RANGERS72', code: '722027' }, { 'x-real-ip': `10.1.0.${i + 2}` })).statusCode);
    expect(codes).toEqual([200, 200, 200, 429]);
    expect(sentEmails()).toHaveLength(3);
  });

  it('documents the team limit', () => {
    expect(rl.TEAM_LIMIT).toBe(20);
    expect(rl.TEAM_WINDOW_SEC).toBe(3600);
  });

  it('the team counter carries a TTL and stores no raw team code', async () => {
    await ask({ teamCode: 'FLYERS10', code: '1' });
    const keys = [...fake.map.keys()].filter((k) => k.startsWith('rl:watch-request:team:'));
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toMatch(/flyers/i);
    expect(await fake.ttl(keys[0])).toBeGreaterThan(0);
  });
});

describe('team-players is gone', () => {
  it('GET ?action=team-players is an unknown action (404), no names returned', async () => {
    await seedFlyers();
    const r = await call('team-players', { query: { code: 'FLYERS10' } });
    expect(r.statusCode).toBe(404);
    expect(r.body).toEqual({ error: 'unknown login action' });
    expect(JSON.stringify(r.body)).not.toMatch(/Zara|Milo/);
    expect(login.teamPlayers).toBeUndefined();
  });

  it('the public list helper is no longer exported', async () => {
    const mod = await import('../lib/signin_players.js');
    expect(mod.listTeamPlayersPublic).toBeUndefined();
  });
});

describe('my-game-goals accepts the watch session', () => {
  it('works with an approved watch token, for that player only', async () => {
    seedLewie();
    const { token } = await approvedWatch();
    const r = await run(coach.myGameGoals, { method: 'GET', query: {}, headers: cookie(token) });
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatchObject({ ok: true, playerId: 'lewie' });
    // via the router too
    const viaRouter = await run(coachHandler, { method: 'GET', query: { action: 'my-game-goals' }, headers: cookie(token) });
    expect(viaRouter.statusCode).toBe(200);
    // asking for someone else with a watch token is refused
    const other = await run(coach.myGameGoals, { method: 'GET', query: { playerId: 'alder' }, headers: cookie(token) });
    expect(other.statusCode).toBe(403);
  });

  it('a removed (revoked) watch token is refused with 401', async () => {
    seedLewie();
    const { token, manage } = await approvedWatch();
    const list = await call('watch-list', { query: { t: manage } });
    const deviceId = list.body.watches[0].deviceId;
    const rv = await call('watch-revoke', { method: 'POST', body: { t: manage, deviceId } });
    expect(rv.body).toEqual({ ok: true, removed: true });
    const r = await run(coach.myGameGoals, { method: 'GET', query: {}, headers: cookie(token) });
    expect(r.statusCode).toBe(401);
  });

  it('the web session still works, and no session is 401', async () => {
    const web = mintSession('lewie', PARENT);
    expect((await run(coach.myGameGoals, { method: 'GET', query: {}, headers: cookie(web) })).statusCode).toBe(200);
    expect((await run(coach.myGameGoals, { method: 'GET', query: {}, headers: IP })).statusCode).toBe(401);
  });

  it('save-game-goals stays web-session only', async () => {
    seedLewie();
    const { token } = await approvedWatch();
    const r = await run(coach.saveGameGoals, { method: 'POST', query: {}, body: { goalIds: [] }, headers: cookie(token) });
    expect(r.statusCode).toBe(401);
  });
});

describe('the watch token is refused everywhere else', () => {
  let token;
  beforeEach(async () => {
    seedLewie();
    ({ token } = await approvedWatch());
    // sanity: the token is live
    expect((await watch.sessionClaims({ headers: cookie(token) })).kind).toBe('watch');
  });

  it('board: cheer, fire and look writes are 401', async () => {
    for (const action of ['cheer', 'fire']) {
      const r = await run(boardHandler, { method: 'POST', query: { action }, body: { to: 'alder' }, headers: cookie(token) });
      expect(r.statusCode, action).toBe(401);
    }
    const look = await run(boardHandler, { method: 'POST', query: { action: 'look' }, body: { look: {} }, headers: cookie(token) });
    expect(look.statusCode).toBe(401);
    const lookGet = await run(boardHandler, { method: 'GET', query: { action: 'look' }, headers: cookie(token) });
    expect(lookGet.statusCode).toBe(401);
  });

  it('push: register and unregister are 401', async () => {
    for (const action of ['register', 'unregister']) {
      const r = await run(pushHandler, { method: 'POST', query: { action }, body: { token: 'fcm-abc', platform: 'ios' }, headers: cookie(token) });
      expect(r.statusCode, action).toBe(401);
    }
    const viaCoach = await run(coachHandler, { method: 'POST', query: { action: 'push-register' }, body: { token: 'fcm-abc' }, headers: cookie(token) });
    expect(viaCoach.statusCode).toBe(401);
  });

  it('photo: a watch token is not a parent photo token', async () => {
    const r = await run(photoRemove, {
      method: 'POST', query: {},
      body: { playerId: 'lewie' },
      headers: { ...cookie(token), authorization: `Bearer ${token}` },
    });
    expect(r.statusCode).toBe(401);
  });

  it('coach: roster hides parent emails from a watch, coach-token actions refuse it', async () => {
    await seedFlyers();
    // zara on a watch
    const z = await approvedWatch({ teamCode: 'FLYERS10', code: '442027' });
    const web = await run(coach.roster, { method: 'GET', query: { code: 'FLYERS10' }, headers: cookie(mintSession('zara', ZARA_PARENT)) });
    expect(web.body.members.find((m) => m.playerId === 'zara').parentEmails).toEqual([ZARA_PARENT]);
    const onWatch = await run(coach.roster, { method: 'GET', query: { code: 'FLYERS10' }, headers: cookie(z.token) });
    expect(onWatch.statusCode).toBe(200);
    expect(JSON.stringify(onWatch.body)).not.toContain('@');
    // a watch token passed where a coach token goes is refused
    const plan = await run(coachHandler, { method: 'POST', query: { action: 'set-plan' }, body: { coachToken: token, code: 'RANGERS72', plan: {} }, headers: cookie(token) });
    expect(plan.statusCode).toBe(401);
    const goal = await run(coachHandler, { method: 'GET', query: { action: 'my-game-goals', playerId: 'zara', coachToken: token }, headers: IP });
    expect(goal.statusCode).toBe(401);
  });
});
