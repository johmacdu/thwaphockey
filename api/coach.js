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
//   GET  ?action=roster         { code, coachToken? }             -> members + this-week participation + idpGoal
//                                 (parentEmails only for the team's coach, an admin, or the signed-in player's own)
//   GET  ?action=player         { code, playerId }                -> per-player IDP roll-up (member without parent emails
//                                 unless the team's coach, an admin, or the signed-in player)
//   POST ?action=join           { code, playerId }                -> kid/parent joins via code (no parent emails)
//   GET  ?action=schedule       { code }                          -> read-only week (placeholder this phase)
//   POST ?action=set-idp-goal   { playerId, text, coachToken? }   -> monthly personal goal (session player or team coach)
//   GET  ?action=idp-goal       { playerId }                      -> current monthly goal
//   POST ?action=log-game-goal  { playerId, goalId, goalTitle, done, note, coachToken? } -> append game-goal
//                                 check-off (thwapSession for that player, or a coach of the player's team)
//   GET  ?action=game-goal-log  { playerId }                      -> recent check-offs
//   POST ?action=save-game-goals { gameId?, goalIds }             -> save the signed-in player's own
//                                 Game Day Goals picks for a game (thwapSession only; no gameId = next game)
//   GET  ?action=my-game-goals  { gameId?, playerId?, coachToken? } -> { gameDay, game, goals, teamGoal }
//                                  (web session or an approved Apple Watch session)
//                                 for the signed-in player, or a player on a team the coach runs
//
// Coach auth: a coach session token (reuses lib/session_store's HMAC mint/verify,
// with playerId = 'coach:<email>'). Password is checked against an HMAC hash so no
// plaintext is stored. THIS PHASE seeds one team (RANGERS72) and one coach on first
// touch; there is no public coach-signup yet.

import crypto from 'crypto';
import { parseBody } from '../lib/photo_common.js';
import { sharedKeyOk, adminTokenFrom } from '../lib/admin_auth.js';
import { mintSession, verifySession, readSessionCookie } from '../lib/session_store.js';
import { sessionClaims } from '../lib/watch_store.js';
import { ROSTER, weekBoard, monthTrend, adjustPlayer, getGrants, setGrants } from '../lib/store.js';
import { LETTERS, MAX_A, letterFromGrants, withLetter } from '../lib/avatar_items.js';
import {
  getTeam, setTeam, listMembers, addMember, getMember, removeMember,
  getCoach, setCoach, getIdpGoal, setIdpGoal, getGameGoalLog, logGameGoal, getIdpGoalLog,
  getTeamPlan, setTeamPlan,
  getTeamGoal, setTeamGoal,
  addDrillSuggestion, listDrillSuggestions, setSuggestionStatus, listAllTeamCodes,
  updateMember, parentEmailList, createResetToken, consumeResetToken,
  getAdmin, setAdmin, ensureTeamIndexed,
  listTeamCoaches, ensureHeadCoach, addAssistantCoach, removeAssistantCoach, MAX_ASSISTANTS,
  backfillSeedBeta, getBetaUntil,
  savePushToken, withoutLegacyPhoto,
} from '../lib/teams_store.js';
import { ensureSchedule, getSchedule, addEvent as addScheduleEvent, nextEvent, localDateStr } from '../lib/schedule_store.js';
import { resolveSigninPlayer, RANGERS_TEAM_CODE } from '../lib/signin_players.js';
import { teamPlayerIds, resolvePlayer } from '../lib/team_players.js';
import { GAME_GOAL_TARGET, gameGoalById } from '../lib/game_goals_catalog.js';
import { getGamePick, setGamePick } from '../lib/game_picks_store.js';
import { isGated, billingStatus } from '../lib/billing_store.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Validate + normalize an incoming guardian-email list (any number of emails).
// Empty entries are dropped; each remaining one must look like an email. Returns
// { emails: [...] } or { error } when one is malformed. `undefined` in ->
// `undefined` out (the caller did not touch the emails).
function normalizeParentEmails(input) {
  if (input === undefined) return { emails: undefined };
  const arr = Array.isArray(input) ? input : [input];
  const seen = new Set();
  const out = [];
  for (const raw of arr) {
    const e = String(raw || '').trim().toLowerCase();
    if (!e) continue;
    if (!EMAIL_RE.test(e)) return { error: 'a parent email is invalid' };
    if (!seen.has(e)) { seen.add(e); out.push(e); }
  }
  return { emails: out };
}

// Resolve the guardian-email update fields for an edit action: prefer the
// flexible `parentEmails` array; otherwise validate and pass the legacy pair
// (updateMember replaces the first two but keeps any extra emails on file, so an
// old two-field caller never drops the rest). Returns { fields } or { error }.
function parentEmailFields(parentEmails, parentEmail, parentEmail2) {
  const pe = normalizeParentEmails(parentEmails);
  if (pe.error) return { error: pe.error };
  if (pe.emails !== undefined) return { fields: { parentEmails: pe.emails } };
  for (const e of [parentEmail, parentEmail2]) {
    if (e !== undefined && String(e || '').trim() && !EMAIL_RE.test(String(e).trim().toLowerCase())) {
      return { error: 'a parent email is invalid' };
    }
  }
  return { fields: { parentEmail, parentEmail2 } };
}

// --- seed (Jr Rangers 10U) --------------------------------------------------
// One known team for this phase. jason@riversidepayments.com / ranger10u, whose
// own child is player 'alder' (#71). One team only (Jr Rangers 10U). Seeded
// idempotently on first coach touch so no manual DB step is needed.
const SEED_TEAM_CODE = 'RANGERS72';
const SEED_COACH_EMAIL = 'jason@riversidepayments.com';
const SEED_ADMIN_EMAIL = 'hi@woodymacduffie.com';
const SEED_COACH_PASSWORD = 'ranger10u';
const SEED_COACH_PASSWORD_PRIOR = 'rangers2026'; // superseded default; migrate an untouched coach off it
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
  // Jason coaches ONE team: the Jr Rangers 10U with the full roster. No demo
  // teams, so there is no multi-team switcher and every login lands on the same
  // (only) team. Seeded idempotently; safe to call repeatedly.
  const DEMO_TEAMS = [
    { code: SEED_TEAM_CODE, name: 'Jr Rangers 10U', ageGroup: '10U', members: ROSTER.map((p) => ({ playerId: p.id, firstName: p.name, number: p.number })) },
  ];
  // Create any team that does not exist yet, with its members (idempotent).
  for (const t of DEMO_TEAMS) {
    if (!(await getTeam(t.code))) {
      // betaUntil:null defers the window to backfillSeedBeta below (now + 14d),
      // the single source of the SEED team's window. The createdAt + 30d default
      // in setTeam is for genuinely NEW coach-created teams, not the seed.
      await setTeam(t.code, { name: t.name, association: 'Vancouver Jr. Rangers', ageGroup: t.ageGroup, coachEmail: SEED_COACH_EMAIL, createdAt: new Date().toISOString(), betaUntil: null });
      for (const m of t.members) {
        await addMember(t.code, {
          playerId: m.playerId, firstName: m.firstName,
          lastName: (t.code === SEED_TEAM_CODE && m.playerId === SEED_CHILD_PLAYER_ID) ? 'Reese' : '',
          number: m.number, position: '',
          parentEmail: (t.code === SEED_TEAM_CODE && m.playerId === SEED_CHILD_PLAYER_ID) ? SEED_COACH_EMAIL : '',
          status: 'active',
        });
      }
    }
  }
  const allCodes = DEMO_TEAMS.map((t) => t.code);
  // Backfill the team index for teams that predate the index (created before
  // teams:index existed), so admin views that scan the index still see them.
  for (const code of allCodes) { await ensureTeamIndexed(code); }
  // Backfill the beta-banner window for the seed team ONCE. The seed carries an
  // OLD createdAt (set the first time ensureSeed ran), so the banner must NOT key
  // off createdAt or it would hide immediately; give it now + 14 days the first
  // time, and never overwrite an existing betaUntil on later redeploys.
  await backfillSeedBeta(SEED_TEAM_CODE);
  const existing = await getCoach(SEED_COACH_EMAIL);
  if (existing) {
    // Pin the seed coach to exactly the canonical team set (currently the one 10U
    // team). This also PRUNES any extra teams a previously-seeded account still
    // carries (the retired 8U/12U demo teams), so every login lands on the same
    // single team with no switcher.
    const have = existing.teams || [];
    const merged = allCodes.slice();
    // Migrate the password to the new default ONLY if it is unset or still the
    // prior default; never clobber a password the coach set themselves.
    const untouched = !existing.passHash || safeEqual(existing.passHash, passHash(SEED_COACH_PASSWORD_PRIOR));
    const nextPass = untouched ? passHash(SEED_COACH_PASSWORD) : existing.passHash;
    const teamsChanged = merged.length !== have.length || merged.some((c, i) => c !== have[i]);
    const passChanged = nextPass !== existing.passHash;
    if (teamsChanged || passChanged) {
      return setCoach(SEED_COACH_EMAIL, { ...existing, teams: merged, passHash: nextPass });
    }
    return existing;
  }
  return setCoach(SEED_COACH_EMAIL, {
    name: 'Jason',
    passHash: passHash(SEED_COACH_PASSWORD),
    teams: allCodes,
    childPlayerId: SEED_CHILD_PLAYER_ID,
    createdAt: new Date().toISOString(),
  });
}

