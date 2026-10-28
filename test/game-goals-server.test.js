// test/game-goals-server.test.js
//
// Server-saved Game Day Goals picks (Apple Watch step 3b):
//   POST /api/coach?action=save-game-goals { gameId?, goalIds }
//   GET  /api/coach?action=my-game-goals [&gameId=] [&playerId=&coachToken=]
// plus the goal catalog staying in step with hockey_game_goals.html, and the
// page's pure sync rules (window.ThwapGoalSync) run from the shipped source.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';
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
const { mintSession, SESSION_COOKIE } = await import('../lib/session_store.js');
const { setTeamGoal, addMember, setTeam } = await import('../lib/teams_store.js');
const { GAME_GOALS, GAME_GOAL_TARGET } = await import('../lib/game_goals_catalog.js');

const __dirname = dirname(fileURLToPath(import.meta.url));
const goalsHtml = readFileSync(resolve(__dirname, '../hockey_game_goals.html'), 'utf8');

function makeRes() {
  return {
    statusCode: 200, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
}
const cookieFor = (pid) => `${SESSION_COOKIE}=${encodeURIComponent(mintSession(pid, `${pid}@example.com`))}`;
const post = (body, pid) => ({ method: 'POST', body, query: {}, headers: pid ? { cookie: cookieFor(pid) } : {} });
const get = (query, pid) => ({ method: 'GET', query, headers: pid ? { cookie: cookieFor(pid) } : {} });

async function save(body, pid) { const res = makeRes(); await _handlers.saveGameGoals(post(body, pid), res); return res; }
async function read(query, pid) { const res = makeRes(); await _handlers.myGameGoals(get(query, pid), res); return res; }

// Vancouver noon on a date, so the Vancouver day is unambiguous.
function at(date) { vi.setSystemTime(new Date(`${date}T19:00:00Z`)); }

beforeEach(() => {
  fake.map.clear();
  setEnv();
  vi.useFakeTimers({ toFake: ['Date'] });
  at('2026-10-29'); // Thursday; next game is g-1031 (Sat Oct 31)
});
afterEach(() => { vi.useRealTimers(); });

describe('save-game-goals + my-game-goals: own picks', () => {
  it('saves the signed-in player\'s picks for the next game and reads them back', async () => {
    const s = await save({ goalIds: ['g1', 'g7'] }, 'alder');
    expect(s.statusCode).toBe(200);
    expect(s.body).toMatchObject({ ok: true, gameId: 'g-1031', goalIds: ['g1', 'g7'], max: 3 });

    const r = await read({}, 'alder');
    expect(r.statusCode).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.saved).toBe(true);
    expect(r.body.game).toEqual({ id: 'g-1031', kind: 'game', date: '2026-10-31', endDate: null, time: '16:00', opponent: 'Tacoma Rockets', home: true, place: 'Home' });
    expect(r.body.goals.map((g) => g.id)).toEqual(['g1', 'g7']);
    expect(r.body.goals[0].title).toBe('Scan Twice');
    expect(r.body.teamGoal).toBeNull();
    expect(r.headers['Cache-Control']).toBe('no-store');
  });

  it('saves for a named gameId on the schedule, and reads it with that gameId', async () => {
    const s = await save({ gameId: 'g-1101', goalIds: ['g2'] }, 'alder');
    expect(s.body.gameId).toBe('g-1101');
    expect((await read({}, 'alder')).body.goals).toEqual([]); // next game g-1031 has none
    const r = await read({ gameId: 'g-1101' }, 'alder');
    expect(r.body.game.id).toBe('g-1101');
    expect(r.body.goals.map((g) => g.id)).toEqual(['g2']);
  });

  it('an empty list is a real save that clears the pick', async () => {
    await save({ goalIds: ['g1'] }, 'alder');
    await save({ goalIds: [] }, 'alder');
    const r = await read({}, 'alder');
    expect(r.body.saved).toBe(true);
    expect(r.body.goals).toEqual([]);
  });

  it('a pick with no save reads as saved:false and no goals', async () => {
    const r = await read({}, 'alder');
    expect(r.body).toMatchObject({ ok: true, saved: false, goals: [], savedAt: null });
  });

  it('rejects unknown goals, unknown games and a non-list', async () => {
    expect((await save({ goalIds: ['g999'] }, 'alder')).statusCode).toBe(400);
    expect((await save({ goalIds: 'g1' }, 'alder')).statusCode).toBe(400);
    expect((await save({ gameId: 'nope', goalIds: ['g1'] }, 'alder')).statusCode).toBe(400);
    expect((await read({ gameId: 'nope' }, 'alder')).statusCode).toBe(400);
  });

  it('duplicate goal ids collapse to one', async () => {
    const s = await save({ goalIds: ['g1', 'g1', 'g2'] }, 'alder');
    expect(s.body.goalIds).toEqual(['g1', 'g2']);
  });

  it('only POST saves and only GET reads', async () => {
    const r1 = makeRes(); await _handlers.saveGameGoals(get({}, 'alder'), r1);
    expect(r1.statusCode).toBe(405);
    const r2 = makeRes(); await _handlers.myGameGoals(post({}, 'alder'), r2);
    expect(r2.statusCode).toBe(405);
  });
});

