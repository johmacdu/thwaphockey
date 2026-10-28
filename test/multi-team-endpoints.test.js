// test/multi-team-endpoints.test.js
//
// Every player endpoint accepts players on ANY team (lib/team_players.js), not
// only the 16 hard-coded Jr. Rangers 10U players in ROSTER:
//   - api/done.js     record a drill, read today and this week
//   - api/board.js    leaderboard, cheers, fires, givers, looks: own team ONLY
//   - api/push.js     register a device, admin send/status
//   - api/photo/*     get, request-code, verify, upload, admin-put
//   - lib/look_api.js own look read/write
// The 16 Rangers keep working with no member records, and an unknown player
// (or one removed from their team's members list) is refused.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FakeRedis } from './fakeRedis.js';

const fake = new FakeRedis();
vi.mock('@upstash/redis', () => ({ Redis: class { constructor() { return fake; } } }));
const blobPut = vi.fn(async (key) => ({ url: `https://blob.example/${key}` }));
vi.mock('@vercel/blob', () => ({ put: (...a) => blobPut(...a), del: vi.fn(async () => {}) }));

function setEnv() {
  process.env.KV_REST_API_URL = 'https://fake';
  process.env.KV_REST_API_TOKEN = 'fake';
  process.env.RESEND_API_KEY = 'rk_test';
  process.env.PHOTO_FROM_EMAIL = 'thwap@example.com';
  process.env.PHOTO_TOKEN_SECRET = 'test-secret-please-change';
  process.env.BLOB_READ_WRITE_TOKEN = 'blob_test';
  process.env.SESSION_TOKEN_SECRET = 'session-secret-please-change';
  process.env.THWAP_ADMIN_TOKEN = 'admin-test-token';
}
setEnv();

const { default: done } = await import('../api/done.js');
const { default: board } = await import('../api/board.js');
const { default: reset } = await import('../api/reset.js');
const { _handlers: push } = await import('../api/push.js');
const { default: photoGet } = await import('../api/photo/get.js');
const { default: photoRequest } = await import('../api/photo/request-code.js');
const { default: photoVerify } = await import('../api/photo/verify.js');
const { default: photoUpload } = await import('../api/photo/upload.js');
const { default: photoAdminPut } = await import('../api/photo/admin-put.js');
const { mintSession } = await import('../lib/session_store.js');
const { mintToken } = await import('../lib/photo_store.js');
const { ROSTER } = await import('../lib/store.js');
const { setTeam, addMember, removeMember } = await import('../lib/teams_store.js');
const { resolvePlayer, teamPlayerIds } = await import('../lib/team_players.js');

