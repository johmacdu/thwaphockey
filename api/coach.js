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
  getTeamGoal, setTeamGoal,
  addDrillSuggestion, listDrillSuggestions, setSuggestionStatus, listAllTeamCodes,
  updateMember, createResetToken, consumeResetToken,
  getAdmin, setAdmin, ensureTeamIndexed,
  listTeamCoaches, ensureHeadCoach, addAssistantCoach, removeAssistantCoach, MAX_ASSISTANTS,
} from '../lib/teams_store.js';
import { ensureSchedule, getSchedule, addEvent as addScheduleEvent, nextEvent } from '../lib/schedule_store.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
      await setTeam(t.code, { name: t.name, association: 'Vancouver Jr. Rangers', ageGroup: t.ageGroup, coachEmail: SEED_COACH_EMAIL, createdAt: new Date().toISOString() });
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
// Authorize an admin request. Accepts the new admin session token (adminToken in
// body or query, or Bearer), and still accepts the legacy shared admin key so
// nothing that already used it breaks. Returns the admin record, or null (after
// writing a 401) when neither path authorizes.
async function requireAdmin(req, res) {
  const { adminToken } = parseBody(req);
  const auth = (req.headers && req.headers.authorization) ? String(req.headers.authorization) : '';
  const bearer = auth.indexOf('Bearer ') === 0 ? auth.slice(7) : '';
  const token = adminToken || (req.query && req.query.adminToken) || bearer || '';
  const a = adminFromToken(token);
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
  const { code, firstName, lastName, number, position, parentEmail, parentEmail2, photo } = parseBody(req);
  if (!(await getTeam(code))) return res.status(404).json({ error: 'unknown team' });
  if (!String(firstName || '').trim()) return res.status(400).json({ error: 'first name required' });
  if (!EMAIL_RE.test(String(parentEmail || '').trim().toLowerCase())) return res.status(400).json({ error: 'a parent email is required' });
  if (String(parentEmail2 || '').trim() && !EMAIL_RE.test(String(parentEmail2).trim().toLowerCase())) return res.status(400).json({ error: 'second parent email is invalid' });
  // id = lowercase first name (same id space as player:<id>).
  const playerId = String(firstName).trim().toLowerCase();
  const rec = await addMember(code, { playerId, firstName, lastName, number, position, parentEmail, parentEmail2, photo, status: 'active' });
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

// POST edit an existing player's fields (name / number / position / photo). Coach-only.
async function updatePlayer(req, res) {
  if (!methodGuard(req, res, 'POST')) return;
  const coach = await requireCoach(req, res); if (!coach) return;
  const { code, playerId, firstName, lastName, number, position, photo, parentEmail, parentEmail2 } = parseBody(req);
  if (!(await getTeam(code))) return res.status(404).json({ error: 'unknown team' });
  if (firstName !== undefined && !String(firstName || '').trim()) {
    return res.status(400).json({ error: 'first name cannot be empty' });
  }
  if (parentEmail !== undefined && String(parentEmail || '').trim() && !EMAIL_RE.test(String(parentEmail).trim().toLowerCase())) {
    return res.status(400).json({ error: 'parent email is invalid' });
  }
  if (parentEmail2 !== undefined && String(parentEmail2 || '').trim() && !EMAIL_RE.test(String(parentEmail2).trim().toLowerCase())) {
    return res.status(400).json({ error: 'second parent email is invalid' });
  }
  const rec = await updateMember(playerId, { firstName, lastName, number, position, photo, parentEmail, parentEmail2 });
  if (!rec) return res.status(404).json({ error: 'unknown player' });
  return res.status(200).json({ ok: true, member: rec });
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
      if (m) out.push({ ...m, id: pid, name: [m.firstName, m.lastName].filter(Boolean).join(' ') || m.firstName || pid, teamCode: code, teamName: (team && team.name) || code });
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
  const { playerId, firstName, lastName, number, position, parentEmail, parentEmail2 } = parseBody(req);
  if (!(await getMember(playerId))) return res.status(404).json({ error: 'unknown player' });
  if (firstName !== undefined && !String(firstName || '').trim()) {
    return res.status(400).json({ error: 'first name cannot be empty' });
  }
  if (parentEmail !== undefined && String(parentEmail || '').trim() && !EMAIL_RE.test(String(parentEmail).trim().toLowerCase())) {
    return res.status(400).json({ error: 'parent email is invalid' });
  }
  if (parentEmail2 !== undefined && String(parentEmail2 || '').trim() && !EMAIL_RE.test(String(parentEmail2).trim().toLowerCase())) {
    return res.status(400).json({ error: 'second parent email is invalid' });
  }
  const rec = await updateMember(playerId, { firstName, lastName, number, position, parentEmail, parentEmail2 });
  if (!rec) return res.status(404).json({ error: 'unknown player' });
  return res.status(200).json({ ok: true, member: rec });
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
  if (m && m.parentEmail && m.number != null) {
    const name = m.firstName || 'your player';
    await sendMail(m.parentEmail, 'Your Thwap Hockey player code',
      `The player code for ${name} is the jersey number followed by the season year.\n\n` +
      `For jersey #${m.number}: ${m.number}2026 or ${m.number}2027.\n\n` +
      `Use it to sign in on Thwap Hockey. If you did not ask for this, you can ignore this email.`);
  }
  return res.status(200).json({ ok: true });
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
  if (!event || !event.date) return res.status(400).json({ error: 'event date required' });
  const sched = await addScheduleEvent(code, event);
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
  }
  return res.status(200).json({ ok: true, coaches });
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
  const rec = await setTeamGoal(code, { text });
  return res.status(200).json({ ok: true, teamGoal: rec });
}