// Seed the admin account once, with NO password (passHash null). First visit to
// /admin sets the password. Never bakes a password into the code. Idempotent:
// only creates the record if it does not already exist, so it never clobbers a
// password the admin already set.
async function ensureAdminSeed() {
  const existing = await getAdmin(SEED_ADMIN_EMAIL);
  if (existing) return existing;
  return setAdmin(SEED_ADMIN_EMAIL, { name: 'Admin', passHash: null, createdAt: new Date().toISOString() });
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

// Does this coach run this team? Head or assistant on the team's coach list, the
// team's own coachEmail, or the team in the coach's own record. Being *a* coach
// is not enough: anyone can register as one.
async function coachRunsTeam(coach, code) {
  const c = String(code || '').trim().toUpperCase();
  const email = String(coach && coach.email || '').toLowerCase();
  if (!c || !email) return false;
  const team = await getTeam(c);
  if (!team) return false;
  if (String(team.coachEmail || '').toLowerCase() === email) return true;
  if ((coach.teams || []).map((t) => String(t).toUpperCase()).includes(c)) return true;
  const coaches = await listTeamCoaches(c);
  return coaches.some((x) => String(x.email || '').toLowerCase() === email);
}

async function playerOnTeam(code, playerId) {
  const pid = String(playerId || '').trim().toLowerCase();
  if (!pid) return false;
  return (await listMembers(code)).map((m) => String(m).toLowerCase()).includes(pid);
}

// --- read-side access to children's family data -----------------------------
// Parent emails are a child's family contact details. They go only to a coach
// who runs the player's team, an admin, or the signed-in player (their own).
// These helpers never write a response, so a public caller still gets the
// non-sensitive fields instead of an error.
const PARENT_EMAIL_FIELDS = ['parentEmail', 'parentEmail2', 'parentEmails'];
function withoutParentEmails(m) {
  if (!m || typeof m !== 'object') return m;
  const out = { ...m };
  for (const k of PARENT_EMAIL_FIELDS) delete out[k];
  return out;
}
// The coach behind a coachToken (query or body), or null. No response written.
async function coachFromReq(req) {
  const { coachToken } = parseBody(req);
  const tok = coachToken || (req.query && req.query.coachToken) || '';
  const c = tok ? coachFromToken(tok) : null;
  return c ? await getCoach(c.email) : null;
}
// Is this an admin request (admin session token or the shared admin key)?
async function isAdminReq(req) {
  const a = adminFromToken(adminTokenFrom(req, parseBody(req)));
  if (a && (await getAdmin(a.email))) return true;
  return adminOk(req);
}
// The signed-in player's id from the thwapSession cookie, or ''.
function sessionPlayerId(req) {
  const s = verifySession(readSessionCookie(req));
  return s ? String(s.playerId || '').toLowerCase() : '';
}
// May this request read the parent emails of player pid on team code?
async function canSeeParentEmails(req, code, pid) {
  if (pid && sessionPlayerId(req) === String(pid).toLowerCase()) return true;
  const coach = await coachFromReq(req);
  if (coach && code && (await coachRunsTeam(coach, code))) return true;
  return isAdminReq(req);
}

// --- write-side access to a player's own records ----------------------------
// A write to a player's log/goal needs the signed-in player themselves (the
// thwapSession cookie, the same gate api/done uses) or a coach who runs the
// player's team (coachToken). No session and no team coach -> 401; signed in
// as someone else -> 403. Returns 'player' | 'coach', or null after a response.
async function authorizePlayerWrite(req, res, pid) {
  const coach = await coachFromReq(req);
  if (coach) {
    const m = await getMember(pid);
    const code = m && m.teamCode;
    if (code && (await coachRunsTeam(coach, code))) return 'coach';
  }
  const selfId = sessionPlayerId(req);
  if (selfId && selfId === pid) return 'player';
  if (!selfId && !coach) { res.status(401).json({ error: 'session required' }); return null; }
  res.status(403).json({ error: 'not your account' });
  return null;
}

// POST ?action=set-letter { coachToken, code, playerId, letter: 'C' | 'A' | '' }
//   -> the coach gives a player the C or an A, or takes it off (''). The coach
//   must run the team and the player must be on it. One C per team: giving the
//   C to someone takes it off whoever had it. At most two A's: a third is
//   refused so the coach decides who comes off. Stored in the player's coach
//   grants; every card picks it up from ?action=looks.
async function setLetter(req, res) {
  if (!methodGuard(req, res, 'POST')) return;
  const coach = await requireCoach(req, res); if (!coach) return;
  const { code, playerId, letter } = parseBody(req);
  const want = String(letter || '').toUpperCase();
  if (want && !LETTERS[want]) return res.status(400).json({ error: 'letter must be C, A or empty' });
  if (!(await getTeam(code))) return res.status(404).json({ error: 'unknown team' });
  if (!(await coachRunsTeam(coach, code))) return res.status(403).json({ error: 'not your team' });
  const pid = String(playerId || '').toLowerCase();
  const members = (await listMembers(code)).map((m) => String(m).toLowerCase());
  if (!pid || !members.includes(pid)) return res.status(404).json({ error: 'player is not on this team' });
  const others = members.filter((m) => m !== pid);
  const otherGrants = await Promise.all(others.map((m) => getGrants(m)));
  let moved = null;
  if (want === 'A') {
    const aCount = otherGrants.filter((g) => letterFromGrants(g) === 'A').length;
    if (aCount >= MAX_A) return res.status(409).json({ error: 'Two players already have an A. Take one off first.' });
  }
  if (want === 'C') {
    for (let i = 0; i < others.length; i++) {
      if (letterFromGrants(otherGrants[i]) === 'C') { await setGrants(others[i], withLetter(otherGrants[i], '')); moved = others[i]; }
    }
  }
  const grants = await setGrants(pid, withLetter(await getGrants(pid), want));
  return res.status(200).json({ ok: true, playerId: pid, letter: letterFromGrants(grants), movedFrom: moved });
}

// --- admin session token (email + password) --------------------------------
// Same HMAC session mint as coaches, namespaced admin: so an admin token can
// never be confused with a coach token. The email is hex-encoded inside the pid.
function mintAdminToken(email) {
  const e = String(email).toLowerCase();
  return mintSession(`admin:${hexEncode(e)}`, e);
}
function adminFromToken(token) {
  const claims = verifySession(token);
  if (!claims || !String(claims.playerId || '').startsWith('admin:')) return null;
  try { return { email: hexDecode(String(claims.playerId).slice('admin:'.length)) }; }
  catch { return null; }
}
// Authorize an admin request. Accepts the admin session token (adminToken in the
// body, or Bearer), and still accepts the legacy shared admin key in the
// Authorization: Bearer header. Neither is read from the URL. Returns the admin
// record, or null (after writing a 401) when neither path authorizes.
async function requireAdmin(req, res) {
  const a = adminFromToken(adminTokenFrom(req, parseBody(req)));
  if (a) {
    const rec = await getAdmin(a.email);
    if (rec) return rec;
  }
  if (adminOk(req)) return { email: 'shared-key', legacy: true };
  res.status(401).json({ error: 'admin auth required' });
  return null;
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
  const codes = coach.teams || [];
  const teamList = [];
  for (const c of codes) {
    const t = await getTeam(c);
    teamList.push({ code: c, name: (t && t.name) || c, ageGroup: (t && t.ageGroup) || '' });
  }
  return res.status(200).json({
    ok: true, token,
    coach: { email: cleanEmail, name: coach.name, teams: codes, teamList, childPlayerId: coach.childPlayerId || null },
  });
}

// POST ?action=coach-register { email, password, name } -> self-serve coach
// signup. Creates a brand-new coach:<email> with a hashed password (via passHash,
// the same helper coach-login checks against), rejects a duplicate email, and
// returns a session token in the SAME shape coach-login does so the client can
// go straight on to create-team. New coaches start with no teams.
async function coachRegister(req, res) {
  if (!methodGuard(req, res, 'POST')) return;
  // Seed first so the canonical seed coach/admin exist; this also makes a
  // registration on the seed email correctly hit the duplicate guard below.
  await ensureSeed();
  const { email, password, name } = parseBody(req);
  const cleanEmail = String(email || '').trim().toLowerCase();
  res.setHeader('Cache-Control', 'no-store');
  if (!EMAIL_RE.test(cleanEmail)) return res.status(400).json({ error: 'bad email' });
  const pass = String(password || '');
  if (pass.length < 6) return res.status(400).json({ error: 'password must be at least 6 characters' });
  if (await getCoach(cleanEmail)) return res.status(409).json({ error: 'an account with that email already exists' });
  const cleanName = String(name || '').trim().slice(0, 60) || 'Coach';
  await setCoach(cleanEmail, {
    name: cleanName,
    passHash: passHash(pass),
    teams: [],
    childPlayerId: null,
    createdAt: new Date().toISOString(),
  });
  const token = mintCoachToken(cleanEmail);
  return res.status(200).json({
    ok: true, token,
    coach: { email: cleanEmail, name: cleanName, teams: [], teamList: [], childPlayerId: null },
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
  // A `photo` in the body is ignored: player photos go through api/photo/*.
  const { code, firstName, lastName, number, position, parentEmail, parentEmail2, parentEmails } = parseBody(req);
  if (!(await getTeam(code))) return res.status(404).json({ error: 'unknown team' });
  if (!(await coachRunsTeam(coach, code))) return res.status(403).json({ error: 'not your team' });
  if (!String(firstName || '').trim()) return res.status(400).json({ error: 'first name required' });
  // Accept the flexible list; fall back to the legacy two fields.
  const pe = normalizeParentEmails(parentEmails !== undefined ? parentEmails : [parentEmail, parentEmail2]);
  if (pe.error) return res.status(400).json({ error: pe.error });
  if (!pe.emails.length) return res.status(400).json({ error: 'a parent email is required' });
  // id = lowercase first name (same id space as player:<id>).
  const playerId = String(firstName).trim().toLowerCase();
  const rec = await addMember(code, { playerId, firstName, lastName, number, position, parentEmails: pe.emails, status: 'active' });
  return res.status(200).json({ ok: true, member: withoutLegacyPhoto(rec) });
}

async function removePlayer(req, res) {
  if (!methodGuard(req, res, 'POST')) return;
  const coach = await requireCoach(req, res); if (!coach) return;
  const { code, playerId } = parseBody(req);
  if (!(await getTeam(code))) return res.status(404).json({ error: 'unknown team' });
  if (!(await coachRunsTeam(coach, code))) return res.status(403).json({ error: 'not your team' });
  if (!(await playerOnTeam(code, playerId))) return res.status(404).json({ error: 'player is not on this team' });
  const out = await removeMember(code, playerId);
  return res.status(200).json({ ok: true, ...out });
}

// POST edit an existing player's fields (name / number / position / emails). Coach-only.
// A `photo` in the body is ignored: player photos go through api/photo/*.
async function updatePlayer(req, res) {
  if (!methodGuard(req, res, 'POST')) return;
  const coach = await requireCoach(req, res); if (!coach) return;
  const { code, playerId, firstName, lastName, number, position, parentEmail, parentEmail2, parentEmails } = parseBody(req);
  if (!(await getTeam(code))) return res.status(404).json({ error: 'unknown team' });
  if (!(await coachRunsTeam(coach, code))) return res.status(403).json({ error: 'not your team' });
  if (!(await playerOnTeam(code, playerId))) return res.status(404).json({ error: 'player is not on this team' });
  if (firstName !== undefined && !String(firstName || '').trim()) {
    return res.status(400).json({ error: 'first name cannot be empty' });
  }
  const emailFields = parentEmailFields(parentEmails, parentEmail, parentEmail2);
  if (emailFields.error) return res.status(400).json({ error: emailFields.error });
  const rec = await updateMember(playerId, { firstName, lastName, number, position, ...emailFields.fields });
  if (!rec) return res.status(404).json({ error: 'unknown player' });
  return res.status(200).json({ ok: true, member: withoutLegacyPhoto(rec) });
}

// POST ?action=self-update-player { code (team), playerId, playerCode, firstName,
//   lastName, number, parentEmail, parentEmail2 } -> a signed-in PLAYER edits their
//   OWN record. Authorized by the player's own code (jersey + season year), which
//   only they/their parent hold; a player can never edit another player. Position
//   is NOT editable here (that is the coach's roster position; the player sets a
//   game-day position separately via set-game-position).
async function selfUpdatePlayer(req, res) {
  if (!methodGuard(req, res, 'POST')) return;
  const { code, playerId, playerCode, firstName, lastName, number, parentEmail, parentEmail2, parentEmails } = parseBody(req);
  res.setHeader('Cache-Control', 'no-store');
  const pid = String(playerId || '').toLowerCase();
  if (!pid) return res.status(400).json({ error: 'playerId required' });
  if (code && !(await getTeam(code))) return res.status(404).json({ error: 'unknown team' });
  const m = await getMember(pid);
  if (!m) return res.status(404).json({ error: 'unknown player' });
  // Authorize: the submitted code must match THIS player's current code
  // (jersey number + season year). This is the same secret the player signs in with.
  const cur = String(m.number == null ? '' : m.number).trim();
  const entered = String(playerCode || '').trim();
  if (!cur || (entered !== cur + '2027' && entered !== cur + '2026')) {
    return res.status(403).json({ error: 'that code did not match your player code' });
  }
  if (firstName !== undefined && !String(firstName || '').trim()) {
    return res.status(400).json({ error: 'first name cannot be empty' });
  }
  const emailFields = parentEmailFields(parentEmails, parentEmail, parentEmail2);
  if (emailFields.error) return res.status(400).json({ error: emailFields.error });
  const rec = await updateMember(pid, { firstName, lastName, number, ...emailFields.fields });
  if (!rec) return res.status(404).json({ error: 'unknown player' });
  return res.status(200).json({ ok: true, member: withoutLegacyPhoto(rec) });
}

// GET (admin key) full roster across all teams, for the admin roster editor.
async function adminRoster(req, res) {
  if (!methodGuard(req, res, 'GET')) return;
  if (!(await requireAdmin(req, res))) return;
  await ensureSeed();
  const codes = await listAllTeamCodes();
  const out = [];
  for (const code of codes) {
    const team = await getTeam(code);
    const ids = await listMembers(code);
    for (const pid of ids) {
      const m = await getMember(pid);
      if (m) out.push({ ...withoutLegacyPhoto(m), id: pid, parentEmails: parentEmailList(m), name: [m.firstName, m.lastName].filter(Boolean).join(' ') || m.firstName || pid, teamCode: code, teamName: (team && team.name) || code });
    }
  }
  out.sort((a, b) => String(a.teamName || '').localeCompare(String(b.teamName || '')) || Number(a.number || 0) - Number(b.number || 0));
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true, players: out });
}

// POST (admin key) edit a player's roster fields. Same validation as the coach
// update-player, but authorized by the admin key instead of a coach token.
async function adminUpdatePlayer(req, res) {
  if (!methodGuard(req, res, 'POST')) return;
  if (!(await requireAdmin(req, res))) return;
  const { playerId, firstName, lastName, number, position, parentEmail, parentEmail2, parentEmails } = parseBody(req);
  if (!(await getMember(playerId))) return res.status(404).json({ error: 'unknown player' });
  if (firstName !== undefined && !String(firstName || '').trim()) {
    return res.status(400).json({ error: 'first name cannot be empty' });
  }
  const emailFields = parentEmailFields(parentEmails, parentEmail, parentEmail2);
  if (emailFields.error) return res.status(400).json({ error: emailFields.error });
  const rec = await updateMember(playerId, { firstName, lastName, number, position, ...emailFields.fields });
  if (!rec) return res.status(404).json({ error: 'unknown player' });
  return res.status(200).json({ ok: true, member: withoutLegacyPhoto(rec) });
}

// GET whether the admin account exists and whether a password has been set yet.
// Public (no secret): only reveals the boolean, so the login UI can show the
// first-run "set a password" screen vs the normal login.
async function adminStatus(req, res) {
  if (!methodGuard(req, res, 'GET')) return;
  await ensureAdminSeed();
  const email = String((req.query && req.query.email) || SEED_ADMIN_EMAIL).trim().toLowerCase();
  const rec = await getAdmin(email);
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true, exists: !!rec, hasPassword: !!(rec && rec.passHash) });
}

