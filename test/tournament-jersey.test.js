// test/tournament-jersey.test.js
//
// Phase 4 tournament jersey (decided Oct 28 2026): the coach puts a
// tournament on the team schedule; a player who trains 2 days in that
// tournament week (the Monday it starts through its last day) earns the
// jersey, and it is saved to their grants so it is kept forever.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
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

const A = await import('../lib/avatar_items.js');
const { _handlers, _seed } = await import('../api/coach.js');
const { handleLookGet } = await import('../lib/look_api.js');
const { setSchedule } = await import('../lib/schedule_store.js');
const { getGrants } = await import('../lib/store.js');
const { mintSession, SESSION_COOKIE } = await import('../lib/session_store.js');
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

function makeRes() {
  return { statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(p) { this.body = p; return this; }, setHeader(k, v) { this.headers[k] = v; } };
}
const post = (body) => ({ method: 'POST', body, query: {}, headers: {} });
const CODE = () => _seed.SEED_TEAM_CODE;
const TOURNEY = { id: 't-1113', kind: 'tournament', date: '2026-11-13', endDate: '2026-11-15', opponent: 'Nuclear Meltdown' };

async function seed() {
  const res = makeRes();
  await _handlers.coachLogin(post({ email: _seed.SEED_COACH_EMAIL, password: _seed.SEED_COACH_PASSWORD }), res);
  return res.body.token;
}
async function look(id) {
  const res = makeRes();
  await handleLookGet({ method: 'GET', query: {}, headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(mintSession(id, 'p@example.com'))}` } }, res);
  return res.body;
}
const trainOn = (id, days) => fake.map.set(`days:${id}`, JSON.stringify(days));

beforeEach(() => { fake.map.clear(); setEnv(); });

describe('catalog', () => {
  it('a tournament jersey, earned with 2 days in a tournament week', () => {
    const it0 = A.itemById('jersey-tournament');
    expect(it0).toMatchObject({ slot: 'jersey', label: 'Tournament jersey', rule: { type: 'tournament', n: 2 } });
    expect(A.isUnlocked(it0, { tournament: 1 })).toBe(false);
    expect(A.isUnlocked(it0, { tournament: 2 })).toBe(true);
    expect(A.isUnlocked(it0, { tournament: 0 }, ['jersey-tournament'])).toBe(true); // kept once earned
  });
});

describe('earning it from the team schedule', () => {
  it('2 training days in the tournament week (Mon Nov 9 to Sun Nov 15) unlock it, and it is saved', async () => {
    await seed();
    await setSchedule(CODE(), { practices: [], events: [TOURNEY] });
    trainOn('lewie', ['2026-11-10', '2026-11-14']);
    const j = await look('lewie');
    expect(j.progress.tournament).toBe(2);
    expect(j.unlocked).toContain('jersey-tournament');
    expect(await getGrants('lewie')).toContain('jersey-tournament');
  });

  it('kept forever: still unlocked after the tournament is removed from the schedule', async () => {
    await seed();
    await setSchedule(CODE(), { practices: [], events: [TOURNEY] });
    trainOn('lewie', ['2026-11-10', '2026-11-14']);
    await look('lewie');
    await setSchedule(CODE(), { practices: [], events: [] });
    expect((await look('lewie')).unlocked).toContain('jersey-tournament');
  });

  it('one day in the week, or days outside it, do not unlock it', async () => {
    await seed();
    await setSchedule(CODE(), { practices: [], events: [TOURNEY] });
    trainOn('lewie', ['2026-11-08', '2026-11-12', '2026-11-16']); // Sun before, one inside, Mon after
    const j = await look('lewie');
    expect(j.progress.tournament).toBe(1);
    expect(j.unlocked).not.toContain('jersey-tournament');
    expect(await getGrants('lewie')).not.toContain('jersey-tournament');
  });

  it('a game is not a tournament', async () => {
    await seed();
    await setSchedule(CODE(), { practices: [], events: [{ id: 'g-1', kind: 'game', date: '2026-11-13', opponent: 'X' }] });
    trainOn('lewie', ['2026-11-10', '2026-11-12']);
    expect((await look('lewie')).unlocked).not.toContain('jersey-tournament');
  });
});

describe('the coach adds a tournament', () => {
  it('saves kind tournament with its last day', async () => {
    const t = await seed();
    const res = makeRes();
    await _handlers.addEvent(post({ coachToken: t, code: CODE(), event: { kind: 'tournament', date: '2027-01-15', endDate: '2027-01-17', opponent: 'Winter Classic' } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.schedule.events.find((e) => e.opponent === 'Winter Classic')).toMatchObject({ kind: 'tournament', endDate: '2027-01-17' });
  });
  it('refuses a last day before the first, a bad date, or an unknown kind', async () => {
    const t = await seed();
    const ask = async (event) => { const r = makeRes(); await _handlers.addEvent(post({ coachToken: t, code: CODE(), event }), r); return r.statusCode; };
    expect(await ask({ kind: 'tournament', date: '2027-01-15', endDate: '2027-01-14', opponent: 'X' })).toBe(400);
    expect(await ask({ kind: 'game', date: 'soon', opponent: 'X' })).toBe(400);
    expect(await ask({ kind: 'party', date: '2027-01-15', opponent: 'X' })).toBe(400);
    expect(await ask({ date: '2027-01-15', opponent: 'X' })).toBe(200); // no kind = a game
  });
  it('the add form offers Game or Tournament, with a Last day only for tournaments', () => {
    expect(html).toMatch(/id='sgKindGame' checked><span>Game<\/span>/);
    expect(html).toMatch(/id='sgKindTour'><span>Tournament<\/span>/);
    expect(html).toMatch(/<label class='sheet-lab' id='sgEndRow' hidden>Last day<input class='pgate-in' id='sgEnd' type='date'><\/label>/);
    expect(html).toMatch(/\.sheet-lab\[hidden\]\{display:none\}/);
    expect(html).toMatch(/kind:tour\?'tournament':'game'/);
  });
});
