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
const teamPlanKey = (code) => `teamPlan:${codeNorm(code)}`;
const drillSuggestKey = (code) => `drillSuggest:${codeNorm(code)}`;

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
export async function addMember(code, { playerId, firstName, lastName, number, position, parentEmail, status, photo }) {
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
    photo: (typeof photo === 'string' && photo.startsWith('data:image/')) ? photo.slice(0, 400000) : '',
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

// --- Team coach roster: one head + up to MAX_ASSISTANTS assistants ----------
// Stored team:<code>:coaches as [{ email, role:'head'|'assistant', addedAt }].
const coachesKey = (code) => `team:${codeNorm(code)}:coaches`;
export const MAX_ASSISTANTS = 3;
export async function listTeamCoaches(code) {
  const raw = await kv.get(coachesKey(code));
  return Array.isArray(raw) ? raw : (typeof raw === 'string' ? (() => { try { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch { return []; } })() : []);
}
// Ensure a head record exists for a team (idempotent): used to seed the head from
// the team's coachEmail if the coaches list is empty.
export async function ensureHeadCoach(code, headEmail) {
  const list = await listTeamCoaches(code);
  if (list.some((c) => c.role === 'head')) return list;
  const next = [{ email: emailNorm(headEmail), role: 'head', addedAt: new Date().toISOString() }, ...list.filter((c) => c.email !== emailNorm(headEmail))];
  await kv.set(coachesKey(code), next);
  return next;
}
// Add an assistant. Returns { ok, coaches } or { ok:false, reason }.
export async function addAssistantCoach(code, email) {
  const e = emailNorm(email);
  const list = await listTeamCoaches(code);
  if (list.some((c) => c.email === e)) return { ok: false, reason: 'already a coach', coaches: list };
  const assistants = list.filter((c) => c.role === 'assistant');
  if (assistants.length >= MAX_ASSISTANTS) return { ok: false, reason: 'assistant limit reached', coaches: list };
  const next = list.concat([{ email: e, role: 'assistant', addedAt: new Date().toISOString() }]);
  await kv.set(coachesKey(code), next);
  return { ok: true, coaches: next };
}
export async function removeAssistantCoach(code, email) {
  const e = emailNorm(email);
  const list = await listTeamCoaches(code);
  const next = list.filter((c) => !(c.email === e && c.role === 'assistant'));
  await kv.set(coachesKey(code), next);
  return next;
}

// --- Team weekly plan -------------------------------------------------------
// Which categories/drills each weekday. Two accepted shapes per day:
//   legacy on/off:   mon: ['stick','shoot']                (category is on)
//   drill-level:     mon: { shoot:['Wrist Shots','Snap Shots'], stick:[...] }
// A day is normalized to the object shape on read; a legacy array becomes
// { cat: [] } (category on, no specific drills). Default (unset) is all-3-empty
// every day, matching the built-in rotation.
const PLAN_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const PLAN_CATS = ['stick', 'shoot', 'dryland'];
const MAX_DRILLS_PER_CAT = 40;
const MAX_DRILL_NAME = 80;
// Normalize one day's value (either shape) into { cat: [drillName,...] }.
function normDay(v) {
  const out = {};
  if (Array.isArray(v)) {
    for (const c of v) if (PLAN_CATS.includes(c)) out[c] = [];
    return out;
  }
  if (v && typeof v === 'object') {
    for (const c of PLAN_CATS) {
      if (!Array.isArray(v[c])) continue;
      const names = v[c]
        .filter((n) => typeof n === 'string')
        .map((n) => n.slice(0, MAX_DRILL_NAME))
        .slice(0, MAX_DRILLS_PER_CAT);
      out[c] = names;
    }
    return out;
  }
  return out;
}
function defaultPlan() {
  const p = {};
  for (const d of PLAN_DAYS) p[d] = {};
  return p;
}
export async function getTeamPlan(code) {
  const raw = await kv.get(teamPlanKey(code));
  if (!raw || typeof raw !== 'object') return defaultPlan();
  const out = {};
  for (const d of PLAN_DAYS) out[d] = normDay(raw[d]);
  return out;
}
export async function setTeamPlan(code, plan) {
  const out = {};
  const src = (plan && typeof plan === 'object') ? plan : {};
  for (const d of PLAN_DAYS) out[d] = normDay(src[d]);
  await kv.set(teamPlanKey(code), out);
  return out;
}

// --- Drill suggestions (coach -> Thwap backlog) -----------------------------
// A coach recommends a drill; Thwap reviews the list later. Append-only.
const SUGGEST_CATS = ['stick', 'shoot', 'dryland'];
const MAX_SUGGEST_TEXT = 140;
const MAX_SUGGESTIONS = 200;
export async function addDrillSuggestion(code, { category, text, byCoach } = {}) {
  const cat = SUGGEST_CATS.includes(category) ? category : 'stick';
  const clean = String(text || '').trim().slice(0, MAX_SUGGEST_TEXT);
  if (!clean) return null;
  const raw = await kv.get(drillSuggestKey(code));
  const list = Array.isArray(raw) ? raw.slice(0, MAX_SUGGESTIONS - 1) : [];
  const rec = {
    id: `s${Date.now().toString(36)}`,
    category: cat,
    text: clean,
    byCoach: String(byCoach || '').slice(0, 120),
    at: new Date().toISOString(),
    status: 'new',
  };
  list.unshift(rec);
  await kv.set(drillSuggestKey(code), list);
  return rec;
}
export async function listDrillSuggestions(code) {
  const raw = await kv.get(drillSuggestKey(code));
  return Array.isArray(raw) ? raw : [];
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