// POST set the admin password. Allowed ONLY when no password is set yet
// (first-run). Rotating an existing password requires being logged in and is a
// separate flow, so this can never be used to hijack a live admin account.
async function adminSetPassword(req, res) {
  if (!methodGuard(req, res, 'POST')) return;
  await ensureAdminSeed();
  const { email, password } = parseBody(req);
  const cleanEmail = String(email || SEED_ADMIN_EMAIL).trim().toLowerCase();
  const rec = await getAdmin(cleanEmail);
  if (!rec) return res.status(404).json({ error: 'unknown admin' });
  if (rec.passHash) return res.status(409).json({ error: 'password already set' });
  const clean = String(password || '');
  if (clean.length < 8) return res.status(400).json({ error: 'password must be at least 8 characters' });
  await setAdmin(cleanEmail, { ...rec, passHash: passHash(clean) });
  const token = mintAdminToken(cleanEmail);
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true, token });
}

// POST admin login with email + password. Mints an admin session token.
async function adminLogin(req, res) {
  if (!methodGuard(req, res, 'POST')) return;
  await ensureAdminSeed();
  const { email, password } = parseBody(req);
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(cleanEmail)) return res.status(400).json({ error: 'bad email' });
  const rec = await getAdmin(cleanEmail);
  res.setHeader('Cache-Control', 'no-store');
  if (!rec || !rec.passHash || !safeEqual(rec.passHash, passHash(password))) {
    return res.status(401).json({ error: 'bad credentials' });
  }
  const token = mintAdminToken(cleanEmail);
  return res.status(200).json({ ok: true, token, admin: { email: cleanEmail, name: rec.name || 'Admin' } });
}

