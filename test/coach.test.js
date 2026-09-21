// test/coach.test.js
//
// Tests for the coach + team + IDP router (api/coach.js). Redis is faked, session
// secrets set, mirroring test/login.test.js. Covers: seed + coach-login (good and
// bad password), coach-auth gate, create-team, add/remove player (kid identity is
// membership-only), roster with this-week participation, monthly IDP goal, and the
// game-day-goal check-off log.

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

const { _handlers, _seed } = await import('../api/coach.js');

function makeRes() {
  return {
    statusCode: 200, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
}
const post = (body, query = {}) => ({ method: 'POST', body, query, headers: {} });
const get = (query = {}) => ({ method: 'GET', query, headers: {} });

async function loginSeedCoach() {
  const res = makeRes();
  await _handlers.coachLogin(post({ email: _seed.SEED_COACH_EMAIL, password: _seed.SEED_COACH_PASSWORD }), res);
  return res;
}

beforeEach(() => {
  fake.map.clear();
  setEnv();
});

describe('coach-login + seed', () => {
  it('seeds Jr Rangers and logs the coach in with the right password', async () => {
    const res = await loginSeedCoach();
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.token).toBeTruthy();
    expect(res.body.coach.childPlayerId).toBe('alder');
    expect(res.body.coach.teams).toContain(_seed.SEED_TEAM_CODE);
  });

  it('rejects a wrong password', async () => {
    const res = makeRes();
    await _handlers.coachLogin(post({ email: _seed.SEED_COACH_EMAIL, password: 'wrong' }), res);
    expect(res.statusCode).toBe(401);
  });

  it('rejects a malformed email', async () => {
    const res = makeRes();
    await _handlers.coachLogin(post({ email: 'nope', password: 'x' }), res);
    expect(res.statusCode).toBe(400);
  });
});

describe('coach auth gate', () => {
  it('blocks create-team without a valid coach token', async () => {
    const res = makeRes();
    await _handlers.createTeam(post({ name: 'X' }), res);
    expect(res.statusCode).toBe(401);
  });
});