// POST a coach's drill recommendation to the Thwap backlog. Coach-only.
async function suggestDrill(req, res) {
  if (!methodGuard(req, res, 'POST')) return;
  const coach = await requireCoach(req, res); if (!coach) return;
  const { code, category, text } = parseBody(req);
  if (!(await getTeam(code))) return res.status(404).json({ error: 'unknown team' });
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
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true, suggestions: await listDrillSuggestions(code) });
}

// Thwap-admin auth: a bearer or ?key= secret, matching the waitlist admin pattern.
// Disabled (all calls 401) when the env secret is unset, so it is never open by default.
function adminOk(req) {
  const secret = process.env.THWAP_ADMIN_TOKEN || process.env.WAITLIST_ADMIN_TOKEN || '';
  if (!secret) return false;
  const auth = (req.headers && req.headers.authorization) ? String(req.headers.authorization) : '';
  const bearer = auth.indexOf('Bearer ') === 0 ? auth.slice(7) : '';
  const q = (req.query && (req.query.key || req.query.token)) || '';
  return bearer === secret || String(q) === secret;
}

// GET all coach drill suggestions across every team (Thwap review backlog). Admin-only.
async function reviewSuggestions(req, res) {
  if (!methodGuard(req, res, 'GET')) return;
  if (!adminOk(req)) return res.status(401).json({ error: 'unauthorized' });
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
  if (!adminOk(req)) return res.status(401).json({ error: 'unauthorized' });
  const { code, id, status } = parseBody(req);
  const rec = await setSuggestionStatus(code, id, status);
  if (!rec) return res.status(404).json({ error: 'unknown suggestion or bad status' });
  return res.status(200).json({ ok: true, suggestion: rec });
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

async function teamCoaches(req, res) {
  if (!methodGuard(req, res, 'GET')) return;
  const code = (req.query && req.query.code) || SEED_TEAM_CODE;
  const team = await getTeam(code);
  if (!team) return res.status(404).json({ error: 'unknown team' });
  if (team.coachEmail) await ensureHeadCoach(code, team.coachEmail);
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true, coaches: await enrichCoaches(code), maxAssistants: MAX_ASSISTANTS });
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
    case 'update-player': return updatePlayer(req, res);
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
    case 'team-coaches': return teamCoaches(req, res);
    case 'invite-coach': return inviteCoach(req, res);
    case 'remove-coach': return removeCoach(req, res);
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
  updatePlayer, setPassword, requestPassword, resetPassword, requestCode,
  adminRoster, adminUpdatePlayer,
  adminLogin, adminSetPassword, adminStatus,
  join, schedule, setIdp, idpGoal, logGoal, gameGoalLogRead,
  getPlan, setPlan,
  teamGoal, setTeamGoal: setTeamGoalHandler,
  suggestDrill, drillSuggestions,
  reviewSuggestions, resolveSuggestion,
  teamCoaches, inviteCoach, removeCoach,
  addEvent, setCoachProfile,
};
export const _seed = { SEED_TEAM_CODE, SEED_COACH_EMAIL, SEED_COACH_PASSWORD, SEED_CHILD_PLAYER_ID, ensureSeed, mintCoachToken };
