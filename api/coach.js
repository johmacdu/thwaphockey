// api/coach.js
//
// Consolidated COACH + TEAM + IDP router. ONE serverless function that dispatches
// on ?action= so every coach/team/IDP action costs ONE function slot instead of
// many (Vercel Hobby caps a deployment at 12; api/ is at the limit). All data
// logic lives in lib/teams_store.js and lib/store.js (helpers outside api/ are
// not counted as functions).
//
// Actions:
//   POST ?action=coach-login    { email, password }              -> coach session token (+ childPlayerId)
//   POST ?action=create-team    { coachToken, name, association, ageGroup } -> { code }
//   POST ?action=add-player     { code, coachToken, firstName, lastName, number, position, parentEmail }
//   POST ?action=remove-player  { code, coachToken, playerId }
//   GET  ?action=roster         { code }                          -> members + this-week participation + idpGoal
//   GET  ?action=player         { code, playerId }                -> per-player IDP roll-up
//   POST ?action=join           { code, playerId }                -> kid/parent joins via code
//   GET  ?action=schedule       { code }                          -> read-only week (placeholder this phase)
//   POST ?action=set-idp-goal   { playerId, text, setBy }         -> monthly personal goal
//   GET  ?action=idp-goal       { playerId }                      -> current monthly goal
//   POST ?action=log-game-goal  { playerId, goalId, goalTitle, done, note } -> append game-goal check-off
//   GET  ?action=game-goal-log  { playerId }                      -> recent check-offs
//
// Coach auth: a coach session token (reuses lib/session_store's HMAC mint/verify,
// with playerId = 'coach:<email>'). Password is checked against an HMAC hash so no
// plaintext is stored. THIS PHASE seeds one team (RANGERS72) and one coach on first
// touch; there is no public coach-signup yet.

import crypto from 'crypto';
import { parseBody } from '../lib/photo_common.js';
import { mintSession, verifySession } from '../lib/session_store.js';
import { ROSTER, weekBoard, monthTrend } from '../lib/store.js';
import {
  getTeam, setTeam, listMembers, addMember, getMember, removeMember,
  getCoach, setCoach, getIdpGoal, setIdpGoal, getGameGoalLog, logGameGoal,
  getTeamPlan, setTeamPlan,
} from '../lib/teams_store.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// --- seed (Jr Rangers 10U) --------------------------------------------------
// One known team for this phase. jason@riversidepayments.com / ranger10u, whose
// own child is player 'alder' (#71). Seeded idempotently on first coach touch so
// no manual DB step is needed; safe to call repeatedly.
const SEED_TEAM_CODE = 'RANGERS72';
const SEED_COACH_EMAIL = 'jason@riversidepayments.com';
const SEED_COACH_PASSWORD = 'ranger10u';
const SEED_CHILD_PLAYER_ID = 'alder';

function passHash(password) {
  const secret = process.env.PHOTO_TOKEN_SECRET || process.env.SESSION_TOKEN_SECRET || '';
  return crypto.createHmac('sha256', secret).update(String(password)).digest('hex');
}

