// test/unauthenticated-endpoints.test.js
//
// Parent emails are a child's family contact details, and a player's game-goal
// log and monthly goal are theirs to write. These tests pin the access rules:
//   roster / join / player : no parent emails unless the caller is a coach who
//                            runs the team, an admin, or the signed-in player.
//   log-game-goal / set-idp-goal : need the thwapSession cookie for THAT player
//                            (401 with none, 403 for another player), or a coach
//                            who runs the player's team.

import { describe, it, expect, beforeEach, vi } from 'vitest';
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

const { _handlers, _seed } = await import('../api/coach.js');
const { mintSession, SESSION_COOKIE } = await import('../lib/session_store.js');
const { getGameGoalLog, getIdpGoal } = await import('../lib/teams_store.js');

function makeRes() {
  return {
    statusCode: 200, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
}
const post = (body, headers = {}) => ({ method: 'POST', body, query: {}, headers });
const get = (query, headers = {}) => ({ method: 'GET', query, headers });
const CODE = () => _seed.SEED_TEAM_CODE;
const cookieFor = (pid) => ({ cookie: `${SESSION_COOKIE}=${encodeURIComponent(mintSession(pid, `${pid}@example.com`))}` });

async function call(name, req) { const res = makeRes(); await _handlers[name](req, res); return res; }
async function headCoach() {
  return (await call('coachLogin', post({ email: _seed.SEED_COACH_EMAIL, password: _seed.SEED_COACH_PASSWORD }))).body.token;
}
async function stranger() {
  return (await call('coachRegister', post({ email: 'stranger@example.com', password: 'secret1', name: 'Stranger' }))).body.token;
}
async function seedEmails() {
  const t = await headCoach();
  await call('updatePlayer', post({ coachToken: t, code: CODE(), playerId: 'lewie', parentEmails: ['lewie.parent@example.com', 'lewie.two@example.com'] }));
  await call('updatePlayer', post({ coachToken: t, code: CODE(), playerId: 'alder', parentEmails: ['alder.parent@example.com'] }));
  return t;
}
// True when any email-shaped value or parent-email key is anywhere in the payload.
function leaksEmail(body) {
  const json = JSON.stringify(body);
  return /parent\.?(?:Email|email)[^"]*"\s*:\s*(?:"[^"]+"|\[\s*")/.test(json) || /lewie\.parent@|lewie\.two@|alder\.parent@/.test(json);
}

beforeEach(() => { fake.map.clear(); setEnv(); });

describe('roster', () => {
  it('unauthenticated: no parent emails anywhere in the response', async () => {
    await seedEmails();
    const res = await call('roster', get({ code: CODE() }));
    expect(res.statusCode).toBe(200);
    expect(res.body.members.length).toBeGreaterThan(0);
    expect(leaksEmail(res.body)).toBe(false);
    // fields the player UI renders are still there
    const lewie = res.body.members.find((m) => m.playerId === 'lewie');
    expect(lewie).toMatchObject({ firstName: expect.any(String), number: 72 });
    expect(lewie.week).toBeTruthy();
  });

  it('the team coach still gets every parent email the coach UI needs', async () => {
    const t = await seedEmails();
    const res = await call('roster', get({ code: CODE(), coachToken: t }));
    const by = (id) => res.body.members.find((m) => m.playerId === id).parentEmails;
    expect(by('lewie')).toEqual(['lewie.parent@example.com', 'lewie.two@example.com']);
    expect(by('alder')).toEqual(['alder.parent@example.com']);
  });

  it('an admin sees parent emails', async () => {
    await seedEmails();
    const res = await call('roster', get({ code: CODE() }, { authorization: 'Bearer admin-test-token' }));
    expect(res.body.members.find((m) => m.playerId === 'lewie').parentEmails).toEqual(['lewie.parent@example.com', 'lewie.two@example.com']);
  });
});

describe('join', () => {
  it('unauthenticated: player record has no email fields', async () => {
    await seedEmails();
    const res = await call('join', post({ code: CODE(), playerId: 'lewie' }));
    expect(res.statusCode).toBe(200);
    expect(res.body.player.number).toBe(72);
    expect(res.body.player.firstName).toBeTruthy();
    for (const k of ['parentEmail', 'parentEmail2', 'parentEmails']) expect(res.body.player).not.toHaveProperty(k);
    expect(leaksEmail(res.body)).toBe(false);
  });

  it('a coach from another team still gets no emails', async () => {
    await seedEmails();
    const res = await call('join', post({ code: CODE(), playerId: 'lewie', coachToken: await stranger() }));
    expect(leaksEmail(res.body)).toBe(false);
  });

  it('the team coach still gets the full record', async () => {
    const t = await seedEmails();
    const res = await call('join', post({ code: CODE(), playerId: 'lewie', coachToken: t }));
    expect(res.body.player.parentEmails).toEqual(['lewie.parent@example.com', 'lewie.two@example.com']);
  });
});

describe('player roll-up', () => {
  it('unauthenticated: member keeps position fields, loses emails', async () => {
    await seedEmails();
    const res = await call('playerRollup', get({ playerId: 'lewie' }));
    expect(res.statusCode).toBe(200);
    expect(res.body.member.number).toBe(72);
    expect(res.body.member).toHaveProperty('position');
    expect(leaksEmail(res.body)).toBe(false);
  });

  it('the signed-in player sees their own emails', async () => {
    await seedEmails();
    const res = await call('playerRollup', get({ playerId: 'lewie' }, cookieFor('lewie')));
    expect(res.body.member.parentEmails).toEqual(['lewie.parent@example.com', 'lewie.two@example.com']);
  });

  it('another signed-in player does not', async () => {
    await seedEmails();
    const res = await call('playerRollup', get({ playerId: 'lewie' }, cookieFor('alder')));
    expect(leaksEmail(res.body)).toBe(false);
  });
});

describe('log-game-goal', () => {
  const entry = { playerId: 'lewie', goalId: 'g1', goalTitle: 'Scan Twice', done: true, note: '' };

  it('no session: 401 and nothing written', async () => {
    await headCoach();
    const res = await call('logGoal', post(entry));
    expect(res.statusCode).toBe(401);
    expect(await getGameGoalLog('lewie')).toEqual([]);
  });

  it('signed in as a different player: 403 and nothing written', async () => {
    await headCoach();
    const res = await call('logGoal', post(entry, cookieFor('alder')));
    expect(res.statusCode).toBe(403);
    expect(await getGameGoalLog('lewie')).toEqual([]);
  });

  it('a coach from another team: 403', async () => {
    await headCoach();
    const res = await call('logGoal', post({ ...entry, coachToken: await stranger() }));
    expect(res.statusCode).toBe(403);
    expect(await getGameGoalLog('lewie')).toEqual([]);
  });

  it('the signed-in player writes their own log', async () => {
    await headCoach();
    const res = await call('logGoal', post(entry, cookieFor('lewie')));
    expect(res.statusCode).toBe(200);
    expect((await getGameGoalLog('lewie')).length).toBe(1);
  });

  it('the team coach may write it', async () => {
    const t = await headCoach();
    const res = await call('logGoal', post({ ...entry, coachToken: t }));
    expect(res.statusCode).toBe(200);
  });
});

describe('set-idp-goal', () => {
  it('no session: 401; other player: 403', async () => {
    await headCoach();
    expect((await call('setIdp', post({ playerId: 'lewie', text: 'x' }))).statusCode).toBe(401);
    expect((await call('setIdp', post({ playerId: 'lewie', text: 'x' }, cookieFor('alder')))).statusCode).toBe(403);
    expect(await getIdpGoal('lewie')).toBeFalsy();
  });

  it('own write is recorded as the player even if the body claims coach', async () => {
    await headCoach();
    const res = await call('setIdp', post({ playerId: 'lewie', text: 'Edges', setBy: 'coach' }, cookieFor('lewie')));
    expect(res.statusCode).toBe(200);
    expect(res.body.idpGoal.setBy).toBe('player');
  });

  it('the team coach writes as coach', async () => {
    const t = await headCoach();
    const res = await call('setIdp', post({ playerId: 'lewie', text: 'Edges', coachToken: t }));
    expect(res.statusCode).toBe(200);
    expect(res.body.idpGoal.setBy).toBe('coach');
  });
});
