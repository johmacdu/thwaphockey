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
  process.env.THWAP_ADMIN_TOKEN = 'admin-test-token';
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

  it('seeds three demo teams and returns a named teamList', async () => {
    const res = await loginSeedCoach();
    expect(res.body.coach.teams.length).toBe(3);
    expect(res.body.coach.teams).toEqual(expect.arrayContaining(['RANGERS72', 'RANGERS8U', 'RANGERS12U']));
    // The 10U team is first so teams[0] (the landing team) is deterministic:
    // every login lands on the same coach experience regardless of seed order.
    expect(res.body.coach.teams[0]).toBe(_seed.SEED_TEAM_CODE);
    const names = (res.body.coach.teamList || []).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['Jr Rangers 10U', 'Jr Rangers 8U', 'Jr Rangers 12U']));
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
    await _handlers.addPlayer(post({ code: _seed.SEED_TEAM_CODE, coachToken: token, firstName: 'Testkid', number: 44, parentEmail: 'parent@example.com' }), add);
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
  it('defaults to empty categories every day when unset', async () => {
    await loginSeedCoach();
    const res = makeRes();
    await _handlers.getPlan(get({ code: _seed.SEED_TEAM_CODE }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.plan.mon).toEqual({});
    expect(res.body.plan.sun).toEqual({});
  });

  it('coach sets a legacy on/off plan and it migrates to the drill-list shape', async () => {
    const login = await loginSeedCoach();
    const token = login.body.token;
    const setRes = makeRes();
    await _handlers.setPlan(post({ code: _seed.SEED_TEAM_CODE, coachToken: token, plan: { mon: ['stick', 'bogus'], tue: [], wed: ['shoot', 'dryland'] } }), setRes);
    expect(setRes.statusCode).toBe(200);
    expect(setRes.body.plan.mon).toEqual({ stick: [] });   // bogus dropped, category on
    expect(setRes.body.plan.tue).toEqual({});               // an off day

    const getRes = makeRes();
    await _handlers.getPlan(get({ code: _seed.SEED_TEAM_CODE }), getRes);
    expect(getRes.body.plan.mon).toEqual({ stick: [] });
    expect(getRes.body.plan.wed).toEqual({ shoot: [], dryland: [] });
  });

  it('coach sets per-category drill lists and they read back, unknown cats dropped', async () => {
    const login = await loginSeedCoach();
    const token = login.body.token;
    const setRes = makeRes();
    await _handlers.setPlan(post({
      code: _seed.SEED_TEAM_CODE, coachToken: token,
      plan: { wed: { shoot: ['Wrist Shots', 'Snap Shots'], stick: ['Toe Drag & Rescue'], bogus: ['x'] }, mon: {} },
    }), setRes);
    expect(setRes.statusCode).toBe(200);
    expect(setRes.body.plan.wed.shoot).toEqual(['Wrist Shots', 'Snap Shots']);
    expect(setRes.body.plan.wed.stick).toEqual(['Toe Drag & Rescue']);
    expect(setRes.body.plan.wed.bogus).toBeUndefined();

    const getRes = makeRes();
    await _handlers.getPlan(get({ code: _seed.SEED_TEAM_CODE }), getRes);
    expect(getRes.body.plan.wed.shoot).toEqual(['Wrist Shots', 'Snap Shots']);
  });

  it('blocks set-plan without a coach token', async () => {
    await loginSeedCoach();
    const res = makeRes();
    await _handlers.setPlan(post({ code: _seed.SEED_TEAM_CODE, plan: { mon: [] } }), res);
    expect(res.statusCode).toBe(401);
  });
});

describe('drill suggestions (coach -> Thwap backlog)', () => {
  it('coach suggests a drill and it reads back, newest first', async () => {
    const login = await loginSeedCoach();
    const token = login.body.token;
    const s1 = makeRes();
    await _handlers.suggestDrill(post({ code: _seed.SEED_TEAM_CODE, coachToken: token, category: 'shoot', text: 'One-timer off a pass' }), s1);
    expect(s1.statusCode).toBe(200);
    expect(s1.body.suggestion.category).toBe('shoot');
    expect(s1.body.suggestion.status).toBe('new');

    const listRes = makeRes();
    await _handlers.drillSuggestions(get({ code: _seed.SEED_TEAM_CODE, coachToken: token }), listRes);
    expect(listRes.statusCode).toBe(200);
    expect(listRes.body.suggestions[0].text).toBe('One-timer off a pass');
  });

  it('rejects an empty suggestion', async () => {
    const login = await loginSeedCoach();
    const res = makeRes();
    await _handlers.suggestDrill(post({ code: _seed.SEED_TEAM_CODE, coachToken: login.body.token, category: 'stick', text: '  ' }), res);
    expect(res.statusCode).toBe(400);
  });

  it('blocks suggest-drill without a coach token', async () => {
    await loginSeedCoach();
    const res = makeRes();
    await _handlers.suggestDrill(post({ code: _seed.SEED_TEAM_CODE, category: 'stick', text: 'x' }), res);
    expect(res.statusCode).toBe(401);
  });
});

