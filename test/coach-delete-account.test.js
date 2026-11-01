// test/coach-delete-account.test.js
//
// App Store guideline 5.1.1(v): an app that lets people create an account must
// let them delete it in the app. Coaches are the only accounts Thwap creates,
// so POST ?action=delete-account deletes the signed-in coach's own login. The
// typed email must match, every session stops working, and the coach comes off
// every team's coach list. Teams and their players are kept, a head coach's
// assistant takes over, and the seed coach (which ensureSeed recreates) is
// refused. The Profile page carries the coach-only row and two-step confirm.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
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
const { getCoach, getTeam, listTeamCoaches, listMembers } = await import('../lib/teams_store.js');

function makeRes() {
  return {
    statusCode: 200, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
}
const post = (body) => ({ method: 'POST', body, query: {}, headers: {} });
async function call(name, req) { const res = makeRes(); await _handlers[name](req, res); return res; }

async function register(email, name = 'Coach') {
  const r = await call('coachRegister', post({ email, password: 'secret1', name }));
  return r.body.token;
}
async function makeTeam(token, name = 'Sharks') {
  const r = await call('createTeam', post({ coachToken: token, name }));
  return r.body.code;
}

beforeEach(() => { fake.map.clear(); setEnv(); });

describe('delete-account', () => {
  it('deletes the coach login and ends their session', async () => {
    const t = await register('solo@example.com');
    const res = await call('deleteAccount', post({ coachToken: t, email: 'solo@example.com' }));
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(await getCoach('solo@example.com')).toBeNull();
    // The old token no longer works anywhere.
    const after = await call('createTeam', post({ coachToken: t, name: 'Again' }));
    expect(after.statusCode).toBe(401);
    const login = await call('coachLogin', post({ email: 'solo@example.com', password: 'secret1' }));
    expect(login.statusCode).toBe(401);
  });

  it('matches the typed email case-insensitively', async () => {
    const t = await register('case@example.com');
    const res = await call('deleteAccount', post({ coachToken: t, email: '  CASE@Example.com ' }));
    expect(res.statusCode).toBe(200);
    expect(await getCoach('case@example.com')).toBeNull();
  });

  it('refuses when the typed email does not match, and keeps the account', async () => {
    const t = await register('keep@example.com');
    const res = await call('deleteAccount', post({ coachToken: t, email: 'other@example.com' }));
    expect(res.statusCode).toBe(400);
    expect(await getCoach('keep@example.com')).not.toBeNull();
    const empty = await call('deleteAccount', post({ coachToken: t }));
    expect(empty.statusCode).toBe(400);
  });

  it('needs a coach session and a POST', async () => {
    const noAuth = await call('deleteAccount', post({ email: 'x@example.com' }));
    expect(noAuth.statusCode).toBe(401);
    const getReq = await call('deleteAccount', { method: 'GET', query: {}, headers: {}, body: {} });
    expect(getReq.statusCode).toBe(405);
  });

  it('keeps the team and its players when the only coach deletes', async () => {
    const t = await register('head@example.com');
    const code = await makeTeam(t);
    await call('addPlayer', post({ coachToken: t, code, firstName: 'Mia', number: 9, parentEmails: ['p@example.com'] }));
    const res = await call('deleteAccount', post({ coachToken: t, email: 'head@example.com' }));
    expect(res.statusCode).toBe(200);
    const team = await getTeam(code);
    expect(team).not.toBeNull();
    expect(team.name).toBe('Sharks');
    expect(team.coachEmail).toBe('');
    expect((await listMembers(code)).length).toBe(1);
    expect((await listTeamCoaches(code)).some((c) => c.email === 'head@example.com')).toBe(false);
  });

  it('hands the team to the assistant when the head coach deletes', async () => {
    const t = await register('boss@example.com');
    const code = await makeTeam(t);
    await call('teamCoaches', { method: 'GET', query: { code }, headers: {} }); // seeds the head entry
    const inv = await call('inviteCoach', post({ coachToken: t, code, email: 'asst@example.com', password: 'secret1' }));
    expect(inv.statusCode).toBe(200);
    await call('deleteAccount', post({ coachToken: t, email: 'boss@example.com' }));
    const coaches = await listTeamCoaches(code);
    expect(coaches).toEqual([expect.objectContaining({ email: 'asst@example.com', role: 'head' })]);
    expect((await getTeam(code)).coachEmail).toBe('asst@example.com');
    // The listing does not resurrect the deleted head.
    const list = await call('teamCoaches', { method: 'GET', query: { code }, headers: {} });
    expect(list.body.coaches.some((c) => c.email === 'boss@example.com')).toBe(false);
    // The new head can run the team.
    const login = await call('coachLogin', post({ email: 'asst@example.com', password: 'secret1' }));
    const add = await call('addPlayer', post({ coachToken: login.body.token, code, firstName: 'Leo', number: 4, parentEmails: ['q@example.com'] }));
    expect(add.statusCode).toBe(200);
  });

  it('takes an assistant off the team and leaves the head in place', async () => {
    const t = await register('head2@example.com');
    const code = await makeTeam(t);
    await call('teamCoaches', { method: 'GET', query: { code }, headers: {} });
    await call('inviteCoach', post({ coachToken: t, code, email: 'help@example.com', password: 'secret1' }));
    const a = (await call('coachLogin', post({ email: 'help@example.com', password: 'secret1' }))).body.token;
    const res = await call('deleteAccount', post({ coachToken: a, email: 'help@example.com' }));
    expect(res.statusCode).toBe(200);
    expect(await getCoach('help@example.com')).toBeNull();
    const coaches = await listTeamCoaches(code);
    expect(coaches.map((c) => c.email)).toEqual(['head2@example.com']);
    expect((await getTeam(code)).coachEmail).toBe('head2@example.com');
  });

  it('refuses the seed coach, which ensureSeed would recreate', async () => {
    const login = await call('coachLogin', post({ email: _seed.SEED_COACH_EMAIL, password: _seed.SEED_COACH_PASSWORD }));
    const res = await call('deleteAccount', post({ coachToken: login.body.token, email: _seed.SEED_COACH_EMAIL }));
    expect(res.statusCode).toBe(403);
    expect(await getCoach(_seed.SEED_COACH_EMAIL)).not.toBeNull();
  });
});

describe('Profile page: delete account UI', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

  it('has a Delete account row shown only to coaches', () => {
    expect(html).toMatch(/id='profDelAcct'[^>]*>.*Delete account/);
    expect(html).toContain('#profile .prof-delacct{display:none}');
    expect(html).toContain('body.is-coach #profile .prof-delacct{display:flex}');
  });

  it('confirms in two steps and asks for the email', () => {
    expect(html).toContain("id='delAcct' hidden");
    expect(html).toContain("role='alertdialog'");
    expect(html).toContain('Type your email to confirm');
    expect(html).toContain('Your team and its players stay on Thwap.');
    expect(html).toContain("'/api/coach?action=delete-account'");
  });
});