describe('auth', () => {
  it('401 without a session (save and read)', async () => {
    expect((await save({ goalIds: ['g1'] })).statusCode).toBe(401);
    expect((await read({})).statusCode).toBe(401);
  });

  it('403 when saving for another player', async () => {
    const s = await save({ playerId: 'lewie', goalIds: ['g1'] }, 'alder');
    expect(s.statusCode).toBe(403);
    // Nothing was written for either player.
    expect((await read({}, 'alder')).body.saved).toBe(false);
  });

  it('403 when a player reads another player', async () => {
    await save({ goalIds: ['g1'] }, 'lewie');
    expect((await read({ playerId: 'lewie' }, 'alder')).statusCode).toBe(403);
  });

  it('a coach of the team can read a player, but not write', async () => {
    await save({ goalIds: ['g3'] }, 'lewie');
    const login = makeRes();
    await _handlers.coachLogin(post({ email: _seed.SEED_COACH_EMAIL, password: _seed.SEED_COACH_PASSWORD }), login);
    const token = login.body.token;
    const r = makeRes();
    await _handlers.myGameGoals({ method: 'GET', query: { playerId: 'lewie', coachToken: token }, headers: {} }, r);
    expect(r.statusCode).toBe(200);
    expect(r.body.playerId).toBe('lewie');
    expect(r.body.goals.map((g) => g.id)).toEqual(['g3']);
    const w = makeRes();
    await _handlers.saveGameGoals({ method: 'POST', body: { coachToken: token, playerId: 'lewie', goalIds: ['g1'] }, query: {}, headers: {} }, w);
    expect(w.statusCode).toBe(401);
  });

  it('a coach who does not run the player\'s team gets 403', async () => {
    const reg = makeRes();
    await _handlers.coachRegister(post({ email: 'other@example.com', password: 'longpassword1', name: 'Other' }), reg);
    const login = makeRes();
    await _handlers.coachLogin(post({ email: 'other@example.com', password: 'longpassword1' }), login);
    expect(login.body.token).toBeTruthy();
    const r = makeRes();
    await _handlers.myGameGoals({ method: 'GET', query: { playerId: 'lewie', coachToken: login.body.token }, headers: {} }, r);
    expect(r.statusCode).toBe(403);
  });
});

describe('gameDay follows the Vancouver date of the next game', () => {
  it('false before the game day, true on it', async () => {
    expect((await read({}, 'alder')).body.gameDay).toBe(false);
    at('2026-10-31');
    const r = await read({}, 'alder');
    expect(r.body.game.id).toBe('g-1031');
    expect(r.body.gameDay).toBe(true);
  });

  it('late evening in Vancouver is still that day (UTC is already tomorrow)', async () => {
    vi.setSystemTime(new Date('2026-11-01T06:30:00Z')); // Oct 31, 11:30 PM PDT
    const r = await read({}, 'alder');
    expect(r.body.game.id).toBe('g-1031');
    expect(r.body.gameDay).toBe(true);
  });

  it('the next game moves on the day after, and a picked game stays readable by id', async () => {
    at('2026-10-31');
    await save({ goalIds: ['g1'] }, 'alder');
    at('2026-11-01');
    const r = await read({}, 'alder');
    expect(r.body.game.id).toBe('g-1101');
    expect(r.body.gameDay).toBe(true);
    expect(r.body.goals).toEqual([]);
    const past = await read({ gameId: 'g-1031' }, 'alder');
    expect(past.body.gameDay).toBe(false);
    expect(past.body.goals.map((g) => g.id)).toEqual(['g1']);
  });

  // Tournaments are game days too, the same as hockey_game_goals.html's header
  // (next.nextGame from lib/schedule_store nextEvent, which counts any event
  // that has not ended yet).
  it('a tournament is the next game day once it is the soonest event', async () => {
    at('2026-11-02'); // after the Nov 1 game, before the Nov 13-15 tournament
    const r = await read({}, 'alder');
    expect(r.body.game).toMatchObject({ id: 't-1113', kind: 'tournament', date: '2026-11-13', endDate: '2026-11-15' });
    expect(r.body.gameDay).toBe(false);
  });

  it('every day of a tournament is game day, including the middle and last day', async () => {
    for (const d of ['2026-11-13', '2026-11-14', '2026-11-15']) {
      at(d);
      const r = await read({}, 'alder');
      expect(r.body.game.id).toBe('t-1113');
      expect(r.body.gameDay).toBe(true);
    }
    at('2026-11-16');
    const after = await read({}, 'alder');
    expect(after.body.game.id).toBe('g-1121');
    expect(after.body.gameDay).toBe(false);
  });

  it('picks save against the tournament mid-tournament and read back', async () => {
    at('2026-11-14');
    const s = await save({ goalIds: ['g3'] }, 'alder');
    expect(s.statusCode).toBe(200);
    expect(s.body.gameId).toBe('t-1113');
    expect((await read({}, 'alder')).body.goals.map((g) => g.id)).toEqual(['g3']);
  });

  it('matches the page header: server next game === schedule nextEvent().nextGame', async () => {
    const { nextEvent, ensureSchedule } = await import('../lib/schedule_store.js');
    const sched = await ensureSchedule('RANGERS72');
    for (const d of ['2026-10-09', '2026-10-11', '2026-10-13', '2026-11-12', '2026-11-15', '2026-12-13']) {
      at(d);
      const r = await read({}, 'alder');
      const page = nextEvent(sched, d).nextGame;
      expect(r.body.game ? r.body.game.id : null).toBe(page ? page.id : null);
    }
  });

  it('no upcoming game: read returns game null, save is refused with 409', async () => {
    at('2027-06-01');
    const r = await read({}, 'alder');
    expect(r.body).toMatchObject({ ok: true, game: null, gameDay: false, goals: [] });
    expect((await save({ goalIds: ['g1'] }, 'alder')).statusCode).toBe(409);
  });
});