describe('coach roster: head + assistants', () => {
  it('seeds the head from the team coachEmail on first read', async () => {
    await loginSeedCoach();
    const res = makeRes();
    await _handlers.teamCoaches(get({ code: _seed.SEED_TEAM_CODE }), res);
    expect(res.statusCode).toBe(200);
    const head = res.body.coaches.find((c) => c.role === 'head');
    expect(head.email).toBe(_seed.SEED_COACH_EMAIL);
    expect(res.body.maxAssistants).toBe(3);
  });

  it('head invites assistants up to the cap of 3, then refuses', async () => {
    const login = await loginSeedCoach();
    const token = login.body.token;
    // seed head first
    await _handlers.teamCoaches(get({ code: _seed.SEED_TEAM_CODE }), makeRes());
    for (const em of ['a1@x.com', 'a2@x.com', 'a3@x.com']) {
      const r = makeRes();
      await _handlers.inviteCoach(post({ code: _seed.SEED_TEAM_CODE, coachToken: token, email: em }), r);
      expect(r.statusCode).toBe(200);
    }
    const over = makeRes();
    await _handlers.inviteCoach(post({ code: _seed.SEED_TEAM_CODE, coachToken: token, email: 'a4@x.com' }), over);
    expect(over.statusCode).toBe(409);
    expect(over.body.error).toMatch(/limit/);
  });

  it('removes an assistant', async () => {
    const login = await loginSeedCoach();
    const token = login.body.token;
    await _handlers.teamCoaches(get({ code: _seed.SEED_TEAM_CODE }), makeRes());
    await _handlers.inviteCoach(post({ code: _seed.SEED_TEAM_CODE, coachToken: token, email: 'asst@x.com' }), makeRes());
    const rm = makeRes();
    await _handlers.removeCoach(post({ code: _seed.SEED_TEAM_CODE, coachToken: token, email: 'asst@x.com' }), rm);
    expect(rm.statusCode).toBe(200);
    expect(rm.body.coaches.some((c) => c.email === 'asst@x.com')).toBe(false);
  });

  it('blocks invite without a coach token', async () => {
    await loginSeedCoach();
    const res = makeRes();
    await _handlers.inviteCoach(post({ code: _seed.SEED_TEAM_CODE, email: 'x@x.com' }), res);
    expect(res.statusCode).toBe(401);
  });
});