describe('roster + participation + kid-owned identity', () => {
  it('lists the seeded roster with participation and a member has a jersey number', async () => {
    await loginSeedCoach();
    const res = makeRes();
    await _handlers.roster(get({ code: _seed.SEED_TEAM_CODE }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.members.length).toBe(16);
    expect(res.body.participation.total).toBe(16);
    // No training seeded -> nobody trained this week.
    expect(res.body.participation.trained).toBe(0);
    const alder = res.body.members.find((m) => m.playerId === 'alder');
    expect(alder.number).toBe(71);
    expect(alder.lastName).toBe('Reese');
  });

  it('add-player then remove-player leaves the members set clean', async () => {
    const login = await loginSeedCoach();
    const token = login.body.token;
    const add = makeRes();
    await _handlers.addPlayer(post({ code: _seed.SEED_TEAM_CODE, coachToken: token, firstName: 'Testkid', number: 44 }), add);
    expect(add.statusCode).toBe(200);
    expect(add.body.member.status).toBe('active');

    let list = makeRes();
    await _handlers.roster(get({ code: _seed.SEED_TEAM_CODE }), list);
    expect(list.body.members.some((m) => m.playerId === 'testkid')).toBe(true);

    const rm = makeRes();
    await _handlers.removePlayer(post({ code: _seed.SEED_TEAM_CODE, coachToken: token, playerId: 'testkid' }), rm);
    expect(rm.statusCode).toBe(200);

    list = makeRes();
    await _handlers.roster(get({ code: _seed.SEED_TEAM_CODE }), list);
    expect(list.body.members.some((m) => m.playerId === 'testkid')).toBe(false);
  });
});

describe('IDP: monthly goal + game-goal log', () => {
  it('sets and reads a monthly personal goal', async () => {
    await loginSeedCoach();
    const setRes = makeRes();
    await _handlers.setIdp(post({ playerId: 'alder', text: 'Work on backward skating', setBy: 'player' }), setRes);
    expect(setRes.statusCode).toBe(200);
    expect(setRes.body.idpGoal.text).toBe('Work on backward skating');
    expect(setRes.body.idpGoal.setBy).toBe('player');

    const getRes = makeRes();
    await _handlers.idpGoal(get({ playerId: 'alder' }), getRes);
    expect(getRes.body.idpGoal.text).toBe('Work on backward skating');
  });

  it('logs a game-day-goal check-off with an optional note and reads it back', async () => {
    await loginSeedCoach();
    const logRes = makeRes();
    await _handlers.logGoal(post({ playerId: 'alder', goalId: 'g1', goalTitle: 'Scan Twice', done: true, note: 'Looked up before every pass' }), logRes);
    expect(logRes.statusCode).toBe(200);
    expect(logRes.body.entry.done).toBe(true);
    expect(logRes.body.entry.note).toBe('Looked up before every pass');

    const readRes = makeRes();
    await _handlers.gameGoalLogRead(get({ playerId: 'alder' }), readRes);
    expect(readRes.body.log.length).toBe(1);
    expect(readRes.body.log[0].goalTitle).toBe('Scan Twice');
  });

  it('the player roll-up returns base-week counts + goal + game-goal log', async () => {
    await loginSeedCoach();
    await _handlers.setIdp(post({ playerId: 'alder', text: 'Saucer passes', setBy: 'coach' }), makeRes());
    await _handlers.logGoal(post({ playerId: 'alder', goalId: 'g2', goalTitle: 'Change Speed', done: true }), makeRes());
    const res = makeRes();
    await _handlers.playerRollup(get({ playerId: 'alder' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.baseThisWeek).toEqual({ stick: 0, shoot: 0, dryland: 0 });
    expect(res.body.idpGoal.text).toBe('Saucer passes');
    expect(res.body.gameGoals.length).toBe(1);
  });
});

describe('join by team code', () => {
  it('lets a seeded player join and rejects an unknown code', async () => {
    await loginSeedCoach();
    const ok = makeRes();
    await _handlers.join(post({ code: _seed.SEED_TEAM_CODE, playerId: 'lewie' }), ok);
    expect(ok.statusCode).toBe(200);
    expect(ok.body.player.number).toBe(72);

    const bad = makeRes();
    await _handlers.join(post({ code: 'NOPE99', playerId: 'lewie' }), bad);
    expect(bad.statusCode).toBe(404);
  });
});

describe('team weekly plan', () => {
  it('defaults to all three categories every day when unset', async () => {
    await loginSeedCoach();
    const res = makeRes();
    await _handlers.getPlan(get({ code: _seed.SEED_TEAM_CODE }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.plan.mon).toEqual(['stick', 'shoot', 'dryland']);
    expect(res.body.plan.sun).toEqual(['stick', 'shoot', 'dryland']);
  });

  it('coach sets a plan and it reads back, ignoring unknown cats', async () => {
    const login = await loginSeedCoach();
    const token = login.body.token;
    const setRes = makeRes();
    await _handlers.setPlan(post({ code: _seed.SEED_TEAM_CODE, coachToken: token, plan: { mon: ['stick', 'bogus'], tue: [], wed: ['shoot', 'dryland'] } }), setRes);
    expect(setRes.statusCode).toBe(200);
    expect(setRes.body.plan.mon).toEqual(['stick']);   // bogus dropped
    expect(setRes.body.plan.tue).toEqual([]);            // an off day

    const getRes = makeRes();
    await _handlers.getPlan(get({ code: _seed.SEED_TEAM_CODE }), getRes);
    expect(getRes.body.plan.mon).toEqual(['stick']);
    expect(getRes.body.plan.wed).toEqual(['shoot', 'dryland']);
  });

  it('blocks set-plan without a coach token', async () => {
    await loginSeedCoach();
    const res = makeRes();
    await _handlers.setPlan(post({ code: _seed.SEED_TEAM_CODE, plan: { mon: [] } }), res);
    expect(res.statusCode).toBe(401);
  });
});
