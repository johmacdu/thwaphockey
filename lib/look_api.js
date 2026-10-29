// lib/look_api.js
//
// The player character's look (docs/avatar-roadmap.md). Routed through
// api/board.js (?action=look / ?action=looks) instead of its own api/ file, to
// stay inside the Vercel Hobby 12-function cap.
//
// GET  /api/board?action=look   (signed in) -> { look, progress, unlocked, next }
//        The SESSION player's own look, unlock progress and owned item ids.
//        The player is taken from the session, never from the request.
// GET  /api/board?action=looks (public)    -> { looks: { <id>: look|null }, letters: { <id>: 'C'|'A' } }
//        Every player's look on the caller's team (session team, else Jr.
//        Rangers 10U) for teammate and roster cards. A look holds
//        only item ids (no photo, no name, no contact details), so it is as
//        public as the leaderboard. letters are the coach-granted C and A
//        (only players who have one are listed), as public as a jersey.
// POST /api/board?action=look  body: { look }  (signed in) -> { look }
//        Saves the session player's look. Every item must exist, sit in its own
//        slot and be UNLOCKED from recorded completions, else 400. Unlocks are
//        computed here, never trusted from the client.
//
// Auth -> 401 (no/invalid session). Unknown player -> 400.

import {
  getPlayer,
  getTrainingDays,
  getLook,
  setLook,
  getGrants,
  listLooks,
  listGrants,
  currentTeamGoal,
  playerTotalForWeek,
  setGrants,
} from './store.js';
import { listAllTeamCodes, listMembers } from './teams_store.js';
import { getSchedule, localDateStr } from './schedule_store.js';
import { journeyFor } from './journey.js';
import { verifySession, readSessionCookie } from './session_store.js';
import { resolvePlayer, teamForRequest } from './team_players.js';
import {
  ITEMS,
  SLOTS,
  DEFAULT_LOOK,
  itemById,
  progressFrom,
  ruleProgress,
  unlockedIds,
  isUnlocked,
  validateLook,
  sanitizeStoredLook,
  letterFromGrants,
  cleanFit,
} from './avatar_items.js';

function readBody(req) {
  const b = req.body;
  if (!b) return {};
  if (typeof b === 'object') return b;
  if (typeof b === 'string') {
    try { return JSON.parse(b); } catch { return {}; }
  }
  return {};
}

// The session player, on ANY team (lib/team_players.js). Unknown -> 400.
async function sessionPlayer(req) {
  const claims = verifySession(readSessionCookie(req));
  if (!claims) return { status: 401, error: 'session required' };
  const id = String(claims.playerId || '').toLowerCase();
  if (!(await resolvePlayer(id))) return { status: 400, error: 'unknown player' };
  return { id };
}

// The team(s) a player is on, from each team's member list.
async function teamCodesFor(id) {
  const out = [];
  for (const code of await listAllTeamCodes()) {
    if ((await listMembers(code)).map((m) => String(m).toLowerCase()).includes(id)) out.push(code);
  }
  return out;
}

function mondayOf(day) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
function plusDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Tournament weeks for the player's team(s): from the Monday of the week the
// tournament starts through its last day (or that Sunday, whichever is later).
// Returns the most training days the player has in any one of them.
async function bestTournamentWeek(id, dayList) {
  const days = new Set((dayList || []).filter((d) => typeof d === 'string'));
  let best = 0;
  for (const code of await teamCodesFor(id)) {
    const events = ((await getSchedule(code)).events || []).filter((e) => e && e.kind === 'tournament' && e.date);
    for (const e of events) {
      const from = mondayOf(e.date);
      const sunday = plusDays(from, 6);
      const to = (e.endDate && e.endDate > sunday) ? e.endDate : sunday;
      let n = 0;
      for (const d of days) if (d >= from && d <= to) n += 1;
      if (n > best) best = n;
    }
  }
  return best;
}