describe('team schedule', () => {
  it('seeds the 2026-27 games and computes the next game', async () => {
    await loginSeedCoach();
    const res = makeRes();
    await _handlers.schedule(get({ code: _seed.SEED_TEAM_CODE }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.schedule.events.length).toBeGreaterThan(5);
    expect(res.body.schedule.practices[0].dow).toBe(3); // Wednesday
    expect(res.body.next).toBeTruthy();
  });

  it('lets a coach add an event', async () => {
    const login = await loginSeedCoach();
    const token = login.body.token;
    await _handlers.schedule(get({ code: _seed.SEED_TEAM_CODE }), makeRes()); // seed
    const res = makeRes();
    await _handlers.addEvent(post({ code: _seed.SEED_TEAM_CODE, coachToken: token, event: { kind: 'game', date: '2027-01-10', time: '10:00', home: true, opponent: 'Test FC' } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.schedule.events.some((e) => e.opponent === 'Test FC')).toBe(true);
  });

  it('rejects add-event without a coach token', async () => {
    await loginSeedCoach();
    const res = makeRes();
    await _handlers.addEvent(post({ code: _seed.SEED_TEAM_CODE, event: { date: '2027-01-10' } }), res);
    expect(res.statusCode).toBe(401);
  });
});

describe('coach profile', () => {
  it('saves the coach name + photo and shows it in the team coaches strip', async () => {
    const login = await loginSeedCoach();
    const token = login.body.token;
    await _handlers.teamCoaches(get({ code: _seed.SEED_TEAM_CODE }), makeRes()); // seed head
    const res = makeRes();
    await _handlers.setCoachProfile(post({ code: _seed.SEED_TEAM_CODE, coachToken: token, name: 'Coach Jason', photo: 'data:image/jpeg;base64,abc' }), res);
    expect(res.statusCode).toBe(200);
    const head = res.body.coaches.find((c) => c.role === 'head');
    expect(head.name).toBe('Coach Jason');
    expect(head.photo).toContain('data:image/jpeg');
  });

  it('rejects a profile with no name', async () => {
    const login = await loginSeedCoach();
    const res = makeRes();
    await _handlers.setCoachProfile(post({ code: _seed.SEED_TEAM_CODE, coachToken: login.body.token, name: '' }), res);
    expect(res.statusCode).toBe(400);
  });
});

describe('add-player: parent email + photo', () => {
  it('rejects add-player without a parent email', async () => {
    const login = await loginSeedCoach();
    const res = makeRes();
    await _handlers.addPlayer(post({ code: _seed.SEED_TEAM_CODE, coachToken: login.body.token, firstName: 'Noemail' }), res);
    expect(res.statusCode).toBe(400);
  });

  it('stores an optional player photo on add', async () => {
    const login = await loginSeedCoach();
    const res = makeRes();
    await _handlers.addPlayer(post({ code: _seed.SEED_TEAM_CODE, coachToken: login.body.token, firstName: 'Photokid', parentEmail: 'p@x.com', photo: 'data:image/jpeg;base64,abc' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.member.photo).toContain('data:image/jpeg');
  });
});

describe('edit player, coach password, and email requests', () => {
  it('coach edits an existing player and reads it back', async () => {
    const login = await loginSeedCoach();
    const token = login.body.token;
    const add = makeRes();
    await _handlers.addPlayer(post({ code: _seed.SEED_TEAM_CODE, coachToken: token, firstName: 'Editme', number: 5, parentEmail: 'p@x.com' }), add);
    const upd = makeRes();
    await _handlers.updatePlayer(post({ code: _seed.SEED_TEAM_CODE, coachToken: token, playerId: 'editme', firstName: 'Editme', lastName: 'Jones', number: 77, position: 'D' }), upd);
    expect(upd.statusCode).toBe(200);
    expect(upd.body.member.lastName).toBe('Jones');
    expect(upd.body.member.number).toBe(77);
    expect(upd.body.member.position).toBe('D');
  });

  it('rejects update with an empty first name, and unknown player', async () => {
    const login = await loginSeedCoach();
    const r1 = makeRes();
    await _handlers.updatePlayer(post({ code: _seed.SEED_TEAM_CODE, coachToken: login.body.token, playerId: 'editme', firstName: '  ' }), r1);
    expect(r1.statusCode).toBe(400);
    const r2 = makeRes();
    await _handlers.updatePlayer(post({ code: _seed.SEED_TEAM_CODE, coachToken: login.body.token, playerId: 'ghost', lastName: 'X' }), r2);
    expect(r2.statusCode).toBe(404);
  });

  it('blocks update-player without a coach token', async () => {
    await loginSeedCoach();
    const res = makeRes();
    await _handlers.updatePlayer(post({ code: _seed.SEED_TEAM_CODE, playerId: 'editme', lastName: 'X' }), res);
    expect(res.statusCode).toBe(401);
  });

  it('coach changes password with the right current password, then logs in with the new one', async () => {
    const login = await loginSeedCoach();
    const token = login.body.token;
    const set = makeRes();
    await _handlers.setPassword(post({ coachToken: token, currentPassword: _seed.SEED_COACH_PASSWORD, newPassword: 'newpass1' }), set);
    expect(set.statusCode).toBe(200);
    const relog = makeRes();
    await _handlers.coachLogin(post({ email: _seed.SEED_COACH_EMAIL, password: 'newpass1' }), relog);
    expect(relog.statusCode).toBe(200);
    // restore for other tests that assume the seed password
    const restore = makeRes();
    await _handlers.setPassword(post({ coachToken: token, currentPassword: 'newpass1', newPassword: _seed.SEED_COACH_PASSWORD }), restore);
    expect(restore.statusCode).toBe(200);
  });

  it('rejects a password change with the wrong current password or a too-short new one', async () => {
    const login = await loginSeedCoach();
    const token = login.body.token;
    const wrong = makeRes();
    await _handlers.setPassword(post({ coachToken: token, currentPassword: 'nope', newPassword: 'abcdef' }), wrong);
    expect(wrong.statusCode).toBe(401);
    const short = makeRes();
    await _handlers.setPassword(post({ coachToken: token, currentPassword: _seed.SEED_COACH_PASSWORD, newPassword: 'abc' }), short);
    expect(short.statusCode).toBe(400);
  });

  it('request-password answers ok even for an unknown email (no probing)', async () => {
    const res = makeRes();
    await _handlers.requestPassword(post({ email: 'nobody@example.com' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('reset-password rejects an invalid token', async () => {
    const res = makeRes();
    await _handlers.resetPassword(post({ token: 'bogus', newPassword: 'abcdef' }), res);
    expect(res.statusCode).toBe(400);
  });

  it('request-code answers ok (no roster probing)', async () => {
    await loginSeedCoach();
    const res = makeRes();
    await _handlers.requestCode(post({ code: _seed.SEED_TEAM_CODE, playerId: 'editme' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe('assistant coach with login credentials', () => {
  it('head adds an assistant with a name + password, and the assistant can log in', async () => {
    const login = await loginSeedCoach();
    const token = login.body.token;
    const add = makeRes();
    await _handlers.inviteCoach(post({ code: _seed.SEED_TEAM_CODE, coachToken: token, email: 'asst@example.com', name: 'Sam Assistant', password: 'asst1234' }), add);
    expect(add.statusCode).toBe(200);
    expect(add.body.coaches.some((c) => c.email === 'asst@example.com' && c.role === 'assistant')).toBe(true);
    const asstLogin = makeRes();
    await _handlers.coachLogin(post({ email: 'asst@example.com', password: 'asst1234' }), asstLogin);
    expect(asstLogin.statusCode).toBe(200);
    expect(asstLogin.body.token).toBeTruthy();
  });

  it('an assistant added without a password cannot log in', async () => {
    const login = await loginSeedCoach();
    const add = makeRes();
    await _handlers.inviteCoach(post({ code: _seed.SEED_TEAM_CODE, coachToken: login.body.token, email: 'nopass@example.com', name: 'No Pass' }), add);
    expect(add.statusCode).toBe(200);
    const tryLogin = makeRes();
    await _handlers.coachLogin(post({ email: 'nopass@example.com', password: 'anything' }), tryLogin);
    expect(tryLogin.statusCode).toBe(401);
  });
});

describe('seeded coach password', () => {
  it('the seeded coach logs in with the current default password', async () => {
    const res = makeRes();
    await _handlers.coachLogin(post({ email: _seed.SEED_COACH_EMAIL, password: 'rangers2026' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.token).toBeTruthy();
  });

  it('the prior default password no longer works', async () => {
    const res = makeRes();
    await _handlers.coachLogin(post({ email: _seed.SEED_COACH_EMAIL, password: 'ranger10u' }), res);
    expect(res.statusCode).toBe(401);
  });
});

describe('Thwap admin: drill-suggestion review', () => {
  it('blocks review without the admin key', async () => {
    const res = makeRes();
    await _handlers.reviewSuggestions(get({}), res);
    expect(res.statusCode).toBe(401);
  });

  it('lists a coach suggestion across teams and flips its status', async () => {
    const login = await loginSeedCoach();
    const token = login.body.token;
    const add = makeRes();
    await _handlers.suggestDrill(post({ code: _seed.SEED_TEAM_CODE, coachToken: token, category: 'shoot', text: 'One-timer off a pass' }), add);
    const id = add.body.suggestion.id;

    const listRes = makeRes();
    await _handlers.reviewSuggestions(get({ key: 'admin-test-token' }), listRes);
    expect(listRes.statusCode).toBe(200);
    const found = listRes.body.suggestions.find((s) => s.id === id);
    expect(found).toBeTruthy();
    expect(found.teamCode).toBe(_seed.SEED_TEAM_CODE);

    const resolveRes = makeRes();
    await _handlers.resolveSuggestion(post({ code: _seed.SEED_TEAM_CODE, id, status: 'accepted' }, { key: 'admin-test-token' }), resolveRes);
    expect(resolveRes.statusCode).toBe(200);
    expect(resolveRes.body.suggestion.status).toBe('accepted');
  });

  it('blocks resolve without the admin key and rejects a bad status', async () => {
    const noKey = makeRes();
    await _handlers.resolveSuggestion(post({ code: _seed.SEED_TEAM_CODE, id: 'x', status: 'accepted' }, {}), noKey);
    expect(noKey.statusCode).toBe(401);
    const badStatus = makeRes();
    await _handlers.resolveSuggestion(post({ code: _seed.SEED_TEAM_CODE, id: 'nope', status: 'banana' }, { key: 'admin-test-token' }), badStatus);
    expect(badStatus.statusCode).toBe(404);
  });
});