// POST change the coach's own login password. Coach-only (must know the current one).
async function setPassword(req, res) {
  if (!methodGuard(req, res, 'POST')) return;
  const coach = await requireCoach(req, res); if (!coach) return;
  const { currentPassword, newPassword } = parseBody(req);
  const rec = await getCoach(coach.email);
  if (!rec || !safeEqual(rec.passHash, passHash(currentPassword))) {
    return res.status(401).json({ error: 'current password did not match' });
  }
  const clean = String(newPassword || '');
  if (clean.length < 6) return res.status(400).json({ error: 'new password must be at least 6 characters' });
  await setCoach(coach.email, { ...rec, passHash: passHash(clean) });
  return res.status(200).json({ ok: true });
}

// Send a plain email via Resend (no SDK). Returns true on 2xx, false otherwise.
async function sendMail(to, subject, text) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.PHOTO_FROM_EMAIL;
  if (!key || !from) return false;
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, text }),
    });
    return resp.ok;
  } catch (e) {
    return false;
  }
}

// POST a coach password-reset request. Emails a one-time reset LINK (never the
// password itself), so the email is not a standing gate. Always answers ok so a
// public form cannot probe which emails are coaches.
async function requestPassword(req, res) {
  if (!methodGuard(req, res, 'POST')) return;
  await ensureSeed();
  const { email } = parseBody(req);
  const cleanEmail = String(email || '').trim().toLowerCase();
  res.setHeader('Cache-Control', 'no-store');
  if (!EMAIL_RE.test(cleanEmail)) return res.status(400).json({ error: 'bad email' });
  const coach = await getCoach(cleanEmail);
  if (coach) {
    const token = await createResetToken(cleanEmail);
    const base = process.env.SITE_URL || 'https://thwaphockey.com';
    const link = `${base}/?reset=${token}`;
    await sendMail(cleanEmail, 'Reset your Thwap Hockey coach password',
      `Someone asked to reset the coach password for your Thwap Hockey team.\n\n` +
      `Open this link to set a new password (expires in 30 minutes):\n${link}\n\n` +
      `If you did not ask for this, you can ignore this email.`);
  }
  return res.status(200).json({ ok: true });
}

// POST set a new coach password using a reset token (from the emailed link).
async function resetPassword(req, res) {
  if (!methodGuard(req, res, 'POST')) return;
  const { token, newPassword } = parseBody(req);
  const email = await consumeResetToken(token);
  if (!email) return res.status(400).json({ error: 'that reset link is invalid or expired' });
  const clean = String(newPassword || '');
  if (clean.length < 6) return res.status(400).json({ error: 'new password must be at least 6 characters' });
  const rec = await getCoach(email);
  if (!rec) return res.status(400).json({ error: 'that reset link is invalid or expired' });
  await setCoach(email, { ...rec, passHash: passHash(clean) });
  return res.status(200).json({ ok: true });
}

// POST a player-code request. Emails the player's code (jersey + season year) to
// the parent email on file. Always answers ok so it cannot probe the roster.
async function requestCode(req, res) {
  if (!methodGuard(req, res, 'POST')) return;
  const { code, playerId } = parseBody(req);
  res.setHeader('Cache-Control', 'no-store');
  if (!(await getTeam(code))) return res.status(200).json({ ok: true });
  const m = await getMember(playerId);
  if (m && m.number != null) {
    const name = m.firstName || 'your player';
    const subject = 'Your Thwap Hockey player code';
    const text =
      `The player code for ${name} is the jersey number followed by the season year.\n\n` +
      `For jersey #${m.number}: ${m.number}2026 or ${m.number}2027.\n\n` +
      `Use it to sign in on Thwap Hockey. If you did not ask for this, you can ignore this email.`;
    // Send the code to EVERY guardian email on file (any number of them).
    for (const clean of parentEmailList(m)) {
      if (EMAIL_RE.test(clean)) await sendMail(clean, subject, text);
    }
  }
  return res.status(200).json({ ok: true });
}