describe('max goal count matches the page', () => {
  it('3 without a team goal, 4 is refused', async () => {
    expect(GAME_GOAL_TARGET).toBe(3);
    expect((await save({ goalIds: ['g1', 'g2', 'g3'] }, 'alder')).statusCode).toBe(200);
    const s = await save({ goalIds: ['g1', 'g2', 'g3', 'g4'] }, 'alder');
    expect(s.statusCode).toBe(400);
    expect(s.body).toMatchObject({ error: 'too many goals', max: 3 });
  });

  it('2 when the coach set a team goal, and the team goal comes back on read', async () => {
    await setTeamGoal('RANGERS72', { text: 'Talk on the ice' });
    const s = await save({ goalIds: ['g1', 'g2', 'g3'] }, 'alder');
    expect(s.statusCode).toBe(400);
    expect(s.body.max).toBe(2);
    expect((await save({ goalIds: ['g1', 'g2'] }, 'alder')).statusCode).toBe(200);
    const r = await read({}, 'alder');
    expect(r.body.teamGoal.text).toBe('Talk on the ice');
    expect(r.body.max).toBe(2);
  });

  it('the page still uses TARGET = 3 and drops one slot for a team goal', () => {
    expect(goalsHtml).toMatch(/var TARGET = 3;/);
    expect(goalsHtml).toMatch(/selfCap = TARGET - \(hasTeamGoal \? 1 : 0\)/);
  });
});

describe('multi-team players', () => {
  it('a player on another team uses that team\'s schedule', async () => {
    await setTeam('HAWKS9', { name: 'Hawks', coachEmail: 'hawk@example.com', createdAt: new Date().toISOString() });
    await addMember('HAWKS9', { playerId: 'zed', firstName: 'Zed', number: 9, status: 'active' });
    fake.map.set('teamSchedule:HAWKS9', { practices: [], events: [
      { id: 'h-1', kind: 'game', date: '2026-10-30', time: '10:00', home: true, opponent: 'Owls', place: 'Rink' },
    ] });
    const s = await save({ goalIds: ['g5'] }, 'zed');
    expect(s.body.gameId).toBe('h-1');
    const r = await read({}, 'zed');
    expect(r.body.game.opponent).toBe('Owls');
    expect(r.body.goals.map((g) => g.id)).toEqual(['g5']);
  });

  it('an unknown player gets 404', async () => {
    expect((await save({ goalIds: ['g1'] }, 'nobody')).statusCode).toBe(404);
  });
});

