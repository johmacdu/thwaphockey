// test/coach-team-auth.test.js
//
// Being a coach is not enough: anyone can register as one. Every coach call
// that writes a team's data (or lists its drill suggestions) must come from a
// coach who RUNS that team: head or assistant on its coach list, its own
// coachEmail, or the team in the coach's record. Remove and update also need
// the player to be on that team. The roster's parent emails go only to such a
// coach, or to a signed-in player for their own record.

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
const { getMember } = await import('../lib/teams_store.js');

function makeRes() {
  return {
    statusCode: 200, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
}
const post = (body) => ({ method: 'POST', body, query: {}, headers: {} });
const get = (query, headers = {}) => ({ method: 'GET', query, headers });
const CODE = () => _seed.SEED_TEAM_CODE;

async function call(name, req) { const res = makeRes(); await _handlers[name](req, res); return res; }
async function seedToken() {
  return (await call('coachLogin', post({ email: _seed.SEED_COACH_EMAIL, password: _seed.SEED_COACH_PASSWORD }))).body.token;
}
async function strangerToken() {
  return (await call('coachRegister', post({ email: 'stranger@example.com', password: 'secret1', name: 'Stranger' }))).body.token;
}

beforeEach(() => { fake.map.clear(); setEnv(); });

// Each team-scoped coach call with a valid body for the Rangers.
const CALLS = {
  addPlayer: (t) => post({ coachToken: t, code: CODE(), firstName: 'Newkid', number: 88 }),
  removePlayer: (t) => post({ coachToken: t, code: CODE(), playerId: 'lewie' }),
  updatePlayer: (t) => post({ coachToken: t, code: CODE(), playerId: 'lewie', lastName: 'Changed' }),
  addEvent: (t) => post({ coachToken: t, code: CODE(), event: { date: '2026-11-10', title: 'Practice' } }),
  setPlan: (t) => post({ coachToken: t, code: CODE(), plan: { days: [] } }),
  setTeamGoal: (t) => post({ coachToken: t, code: CODE(), text: 'Win the corners' }),
  suggestDrill: (t) => post({ coachToken: t, code: CODE(), category: 'stick', text: 'Figure eights' }),
  drillSuggestions: (t) => get({ coachToken: t, code: CODE() }),
};

describe('a coach who does not run the team is refused', () => {
  for (const [name, req] of Object.entries(CALLS)) {
    it(`${name}: 403`, async () => {
      await seedToken(); // seed the Rangers
      const res = await call(name, req(await strangerToken()));
      expect(res.statusCode).toBe(403);
      expect(res.body.error).toBe('not your team');
    });
  }

  it('the kid record is untouched after a refused edit', async () => {
    await seedToken();
    const before = await getMember('lewie');
    await call('updatePlayer', CALLS.updatePlayer(await strangerToken()));
    expect(await getMember('lewie')).toEqual(before);
  });
});

describe('the team\'s own coaches still can', () => {
  it('the head coach: every call goes through (no 403)', async () => {
    for (const [name, req] of Object.entries(CALLS)) {
      fake.map.clear(); setEnv();
      const res = await call(name, req(await seedToken()));
      expect(res.statusCode, name).not.toBe(403);
      expect(res.statusCode, name).not.toBe(401);
    }
  });

  it('an invited assistant coach can edit the roster', async () => {
    const head = await seedToken();
    const inv = await call('inviteCoach', post({ coachToken: head, code: CODE(), email: 'asst@example.com', password: 'secret1' }));
    expect(inv.statusCode).toBe(200);
    const asst = (await call('coachLogin', post({ email: 'asst@example.com', password: 'secret1' }))).body.token;
    const res = await call('updatePlayer', CALLS.updatePlayer(asst));
    expect(res.statusCode).toBe(200);
  });
});

describe('remove and update need the player on that team', () => {
  it('404 for a player who is not on the team', async () => {
    const t = await seedToken();
    expect((await call('updatePlayer', post({ coachToken: t, code: CODE(), playerId: 'ghost', lastName: 'X' }))).statusCode).toBe(404);
    expect((await call('removePlayer', post({ coachToken: t, code: CODE(), playerId: 'ghost' }))).statusCode).toBe(404);
  });
});

describe('roster parent emails', () => {
  async function seedWithEmail() {
    const t = await seedToken();
    await call('updatePlayer', post({ coachToken: t, code: CODE(), playerId: 'lewie', parentEmails: ['lewie.parent@example.com'] }));
    await call('updatePlayer', post({ coachToken: t, code: CODE(), playerId: 'alder', parentEmails: ['alder.parent@example.com'] }));
    return t;
  }
  const emailsOf = (res, id) => res.body.members.find((m) => m.playerId === id).parentEmails;

  it('nobody signed in: no parent emails at all', async () => {
    await seedWithEmail();
    const res = await call('roster', get({ code: CODE() }));
    expect(res.statusCode).toBe(200);
    expect(res.body.members.every((m) => m.parentEmails.length === 0)).toBe(true);
  });

  it('a coach from another team: no parent emails', async () => {
    await seedWithEmail();
    const res = await call('roster', get({ code: CODE(), coachToken: await strangerToken() }));
    expect(res.body.members.every((m) => m.parentEmails.length === 0)).toBe(true);
  });

  it('the team\'s coach: everyone\'s', async () => {
    const t = await seedWithEmail();
    const res = await call('roster', get({ code: CODE(), coachToken: t }));
    expect(emailsOf(res, 'lewie')).toEqual(['lewie.parent@example.com']);
    expect(emailsOf(res, 'alder')).toEqual(['alder.parent@example.com']);
  });

  it('a signed-in player: only their own', async () => {
    await seedWithEmail();
    const cookie = `${SESSION_COOKIE}=${encodeURIComponent(mintSession('lewie', 'lewie.parent@example.com'))}`;
    const res = await call('roster', get({ code: CODE() }, { cookie }));
    expect(emailsOf(res, 'lewie')).toEqual(['lewie.parent@example.com']);
    expect(emailsOf(res, 'alder')).toEqual([]);
  });
});