// Constant-time compare of two equal-length hex strings.
function safeEqual(a, b) {
  const ab = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

async function ensureSeed() {
  const existing = await getCoach(SEED_COACH_EMAIL);
  if (existing) return existing;
  // Create the team with the whole current ROSTER as active members.
  await setTeam(SEED_TEAM_CODE, {
    name: 'Jr Rangers 10U',
    association: 'Vancouver Jr. Rangers',
    ageGroup: '10U',
    coachEmail: SEED_COACH_EMAIL,
    createdAt: new Date().toISOString(),
  });
  for (const p of ROSTER) {
    await addMember(SEED_TEAM_CODE, {
      playerId: p.id,
      firstName: p.name,
      lastName: p.id === SEED_CHILD_PLAYER_ID ? 'Reese' : '',
      number: p.number,
      position: '',
      parentEmail: p.id === SEED_CHILD_PLAYER_ID ? SEED_COACH_EMAIL : '',
      status: 'active',
    });
  }
  return setCoach(SEED_COACH_EMAIL, {
    name: 'Jason',
    passHash: passHash(SEED_COACH_PASSWORD),
    teams: [SEED_TEAM_CODE],
    childPlayerId: SEED_CHILD_PLAYER_ID,
    createdAt: new Date().toISOString(),
  });
}

// --- coach session token ----------------------------------------------------
// Reuse the HMAC session mint/verify. The session token is dot-delimited AND
// mintSession lowercases the pid, so the pseudo playerId must contain no dots and
// survive lowercasing. Hex-encode the email (lowercase, dot-free) inside coach:.
function hexEncode(s) { return Buffer.from(String(s), 'utf8').toString('hex'); }
function hexDecode(s) { return Buffer.from(String(s), 'hex').toString('utf8'); }
function mintCoachToken(email) {
  const e = String(email).toLowerCase();
  return mintSession(`coach:${hexEncode(e)}`, e);
}
function coachFromToken(token) {
  const claims = verifySession(token);
  if (!claims || !String(claims.playerId || '').startsWith('coach:')) return null;
  try { return { email: hexDecode(String(claims.playerId).slice('coach:'.length)) }; }
  catch { return null; }
}
async function requireCoach(req, res) {
  const { coachToken } = parseBody(req);
  const token = coachToken || (req.query && req.query.coachToken) || '';
  const c = coachFromToken(token);
  if (!c) { res.status(401).json({ error: 'coach auth required' }); return null; }
  const rec = await getCoach(c.email);
  if (!rec) { res.status(401).json({ error: 'unknown coach' }); return null; }
  return rec;
}

function methodGuard(req, res, want) {
  if (req.method !== want) { res.setHeader('Allow', want); res.status(405).json({ error: 'method not allowed' }); return false; }
  return true;
}

// --- handlers ---------------------------------------------------------------

async function coachLogin(req, res) {
  if (!methodGuard(req, res, 'POST')) return;
  await ensureSeed();
  const { email, password } = parseBody(req);
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(cleanEmail)) return res.status(400).json({ error: 'bad email' });
  const coach = await getCoach(cleanEmail);
  res.setHeader('Cache-Control', 'no-store');
  if (!coach || !safeEqual(coach.passHash, passHash(password))) {
    return res.status(401).json({ error: 'bad credentials' });
  }
  const token = mintCoachToken(cleanEmail);
  return res.status(200).json({
    ok: true, token,
    coach: { email: cleanEmail, name: coach.name, teams: coach.teams || [], childPlayerId: coach.childPlayerId || null },
  });
}

async function createTeam(req, res) {
  if (!methodGuard(req, res, 'POST')) return;
  const coach = await requireCoach(req, res); if (!coach) return;
  const { name, association, ageGroup } = parseBody(req);
  if (!String(name || '').trim()) return res.status(400).json({ error: 'team name required' });
  // Auto-generate a unique-ish code from the name + a short random suffix.
  const base = String(name).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'TEAM';
  let code = base + Math.floor(10 + Math.random() * 90);
  for (let i = 0; i < 5 && (await getTeam(code)); i += 1) code = base + Math.floor(10 + Math.random() * 90);
  await setTeam(code, {
    name: String(name).trim(), association: association || '', ageGroup: ageGroup || '10U',
    coachEmail: coach.email, createdAt: new Date().toISOString(),
  });
  const teams = Array.from(new Set([...(coach.teams || []), code]));
  await setCoach(coach.email, { ...coach, teams });
  return res.status(200).json({ ok: true, code });
}

