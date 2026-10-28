// test/team-goal.test.js
//
// The weekly team goal (decided Oct 28 2026): starts at 75; each finished week
// the team hits it raises the next week's goal by 10, up to 145; a missed week
// keeps the goal (it never goes down). Finished weeks are recorded once in
// teamgoal:ladder so they never change later. The team total counts Hands,
// Shooting, Net play, Dryland and Passing (the board's team bar), not Hockey IQ.
// Replaces the old fixed date schedule (team-goal-schedule.test.js).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { FakeRedis } from './fakeRedis.js';

const fake = new FakeRedis();
vi.mock('@upstash/redis', () => ({ Redis: class { constructor() { return fake; } } }));
process.env.KV_REST_API_URL = 'https://fake';
process.env.KV_REST_API_TOKEN = 'fake';

const { currentTeamGoal, nextTeamGoal, TEAM_GOAL, ROSTER } = await import('../lib/store.js');
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// Noon UTC, so the Vancouver local day is the same calendar day.
const at = (iso) => vi.setSystemTime(new Date(iso + 'T19:00:00Z'));
// Put n team-bar drills for a player on a date (appends to their events list).
function drills(id, date, n, disc = 'stick') {
  const key = `events:${id}`;
  const list = JSON.parse(fake.map.get(key) || '[]');
  for (let i = 0; i < n; i++) list.push({ date, disc });
  fake.map.set(key, JSON.stringify(list));
}
const A = () => ROSTER[0].id, B = () => ROSTER[1].id;

beforeEach(() => { fake.map.clear(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('the rule', () => {
  it('+10 on a hit, the same on a miss, never past 145', () => {
    expect(nextTeamGoal(75, 75)).toBe(85);
    expect(nextTeamGoal(75, 74)).toBe(75);
    expect(nextTeamGoal(135, 200)).toBe(145);
    expect(nextTeamGoal(145, 500)).toBe(145);
    expect(TEAM_GOAL).toMatchObject({ start: 75, step: 10, cap: 145, fromWeek: '2026-10-26' });
  });
});

describe('currentTeamGoal', () => {
  it('starts at 75 this week, and records nothing until a week finishes', async () => {
    at('2026-10-28');
    const g = await currentTeamGoal();
    expect(g.goal).toBe(75);
    expect(g.weekStart).toBe('2026-10-26');
    expect(fake.map.has('teamgoal:ladder')).toBe(false);
  });

  it('a hit week raises next week to 85; drills from two kids add up', async () => {
    drills(A(), '2026-10-27', 50);
    drills(B(), '2026-11-01', 25, 'dryland'); // Sunday still counts for that week
    at('2026-11-04');
    const g = await currentTeamGoal();
    expect(g.goal).toBe(85);
    expect(g.weeks).toEqual([{ weekStart: '2026-10-26', goal: 75, total: 75, hit: true }]);
  });

  it('a missed week keeps the goal', async () => {
    drills(A(), '2026-10-27', 80);   // hit 75
    drills(A(), '2026-11-03', 10);   // miss 85
    at('2026-11-11');
    const g = await currentTeamGoal();
    expect(g.weeks.map((w) => [w.goal, w.hit])).toEqual([[75, true], [85, false]]);
    expect(g.goal).toBe(85);
  });

  it('hits every week climb 75, 85, ... and stop at 145', async () => {
    const mondays = [];
    for (let i = 0; i < 10; i++) {
      const d = new Date(Date.UTC(2026, 9, 26 + 7 * i));
      mondays.push(d.toISOString().slice(0, 10));
    }
    mondays.forEach((m) => drills(A(), m, 200));
    at('2027-01-06'); // the week after the 10th Monday
    const g = await currentTeamGoal();
    expect(g.weeks.map((w) => w.goal)).toEqual([75, 85, 95, 105, 115, 125, 135, 145, 145, 145]);
    expect(g.goal).toBe(145);
  });

  it('Hockey IQ does not count toward the team bar', async () => {
    drills(A(), '2026-10-27', 100, 'iq');
    drills(A(), '2026-10-27', 5, 'shoot');
    at('2026-11-04');
    const g = await currentTeamGoal();
    expect(g.weeks[0].total).toBe(5);
    expect(g.goal).toBe(75);
  });

  it('a recorded week never changes, even if old drills drop off later', async () => {
    drills(A(), '2026-10-27', 80);
    at('2026-11-04');
    expect((await currentTeamGoal()).goal).toBe(85);
    fake.map.delete(`events:${A()}`); // the capped events list lost the old week
    at('2026-11-05');
    const g = await currentTeamGoal();
    expect(g.weeks).toEqual([{ weekStart: '2026-10-26', goal: 75, total: 80, hit: true }]);
    expect(g.goal).toBe(85);
  });
});

describe('the bar reads it', () => {
  it('/api/board?tf=week sends this week\'s goal; the all-time board does not', async () => {
    const { default: board } = await import('../api/board.js');
    const res = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(p) { this.body = p; return this; }, setHeader() {} });
    drills(A(), '2026-10-27', 80);
    at('2026-11-04');
    const wk = res();
    await board({ method: 'GET', query: { tf: 'week' }, headers: {} }, wk);
    expect(wk.body.teamGoal).toEqual({ goal: 85, weekStart: '2026-11-02' });
    const all = res();
    await board({ method: 'GET', query: {}, headers: {} }, all);
    expect(all.body.teamGoal).toBeUndefined();
  });
  it('teamGoalFor uses the server goal, with 75 only as the fallback', () => {
    expect(html).toMatch(/function teamGoalFor\(\)\{ return window\.THWAP_TEAM_GOAL\|\|75; \}/);
    expect(html).toMatch(/var goal=teamGoalFor\(\)/);
    expect(html).not.toMatch(/TEAM_GOAL_SCHEDULE/);
    // Both weekly-board fetches pick the goal up.
    expect(html.match(/window\.THWAP_TEAM_GOAL=j\.teamGoal\.goal/g).length).toBe(2);
  });
});