async function roster(req, res) {
  if (!methodGuard(req, res, 'GET')) return;
  await ensureSeed();
  const code = (req.query && req.query.code) || SEED_TEAM_CODE;
  const team = await getTeam(code);
  if (!team) return res.status(404).json({ error: 'unknown team' });
  // Parent emails are children's-family contact details: only a coach who runs
  // this team (or an admin) sees them all; a signed-in player sees only their
  // own (the self-edit sheet). Everyone else gets the roster without them.
  const tok = (req.query && req.query.coachToken) || '';
  const cTok = tok ? coachFromToken(tok) : null;
  const cRec = cTok ? await getCoach(cTok.email) : null;
  const seesAllEmails = !!(cRec && (await coachRunsTeam(cRec, code))) || (await isAdminReq(req));
  const session = verifySession(readSessionCookie(req));
  const selfId = session ? String(session.playerId || '').toLowerCase() : '';
  const ids = await listMembers(code);
  // This team's week only. weekBoard() with no ids reads the Jr. Rangers 10U
  // roster, which left every other team's coach looking at zeros.
  const board = await weekBoard(await teamPlayerIds(team.code)); // [{id, stick, shoot, dryland}]
  const byId = Object.fromEntries(board.map((b) => [b.id, b]));
  const members = [];
  for (const pid of ids) {
    const m = await getMember(pid);
    const wk = byId[pid] || { stick: 0, shoot: 0, dryland: 0, netplay: 0, iq: 0, pass: 0 };
    const trained = (wk.stick + wk.shoot + wk.dryland) > 0;
    const goal = await getIdpGoal(pid);
    members.push({
      playerId: pid,
      firstName: (m && m.firstName) || '', lastName: (m && m.lastName) || '',
      number: m ? m.number : null, position: (m && m.position) || '',
      status: (m && m.status) || 'active',
      parentEmails: (seesAllEmails || pid === selfId) ? parentEmailList(m) : [],
      // Full weekly split so the coach dashboard can break participation down by
      // skill (stick/shoot/dryland are the required triad; iq + pass are bonus).
      week: {
        stick: wk.stick || 0, shoot: wk.shoot || 0, dryland: wk.dryland || 0,
        netplay: wk.netplay || 0, iq: wk.iq || 0, pass: wk.pass || 0,
      },
      trainedThisWeek: trained,
      idpGoal: goal ? goal.text : '',
    });
  }
  const trainedCount = members.filter((m) => m.trainedThisWeek).length;
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    ok: true, team: { code: team.code, name: team.name, ageGroup: team.ageGroup, betaUntil: (team.betaUntil === undefined ? null : team.betaUntil) },
    participation: { trained: trainedCount, total: members.length },
    members,
  });
}

async function playerRollup(req, res) {
  if (!methodGuard(req, res, 'GET')) return;
  const pid = String((req.query && req.query.playerId) || '').toLowerCase();
  if (!pid) return res.status(400).json({ error: 'playerId required' });
  const m = await getMember(pid);
  const board = await weekBoard([pid]); // this player's week, on any team
  const wk = board.find((b) => b.id === pid) || { stick: 0, shoot: 0, dryland: 0 };
  const goal = await getIdpGoal(pid);
  const log = await getGameGoalLog(pid);
  const trend = await monthTrend(pid, 4);
  // The public game-day page reads member.position/gamePosition here, so the
  // record stays readable, minus parent emails unless the caller may see them.
  const member = m ? withoutLegacyPhoto((await canSeeParentEmails(req, m.teamCode, pid)) ? m : withoutParentEmails(m)) : null;
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    ok: true, playerId: pid,
    member,
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
  // join needs only a team code, so it must not hand back parent emails.
  const player = withoutLegacyPhoto((await canSeeParentEmails(req, team.code, pid)) ? m : withoutParentEmails(m));
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true, team: { code: team.code, name: team.name }, player });
}

async function schedule(req, res) {
  if (!methodGuard(req, res, 'GET')) return;
  const code = (req.query && req.query.code) || SEED_TEAM_CODE;
  if (!(await getTeam(code))) return res.status(404).json({ error: 'unknown team' });
  const sched = await ensureSchedule(code);
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true, schedule: sched, next: nextEvent(sched) });
}

// POST add one event to the schedule (head/assistant coach). Manual add today;
// the same handler is the write target for a future TeamSnap sync.
async function addEvent(req, res) {
  if (!methodGuard(req, res, 'POST')) return;
  const coach = await requireCoach(req, res); if (!coach) return;
  const { code, event } = parseBody(req);
  if (!(await getTeam(code))) return res.status(404).json({ error: 'unknown team' });
  if (!(await coachRunsTeam(coach, code))) return res.status(403).json({ error: 'not your team' });
  if (!event || !event.date) return res.status(400).json({ error: 'event date required' });
  const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  if (!DAY_RE.test(String(event.date))) return res.status(400).json({ error: 'event date must be YYYY-MM-DD' });
  const kind = event.kind || 'game';
  if (kind !== 'game' && kind !== 'tournament') return res.status(400).json({ error: 'kind must be game or tournament' });
  if (kind === 'tournament' && event.endDate != null && event.endDate !== '') {
    if (!DAY_RE.test(String(event.endDate)) || event.endDate < event.date) return res.status(400).json({ error: 'the last day must be on or after the first day' });
  }
  const sched = await addScheduleEvent(code, { ...event, kind });
  return res.status(200).json({ ok: true, schedule: sched, next: nextEvent(sched) });
}

// POST set the signed-in coach's own name + photo (data URL). Enriches the
// team-visible coaches strip.
async function setCoachProfile(req, res) {
  if (!methodGuard(req, res, 'POST')) return;
  const coach = await requireCoach(req, res); if (!coach) return;
  const { name, photo } = parseBody(req);
  const cleanName = String(name || '').trim().slice(0, 60);
  if (!cleanName) return res.status(400).json({ error: 'name required' });
  const photoStr = typeof photo === 'string' && photo.startsWith('data:image/') ? photo.slice(0, 400000) : (coach.photo || '');
  await setCoach(coach.email, { ...coach, name: cleanName, photo: photoStr });
  // Return the refreshed coaches list for whatever team the coach names.
  const body = parseBody(req);
  let coaches = [];
  if (body.code && (await getTeam(body.code))) {
    const team = await getTeam(body.code);
    if (team.coachEmail) await ensureHeadCoach(body.code, team.coachEmail);
    coaches = await enrichCoaches(body.code);
    // Any registered coach can name any team code here, so emails only go back
    // to a coach who runs that team.
    if (!(await coachRunsTeam(coach, body.code))) coaches = withoutCoachEmails(coaches);
  }
  return res.status(200).json({ ok: true, coaches });
}

// GET the team's weekly plan (which categories are on each weekday). Public read
// so the kid app can shape today's home; defaults to all-3-every-day when unset.
//
// Which team: an explicit ?code= (the coach Plan screen) wins, unchanged. With no
// code (the player app), the team comes from the signed-in player's SESSION via
// lib/team_players.js resolvePlayer, the same lookup /api/done?view=today uses,
// so web and watch build today's drills from the same plan. No session (or a
// session for a player no longer on any team) keeps the Jr. Rangers 10U default.
async function getPlan(req, res) {
  if (!methodGuard(req, res, 'GET')) return;
  const code = (req.query && req.query.code) || (await sessionTeamCode(req)) || SEED_TEAM_CODE;
  if (!(await getTeam(code))) return res.status(404).json({ error: 'unknown team' });
  res.setHeader('Cache-Control', 'no-store');
  // Billing status rides along so the client can paywall from the call it already
  // makes; `code` here is the same team the plan is for.
  return res.status(200).json({ ok: true, plan: await getTeamPlan(code), billing: await billingStatus(code) });
}

// The signed-in player's team code, or '' (no/invalid session, unknown player,
// or a lookup error). Never throws: a plan read must fail open to the default.
async function sessionTeamCode(req) {
  try {
    const claims = verifySession(readSessionCookie(req));
    if (!claims || !claims.playerId) return '';
    const me = await resolvePlayer(claims.playerId);
    return (me && me.teamCode) || '';
  } catch {
    return '';
  }
}

// POST the team's weekly plan. Coach-only.
async function setPlan(req, res) {
  if (!methodGuard(req, res, 'POST')) return;
  const coach = await requireCoach(req, res); if (!coach) return;
  const { code, plan } = parseBody(req);
  if (!(await getTeam(code))) return res.status(404).json({ error: 'unknown team' });
  if (!(await coachRunsTeam(coach, code))) return res.status(403).json({ error: 'not your team' });
  // Paywall: no editing the weekly plan when the team's season is unpaid. No-op
  // until BILLING_ENFORCED=1, and fails open if billing can't be read.
  if (await isGated(code)) return res.status(402).json({ error: 'season not active', gated: true });
  const saved = await setTeamPlan(code, plan);
  return res.status(200).json({ ok: true, plan: saved });
}