function makeRes() {
  return {
    statusCode: 200, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
}
const cookie = (pid) => ({ cookie: `thwapSession=${mintSession(pid, 'parent@example.com')}` });
const postAs = (pid, body, query = {}) => ({ method: 'POST', query, body, headers: pid ? cookie(pid) : {} });
const getAs = (pid, query = {}) => ({ method: 'GET', query, headers: pid ? cookie(pid) : {} });
const IMG = 'data:image/jpeg;base64,' + Buffer.from('hello-jpeg-bytes').toString('base64');
const ROSTER_IDS = ROSTER.map((p) => p.id);

async function seedFlyers() {
  await setTeam('FLYERS10', { name: 'Flyers 9U', createdAt: new Date().toISOString() });
  await addMember('FLYERS10', { playerId: 'zara', firstName: 'Zara', lastName: 'Quinn', number: 44 });
  await addMember('FLYERS10', { playerId: 'milo', firstName: 'Milo', lastName: 'Park', number: 8 });
}

beforeEach(async () => {
  fake.map.clear();
  setEnv();
  blobPut.mockClear();
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-14T20:00:00.000Z')); // Wed, Vancouver
  await seedFlyers();
});
afterEach(() => { vi.useRealTimers(); });

describe('lib/team_players', () => {
  it('resolves a non-Rangers player to their own team', async () => {
    expect(await resolvePlayer('Zara')).toMatchObject({ id: 'zara', teamCode: 'FLYERS10', number: 44 });
  });
  it('resolves all 16 Rangers with no member records', async () => {
    for (const p of ROSTER) {
      expect(await resolvePlayer(p.id)).toMatchObject({ id: p.id, teamCode: 'RANGERS72', number: p.number });
    }
  });
  it('refuses an unknown id and a player removed from their team', async () => {
    expect(await resolvePlayer('ghost')).toBeNull();
    expect(await resolvePlayer('')).toBeNull();
    await removeMember('FLYERS10', 'milo');
    expect(await resolvePlayer('milo')).toBeNull();
  });
  it('lists the Rangers as ROSTER first (unchanged order), other teams by members', async () => {
    expect(await teamPlayerIds('RANGERS72')).toEqual(ROSTER_IDS);
    expect(await teamPlayerIds('FLYERS10')).toEqual(['zara', 'milo']);
    expect(await teamPlayerIds('NOPE')).toEqual([]);
  });
});

describe('api/done.js on any team', () => {
  it('records a drill for a non-Rangers player and reads it back today and this week', async () => {
    let res = makeRes();
    await done(postAs('zara', { player: 'zara', discipline: 'stick', drillId: 'stick:0' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.player.stick).toBe(1);
    expect(res.body.drills).toEqual(['stick:0']);

    res = makeRes();
    await done(getAs('zara'), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ player: 'zara', drills: ['stick:0'] });

    res = makeRes();
    await done(getAs('zara', { week: '1' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.drills).toEqual(['stick:0']);
  });

  it('keeps the auth rules: no session 401, another player 403', async () => {
    let res = makeRes();
    await done(postAs(null, { player: 'zara', discipline: 'stick' }), res);
    expect(res.statusCode).toBe(401);
    res = makeRes();
    await done(postAs('milo', { player: 'zara', discipline: 'stick' }), res);
    expect(res.statusCode).toBe(403);
  });

  it('refuses an unknown player (POST and GET) and a removed player', async () => {
    let res = makeRes();
    await done(postAs('ghost', { player: 'ghost', discipline: 'stick' }), res);
    expect(res.statusCode).toBe(400);
    res = makeRes();
    await done(getAs('ghost'), res);
    expect(res.statusCode).toBe(400);
    await removeMember('FLYERS10', 'milo');
    res = makeRes();
    await done(postAs('milo', { player: 'milo', discipline: 'stick' }), res);
    expect(res.statusCode).toBe(400);
  });

  it('all 16 Rangers still record and read with no member records', async () => {
    fake.map.clear();
    for (const p of ROSTER) {
      const disc = p.id === 'johnny' ? 'netplay' : 'shoot';
      const res = makeRes();
      await done(postAs(p.id, { player: p.id, discipline: disc, drillId: `${disc}:0` }), res);
      expect(res.statusCode).toBe(200);
      const g = makeRes();
      await done(getAs(p.id), g);
      expect(g.body.drills).toEqual([`${disc}:0`]);
    }
  });
});

describe('api/board.js is scoped to the player\'s own team', () => {
  it('a Flyers player sees only Flyers players, all-time and this week', async () => {
    await done(postAs('zara', { player: 'zara', discipline: 'stick' }), makeRes());
    let res = makeRes();
    await board(getAs('zara'), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.players.map((p) => p.id)).toEqual(['zara', 'milo']);
    expect(res.body.players[0].stick).toBe(1);

    res = makeRes();
    await board(getAs('zara', { tf: 'week' }), res);
    expect(res.body.players.map((p) => p.id)).toEqual(['zara', 'milo']);
    expect(res.body.players[0].stick).toBe(1);
    expect(res.body.teamGoal).toMatchObject({ goal: 75 });
  });

  it('Rangers (signed in or not) see exactly the 16, never a Flyers player', async () => {
    await done(postAs('zara', { player: 'zara', discipline: 'stick' }), makeRes());
    for (const req of [getAs(null), getAs('lewie'), getAs(null, { tf: 'week' }), getAs('lewie', { tf: 'week' })]) {
      const res = makeRes();
      await board(req, res);
      expect(res.body.players.map((p) => p.id)).toEqual(ROSTER_IDS);
    }
  });

  it('keeps a separate team-goal ladder per team', async () => {
    vi.setSystemTime(new Date('2026-11-04T20:00:00.000Z')); // week after fromWeek
    await board(getAs('zara', { tf: 'week' }), makeRes());
    await board(getAs('lewie', { tf: 'week' }), makeRes());
    expect(fake.map.has('teamgoal:FLYERS10:ladder')).toBe(true);
    expect(fake.map.has('teamgoal:ladder')).toBe(true);
  });

  it('cheers and fires stay inside a team', async () => {
    for (const action of ['cheer', 'fire']) {
      let res = makeRes();
      await board(postAs('zara', { to: 'milo' }, { action }), res);
      expect(res.statusCode).toBe(200);
      expect(res.body.ok).toBe(true);
      res = makeRes();
      await board(postAs('zara', { to: 'lewie' }, { action }), res);
      expect(res.statusCode).toBe(400);
      res = makeRes();
      await board(postAs('lewie', { to: 'zara' }, { action }), res);
      expect(res.statusCode).toBe(400);
      res = makeRes();
      await board(postAs('lewie', { to: 'teddy' }, { action }), res);
      expect(res.statusCode).toBe(200);
    }
    const res = makeRes();
    await board(getAs('zara'), res);
    expect(res.body.players.find((p) => p.id === 'milo')).toMatchObject({ cheers: 1, fire: 1 });
  });

  it('cheers-for and fires-for name a teammate giver on a non-Rangers team', async () => {
    await board(postAs('zara', { to: 'milo' }, { action: 'cheer' }), makeRes());
    await board(postAs('zara', { to: 'milo' }, { action: 'fire' }), makeRes());
    for (const action of ['cheers-for', 'fires-for']) {
      const res = makeRes();
      await board(getAs('milo', { action }), res);
      expect(res.body.givers.map((g) => g.from)).toEqual(['zara']);
    }
  });

  it('looks: own look works off-Rangers, the teammate list is own team only', async () => {
    let res = makeRes();
    await board(getAs('zara', { action: 'look' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.id).toBe('zara');
    res = makeRes();
    await board(getAs('zara', { action: 'looks' }), res);
    expect(Object.keys(res.body.looks).sort()).toEqual(['milo', 'zara']);
    res = makeRes();
    await board(getAs(null, { action: 'looks' }), res);
    expect(Object.keys(res.body.looks)).toEqual(ROSTER_IDS);
    res = makeRes();
    await board(getAs('ghost', { action: 'look' }), res);
    expect(res.statusCode).toBe(400);
  });
});

describe('api/push.js on any team', () => {
  it('registers a non-Rangers player and a Rangers player, refuses an unknown session', async () => {
    let res = makeRes();
    await push.register(postAs('zara', { token: 'tok-z', platform: 'ios' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.count).toBe(1);
    res = makeRes();
    await push.register(postAs('lewie', { token: 'tok-l', platform: 'ios' }), res);
    expect(res.statusCode).toBe(200);
    res = makeRes();
    await push.register(postAs('ghost', { token: 'tok-g', platform: 'ios' }), res);
    expect(res.statusCode).toBe(400);
  });

  it('admin send accepts a non-Rangers player, refuses an unknown one; status covers every team', async () => {
    await push.register(postAs('zara', { token: 'tok-z', platform: 'ios' }), makeRes());
    const admin = { authorization: 'Bearer admin-test-token' };
    let res = makeRes();
    await push.send({ method: 'POST', query: {}, headers: admin, body: { playerId: 'zara', payload: { title: 'x' } } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.tokens).toBe(1);
    res = makeRes();
    await push.send({ method: 'POST', query: {}, headers: admin, body: { playerId: 'ghost', payload: { title: 'x' } } }, res);
    expect(res.statusCode).toBe(400);
    res = makeRes();
    await push.status({ method: 'GET', query: {}, headers: admin }, res);
    const ids = res.body.players.map((p) => p.playerId);
    expect(ids.slice(0, 16)).toEqual(ROSTER_IDS);
    expect(ids).toContain('zara');
    res = makeRes();
    await push.status({ method: 'GET', query: { team: 'FLYERS10' }, headers: admin }, res);
    expect(res.body.players.map((p) => p.playerId)).toEqual(['zara', 'milo']);
  });
});

describe('api/photo/* on any team', () => {
  it('get, request-code, verify, upload and admin-put accept a non-Rangers player', async () => {
    let res = makeRes();
    await photoGet({ method: 'GET', query: { playerId: 'zara' } }, res);
    expect(res.statusCode).toBe(404); // known player, no photo yet

    res = makeRes();
    await photoRequest({ method: 'POST', body: { email: 'parent@example.com', playerId: 'zara' }, headers: {} }, res);
    expect(res.statusCode).toBe(200);
    const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sent.text).toContain('Zara');
    const code = /code is: (\d{6})/.exec(sent.text)[1];

    res = makeRes();
    await photoVerify({ method: 'POST', body: { email: 'parent@example.com', playerId: 'zara', code }, headers: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.uploadToken).toBeTruthy();

    res = makeRes();
    await photoUpload({ method: 'POST', body: { playerId: 'zara', imageData: IMG }, headers: { authorization: `Bearer ${mintToken('zara')}` } }, res);
    expect(res.statusCode).toBe(200);
    res = makeRes();
    await photoGet({ method: 'GET', query: { playerId: 'zara' } }, res);
    expect(res.statusCode).toBe(200);

    res = makeRes();
    await photoAdminPut({ method: 'POST', query: {}, body: { playerId: 'milo', imageData: IMG, consent: { method: 'in_person', grantedBy: 'Parent' } }, headers: { authorization: 'Bearer admin-test-token' } }, res);
    expect(res.statusCode).toBe(200);
  });

  it('refuses an unknown player on every photo endpoint; Rangers still accepted', async () => {
    let res = makeRes();
    await photoGet({ method: 'GET', query: { playerId: 'ghost' } }, res);
    expect(res.statusCode).toBe(400);
    res = makeRes();
    await photoRequest({ method: 'POST', body: { email: 'p@example.com', playerId: 'ghost' }, headers: {} }, res);
    expect(res.statusCode).toBe(400);
    res = makeRes();
    await photoVerify({ method: 'POST', body: { email: 'p@example.com', playerId: 'ghost', code: '123456' }, headers: {} }, res);
    expect(res.statusCode).toBe(400);
    res = makeRes();
    await photoUpload({ method: 'POST', body: { playerId: 'ghost', imageData: IMG }, headers: { authorization: `Bearer ${mintToken('ghost')}` } }, res);
    expect(res.statusCode).toBe(400);
    res = makeRes();
    await photoGet({ method: 'GET', query: { playerId: 'lewie' } }, res);
    expect(res.statusCode).toBe(404);
  });
});

describe('api/reset.js on any team', () => {
  it('resets a non-Rangers player, refuses an unknown one', async () => {
    process.env.SEED_KEY = 'seed-test';
    await done(postAs('zara', { player: 'zara', discipline: 'stick' }), makeRes());
    let res = makeRes();
    await reset({ method: 'POST', query: { player: 'zara' }, headers: { 'x-seed-key': 'seed-test' } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.player.stick).toBe(0);
    res = makeRes();
    await reset({ method: 'POST', query: { player: 'ghost' }, headers: { 'x-seed-key': 'seed-test' } }, res);
    expect(res.statusCode).toBe(400);
    delete process.env.SEED_KEY;
  });
});
