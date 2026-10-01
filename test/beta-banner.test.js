// test/beta-banner.test.js
//
// Guards for the per-team beta-banner auto-hide (Option A: a per-team betaUntil
// date so it scales to new teams automatically).
//
// Backend (api/coach.js + lib/teams_store.js), Redis faked exactly like
// test/coach.test.js:
//   - ?action=beta returns { ok, betaUntil } for the seed team (public, no auth)
//   - the seed backfill is idempotent: now+14d, and NOT pushed out on redeploy
//   - a NEW team gets betaUntil = createdAt + 30d
//   - roster also carries team.betaUntil
// Client date comparison (the hide/show rule the index.html IIFE applies) is
// tested as pure logic, plus source guards on index.html matching the approach
// in test/game-goals-prep-window.test.js (jsdom cannot run index.html).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
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
const store = await import('../lib/teams_store.js');

function makeRes() {
  return {
    statusCode: 200, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
}
const get = (query = {}) => ({ method: 'GET', query, headers: {} });

const DAY_MS = 86400000;

beforeEach(() => {
  fake.map.clear();
  setEnv();
});

describe('?action=beta (public, no auth)', () => {
  it('returns a betaUntil for the seed team, no-store, and about 14 days out', async () => {
    const before = Date.now();
    const res = makeRes();
    await _handlers.beta(get({}), res); // defaults to the seed team
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.betaUntil).toBeTruthy();
    expect(res.headers['Cache-Control']).toBe('no-store');
    const until = Date.parse(res.body.betaUntil);
    // ~14 days from now (allow a day of slack around the test clock).
    expect(until).toBeGreaterThan(before + 13 * DAY_MS);
    expect(until).toBeLessThan(before + 15 * DAY_MS);
  });

  it('needs no coach token (it is the player-home data source)', async () => {
    const res = makeRes();
    await _handlers.beta(get({ code: _seed.SEED_TEAM_CODE }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('returns betaUntil:null for an unknown team instead of erroring', async () => {
    const res = makeRes();
    await _handlers.beta(get({ code: 'NOSUCHTEAM99' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.betaUntil).toBeNull();
  });
});

describe('seed backfill is idempotent (does not drift on redeploy)', () => {
  it('keeps the SAME betaUntil across repeated ensureSeed runs', async () => {
    const r1 = makeRes();
    await _handlers.beta(get({}), r1); // ensureSeed runs here
    const first = r1.body.betaUntil;
    // Simulate a later redeploy: ensureSeed again, then re-read.
    await _seed.ensureSeed();
    const r2 = makeRes();
    await _handlers.beta(get({}), r2);
    expect(r2.body.betaUntil).toBe(first);
  });

  it('backfillSeedBeta never overwrites an existing betaUntil', async () => {
    const pinned = new Date(Date.now() + 3 * DAY_MS).toISOString();
    await store.setTeam(_seed.SEED_TEAM_CODE, {
      name: 'Jr Rangers 10U', createdAt: new Date('2020-01-01').toISOString(), betaUntil: pinned,
    });
    const got = await store.backfillSeedBeta(_seed.SEED_TEAM_CODE);
    expect(got).toBe(pinned);
    expect(await store.getBetaUntil(_seed.SEED_TEAM_CODE)).toBe(pinned);
  });
});

describe('a NEW team gets createdAt + 30 days (Option A: per-team, auto-scaling)', () => {
  it('defaults betaUntil to createdAt + 30d when none is supplied', async () => {
    const createdAt = new Date('2026-06-01T00:00:00.000Z').toISOString();
    const rec = await store.setTeam('NEWTEAM10', { name: 'New Team', createdAt });
    const expected = new Date(Date.parse(createdAt) + 30 * DAY_MS).toISOString();
    expect(rec.betaUntil).toBe(expected);
    expect(await store.getBetaUntil('NEWTEAM10')).toBe(expected);
  });

  it('a plain record rewrite does not reset or push out an existing window', async () => {
    const createdAt = new Date('2026-06-01T00:00:00.000Z').toISOString();
    const first = await store.setTeam('NEWTEAM11', { name: 'New Team', createdAt });
    // Rewrite the same team (e.g. a profile edit) with no betaUntil provided.
    const again = await store.setTeam('NEWTEAM11', { name: 'Renamed Team', createdAt });
    expect(again.betaUntil).toBe(first.betaUntil);
  });

  it('exposes betaUntil in the roster response team object', async () => {
    const res = makeRes();
    await _handlers.roster(get({ code: _seed.SEED_TEAM_CODE }), res);
    expect(res.body.ok).toBe(true);
    expect(res.body.team).toHaveProperty('betaUntil');
    expect(res.body.team.betaUntil).toBeTruthy();
  });
});

// The hide/show decision the index.html IIFE applies: hide only when betaUntil
// is a real date AND now is past it; otherwise (including a null date or an
// unparseable one) leave the banner shown. This mirrors the inline logic exactly.
function shouldHide(betaUntil, now) {
  if (!betaUntil) return false;
  const until = Date.parse(betaUntil);
  if (Number.isNaN(until)) return false;
  return now > until;
}

describe('client hide/show date comparison (fail-open)', () => {
  const now = Date.parse('2026-06-15T12:00:00.000Z');
  it('HIDES when now is past betaUntil', () => {
    expect(shouldHide('2026-06-14T00:00:00.000Z', now)).toBe(true);
  });
  it('SHOWS when betaUntil is still in the future', () => {
    expect(shouldHide('2026-06-20T00:00:00.000Z', now)).toBe(false);
  });
  it('SHOWS (fail-open) when betaUntil is null', () => {
    expect(shouldHide(null, now)).toBe(false);
  });
  it('SHOWS (fail-open) when betaUntil is unparseable', () => {
    expect(shouldHide('not-a-date', now)).toBe(false);
  });
});

describe('index.html banner source guards', () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');

  it('the banner has an id so the auto-hide can target it', () => {
    expect(html).toMatch(/class='wipnote' id='wipNote'/);
  });

  it('fetches the public no-auth beta endpoint with no-store', () => {
    expect(html).toMatch(/fetch\('\/api\/coach\?action=beta',\{cache:'no-store'\}\)/);
  });

  it('hides only when now is past a real betaUntil', () => {
    expect(html).toMatch(/Date\.now\(\)>until/);
    expect(html).toMatch(/!isNaN\(until\)/);
    expect(html).toMatch(/\.hidden=true/);
  });

  it('fails open: a fetch error leaves the banner shown (a bare .catch, no hide)', () => {
    expect(html).toMatch(/\.catch\(function\(\)\{\}\)/);
  });
});
