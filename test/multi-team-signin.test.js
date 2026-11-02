// test/multi-team-signin.test.js
//
// Sign-in across every team (lib/signin_players.js + api/login.js). Covers: a
// player on a non-Rangers team signing in with their jersey code and the email
// OTP path, all 16 original Jr. Rangers 10U players still signing in (with and
// without member records in the store), and wrong codes and wrong teams
// rejected. (The public team-players list was removed: test/watch-signin-team-code.test.js.)

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

const { _handlers } = await import('../api/login.js');
const { requestCode, verify, session } = _handlers;
const { verifySession, SESSION_COOKIE, mintDeviceToken, deviceCookieName } = await import('../lib/session_store.js');
// These tests are about WHO can sign in with a player code, so every call comes
// from a browser the parent already approved (remembered-device cookie) and
// starts with fresh rate-limit windows. The new-device parent step and the
// limits themselves are covered in test/web-signin-protection.test.js.
const codeSignin = async (req, res) => {
  for (const k of [...fake.map.keys()]) if (String(k).startsWith('rl:')) fake.map.delete(k);
  const pid = String((req.body && req.body.playerId) || '').trim().toLowerCase();
  req.headers = { ...(req.headers || {}), cookie: `${deviceCookieName(pid)}=${mintDeviceToken(pid)}` };
  return _handlers.codeSignin(req, res);
};
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

describe('code-signin with a team code and no player id (a kid on a new team)', () => {
  // No player id in the body, so mark this browser as approved for the kid we
  // expect the team code + code to find.
  const asKid = (pid, body) => async (res) => {
    for (const k of [...fake.map.keys()]) if (String(k).startsWith('rl:')) fake.map.delete(k);
    return _handlers.codeSignin({ ...post(body), headers: { cookie: `${deviceCookieName(pid)}=${mintDeviceToken(pid)}` } }, res);
  };
  it('finds the player from the team code plus their own code', async () => {
    await seedFlyers();
    const res = makeRes();
    await asKid('zara', { teamCode: 'FLYERS10', code: '442026', keep: true })(res);
    expect(res.statusCode).toBe(200);
    expect(res.body.player).toEqual({ id: 'zara', name: 'Zara', number: 44, teamCode: 'FLYERS10', teamName: 'Flyers 9U' });
    expect(verifySession(tokenFrom(res.headers['Set-Cookie'])).playerId).toBe('zara');
  });
  it('accepts the team code in any case', async () => {
    await seedFlyers();
    const res = makeRes();
    await asKid('milo', { teamCode: 'flyers10', code: '82027' })(res);
    expect(res.statusCode).toBe(200);
    expect(res.body.player.id).toBe('milo');
  });
  it('rejects a code nobody on that team has', async () => {
    await seedFlyers();
    const res = makeRes();
    await codeSignin(post({ teamCode: 'FLYERS10', code: '992026' }), res);
    expect(res.statusCode).toBe(401);
  });
  it('never signs into another team with that team code', async () => {
    await seedFlyers();
    await seedRangers();
    const res = makeRes();
    await codeSignin(post({ teamCode: 'FLYERS10', code: '712026' }), res); // Alder's Rangers code
    expect(res.statusCode).toBe(401);
  });
  it('refuses when two kids on the team share the number', async () => {
    await seedFlyers();
    await addMember('FLYERS10', { playerId: 'ava', firstName: 'Ava', number: 44 });
    const res = makeRes();
    await codeSignin(post({ teamCode: 'FLYERS10', code: '442026' }), res);
    expect(res.statusCode).toBe(401);
  });
  it('rejects an unknown team code', async () => {
    const res = makeRes();
    await codeSignin(post({ teamCode: 'NOPE99', code: '442026' }), res);
    expect(res.statusCode).toBe(401);
  });
});

describe('code-signin on a non-Rangers team', () => {
  it('signs a Flyers player in with jersey + season and mints a session', async () => {
    await seedFlyers();
    const res = makeRes();
    await codeSignin(post({ playerId: 'zara', code: '442026', keep: true }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.player).toEqual({ id: 'zara', name: 'Zara', number: 44, teamCode: 'FLYERS10', teamName: 'Flyers 9U' });
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
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'bad code' });
  });

  it('rejects a player removed from their team', async () => {
    await seedFlyers();
    await removeMember('FLYERS10', 'milo');
    const res = makeRes();
    await codeSignin(post({ playerId: 'milo', code: '82026' }), res);
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'bad code' });
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
          expect(res.body.player).toMatchObject({ id: p.id, name: p.name, number: p.number, teamCode: 'RANGERS72' });
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