async function addPlayer(req, res) {
  if (!methodGuard(req, res, 'POST')) return;
  const coach = await requireCoach(req, res); if (!coach) return;
  const { code, firstName, lastName, number, position, parentEmail } = parseBody(req);
  if (!(await getTeam(code))) return res.status(404).json({ error: 'unknown team' });
  if (!String(firstName || '').trim()) return res.status(400).json({ error: 'first name required' });
  // id = lowercase first name (same id space as player:<id>).
  const playerId = String(firstName).trim().toLowerCase();
  const rec = await addMember(code, { playerId, firstName, lastName, number, position, parentEmail, status: 'active' });
  return res.status(200).json({ ok: true, member: rec });
}

async function removePlayer(req, res) {
  if (!methodGuard(req, res, 'POST')) return;
  const coach = await requireCoach(req, res); if (!coach) return;
  const { code, playerId } = parseBody(req);
  if (!(await getTeam(code))) return res.status(404).json({ error: 'unknown team' });
  const out = await removeMember(code, playerId);
  return res.status(200).json({ ok: true, ...out });
}

async function roster(req, res) {
  if (!methodGuard(req, res, 'GET')) return;
  await ensureSeed();
  const code = (req.query && req.query.code) || SEED_TEAM_CODE;
  const team = await getTeam(code);
  if (!team) return res.status(404).json({ error: 'unknown team' });
  const ids = await listMembers(code);
  const board = await weekBoard(); // [{id, stick, shoot, dryland}]
  const byId = Object.fromEntries(board.map((b) => [b.id, b]));
  const members = [];
  for (const pid of ids) {
    const m = await getMember(pid);
    const wk = byId[pid] || { stick: 0, shoot: 0, dryland: 0 };
    const trained = (wk.stick + wk.shoot + wk.dryland) > 0;
    const goal = await getIdpGoal(pid);
    members.push({
      playerId: pid,
      firstName: (m && m.firstName) || '', lastName: (m && m.lastName) || '',
      number: m ? m.number : null, position: (m && m.position) || '',
      status: (m && m.status) || 'active',
      week: { stick: wk.stick, shoot: wk.shoot, dryland: wk.dryland }, trainedThisWeek: trained,
      idpGoal: goal ? goal.text : '',
    });
  }
  const trainedCount = members.filter((m) => m.trainedThisWeek).length;
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    ok: true, team: { code: team.code, name: team.name, ageGroup: team.ageGroup },
    participation: { trained: trainedCount, total: members.length },
    members,
  });
}

async function playerRollup(req, res) {
  if (!methodGuard(req, res, 'GET')) return;
  const pid = String((req.query && req.query.playerId) || '').toLowerCase();
  if (!pid) return res.status(400).json({ error: 'playerId required' });
  const m = await getMember(pid);
  const board = await weekBoard();
  const wk = board.find((b) => b.id === pid) || { stick: 0, shoot: 0, dryland: 0 };
  const goal = await getIdpGoal(pid);
  const log = await getGameGoalLog(pid);
  const trend = await monthTrend(pid, 4);
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    ok: true, playerId: pid,
    member: m || null,
    baseThisWeek: { stick: wk.stick, shoot: wk.shoot, dryland: wk.dryland },
    monthTrend: trend,
    idpGoal: goal || null,
    gameGoals: log.slice(-20).reverse(),
  });
}

async function join(req, res) {
  if (!methodGuard(req, res, 'POST')) return;
  const { code, playerId } = parseBody(req);
  const team = await getTeam(code);
  if (!team) return res.status(404).json({ error: 'unknown team code' });
  const pid = String(playerId || '').toLowerCase();
  const members = await listMembers(code);
  if (!members.includes(pid)) return res.status(404).json({ error: 'player not on this team' });
  const m = await getMember(pid);
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true, team: { code: team.code, name: team.name }, player: m });
}

async function schedule(req, res) {
  if (!methodGuard(req, res, 'GET')) return;
  // Read-only this phase: the app's day rotation is the schedule. Return a marker
  // so the client can render "your team follows the Thwap weekly rotation".
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true, mode: 'rotation', note: 'Team follows the Thwap weekly rotation.' });
}