// GET the team's shared game-day goal. Public (players read it into their plan).
async function teamGoal(req, res) {
  if (!methodGuard(req, res, 'GET')) return;
  const code = (req.query && req.query.code) || SEED_TEAM_CODE;
  if (!(await getTeam(code))) return res.status(404).json({ error: 'unknown team' });
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true, teamGoal: await getTeamGoal(code) });
}

// POST the team's shared game-day goal. Coach-only. Empty text clears it.
async function setTeamGoalHandler(req, res) {
  if (!methodGuard(req, res, 'POST')) return;
  const coach = await requireCoach(req, res); if (!coach) return;
  const { code, text } = parseBody(req);
  if (!(await getTeam(code))) return res.status(404).json({ error: 'unknown team' });
  if (!(await coachRunsTeam(coach, code))) return res.status(403).json({ error: 'not your team' });
  const rec = await setTeamGoal(code, { text });
  return res.status(200).json({ ok: true, teamGoal: rec });
}

// POST a coach's drill recommendation to the Thwap backlog. Coach-only.
async function suggestDrill(req, res) {
  if (!methodGuard(req, res, 'POST')) return;
  const coach = await requireCoach(req, res); if (!coach) return;
  const { code, category, text } = parseBody(req);
  if (!(await getTeam(code))) return res.status(404).json({ error: 'unknown team' });
  if (!(await coachRunsTeam(coach, code))) return res.status(403).json({ error: 'not your team' });
  const rec = await addDrillSuggestion(code, { category, text, byCoach: coach.email });
  if (!rec) return res.status(400).json({ error: 'a drill description is required' });
  return res.status(200).json({ ok: true, suggestion: rec });
}

// GET the team's drill suggestions (Thwap review backlog). Coach-only.
async function drillSuggestions(req, res) {
  if (!methodGuard(req, res, 'GET')) return;
  const coach = await requireCoach(req, res); if (!coach) return;
  const code = (req.query && req.query.code) || SEED_TEAM_CODE;
  if (!(await getTeam(code))) return res.status(404).json({ error: 'unknown team' });
  if (!(await coachRunsTeam(coach, code))) return res.status(403).json({ error: 'not your team' });
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true, suggestions: await listDrillSuggestions(code) });
}

// Thwap-admin auth: the shared secret in the Authorization: Bearer header only
// (never ?key= in the URL). Disabled (all calls 401) when the env secret is unset.
function adminOk(req) {
  return sharedKeyOk(req);
}

// GET all coach drill suggestions across every team (Thwap review backlog). Admin-only.
async function reviewSuggestions(req, res) {
  if (!methodGuard(req, res, 'GET')) return;
  if (!(await requireAdmin(req, res))) return;
  await ensureSeed();
  const codes = await listAllTeamCodes();
  const out = [];
  for (const code of codes) {
    const team = await getTeam(code);
    const list = await listDrillSuggestions(code);
    for (const s of list) out.push({ ...s, teamCode: code, teamName: (team && team.name) || code });
  }
  out.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true, suggestions: out });
}

// POST accept/dismiss a suggestion (flip its status). Admin-only.
async function resolveSuggestion(req, res) {
  if (!methodGuard(req, res, 'POST')) return;
  if (!(await requireAdmin(req, res))) return;
  const { code, id, status } = parseBody(req);
  const rec = await setSuggestionStatus(code, id, status);
  if (!rec) return res.status(404).json({ error: 'unknown suggestion or bad status' });
  return res.status(200).json({ ok: true, suggestion: rec });
}

// POST correct a player's discipline counts by a signed delta. Admin-only.
// Body: { playerId, stick?, shoot?, dryland?, netplay?, iq?, pass?, onDate? } (deltas,
// usually negative). Used for one-off data corrections (e.g. undoing double-counted
// completions from a bug, or trimming an over-count down to the real total).
// Decrements the aggregate counts (clamped at 0) AND removes the matching number of
// dated events for onDate (default today) so the weekly split corrects too. All six
// disciplines are accepted (adjustPlayer already loops over every DISCIPLINE); the
// handler previously destructured only stick/shoot/dryland, so iq/pass/netplay could
// not be corrected. Returns the updated player object.
async function adjustCounts(req, res) {
  if (!methodGuard(req, res, 'POST')) return;
  if (!(await requireAdmin(req, res))) return;
  const { playerId, stick, shoot, dryland, netplay, iq, pass, onDate } = parseBody(req);
  const pid = String(playerId || '').toLowerCase();
  if (!pid || !ROSTER.some((p) => p.id === pid)) {
    return res.status(400).json({ error: 'unknown player' });
  }
  const deltas = {
    stick: Number(stick) || 0,
    shoot: Number(shoot) || 0,
    dryland: Number(dryland) || 0,
    netplay: Number(netplay) || 0,
    iq: Number(iq) || 0,
    pass: Number(pass) || 0,
  };
  const date = (typeof onDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(onDate)) ? onDate : undefined;
  const updated = date ? await adjustPlayer(pid, deltas, date) : await adjustPlayer(pid, deltas);
  return res.status(200).json({ ok: true, player: updated });
}

// GET the team's coach roster (head + assistants). Seeds the head from the team's
// coachEmail on first read. Public read (coaches list is not sensitive).
// Enrich a team's coach roster with each coach's name + photo (from coach:<email>).
async function enrichCoaches(code) {
  const list = await listTeamCoaches(code);
  const out = [];
  for (const c of list) {
    const rec = await getCoach(c.email);
    out.push({ email: c.email, role: c.role, name: (rec && rec.name && rec.name !== 'Coach') ? rec.name : '', photo: (rec && rec.photo) || '' });
  }
  return out;
}

// Coach emails are contact details. A team code is shared with every family, so
// it is not enough to read them: only a coach who runs this team (or an admin)
// gets emails. Everyone else gets name, role and photo, which is all the player
// and parent banner shows.
function withoutCoachEmails(list) {
  return (list || []).map(({ email, ...rest }) => rest);
}
async function canSeeCoachEmails(req, code) {
  const coach = await coachFromReq(req);
  if (coach && (await coachRunsTeam(coach, code))) return true;
  return isAdminReq(req);
}

async function teamCoaches(req, res) {
  if (!methodGuard(req, res, 'GET')) return;
  const code = (req.query && req.query.code) || SEED_TEAM_CODE;
  const team = await getTeam(code);
  if (!team) return res.status(404).json({ error: 'unknown team' });
  if (team.coachEmail) await ensureHeadCoach(code, team.coachEmail);
  const coaches = await enrichCoaches(code);
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    ok: true,
    coaches: (await canSeeCoachEmails(req, code)) ? coaches : withoutCoachEmails(coaches),
    maxAssistants: MAX_ASSISTANTS,
  });
}

// POST invite an assistant coach (head only, capped at MAX_ASSISTANTS). Adds them
// to the team's coach roster and, if that email already has a coach record, grants
// them the team so they see it on sign-in.
async function inviteCoach(req, res) {
  if (!methodGuard(req, res, 'POST')) return;
  const coach = await requireCoach(req, res); if (!coach) return;
  const { code, email, name, photo, password } = parseBody(req);
  const team = await getTeam(code);
  if (!team) return res.status(404).json({ error: 'unknown team' });
  if (team.coachEmail) await ensureHeadCoach(code, team.coachEmail);
  const list = await listTeamCoaches(code);
  const isHead = list.some((c) => c.role === 'head' && c.email === coach.email);
  if (!isHead) return res.status(403).json({ error: 'only the head coach can invite' });
  const inviteEmail = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(inviteEmail)) return res.status(400).json({ error: 'bad email' });
  const result = await addAssistantCoach(code, inviteEmail, { name, photo });
  if (!result.ok) return res.status(409).json({ error: result.reason, coaches: result.coaches });
  // Create or update the assistant's login record so they can actually sign in.
  const existing = await getCoach(inviteEmail);
  const teams = Array.from(new Set([...((existing && existing.teams) || []), String(code).toUpperCase()]));
  const rec = { ...(existing || {}), email: inviteEmail, teams };
  if (typeof name === 'string' && name.trim()) rec.name = name.trim();
  if (typeof photo === 'string' && photo.startsWith('data:image/')) rec.photo = photo.slice(0, 400000);
  // A password sets their login credential; without one they cannot sign in yet.
  if (password != null && String(password).length >= 4) rec.passHash = passHash(String(password));
  await setCoach(inviteEmail, rec);
  return res.status(200).json({ ok: true, coaches: await enrichCoaches(code) });
}

