// test/letters.test.js
//
// Phase 4: the coach grants the C and A (api/coach.js ?action=set-letter). The
// coach must run the team and the player must be on it; one C per team (giving
// it moves it); at most two A's. Letters reach every card through
// /api/board?action=looks (lib/look_api.js) and the player's own look.

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
const { handleLooks } = await import('../lib/look_api.js');
const { getGrants } = await import('../lib/store.js');
const { listMembers } = await import('../lib/teams_store.js');

function makeRes() {
  return {
    statusCode: 200, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
}
const post = (body) => ({ method: 'POST', body, query: {}, headers: {} });
const CODE = () => _seed.SEED_TEAM_CODE;

async function seedToken() {
  const res = makeRes();
  await _handlers.coachLogin(post({ email: _seed.SEED_COACH_EMAIL, password: _seed.SEED_COACH_PASSWORD }), res);
  return res.body.token;
}
async function setLetter(body) {
  const res = makeRes();
  await _handlers.setLetter(post(body), res);
  return res;
}
async function looks() {
  const res = makeRes();
  await handleLooks({ method: 'GET', query: {}, headers: {} }, res);
  return res.body;
}

beforeEach(() => { fake.map.clear(); setEnv(); });

describe('set-letter', () => {
  it('the coach gives a player the C; it shows in the team letters', async () => {
    const token = await seedToken();
    const members = await listMembers(CODE());
    expect(members).toContain('lewie');
    const res = await setLetter({ coachToken: token, code: CODE(), playerId: 'Lewie', letter: 'C' });
    expect(res.statusCode).toBe(200);
    expect(res.body.letter).toBe('C');
    expect(await getGrants('lewie')).toContain('letter-c');
    expect((await looks()).letters).toEqual({ lewie: 'C' });
  });

  it('one C per team: giving it to someone else moves it', async () => {
    const token = await seedToken();
    await setLetter({ coachToken: token, code: CODE(), playerId: 'lewie', letter: 'C' });
    const res = await setLetter({ coachToken: token, code: CODE(), playerId: 'alder', letter: 'C' });
    expect(res.statusCode).toBe(200);
    expect(res.body.movedFrom).toBe('lewie');
    expect((await looks()).letters).toEqual({ alder: 'C' });
  });

  it('at most two A\'s: a third is refused with a plain reason', async () => {
    const token = await seedToken();
    const [a, b, c] = (await listMembers(CODE())).filter((m) => m !== 'lewie').slice(0, 3);
    expect((await setLetter({ coachToken: token, code: CODE(), playerId: a, letter: 'A' })).statusCode).toBe(200);
    expect((await setLetter({ coachToken: token, code: CODE(), playerId: b, letter: 'A' })).statusCode).toBe(200);
    const third = await setLetter({ coachToken: token, code: CODE(), playerId: c, letter: 'A' });
    expect(third.statusCode).toBe(409);
    expect(third.body.error).toMatch(/Two players already have an A/);
    // Swapping one of the two A's for the C frees a spot.
    expect((await setLetter({ coachToken: token, code: CODE(), playerId: a, letter: 'C' })).statusCode).toBe(200);
    expect((await setLetter({ coachToken: token, code: CODE(), playerId: c, letter: 'A' })).statusCode).toBe(200);
  });

  it('taking a letter off clears it', async () => {
    const token = await seedToken();
    await setLetter({ coachToken: token, code: CODE(), playerId: 'lewie', letter: 'A' });
    const res = await setLetter({ coachToken: token, code: CODE(), playerId: 'lewie', letter: '' });
    expect(res.body.letter).toBe(null);
    expect((await looks()).letters).toEqual({});
  });

  it('keeps other grants when the letter changes', async () => {
    const token = await seedToken();
    fake.map.set('grants:lewie', JSON.stringify(['jersey-legend']));
    await setLetter({ coachToken: token, code: CODE(), playerId: 'lewie', letter: 'C' });
    expect(await getGrants('lewie')).toEqual(['jersey-legend', 'letter-c']);
  });

  it('refuses a coach who does not run the team', async () => {
    await seedToken(); // seeds the team
    const reg = makeRes();
    await _handlers.coachRegister(post({ email: 'stranger@example.com', password: 'secret1', name: 'Stranger' }), reg);
    const res = await setLetter({ coachToken: reg.body.token, code: CODE(), playerId: 'lewie', letter: 'C' });
    expect(res.statusCode).toBe(403);
    expect(await getGrants('lewie')).toEqual([]);
  });

  it('refuses no coach, a bad letter, and a player not on the team', async () => {
    const token = await seedToken();
    expect((await setLetter({ code: CODE(), playerId: 'lewie', letter: 'C' })).statusCode).toBe(401);
    expect((await setLetter({ coachToken: token, code: CODE(), playerId: 'lewie', letter: 'K' })).statusCode).toBe(400);
    expect((await setLetter({ coachToken: token, code: CODE(), playerId: 'nobody', letter: 'C' })).statusCode).toBe(404);
  });
});
