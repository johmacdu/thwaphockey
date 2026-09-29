// test/self-update-player.test.js
//
// P1 authorization test for api/coach.js ?action=self-update-player.
//
// Contract, as READ from selfUpdatePlayer() in api/coach.js (not assumed):
//   A signed-in PLAYER edits their OWN record, authorized by their own player
//   CODE (jersey number + season year, e.g. Lewie #72 -> "722027" or "722026").
//   The code is checked against the TARGET player's own number, so a player can
//   only pass the gate for the player whose number they hold the code for.
//     - missing playerId                          -> 400 { error: 'playerId required' }
//     - unknown player                            -> 404 { error: 'unknown player' }
//     - wrong/absent playerCode for that player   -> 403 { error: 'that code did not match your player code' }
//     - correct playerCode for that player        -> 200 { ok: true, member }
//
// This proves self-only authorization the way the endpoint actually enforces it:
// the code IS the per-player secret, so supplying player A's code against player
// B's playerId is refused. There is no session-token mechanism on this action.
//
// Harness mirrors test/coach.test.js: fake Redis, seeded Jr Rangers team, and
// the exported _handlers / _seed.

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

// selfUpdatePlayer is intentionally NOT in the _handlers export (only some
// handlers are), and this is a test-only task (no production edits). So we drive
// it through the PUBLIC action router — the default export — with
// query.action = 'self-update-player'. That is also the most faithful test of
// the real request path. _handlers/_seed are still used for seeding.
const { default: handler, _handlers, _seed } = await import('../api/coach.js');

function makeRes() {
  return {
    statusCode: 200, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
}
const post = (body, query = {}) => ({ method: 'POST', body, query, headers: {} });

// Route a POST through the default action router: ?action=<action>.
const selfUpdate = (body) => post(body, { action: 'self-update-player' });
const gamePosition = (body) => post(body, { action: 'set-game-position' });

// Seed the team so its members (with jersey numbers) exist in the store.
async function seedTeam() {
  const res = makeRes();
  await _handlers.coachLogin(post({ email: _seed.SEED_COACH_EMAIL, password: _seed.SEED_COACH_PASSWORD }), res);
  return res;
}

beforeEach(async () => {
  fake.map.clear();
  setEnv();
  await _seed.ensureSeed();
  await seedTeam();
});

describe('self-update-player: a player edits their OWN record', () => {
  it('200 when the correct player code (jersey + 2027) is provided', async () => {
    // Lewie is #72 -> code "722027".
    const res = makeRes();
    await handler(selfUpdate({
      code: _seed.SEED_TEAM_CODE,
      playerId: 'lewie',
      playerCode: '722027',
      lastName: 'MacDuffie',
    }), res);
    expect(res.statusCode, JSON.stringify(res.body)).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.member.lastName).toBe('MacDuffie');
  });

  it('200 when the prior-season code (jersey + 2026) is provided', async () => {
    const res = makeRes();
    await handler(selfUpdate({
      code: _seed.SEED_TEAM_CODE,
      playerId: 'lewie',
      playerCode: '722026',
      lastName: 'Mac',
    }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.member.lastName).toBe('Mac');
  });
});

describe('self-update-player: a player CANNOT edit a DIFFERENT player', () => {
  it("403 when using Lewie's code (722027) to update William (#16)", async () => {
    // William is #16 -> his code is "162027"/"162026". Lewie's code must NOT
    // authorize editing William.
    const res = makeRes();
    await handler(selfUpdate({
      code: _seed.SEED_TEAM_CODE,
      playerId: 'william',
      playerCode: '722027', // Lewie's code, not William's
      lastName: 'Hacked',
    }), res);
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe('that code did not match your player code');
    // William's record was not modified.
    const stored = fake.map.get('teamMember:william');
    expect(stored.lastName).not.toBe('Hacked');
  });

  it('403 when NO player code is supplied at all', async () => {
    const res = makeRes();
    await handler(selfUpdate({
      code: _seed.SEED_TEAM_CODE,
      playerId: 'lewie',
      lastName: 'Nope',
    }), res);
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe('that code did not match your player code');
  });

  it('403 on a plausible-but-wrong code for the target player', async () => {
    const res = makeRes();
    await handler(selfUpdate({
      code: _seed.SEED_TEAM_CODE,
      playerId: 'lewie',
      playerCode: '000000',
      lastName: 'Nope',
    }), res);
    expect(res.statusCode).toBe(403);
  });
});

describe('self-update-player: input + existence guards', () => {
  it('400 when playerId is missing', async () => {
    const res = makeRes();
    await handler(selfUpdate({ code: _seed.SEED_TEAM_CODE, playerCode: '722027' }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('playerId required');
  });

  it('404 on an unknown player (never reaches the code check)', async () => {
    const res = makeRes();
    await handler(selfUpdate({ code: _seed.SEED_TEAM_CODE, playerId: 'ghost', playerCode: '112027' }), res);
    expect(res.statusCode).toBe(404);
    expect(res.body.error).toBe('unknown player');
  });

  it('rejects an empty first name even with a valid code (400)', async () => {
    const res = makeRes();
    await handler(selfUpdate({
      code: _seed.SEED_TEAM_CODE, playerId: 'lewie', playerCode: '722027', firstName: '   ',
    }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('first name cannot be empty');
  });
});

// set-game-position is now gated by the SAME per-player code as
// self-update-player (jersey number + season year). Before the fix it took only
// { playerId, gamePosition } with no auth at all, so any caller could set any
// player's game-day position -- a write to another kid's record. These tests
// lock the gate: the player's own code is required, and one player's code
// cannot move another player's position.
describe('set-game-position authorization (player-code gated)', () => {
  it('accepts a game-position change with the player OWN code', async () => {
    const res = makeRes();
    // Lewie is #72 -> code 722027.
    await handler(gamePosition({ playerId: 'lewie', gamePosition: 'D', playerCode: '722027' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.gamePosition).toBe('D');
  });

  it('REFUSES a game-position change with NO code (403), no write', async () => {
    const res = makeRes();
    await handler(gamePosition({ playerId: 'lewie', gamePosition: 'D' }), res);
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe('that code did not match your player code');
  });

  it("REFUSES using one player's code to move a DIFFERENT player (403)", async () => {
    const res = makeRes();
    // Lewie's code 722027 cannot move William (#16, code 162027).
    await handler(gamePosition({ playerId: 'william', gamePosition: 'D', playerCode: '722027' }), res);
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe('that code did not match your player code');
  });
});