// POST remove an assistant coach (head only).
async function removeCoach(req, res) {
  if (!methodGuard(req, res, 'POST')) return;
  const coach = await requireCoach(req, res); if (!coach) return;
  const { code, email } = parseBody(req);
  const team = await getTeam(code);
  if (!team) return res.status(404).json({ error: 'unknown team' });
  if (team.coachEmail) await ensureHeadCoach(code, team.coachEmail);
  const list = await listTeamCoaches(code);
  const isHead = list.some((c) => c.role === 'head' && c.email === coach.email);
  if (!isHead) return res.status(403).json({ error: 'only the head coach can remove' });
  const next = await removeAssistantCoach(code, String(email || '').trim().toLowerCase());
  return res.status(200).json({ ok: true, coaches: next });
}

async function setIdp(req, res) {
  if (!methodGuard(req, res, 'POST')) return;
  const { playerId, text } = parseBody(req);
  const pid = String(playerId || '').toLowerCase();
  if (!pid) return res.status(400).json({ error: 'playerId required' });
  // Who set it comes from the credential, not the body, so it cannot be spoofed.
  const setBy = await authorizePlayerWrite(req, res, pid); if (!setBy) return;
  const rec = await setIdpGoal(pid, { text, setBy });
  return res.status(200).json({ ok: true, idpGoal: rec });
}

// POST ?action=set-game-position { playerId, gamePosition }  -> the player's own
// game-day position ('F'|'D'|'B'). Player-owned (no coach token), and stored on a
// SEPARATE field so it never overwrites the coach's roster `position`.
async function setGamePosition(req, res) {
  if (!methodGuard(req, res, 'POST')) return;
  const { playerId, gamePosition, playerCode } = parseBody(req);
  const pid = String(playerId || '').toLowerCase();
  if (!pid) return res.status(400).json({ error: 'playerId required' });
  if (!['F', 'D', 'B'].includes(gamePosition)) return res.status(400).json({ error: 'bad position' });
  const m = await getMember(pid);
  if (!m) return res.status(404).json({ error: 'unknown player' });
  // Authorize the same way self-update-player does: the submitted code must
  // match THIS player's current code (jersey number + season year), the secret
  // the player signs in with. Without this, any caller could set any player's
  // game-day position -- a write to another kid's record with no auth.
  const cur = String(m.number == null ? '' : m.number).trim();
  const entered = String(playerCode || '').trim();
  if (!cur || (entered !== cur + '2027' && entered !== cur + '2026')) {
    return res.status(403).json({ error: 'that code did not match your player code' });
  }
  const rec = await updateMember(pid, { gamePosition });
  if (!rec) return res.status(404).json({ error: 'unknown player' });
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true, gamePosition: rec.gamePosition });
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
  if (!(await authorizePlayerWrite(req, res, pid))) return;
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

// --- Game Day Goals picks (server copy, for other devices and the watch) ----
// Game day follows the web app's "next game" card and hockey_game_goals.html's
// header, which both read next.nextGame from lib/schedule_store nextEvent(): the
// soonest scheduled event, a game OR a tournament, that has not ended yet
// (endDate, else date, on or after today's Vancouver date). A tournament counts
// as game day on every date from its start through its endDate. With no gameId
// the target is that next event; a gameId names one event on the team schedule.

// The player's team schedule. The Rangers seed team seeds its schedule on first
// read (same as ?action=schedule); other teams read what their coach entered.
async function teamScheduleFor(code) {
  return code === RANGERS_TEAM_CODE ? ensureSchedule(code) : getSchedule(code);
}
const GAME_DAY_KINDS = ['game', 'tournament'];
function nextGameOf(sched, today) {
  const events = (sched.events || []).filter((e) => e && e.date && GAME_DAY_KINDS.includes(e.kind || 'game'));
  return nextEvent({ ...sched, events }, today).nextGame;
}
// { game } or { error, status }. today is the Vancouver date.
function resolvePickGame(sched, gameId, today) {
  const gid = String(gameId || '').trim();
  if (gid) {
    const ev = (sched.events || []).find((e) => e && e.id === gid);
    return ev ? { game: ev } : { status: 400, error: 'unknown game' };
  }
  const g = nextGameOf(sched, today);
  return g ? { game: g } : { status: 409, error: 'no upcoming game' };
}
function isGameDay(game, today) {
  if (!game || !game.date) return false;
  return today >= game.date && today <= (game.endDate || game.date);
}
function publicGame(g) {
  if (!g) return null;
  return {
    id: g.id, kind: g.kind || 'game', date: g.date, endDate: g.endDate || null,
    time: g.time || null, opponent: g.opponent || '', home: !!g.home, place: g.place || '',
  };
}
// How many goals a player may pick: the full plan minus the coach's team goal
// slot, the same rule as selfCap in hockey_game_goals.html.
function pickCap(teamGoalRec) {
  return GAME_GOAL_TARGET - (teamGoalRec && String(teamGoalRec.text || '').trim() ? 1 : 0);
}

// POST ?action=save-game-goals { gameId?, goalIds }  -> save the SIGNED-IN
// player's own picks. Only the thwapSession player may write; a body playerId
// naming someone else is refused (403), never written. Coaches cannot write a
// kid's picks.
async function saveGameGoals(req, res) {
  if (!methodGuard(req, res, 'POST')) return;
  const selfId = sessionPlayerId(req);
  if (!selfId) return res.status(401).json({ error: 'session required' });
  const { gameId, goalIds, playerId } = parseBody(req);
  if (playerId != null && String(playerId).trim() && String(playerId).trim().toLowerCase() !== selfId) {
    return res.status(403).json({ error: 'not your account' });
  }
  if (!Array.isArray(goalIds)) return res.status(400).json({ error: 'goalIds must be a list' });
  const ids = [];
  for (const raw of goalIds) {
    const id = String(raw || '').trim();
    if (!gameGoalById(id)) return res.status(400).json({ error: 'unknown goal', goalId: id });
    if (!ids.includes(id)) ids.push(id);
  }
  const player = await resolveSigninPlayer(selfId);
  if (!player) return res.status(404).json({ error: 'unknown player' });
  const today = localDateStr();
  const sched = await teamScheduleFor(player.teamCode);
  const r = resolvePickGame(sched, gameId, today);
  if (!r.game) return res.status(r.status).json({ error: r.error });
  const tg = await getTeamGoal(player.teamCode);
  const max = pickCap(tg);
  if (ids.length > max) return res.status(400).json({ error: 'too many goals', max });
  const rec = await setGamePick(selfId, r.game.id, ids);
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true, gameId: rec.gameId, goalIds: rec.goalIds, savedAt: rec.savedAt, max });
}