// GET the team's weekly plan (which categories are on each weekday). Public read
// so the kid app can shape today's home; defaults to all-3-every-day when unset.
async function getPlan(req, res) {
  if (!methodGuard(req, res, 'GET')) return;
  const code = (req.query && req.query.code) || SEED_TEAM_CODE;
  if (!(await getTeam(code))) return res.status(404).json({ error: 'unknown team' });
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true, plan: await getTeamPlan(code) });
}

// POST the team's weekly plan. Coach-only.
async function setPlan(req, res) {
  if (!methodGuard(req, res, 'POST')) return;
  const coach = await requireCoach(req, res); if (!coach) return;
  const { code, plan } = parseBody(req);
  if (!(await getTeam(code))) return res.status(404).json({ error: 'unknown team' });
  const saved = await setTeamPlan(code, plan);
  return res.status(200).json({ ok: true, plan: saved });
}

async function setIdp(req, res) {
  if (!methodGuard(req, res, 'POST')) return;
  const { playerId, text, setBy } = parseBody(req);
  const pid = String(playerId || '').toLowerCase();
  if (!pid) return res.status(400).json({ error: 'playerId required' });
  const rec = await setIdpGoal(pid, { text, setBy });
  return res.status(200).json({ ok: true, idpGoal: rec });
}

async function idpGoal(req, res) {
  if (!methodGuard(req, res, 'GET')) return;
  const pid = String((req.query && req.query.playerId) || '').toLowerCase();
  if (!pid) return res.status(400).json({ error: 'playerId required' });
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true, idpGoal: await getIdpGoal(pid) });
}

async function logGoal(req, res) {
  if (!methodGuard(req, res, 'POST')) return;
  const { playerId, goalId, goalTitle, done, note } = parseBody(req);
  const pid = String(playerId || '').toLowerCase();
  if (!pid) return res.status(400).json({ error: 'playerId required' });
  const entry = await logGameGoal(pid, { goalId, goalTitle, done, note });
  return res.status(200).json({ ok: true, entry });
}

async function gameGoalLogRead(req, res) {
  if (!methodGuard(req, res, 'GET')) return;
  const pid = String((req.query && req.query.playerId) || '').toLowerCase();
  if (!pid) return res.status(400).json({ error: 'playerId required' });
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true, log: (await getGameGoalLog(pid)).slice(-30).reverse() });
}

export default async function handler(req, res) {
  const action = String((req.query && req.query.action) || '').toLowerCase();
  switch (action) {
    case 'coach-login': return coachLogin(req, res);
    case 'create-team': return createTeam(req, res);
    case 'add-player': return addPlayer(req, res);
    case 'remove-player': return removePlayer(req, res);
    case 'roster': return roster(req, res);
    case 'player': return playerRollup(req, res);
    case 'join': return join(req, res);
    case 'schedule': return schedule(req, res);
    case 'get-plan': return getPlan(req, res);
    case 'set-plan': return setPlan(req, res);
    case 'set-idp-goal': return setIdp(req, res);
    case 'idp-goal': return idpGoal(req, res);
    case 'log-game-goal': return logGoal(req, res);
    case 'game-goal-log': return gameGoalLogRead(req, res);
    default: return res.status(404).json({ error: 'unknown coach action' });
  }
}

// Exported for unit tests (call sub-handlers directly with a query.action-free req).
export const _handlers = {
  coachLogin, createTeam, addPlayer, removePlayer, roster, playerRollup,
  join, schedule, setIdp, idpGoal, logGoal, gameGoalLogRead,
  getPlan, setPlan,
};
export const _seed = { SEED_TEAM_CODE, SEED_COACH_EMAIL, SEED_COACH_PASSWORD, SEED_CHILD_PLAYER_ID, ensureSeed, mintCoachToken };