describe('goal catalog matches hockey_game_goals.html', () => {
  it('every goal card on the page is in the catalog with the same title', () => {
    const re = /<label class="goal goal-(\d+)" for="g\1">[\s\S]*?<h3>([\s\S]*?)<\/h3>/g;
    const fromHtml = [];
    let m;
    while ((m = re.exec(goalsHtml))) fromHtml.push({ id: 'g' + m[1], title: m[2].replace(/&amp;/g, '&').replace(/&rsquo;/g, '\u2019').replace(/&#x27;/g, "'").trim() });
    expect(fromHtml.length).toBe(45);
    expect(GAME_GOALS.length).toBe(fromHtml.length);
    for (const h of fromHtml) {
      const c = GAME_GOALS.find((g) => g.id === h.id);
      expect(c, h.id).toBeTruthy();
      expect(c.title).toBe(h.title);
    }
  });
});

// --- client sync rules, run from the shipped page source ---------------------
function loadSync() {
  const marker = 'window.ThwapGoalSync={';
  const mi = goalsHtml.indexOf(marker);
  if (mi === -1) throw new Error('ThwapGoalSync not found');
  const open = goalsHtml.lastIndexOf('(function(){', mi);
  const close = goalsHtml.indexOf('})();', mi);
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(goalsHtml.slice(open, close + 5), sandbox);
  return sandbox.window.ThwapGoalSync;
}
const plain = (x) => JSON.parse(JSON.stringify(x));

describe('page sync rules (localStorage migration and offline fallback)', () => {
  const S = loadSync();
  const srv = (over = {}) => ({ ok: true, game: { id: 'g-1031' }, saved: false, goals: [], max: 3, ...over });

  it('signed out or offline: keep using localStorage, no server write', () => {
    expect(plain(S.decide({ server: null, local: ['g1'], dirty: true, migrated: false }))).toEqual({ action: 'none', goalIds: ['g1'], backupLocal: false });
  });

  it('migrates an old localStorage pick to the server once', () => {
    const d = S.decide({ server: srv(), local: ['g1', 'g4'], dirty: false, migrated: false });
    expect(plain(d)).toEqual({ action: 'push', goalIds: ['g1', 'g4'], backupLocal: false });
  });

  it('after migration, a server pick from another device is shown here', () => {
    const d = S.decide({ server: srv({ saved: true, goals: [{ id: 'g9' }] }), local: ['g1'], dirty: false, migrated: true });
    expect(plain(d)).toEqual({ action: 'apply', goalIds: ['g9'], backupLocal: false });
  });

  it('an old local pick replaced by a newer server pick is kept in a backup', () => {
    const d = S.decide({ server: srv({ saved: true, goals: [{ id: 'g9' }] }), local: ['g1'], dirty: false, migrated: false });
    expect(d.action).toBe('apply');
    expect(d.backupLocal).toBe(true);
  });

  it('offline edits (dirty) win over the server copy, including a reset', () => {
    expect(S.decide({ server: srv({ saved: true, goals: [{ id: 'g9' }] }), local: ['g2'], dirty: true, migrated: true }).action).toBe('push');
    const reset = S.decide({ server: srv({ saved: true, goals: [{ id: 'g9' }] }), local: [], dirty: true, migrated: true });
    expect(plain(reset)).toEqual({ action: 'push', goalIds: [], backupLocal: false });
  });

  it('caps an upload at the server max and backs up the extra pick', () => {
    const d = S.decide({ server: srv({ max: 2 }), local: ['g1', 'g2', 'g3'], dirty: false, migrated: false });
    expect(plain(d)).toEqual({ action: 'push', goalIds: ['g1', 'g2'], backupLocal: true });
  });

  it('picks showing here but never saved for this game are uploaded', () => {
    expect(S.decide({ server: srv(), local: ['g1'], dirty: false, migrated: true }).action).toBe('push');
  });

  it('no game on the schedule: nothing to sync', () => {
    expect(S.decide({ server: srv({ game: null }), local: ['g1'], dirty: true, migrated: false }).action).toBe('none');
  });

  it('drops junk ids from localStorage', () => {
    expect(plain(S.clean(['g1', 'x', null, 'g1', 'g12']))).toEqual(['g1', 'g12']);
  });
});

describe('page wiring', () => {
  it('saves to the server with the session cookie and reads back on load', () => {
    expect(goalsHtml).toMatch(/action=save-game-goals',\{method:'POST',credentials:'include'/);
    expect(goalsHtml).toMatch(/action=my-game-goals/);
    expect(goalsHtml).toMatch(/window\.ThwapGoalSync\.decide\(/);
  });
  it('localStorage stays the offline copy and changes are marked until confirmed', () => {
    expect(goalsHtml).toMatch(/localStorage\.setItem\(KEY, JSON\.stringify\(pickedIds\(\)\)\);\s*localStorage\.setItem\(DIRTY, '1'\);/);
    expect(goalsHtml).toMatch(/if\(r\.ok\)\{ try\{ localStorage\.removeItem\(DIRTY\);/);
  });
  it('both reset buttons push the cleared plan', () => {
    expect((goalsHtml.match(/localStorage\.setItem\(DIRTY, '1'\); \}catch\(e\)\{\}\s*clearGameDone\(\);\s*updateUI\(\);\s*schedulePush\(\);/g) || []).length).toBe(2);
  });
});
