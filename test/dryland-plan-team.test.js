// test/dryland-plan-team.test.js
//
// The player app reads the coach plan with /api/coach?action=get-plan and NO team
// code. It used to always get the Jr. Rangers 10U plan, so a player on another
// team trained the Rangers dryland on the web while the watch
// (/api/done?view=today) used their own team's plan. The server now resolves the
// team from the player SESSION (lib/team_players.js), the same lookup view=today
// uses, so web and watch agree. An explicit ?code= (coach Plan screen) is
// unchanged.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
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
const { _handlers: coach, _seed } = await import('../api/coach.js');
const { mintSession } = await import('../lib/session_store.js');
const { setTeam, addMember, setTeamPlan } = await import('../lib/teams_store.js');
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
async function call(handler, req) { const res = makeRes(); await handler(req, res); return res; }

const DATE = '2026-10-28'; // a Wednesday (dryland day)
const FLYERS_DRY = ['Box Jumps', 'Wall Sit'];
const RANGERS_DRY = ['Sprint Starts', 'Calf Raises'];

// Web dryland for a fetched plan: the same shared library the page inlines.
const webDryland = (plan) =>
  drills.todayList(drills.dayIndexForDate(DATE), { coachPlan: plan }).drills
    .filter((d) => d.discipline === 'dryland').map((d) => d.name);
const watchDryland = (body) => body.drills.filter((d) => d.discipline === 'dryland').map((d) => d.name);

beforeEach(async () => {
  fake.map.clear();
  setEnv();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${DATE}T19:00:00Z`));
  await _seed.ensureSeed();
  await setTeam('FLYERS10', { name: 'Flyers 9U', createdAt: new Date().toISOString() });
  await addMember('FLYERS10', { playerId: 'zara', firstName: 'Zara', lastName: 'Quinn', number: 44, position: 'F' });
  await setTeamPlan('FLYERS10', { wed: { stick: [], shoot: [], dryland: FLYERS_DRY } });
  await setTeamPlan(_seed.SEED_TEAM_CODE, { wed: { stick: [], shoot: [], dryland: RANGERS_DRY } });
});
afterEach(() => { vi.useRealTimers(); });

describe('get-plan with no code uses the signed-in player team', () => {
  it('a non-Rangers player gets their own team plan, not the Rangers plan', async () => {
    const r = await call(coach.getPlan, getAs('zara'));
    expect(r.statusCode).toBe(200);
    expect(r.body.plan.wed.dryland).toEqual(FLYERS_DRY);
    expect(webDryland(r.body.plan)).toEqual(FLYERS_DRY);
  });

  it('a Rangers player is unchanged', async () => {
    const r = await call(coach.getPlan, getAs('lewie'));
    expect(r.statusCode).toBe(200);
    expect(r.body.plan.wed.dryland).toEqual(RANGERS_DRY);
  });

  it('no session keeps the Rangers default', async () => {
    const r = await call(coach.getPlan, getAs(null));
    expect(r.statusCode).toBe(200);
    expect(r.body.plan.wed.dryland).toEqual(RANGERS_DRY);
  });

  it('a session for an unknown player falls back to Rangers', async () => {
    const r = await call(coach.getPlan, getAs('nobody-here'));
    expect(r.statusCode).toBe(200);
    expect(r.body.plan.wed.dryland).toEqual(RANGERS_DRY);
  });

  it('naming a team directly needs that team: coach, admin, or a player on it', async () => {
    const post = (body) => ({ method: 'POST', body, query: {}, headers: {} });
    const headCoach = (await call(coach.coachLogin, post({ email: _seed.SEED_COACH_EMAIL, password: _seed.SEED_COACH_PASSWORD }))).body.token;
    const stranger = (await call(coach.coachRegister, post({ email: 'stranger@example.com', password: 'secret1', name: 'Stranger' }))).body.token;
    // Signed out, or another team's player, cannot read a team's plan by its code.
    expect((await call(coach.getPlan, getAs(null, { code: 'FLYERS10' }))).statusCode).toBe(403);
    expect((await call(coach.getPlan, getAs('zara', { code: _seed.SEED_TEAM_CODE }))).statusCode).toBe(403);
    // A coach who does not run the team is refused too.
    expect((await call(coach.getPlan, getAs(null, { code: _seed.SEED_TEAM_CODE, coachToken: stranger }))).statusCode).toBe(403);
    // The head coach reads their team; a player may name their own team.
    const asCoach = await call(coach.getPlan, getAs(null, { code: _seed.SEED_TEAM_CODE, coachToken: headCoach }));
    expect(asCoach.statusCode).toBe(200);
    expect(asCoach.body.plan.wed.dryland).toEqual(RANGERS_DRY);
    const own = await call(coach.getPlan, getAs('zara', { code: 'FLYERS10' }));
    expect(own.statusCode).toBe(200);
    expect(own.body.plan.wed.dryland).toEqual(FLYERS_DRY);
  });

  it('web dryland list equals /api/done?view=today for the same player and date', async () => {
    for (const pid of ['zara', 'lewie']) {
      const plan = (await call(coach.getPlan, getAs(pid))).body.plan;
      const today = await call(done, getAs(pid, { view: 'today' }));
      expect(today.statusCode).toBe(200);
      expect(webDryland(plan)).toEqual(watchDryland(today.body));
      expect(watchDryland(today.body).length).toBeGreaterThan(0);
    }
  });
});

describe('index.html player plan fetches', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  it('send the session cookie and no hard-coded team code', () => {
    const calls = html.match(/fetch\('\/api\/coach\?action=get-plan'[^)]*\)/g) || [];
    expect(calls.length).toBe(2);
    for (const c of calls) expect(c).toContain("credentials:'include'");
    expect(html).not.toMatch(/action=get-plan&code=RANGERS/);
  });
  it('coach Plan screen names its team and sends its coach token', () => {
    expect(html).toContain("fetch('/api/coach?action=get-plan&code='+encodeURIComponent(code)+'&coachToken='");
  });
});
