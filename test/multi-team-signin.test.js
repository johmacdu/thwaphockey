// test/multi-team-signin.test.js
//
// Sign-in across every team (lib/signin_players.js + api/login.js). Covers: a
// player on a non-Rangers team signing in with their jersey code and the email
// OTP path, all 16 original Jr. Rangers 10U players still signing in (with and
// without member records in the store), wrong codes and wrong teams rejected,
// and the public team-players action returning only safe fields.

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

const { default: handler, _handlers } = await import('../api/login.js');
const { codeSignin, requestCode, verify, session, teamPlayers } = _handlers;
const { verifySession, SESSION_COOKIE } = await import('../lib/session_store.js');
const { ROSTER } = await import('../lib/store.js');
const { setTeam, addMember, updateMember, removeMember } = await import('../lib/teams_store.js');

function makeRes() {
  return {
    statusCode: 200, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
}
const post = (body, headers = {}) => ({ method: 'POST', body, headers });
const tokenFrom = (setCookie) => {
  const m = new RegExp(SESSION_COOKIE + '=([^;]*)').exec(setCookie || '');
  return m ? decodeURIComponent(m[1]) : '';
};

async function seedFlyers() {
  await setTeam('FLYERS10', { name: 'Flyers 9U', createdAt: new Date().toISOString() });
  await addMember('FLYERS10', {
    playerId: 'zara', firstName: 'Zara', lastName: 'Quinn', number: 44,
    parentEmails: ['parent.zara@example.com'], photo: 'data:image/png;base64,AAAA',
  });
  await addMember('FLYERS10', { playerId: 'milo', firstName: 'Milo', lastName: 'Park', number: 8 });
}

// Mirror what ensureSeed in api/coach.js writes for the Rangers seed team.
async function seedRangers() {
  await setTeam('RANGERS72', { name: 'Jr Rangers 10U', createdAt: new Date().toISOString(), betaUntil: null });
  for (const p of ROSTER) {
    await addMember('RANGERS72', {
      playerId: p.id, firstName: p.name, lastName: p.id === 'alder' ? 'Reese' : '',
      number: p.number, parentEmail: p.id === 'alder' ? 'coach@example.com' : '',
    });
  }
}

beforeEach(() => {
  fake.map.clear();
  setEnv();
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
});

describe('code-signin on a non-Rangers team', () => {
  it('signs a Flyers player in with jersey + season and mints a session', async () => {
    await seedFlyers();
    const res = makeRes();
    await codeSignin(post({ playerId: 'zara', code: '442026', keep: true }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.player).toEqual({ id: 'zara', name: 'Zara', number: 44 });
    const claims = verifySession(tokenFrom(res.headers['Set-Cookie']));
    expect(claims.playerId).toBe('zara');
  });

  it('accepts a matching team code, any case', async () => {
    await seedFlyers();
    const res = makeRes();
    await codeSignin(post({ playerId: 'Zara', teamCode: 'flyers10', code: '442027' }), res);
    expect(res.statusCode).toBe(200);
  });

  it('rejects the wrong code', async () => {
    await seedFlyers();
    const res = makeRes();
    await codeSignin(post({ playerId: 'zara', code: '452026' }), res);
    expect(res.statusCode).toBe(401);
    expect(res.headers['Set-Cookie']).toBeUndefined();
  });

  it('rejects a player sent with another team code', async () => {
    await seedFlyers();
    const res = makeRes();
    await codeSignin(post({ playerId: 'zara', teamCode: 'RANGERS72', code: '442026' }), res);
    expect(res.statusCode).toBe(400);
  });

  it('rejects a player removed from their team', async () => {
    await seedFlyers();
    await removeMember('FLYERS10', 'milo');
    const res = makeRes();
    await codeSignin(post({ playerId: 'milo', code: '82026' }), res);
    expect(res.statusCode).toBe(400);
  });

  it('session reports the Flyers player by name', async () => {
    await seedFlyers();
    const r1 = makeRes();
    await codeSignin(post({ playerId: 'zara', code: '442026' }), r1);
    const r2 = makeRes();
    await session({ method: 'GET', headers: { cookie: `${SESSION_COOKIE}=${tokenFrom(r1.headers['Set-Cookie'])}` } }, r2);
    expect(r2.body).toEqual({ authed: true, player: { id: 'zara', name: 'Zara', number: 44 } });
  });
});

describe('email OTP on a non-Rangers team', () => {
  it('request-code emails the on-file parent and verify signs in', async () => {
    await seedFlyers();
    const r1 = makeRes();
    await requestCode(post({ playerId: 'zara' }), r1);
    expect(r1.body).toEqual({ ok: true, sent: 1 });
    const sent = JSON.parse(global.fetch.mock.calls.at(-1)[1].body);
    expect(sent.to).toEqual(['parent.zara@example.com']);
    expect(sent.text).toContain('Zara');
    const code = /code is: (\d{6})/.exec(sent.text)[1];
    const r2 = makeRes();
    await verify(post({ playerId: 'zara', code }), r2);
    expect(r2.statusCode).toBe(200);
    expect(r2.body.player).toEqual({ id: 'zara', name: 'Zara', number: 44 });
  });

  it('request-code for an unknown player sends nothing', async () => {
    await seedFlyers();
    const res = makeRes();
    await requestCode(post({ playerId: 'ghost' }), res);
    expect(res.body).toEqual({ ok: true, sent: 0 });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('the 16 Jr. Rangers 10U players still sign in', () => {
  it('ROSTER has the 16 players', () => {
    expect(ROSTER).toHaveLength(16);
  });

  for (const withStore of [false, true]) {
    it(`every ROSTER player signs in with both season years (${withStore ? 'seeded store' : 'empty store, ROSTER fallback'})`, async () => {
      if (withStore) await seedRangers();
      for (const p of ROSTER) {
        for (const y of ['2026', '2027']) {
          const res = makeRes();
          await codeSignin(post({ playerId: p.id, code: `${p.number}${y}` }), res);
          expect(res.statusCode, `${p.id} ${y}`).toBe(200);
          expect(res.body.player).toEqual({ id: p.id, name: p.name, number: p.number });
        }
        const bad = makeRes();
        await codeSignin(post({ playerId: p.id, code: `${p.number + 1}2026` }), bad);
        expect(bad.statusCode, p.id).toBe(401);
      }
    });
  }

  it('also accepts the RANGERS72 team code', async () => {
    const res = makeRes();
    await codeSignin(post({ playerId: 'lewie', teamCode: 'rangers72', code: '722026' }), res);
    expect(res.statusCode).toBe(200);
  });

  it('a renumbered Rangers player keeps the old code and gains the new one', async () => {
    await seedRangers();
    await updateMember('lewie', { number: 27 });
    for (const code of ['722026', '272026']) {
      const res = makeRes();
      await codeSignin(post({ playerId: 'lewie', code }), res);
      expect(res.statusCode, code).toBe(200);
    }
  });

  it('a coach-added Rangers player (not in ROSTER) signs in from the store', async () => {
    await seedRangers();
    await addMember('RANGERS72', { playerId: 'nova', firstName: 'Nova', number: 6 });
    const res = makeRes();
    await codeSignin(post({ playerId: 'nova', code: '62026' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.player.name).toBe('Nova');
  });
});

describe('team-players', () => {
  const get = (query) => ({ method: 'GET', headers: {}, query });

  it('returns only id, firstName and number', async () => {
    await seedFlyers();
    const res = makeRes();
    await teamPlayers(get({ code: 'flyers10' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      team: { name: 'Flyers 9U' },
      players: [
        { id: 'zara', firstName: 'Zara', number: 44 },
        { id: 'milo', firstName: 'Milo', number: 8 },
      ],
    });
    const raw = JSON.stringify(res.body);
    expect(raw).not.toMatch(/@|Quinn|Park|data:image|parentEmail|lastName|photo/);
  });

  it('routes through the handler on GET ?action=team-players', async () => {
    await seedRangers();
    const res = makeRes();
    await handler({ method: 'GET', headers: {}, query: { action: 'team-players', code: 'RANGERS72' } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.players).toHaveLength(16);
    expect(JSON.stringify(res.body)).not.toMatch(/@|Reese/);
    for (const p of res.body.players) expect(Object.keys(p).sort()).toEqual(['firstName', 'id', 'number']);
  });

  it('falls back to ROSTER for RANGERS72 before the team is seeded', async () => {
    const res = makeRes();
    await teamPlayers(get({ code: 'RANGERS72' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.team).toEqual({ name: 'Jr Rangers 10U' });
    expect(res.body.players).toHaveLength(16);
  });

  it('unknown team -> 404', async () => {
    const res = makeRes();
    await teamPlayers(get({ code: 'NOPE99' }), res);
    expect(res.statusCode).toBe(404);
  });

  it('missing code -> 400, wrong method -> 405', async () => {
    const r1 = makeRes();
    await teamPlayers(get({}), r1);
    expect(r1.statusCode).toBe(400);
    const r2 = makeRes();
    await teamPlayers({ method: 'POST', headers: {}, query: { code: 'RANGERS72' } }, r2);
    expect(r2.statusCode).toBe(405);
  });
});
