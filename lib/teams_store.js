// lib/teams_store.js
//
// Store seam for the COACH + TEAM + IDP feature. Kept OUTSIDE api/ so it does not
// count against Vercel's 12-serverless-function cap (every .js under api/ is a
// function; helpers must live in lib/). Mirrors lib/store.js conventions: one
// Redis client, asArray() tolerance for parsed-or-string values, Vancouver-local
// dates, and never throwing on a missing/malformed key.
//
// Data model (Upstash Redis):
//   team:<code>            { code, name, association, ageGroup, coachEmail, createdAt }
//   team:<code>:members    JSON array of playerId (lowercase first name; same id
//                          space as player:<id> in lib/store.js)
//   teamMember:<playerId>  { teamCode, firstName, lastName, number, position,
//                            status:'active'|'invited', parentEmail, invitedAt, consentAt }
//                          THIS PHASE: status defaults 'active' (no consent gate yet).
//   coach:<email>          { email, name, passHash, teams:[<code>], childPlayerId, createdAt }
//   idpGoal:<playerId>     { text, month:'YYYY-MM', setBy:'player'|'coach', updatedAt }
//   gameGoalLog:<playerId> JSON array (capped) of { date:'YYYY-MM-DD', goalId,
//                            goalTitle, done:true, note:'' }
//
// A player's identity (player:<id>) is owned by lib/store.js and NEVER written
// here. Removing a team member deletes the membership only; the kid's card,
// history, and idpGoal travel with them.

import { Redis } from '@upstash/redis';

const kv = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});

const GAME_GOAL_LOG_CAP = 120;

// --- key helpers ------------------------------------------------------------
const codeNorm = (code) => String(code || '').trim().toUpperCase();
const idNorm = (id) => String(id || '').trim().toLowerCase();
const emailNorm = (e) => String(e || '').trim().toLowerCase();

const teamKey = (code) => `team:${codeNorm(code)}`;
const membersKey = (code) => `team:${codeNorm(code)}:members`;
const memberKey = (pid) => `teamMember:${idNorm(pid)}`;
const coachKey = (email) => `coach:${emailNorm(email)}`;
const idpGoalKey = (pid) => `idpGoal:${idNorm(pid)}`;
const gameGoalLogKey = (pid) => `gameGoalLog:${idNorm(pid)}`;

// --- tolerant array read (mirrors lib/store.js asArray) ---------------------
function asArray(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch { return []; }
  }
  return [];
}

// --- Vancouver-local date + month (mirrors lib/store.js) --------------------
const VANCOUVER_TZ = 'America/Vancouver';
function localDateStr(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: VANCOUVER_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}
function localMonthStr(date = new Date()) {
  return localDateStr(date).slice(0, 7); // 'YYYY-MM'
}

// --- Teams ------------------------------------------------------------------

// Read a team record, or null.
export async function getTeam(code) {
  return (await kv.get(teamKey(code))) || null;
}

// Create/overwrite a team record. Returns the stored object.
export async function setTeam(code, obj) {
  const rec = { ...obj, code: codeNorm(code) };
  await kv.set(teamKey(code), rec);
  return rec;
}

// Members are stored as a JSON array of playerIds (deduped, order-preserving).
export async function listMembers(code) {
  return asArray(await kv.get(membersKey(code)));
}

async function writeMembers(code, ids) {
  const uniq = Array.from(new Set(ids.map(idNorm)));
  await kv.set(membersKey(code), uniq);
  return uniq;
}

// Add a player to a team + write their membership record. status defaults active.
export async function addMember(code, { playerId, firstName, lastName, number, position, parentEmail, status }) {
  const pid = idNorm(playerId);
  const ids = await listMembers(code);
  if (!ids.includes(pid)) { ids.push(pid); await writeMembers(code, ids); }
  const rec = {
    teamCode: codeNorm(code),
    firstName: firstName || '',
    lastName: lastName || '',
    number: number == null ? null : Number(number),
    position: position || '',
    status: status || 'active',
    parentEmail: emailNorm(parentEmail),
    invitedAt: new Date().toISOString(),
    consentAt: (status || 'active') === 'active' ? new Date().toISOString() : null,
  };
  await kv.set(memberKey(pid), rec);
  return rec;
}

export async function getMember(playerId) {
  return (await kv.get(memberKey(playerId))) || null;
}

// Remove a player from a team. Deletes ONLY the membership + members-set entry.
// NEVER touches player:<id> or idpGoal:<id> (kid-owned identity travels).
export async function removeMember(code, playerId) {
  const pid = idNorm(playerId);
  const ids = (await listMembers(code)).filter((x) => x !== pid);
  await writeMembers(code, ids);
  await kv.del(memberKey(pid));
  return { removed: pid };
}

// --- Coach ------------------------------------------------------------------

export async function getCoach(email) {
  return (await kv.get(coachKey(email))) || null;
}

export async function setCoach(email, obj) {
  const rec = { ...obj, email: emailNorm(email) };
  await kv.set(coachKey(email), rec);
  return rec;
}

// --- IDP: monthly personal goal ---------------------------------------------

export async function getIdpGoal(playerId) {
  return (await kv.get(idpGoalKey(playerId))) || null;
}

export async function setIdpGoal(playerId, { text, setBy }) {
  const rec = {
    text: String(text || '').trim(),
    month: localMonthStr(),
    setBy: setBy === 'coach' ? 'coach' : 'player',
    updatedAt: new Date().toISOString(),
  };
  await kv.set(idpGoalKey(playerId), rec);
  return rec;
}

// --- IDP: game-day-goal self-report log -------------------------------------

export async function getGameGoalLog(playerId) {
  return asArray(await kv.get(gameGoalLogKey(playerId)));
}

// Append one game-goal check-off (done + optional note). Capped.
export async function logGameGoal(playerId, { goalId, goalTitle, done, note }) {
  const log = await getGameGoalLog(playerId);
  const entry = {
    date: localDateStr(),
    goalId: String(goalId || ''),
    goalTitle: String(goalTitle || ''),
    done: done !== false,
    note: String(note || '').trim(),
  };
  log.push(entry);
  const capped = log.length > GAME_GOAL_LOG_CAP ? log.slice(log.length - GAME_GOAL_LOG_CAP) : log;
  await kv.set(gameGoalLogKey(playerId), capped);
  return entry;
}

// Test/introspection helper: expose the month helper.
export const _internals = { localDateStr, localMonthStr };