async function progressFor(id) {
  const [counts, dayList, grants0, teamGoal] = await Promise.all([getPlayer(id), getTrainingDays(id), getGrants(id), currentTeamGoal()]);
  const hits = teamGoal.weeks.filter((w) => w.hit);
  const progress = progressFrom(counts, dayList, hits.length);
  progress.tournament = await bestTournamentWeek(id, dayList);
  // The furthest scene reached on this season's path (My Season > Journey).
  progress.journeyTier = journeyFor(dayList, localDateStr()).highestTier;
  // Earned tournament items are saved to grants, so they stay even if the
  // tournament is later removed from the schedule.
  let grants = grants0;
  // Path rewards too: the path restarts each fall, the gear does not.
  const earned = ITEMS.filter((it) => !grants.includes(it.id) && (
    (it.rule.type === 'tournament' && progress.tournament >= it.rule.n)
    || (it.rule.type === 'journey' && progress.journeyTier >= it.rule.n))).map((it) => it.id);
  if (earned.length) grants = await setGrants(id, grants.concat(earned));
  // Grandfather: a hair style the kid already wears stays theirs even though
  // most styles became unlocks (Oct 28 2026). Saved to grants once, kept forever.
  const stored = await getLook(id);
  const worn = stored && itemById(stored.hairstyle);
  if (worn && worn.slot === 'hairstyle' && !isUnlocked(worn, progress, grants)) {
    grants = await setGrants(id, grants.concat([worn.id]));
  }
  return { progress, grants, lastHit: hits[hits.length - 1] || null };
}

// The next few locked items, closest first, for "Unlocks at 50. You're at 32."
function nextUnlocks(progress, grants, limit = 3) {
  const owned = new Set(unlockedIds(progress, grants));
  return ITEMS
    .filter((it) => !owned.has(it.id) && it.rule.type !== 'coach')
    .map((it) => {
      const { have, need } = ruleProgress(it.rule, progress, it.id);
      return { id: it.id, slot: it.slot, label: it.label, tier: it.tier, rule: it.rule, have, need, left: Math.max(0, need - have) };
    })
    .sort((a, b) => a.left / a.need - b.left / b.need)
    .slice(0, limit);
}

// Catalog-only cleanup for teammate looks: drop unknown or misplaced ids.
function catalogClean(stored) {
  if (!stored || typeof stored !== 'object') return null;
  const look = { ...DEFAULT_LOOK };
  for (const slot of SLOTS) {
    const it = itemById(stored[slot]);
    if (it && it.slot === slot) look[slot] = it.id;
  }
  // Teammates' cards show the size and spot each kid picked.
  return { ...look, ...cleanFit(stored) };
}

export async function handleLooks(req, res) {
  // Scoped to one team: the session player's, else the public Jr. Rangers 10U
  // view (original behaviour). Never another team's looks.
  const { ids } = await teamForRequest(req);
  const [all, grants] = await Promise.all([listLooks(ids), listGrants(ids)]);
  const looks = {};
  for (const [id, v] of Object.entries(all)) looks[id] = catalogClean(v);
  const letters = {};
  for (const [id, g] of Object.entries(grants)) { const l = letterFromGrants(g); if (l) letters[id] = l; }
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ looks, letters });
}

export async function handleLookGet(req, res) {
  const who = await sessionPlayer(req);
  if (who.error) return res.status(who.status).json({ error: who.error });
  const { progress, grants, lastHit } = await progressFor(who.id);
  const stored = await getLook(who.id);
  // The latest week the team hit the goal, with this kid's share, for the
  // "The Rangers did it! You added N drills" message.
  const teamWeek = lastHit ? { weekStart: lastHit.weekStart, goal: lastHit.goal, total: lastHit.total, mine: await playerTotalForWeek(who.id, lastHit.weekStart) } : null;
  const look = sanitizeStoredLook(stored, progress, grants);
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    id: who.id,
    look,
    saved: !!stored,
    items: ITEMS.map((it) => ({ id: it.id, slot: it.slot, label: it.label, tier: it.tier, rule: it.rule })),
    progress,
    unlocked: unlockedIds(progress, grants),
    next: nextUnlocks(progress, grants),
    letter: letterFromGrants(grants),
    teamWeek,
  });
}

export async function handleLookPost(req, res) {
  const who = await sessionPlayer(req);
  if (who.error) return res.status(who.status).json({ error: who.error });
  const body = readBody(req);
  const { progress, grants } = await progressFor(who.id);
  const result = validateLook(body.look, progress, grants);
  if (!result.ok) return res.status(400).json({ error: result.error });
  await setLook(who.id, result.look);
  return res.status(200).json({ look: result.look });
}