// GET ?action=my-game-goals [&gameId=] [&playerId=&coachToken=]
//   -> { ok, playerId, gameDay, game, goals:[{id,title,emoji,cue}], teamGoal,
//        savedAt, max }
// The signed-in player reads their own, from the web session OR an approved
// Apple Watch (lib/watch_store.js sessionClaims, the same check api/done.js
// uses; a removed watch is refused). A coach who runs the player's team may
// read a player by playerId. gameDay is true only on the game's Vancouver date.
// save-game-goals stays web-session only.
async function myGameGoals(req, res) {
  if (!methodGuard(req, res, 'GET')) return;
  const q = req.query || {};
  const claims = await sessionClaims(req);
  const selfId = claims ? String(claims.playerId || '').toLowerCase() : '';
  const asked = String(q.playerId || '').trim().toLowerCase();
  let pid = '';
  if (selfId && (!asked || asked === selfId)) {
    pid = selfId;
  } else {
    const coach = await coachFromReq(req);
    if (!coach && !selfId) return res.status(401).json({ error: 'session required' });
    if (!asked) return res.status(400).json({ error: 'playerId required' });
    const m = await resolveSigninPlayer(asked);
    if (!coach || !m || !(await coachRunsTeam(coach, m.teamCode))) {
      return res.status(403).json({ error: 'not your account' });
    }
    pid = asked;
  }
  const player = await resolveSigninPlayer(pid);
  if (!player) return res.status(404).json({ error: 'unknown player' });
  const today = localDateStr();
  const sched = await teamScheduleFor(player.teamCode);
  const teamGoalRec = await getTeamGoal(player.teamCode);
  res.setHeader('Cache-Control', 'no-store');
  const r = resolvePickGame(sched, q.gameId, today);
  if (!r.game && r.status === 400) return res.status(400).json({ error: r.error });
  const game = r.game || null;
  const pick = game ? await getGamePick(pid, game.id) : null;
  const goals = (pick ? pick.goalIds : [])
    .map((id) => gameGoalById(id))
    .filter(Boolean)
    .map((g) => ({ id: g.id, title: g.title, emoji: g.emoji, cue: g.cue }));
  return res.status(200).json({
    ok: true,
    playerId: pid,
    gameDay: isGameDay(game, today),
    game: publicGame(game),
    goals,
    saved: !!pick,
    savedAt: pick ? pick.savedAt : null,
    teamGoal: teamGoalRec || null,
    max: pickCap(teamGoalRec),
  });
}

// GET ?action=history&playerId=<pid>  -> the player's own review history:
// their game-day goal + teach check-offs AND the full coach/player goal history.
// Read-only and non-sensitive (a player's own goals), so no code is required to
// read; writes stay gated. Both logs come back newest-first.
async function historyRead(req, res) {
  if (!methodGuard(req, res, 'GET')) return;
  const pid = String((req.query && req.query.playerId) || '').toLowerCase();
  if (!pid) return res.status(400).json({ error: 'playerId required' });
  const [goals, idp] = await Promise.all([getGameGoalLog(pid), getIdpGoalLog(pid)]);
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    ok: true,
    playerId: pid,
    gameGoals: goals.slice(-60).reverse(),
    idpGoals: idp.slice().reverse(),
  });
}

// PUBLIC, no-auth: the home "beta" banner reads this to decide whether to keep
// showing itself for a team. Returns only { ok, betaUntil } (null when unset or
// the team is unknown), which is non-sensitive. The player home cannot fetch the
// coach-gated roster, so this is its data source. Defaults to the seed team;
// accepts ?code=. no-store so a stale CDN copy never pins the banner on/off.
async function beta(req, res) {
  if (!methodGuard(req, res, 'GET')) return;
  await ensureSeed();
  const code = (req.query && req.query.code) || SEED_TEAM_CODE;
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true, betaUntil: await getBetaUntil(code) });
}

// Register a device push token (from the Capacitor native shell). Linking a
// device to a player decides who receives that player's pushes, so it needs the
// signed-in player (thwapSession cookie) or a coach who runs the player's team,
// via the same authorizePlayerWrite gate as the other player writes. The token is
// stored only under the authorized player: a body `player` naming someone else
// is refused, never written. The current shell registers through
// /api/push?action=register; this route stays for older builds.
async function pushRegister(req, res) {
  if (!methodGuard(req, res, 'POST')) return;
  const { token, platform, player } = parseBody(req);
  if (!String(token || '').trim()) return res.status(400).json({ error: 'token required' });
  const pid = String(player || sessionPlayerId(req) || '').trim().toLowerCase();
  if (!pid) return res.status(401).json({ error: 'session required' });
  if (!(await authorizePlayerWrite(req, res, pid))) return;
  const result = await savePushToken({ token, platform, player: pid });
  if (!result.ok) return res.status(400).json({ error: result.error || 'token required' });
  return res.status(200).json({ ok: true });
}

export default async function handler(req, res) {
  const action = String((req.query && req.query.action) || '').toLowerCase();
  switch (action) {
    case 'coach-login': return coachLogin(req, res);
    case 'coach-register': return coachRegister(req, res);
    case 'create-team': return createTeam(req, res);
    case 'add-player': return addPlayer(req, res);
    case 'remove-player': return removePlayer(req, res);
    case 'update-player': return updatePlayer(req, res);
    case 'set-letter': return setLetter(req, res);
    case 'self-update-player': return selfUpdatePlayer(req, res);
    case 'admin-roster': return adminRoster(req, res);
    case 'admin-update-player': return adminUpdatePlayer(req, res);
    case 'admin-login': return adminLogin(req, res);
    case 'admin-set-password': return adminSetPassword(req, res);
    case 'admin-status': return adminStatus(req, res);
    case 'set-password': return setPassword(req, res);
    case 'request-password': return requestPassword(req, res);
    case 'reset-password': return resetPassword(req, res);
    case 'request-code': return requestCode(req, res);
    case 'roster': return roster(req, res);
    case 'player': return playerRollup(req, res);
    case 'join': return join(req, res);
    case 'schedule': return schedule(req, res);
    case 'add-event': return addEvent(req, res);
    case 'set-coach-profile': return setCoachProfile(req, res);
    case 'get-plan': return getPlan(req, res);
    case 'set-plan': return setPlan(req, res);
    case 'team-goal': return teamGoal(req, res);
    case 'set-team-goal': return setTeamGoalHandler(req, res);
    case 'suggest-drill': return suggestDrill(req, res);
    case 'drill-suggestions': return drillSuggestions(req, res);
    case 'review-suggestions': return reviewSuggestions(req, res);
    case 'resolve-suggestion': return resolveSuggestion(req, res);
    case 'adjust-counts': return adjustCounts(req, res);
    case 'team-coaches': return teamCoaches(req, res);
    case 'invite-coach': return inviteCoach(req, res);
    case 'remove-coach': return removeCoach(req, res);
    case 'set-idp-goal': return setIdp(req, res);
    case 'set-game-position': return setGamePosition(req, res);
    case 'idp-goal': return idpGoal(req, res);
    case 'log-game-goal': return logGoal(req, res);
    case 'game-goal-log': return gameGoalLogRead(req, res);
    case 'save-game-goals': return saveGameGoals(req, res);
    case 'my-game-goals': return myGameGoals(req, res);
    case 'history': return historyRead(req, res);
    case 'push-register': return pushRegister(req, res);
    case 'beta': return beta(req, res);
    default: return res.status(404).json({ error: 'unknown coach action' });
  }
}

// Exported for unit tests (call sub-handlers directly with a query.action-free req).
export const _handlers = {
  coachLogin, coachRegister, createTeam, addPlayer, removePlayer, roster, playerRollup,
  updatePlayer, setLetter, setPassword, requestPassword, resetPassword, requestCode,
  adminRoster, adminUpdatePlayer,
  adminLogin, adminSetPassword, adminStatus,
  join, schedule, setIdp, idpGoal, logGoal, gameGoalLogRead, historyRead, setGamePosition,
  saveGameGoals, myGameGoals,
  getPlan, setPlan, beta,
  teamGoal, setTeamGoal: setTeamGoalHandler,
  suggestDrill, drillSuggestions,
  reviewSuggestions, resolveSuggestion, adjustCounts,
  teamCoaches, inviteCoach, removeCoach,
  addEvent, setCoachProfile,
  pushRegister,
};
export const _seed = { SEED_TEAM_CODE, SEED_COACH_EMAIL, SEED_COACH_PASSWORD, SEED_CHILD_PLAYER_ID, ensureSeed, mintCoachToken };
