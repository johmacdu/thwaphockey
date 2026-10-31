// test/watch-endpoints.test.js
//
// Apple Watch server work (step 3c):
//   - GET /api/done?view=today   today's drills from lib/drills.js, done flags
//   - GET /api/done?view=rings   this week's rings toward the player view goals
//   - goalie from the member store's roster position (lib/positions.js), with
//     GOALIE_IDS as the fallback, for the done write gate, today and rings
//   - the coach roster board counts the coach's OWN team, not the Rangers

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FakeRedis } from './fakeRedis.js';

const fake = new FakeRedis();
vi.mock('@upstash/redis', () => ({ Redis: class { constructor() { return fake; } } }));

function setEnv() {
  process.env.KV_REST_API_URL = 'https://fake';
  process.env.KV_REST_API_TOKEN = 'fake';
  process.env.SESSION_TOKEN_SECRET = 'session-secret-please-change';
}
setEnv();

const { default: done } = await import('../api/done.js');
const { _handlers: coach } = await import('../api/coach.js');
const { mintSession } = await import('../lib/session_store.js');
const { setTeam, addMember, updateMember, setTeamPlan } = await import('../lib/teams_store.js');
const { isGoalie, disciplinesForPlayer } = await import('../lib/positions.js');
const drills = await import('../lib/drills.js');

function makeRes() {
  return {
    statusCode: 200, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
}
const cookie = (pid) => ({ cookie: `thwapSession=${mintSession(pid, 'parent@example.com')}` });
const getAs = (pid, query = {}) => ({ method: 'GET', query, headers: pid ? cookie(pid) : {} });
const postAs = (pid, body) => ({ method: 'POST', query: {}, body, headers: pid ? cookie(pid) : {} });
async function call(handler, req) { const res = makeRes(); await handler(req, res); return res; }
// Pin "now" to 19:00 UTC (noon in Vancouver) on a date.
function at(date) { vi.setSystemTime(new Date(`${date}T19:00:00Z`)); }

beforeEach(async () => {
  fake.map.clear();
  setEnv();
  vi.useFakeTimers({ toFake: ['Date'] });
  at('2026-10-28'); // a Wednesday
  await setTeam('FLYERS10', { name: 'Flyers 9U', createdAt: new Date().toISOString() });
  await addMember('FLYERS10', { playerId: 'zara', firstName: 'Zara', lastName: 'Quinn', number: 44, position: 'F' });
  await addMember('FLYERS10', { playerId: 'gus', firstName: 'Gus', lastName: 'Net', number: 30, position: 'G' });
});
afterEach(() => { vi.useRealTimers(); });

describe('GET /api/done?view=today', () => {
  it('needs a session (401) and only answers for yourself (403)', async () => {
    expect((await call(done, getAs(null, { view: 'today' }))).statusCode).toBe(401);
    expect((await call(done, getAs('lewie', { view: 'today', player: 'alder' }))).statusCode).toBe(403);
    expect((await call(done, getAs('lewie', { view: 'today', player: 'lewie' }))).statusCode).toBe(200);
    expect((await call(done, getAs('lewie', { view: 'nope' }))).statusCode).toBe(400);
  });

  it('returns the same drills, ids and order the web app shows today', async () => {
    const r = await call(done, getAs('lewie', { view: 'today' }));
    expect(r.body).toMatchObject({ ok: true, date: '2026-10-28', restDay: false, goalie: false });
    const want = drills.todayList(drills.dayIndexForDate('2026-10-28'), {}).drills;
    expect(r.body.drills.map((d) => d.id)).toEqual(want.map((d) => d.id));
    expect(r.body.drills.map((d) => d.id)).toEqual(['stick:0', 'stick:1', 'stick:2', 'shoot:0', 'shoot:1', 'shoot:2', 'dryland:0', 'dryland:1', 'dryland:2', 'dryland:3']);
    const first = r.body.drills[0];
    expect(first).toMatchObject({ id: 'stick:0', discipline: 'stick', name: 'The Triangle Drill', dose: 'Multi-Directional', done: false });
    expect(first.steps.length).toBeGreaterThan(0);
    expect(first.timer).toMatchObject({ type: 'reps', sets: 4, workSeconds: 40, restSeconds: 15 });
    const shot = r.body.drills.find((d) => d.discipline === 'shoot');
    expect(shot.timer).toMatchObject({ type: 'session', sets: 1, workSeconds: 150, restSeconds: 0 });
    expect(r.headers['Cache-Control']).toBe('no-store');
  });

  it('marks the drills already checked off today', async () => {
    const m = await call(done, postAs('lewie', { player: 'lewie', discipline: 'dryland', drillId: 'dryland:1', drillName: 'Skater Jumps' }));
    expect(m.statusCode).toBe(200);
    const r = await call(done, getAs('lewie', { view: 'today' }));
    expect(r.body.drills.filter((d) => d.done).map((d) => d.id)).toEqual(['dryland:1']);
  });

  it('weekend (Saturday): dryland rests, Hands and Shooting come back as bonus drills', async () => {
    at('2026-10-31');
    const r = await call(done, getAs('lewie', { view: 'today' }));
    expect(r.body).toMatchObject({ ok: true, date: '2026-10-31', restDay: true, bonusDay: true });
    // The exact list the web page renders on the weekend: index.html calls these
    // same two functions for its Hands and Shooting pages (drills-equivalence
    // proves the page and lib/drills.js agree), with the same positional ids.
    const di = drills.dayIndexForDate('2026-10-31');
    const want = [
      ...drills.stickForDay(di).map((d, i) => `stick:${i}=stick=${d.name}`),
      ...drills.shootForDay(di, false).map((d, i) => `shoot:${i}=shoot=${d.name}`),
    ];
    expect(r.body.drills.map((d) => `${d.id}=${d.discipline}=${d.name}`)).toEqual(want);
    expect(r.body.drills.length).toBeGreaterThan(0);
    expect(r.body.drills.every((d) => d.bonus === true && d.done === false)).toBe(true);
    expect(r.body.drills.some((d) => d.discipline === 'dryland')).toBe(false);
  });

  it('weekend (Sunday) is a bonus day too', async () => {
    at('2026-11-01');
    const r = await call(done, getAs('lewie', { view: 'today' }));
    expect(r.body).toMatchObject({ restDay: true, bonusDay: true });
    expect(new Set(r.body.drills.map((d) => d.discipline))).toEqual(new Set(['stick', 'shoot']));
  });

  it('a weekend check-off is the same record the web writes, and shows as done', async () => {
    at('2026-10-31');
    const m = await call(done, postAs('lewie', { player: 'lewie', discipline: 'stick', drillId: 'stick:1' }));
    expect(m.statusCode).toBe(200);
    const r = await call(done, getAs('lewie', { view: 'today' }));
    expect(r.body.drills.filter((d) => d.done).map((d) => d.id)).toEqual(['stick:1']);
  });

  it('weekend goalie with Net play off: Hands only', async () => {
    at('2026-10-31');
    const r = await call(done, getAs('gus', { view: 'today' }));
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatchObject({ goalie: true, restDay: true, bonusDay: true });
    expect(new Set(r.body.drills.map((d) => d.discipline))).toEqual(new Set(['stick']));
  });

  it('weekdays carry no bonus flags', async () => {
    const r = await call(done, getAs('lewie', { view: 'today' }));
    expect(r.body).toMatchObject({ restDay: false, bonusDay: false });
    expect(r.body.drills.some((d) => 'bonus' in d)).toBe(false);
  });

  it('works for a player on another team, and follows that team coach dryland picks', async () => {
    await setTeamPlan('FLYERS10', { wed: { dryland: ['Wall Sit', 'Calf Raises'] } });
    const r = await call(done, getAs('zara', { view: 'today' }));
    expect(r.statusCode).toBe(200);
    expect(r.body.drills.filter((d) => d.discipline === 'dryland').map((d) => d.id + '=' + d.name))
      .toEqual(['dryland:0=Wall Sit', 'dryland:1=Calf Raises']);
    // the Rangers keep the built-in rotation
    const lewie = await call(done, getAs('lewie', { view: 'today' }));
    expect(lewie.body.drills.filter((d) => d.discipline === 'dryland').length).toBe(4);
  });

  it('a goalie gets Net play, never Shooting (Net play drills are still off, so none listed)', async () => {
    for (const pid of ['johnny', 'gus']) {
      const r = await call(done, getAs(pid, { view: 'today' }));
      expect(r.body.goalie).toBe(true);
      expect(r.body.drills.some((d) => d.discipline === 'shoot')).toBe(false);
      expect(r.body.drills.some((d) => d.discipline === 'stick')).toBe(true);
      expect(r.body.drills.some((d) => d.discipline === 'dryland')).toBe(true);
    }
  });
});

describe('GET /api/done?view=rings', () => {
  it('needs a session (401) and only answers for yourself (403)', async () => {
    expect((await call(done, getAs(null, { view: 'rings' }))).statusCode).toBe(401);
    expect((await call(done, getAs('lewie', { view: 'rings', player: 'johnny' }))).statusCode).toBe(403);
  });

  it('skater rings: stick, shoot, dryland toward the player view goals', async () => {
    await call(done, postAs('lewie', { player: 'lewie', discipline: 'stick', drillId: 'stick:0' }));
    await call(done, postAs('lewie', { player: 'lewie', discipline: 'stick', drillId: 'stick:1' }));
    await call(done, postAs('lewie', { player: 'lewie', discipline: 'shoot', drillId: 'shoot:0' }));
    const r = await call(done, getAs('lewie', { view: 'rings' }));
    expect(r.body).toMatchObject({ ok: true, goalie: false, week: { start: '2026-10-26', end: '2026-10-28' } });
    expect(r.body.rings).toEqual({
      stick: { done: 2, goal: 19 },
      shoot: { done: 1, goal: 19 },
      dryland: { done: 0, goal: 18 },
    });
  });

  it('goalie rings: netplay replaces shoot (Johnny by fallback, Gus by member position)', async () => {
    for (const pid of ['johnny', 'gus']) {
      const r = await call(done, getAs(pid, { view: 'rings' }));
      expect(Object.keys(r.body.rings)).toEqual(['stick', 'netplay', 'dryland']);
      expect(r.body.rings.netplay.goal).toBe(drills.weekGoals(true).netplay);
    }
  });

  it('a non-Rangers player sees their own week', async () => {
    await call(done, postAs('zara', { player: 'zara', discipline: 'dryland', drillId: 'dryland:0' }));
    const r = await call(done, getAs('zara', { view: 'rings' }));
    expect(r.body.rings.dryland.done).toBe(1);
  });
});

describe('goalie comes from the member store position', () => {
  it('position G / goalie means goalie, on any team', async () => {
    expect(await isGoalie('gus')).toBe(true);
    await updateMember('zara', { position: 'goalie' });
    expect(await isGoalie('zara')).toBe(true);
    expect(await disciplinesForPlayer('zara')).toEqual(['stick', 'netplay', 'dryland']);
  });

  it('no position falls back to GOALIE_IDS (Johnny), a skater position overrides it', async () => {
    expect(await isGoalie('johnny')).toBe(true); // no member record
    expect(await isGoalie('lewie')).toBe(false);
    await addMember('RANGERS72', { playerId: 'johnny', firstName: 'Johnny', number: 1, position: '' });
    expect(await isGoalie('johnny')).toBe(true); // empty position -> fallback
    await updateMember('johnny', { position: 'D' });
    expect(await isGoalie('johnny')).toBe(false);
  });

  it('the done write gate follows it: a store goalie logs netplay, not shoot', async () => {
    const bad = await call(done, postAs('gus', { player: 'gus', discipline: 'shoot', drillId: 'shoot:0' }));
    expect(bad.statusCode).toBe(400);
    expect(bad.body.error).toBe('discipline not for this position');
    const ok = await call(done, postAs('gus', { player: 'gus', discipline: 'netplay', drillId: 'shoot:0' }));
    expect(ok.statusCode).toBe(200);
    const zara = await call(done, postAs('zara', { player: 'zara', discipline: 'netplay', drillId: 'shoot:0' }));
    expect(zara.statusCode).toBe(400);
  });

  it('the plain GET carries the goalie flag the web app caches', async () => {
    expect((await call(done, getAs('gus'))).body.goalie).toBe(true);
    expect((await call(done, getAs('zara'))).body.goalie).toBe(false);
    expect((await call(done, getAs('johnny', { week: '1' }))).body.goalie).toBe(true);
  });
});

describe('coach roster board is per team', () => {
  it("another team's coach sees their own players' week, not zeros from the Rangers board", async () => {
    await call(done, postAs('zara', { player: 'zara', discipline: 'stick', drillId: 'stick:0' }));
    await call(done, postAs('zara', { player: 'zara', discipline: 'dryland', drillId: 'dryland:0' }));
    const r = await call(coach.roster, { method: 'GET', query: { code: 'FLYERS10' }, headers: {} });
    expect(r.statusCode).toBe(200);
    const z = r.body.members.find((m) => m.playerId === 'zara');
    expect(z.week).toMatchObject({ stick: 1, dryland: 1 });
    expect(z.trainedThisWeek).toBe(true);
    expect(r.body.participation).toEqual({ trained: 1, total: 2 });
  });

  it('the player rollup counts a non-Rangers player', async () => {
    await call(done, postAs('zara', { player: 'zara', discipline: 'stick', drillId: 'stick:0' }));
    const r = await call(coach.playerRollup, { method: 'GET', query: { playerId: 'zara' }, headers: {} });
    expect(r.body.baseThisWeek).toMatchObject({ stick: 1 });
  });
});
