// api/done.js
//
// POST /api/done  body: { player, discipline, drillId?, undo?, date? }
//   - { player, discipline }            : marks one discipline done (bumps the
//                                         aggregate count + dated event). Original
//                                         behaviour, unchanged and still valid.
//   - { ..., date:'YYYY-MM-DD' }         : OPTIONAL. Attributes the completion to
//                                         that Vancouver-local day instead of
//                                         today, for logging a FORGOTTEN day. Must
//                                         be a real date within the last 7 days and
//                                         not in the future, else 400. The all-time
//                                         count is unaffected; only the dated
//                                         day/event (streak + weekly split) moves.
//   - { ..., drillId }                  : ALSO records that specific drill id in
//                                         the player's per-day completed SET, so a
//                                         second device can re-draw the checkmark.
//   - { player, drillId, undo:true }    : UN-marks that drill id for today. Removes
//                                         it from the per-day set WITHOUT touching
//                                         the aggregate count or stickers (an undo
//                                         should not decrement earned work). No
//                                         `discipline` bump happens on an undo.
//   - { player, drillId, backfill:true }: RECORDS that drill id for today WITHOUT a
//                                         count bump. For correcting a completion
//                                         counted before its per-drill id existed
//                                         (older client sent no drillId), so a
//                                         second device can re-draw the checkmark
//                                         without double-counting. Session-gated.
//
// GET  /api/done   (authenticated)      : returns the signed-in player's completed
//                                         drill ids for TODAY plus which disciplines
//                                         are fully done, so the client can hydrate
//                                         every device. Keyed off the SESSION player,
//                                         never a client-sent id, to prevent spoofing.
//
// GET  /api/done?view=today (session)  : the signed-in player's drill list for
//                                         today, built by lib/drills.js (the SAME
//                                         library, rotation, coach dryland picks and
//                                         timer scripts index.html renders), with
//                                         each drill's done flag:
//   { ok, date, restDay, bonusDay, goalie, drills:[{ id, discipline, name, dose, cue,
//     steps, timer:{type,sets,workSeconds,restSeconds,totalSeconds,script}|null,
//     bonus?, done }] }
//   ids are the web's positional ids ('stick:0', 'shoot:1', 'dryland:2'); a
//   goalie's Net play rows keep the 'shoot:' prefix with discipline 'netplay'.
//   dose is the line the web shows under the name (dryland reps, stickhandling
//   group, shooting theme). Saturday/Sunday: restDay true (dryland rests) and
//   bonusDay true, with the web's optional weekend Hands and third-discipline
//   drills, each flagged bonus:true. Same ids, so a check-off is the same record.
//
// GET  /api/done?view=rings (session)  : this week's rings for the watch
//                                         complication:
//   { ok, week:{start,end}, goalie, rings:{ stick:{done,goal},
//     shoot|netplay:{done,goal}, dryland:{done,goal} } }
//   done = this Monday-based week's count (lib/store weekBoard, raw, can pass
//   the goal); goal = the player view's per-discipline weekly goal (distinct
//   activities in that discipline, lib/drills.js weekGoals). Goalies get
//   netplay in place of shoot.
//
// GET  /api/done?view=season (session) : the Season Book glance for the watch,
//                                         from lib/season_book.js (the same
//                                         loader /api/board?action=journey
//                                         uses for journey.html):
//   { ok, season:{key,label,start,end}, seasonOver, trainingDays, dots,
//     totalDots, tierIndex, tier, nextTier, dotsToNextTier, dotsToFinish,
//     complete, step, stepsDone, daysToNextStep, nextScene, badgeStars,
//     nextStar:{id,name,remaining,unit}|null }
//   nextTier and nextScene are the same (null in Legend). step is 1-3 inside
//   the scene; stepsDone counts all 12; daysToNextStep finishes the current
//   step (on step 3 that moves to nextScene). badgeStars is badgesFor's total;
//   nextStar is the badge closest to its next star (lib/journey nextStarFor).
//
// GET  /api/done?view=team (session)   : this week's team goal for the watch,
//                                         the same numbers the Standings bar
//                                         shows (/api/board?tf=week):
//   { ok, teamName, week:{start,end}, goal, total, toGo, mine }
//   goal = lib/store currentTeamGoal for the player's team; total = the
//   team's weekBoard rows summed over the bar's disciplines (teamBarCount);
//   toGo = max(0, goal - total); mine = this player's own share of total.
//   No per-player list: the watch never ranks kids.
//
// All views: 401 without a session, 403 when ?player= names someone else,
// 400 for a session player no longer on any team. Any team (lib/team_players).
//
// Goalie: the member store's roster position decides, with the old fixed
// GOALIE_IDS list as fallback (lib/positions.js). It drives the POST position
// gate, both views, and the `goalie` flag on the plain GET.
//
// Day boundary: the server is authoritative. The per-day key uses the Vancouver
// local date (lib/store localDateStr), the same "today" the streak/week math uses.
// A client-sent day is NOT trusted for keying, so two devices in different raw
// timezones still agree on which calendar day a drill belongs to.
//
// Success  -> 200 { player } (POST bump) | { ok, drills } (POST drill) | { ... } (GET)
// Bad input-> 400 { error: ... }
// Auth     -> 401 (no/invalid session) | 403 (session for a different player)
// Other    -> 405

import {
  DISCIPLINES,
  bumpPlayer,
  getPlayer,
  addDrillDone,
  removeDrillDone,
  getDrillDone,
  localDateStr,
  validBackdate,
  weekDates,
  weekBoard,
  currentTeamGoal,
  teamBarCount,
} from '../lib/store.js';
import { TIERS, nextStarFor } from '../lib/journey.js';
import { seasonBookFor } from '../lib/season_book.js';
import { sessionClaims } from '../lib/watch_store.js';
import { getMember } from '../lib/teams_store.js';
import { isGated } from '../lib/billing_store.js';
import { resolvePlayer, teamPlayerIds, RANGERS_TEAM_CODE } from '../lib/team_players.js';
import { getTeamPlan, getTeam } from '../lib/teams_store.js';
import { isGoalie, disciplinesForPlayer } from '../lib/positions.js';
import { todayList, weekGoals, dayIndexForDate, thirdDiscipline } from '../lib/drills.js';

// Build a name-stable drill id '<disc>#<slug>' from a discipline key and a drill
// NAME. This is the key the stat week-detail matches against, because the
// positional '<disc>:<index>' id is only meaningful within one day's rendered
// list and cannot be mapped back to a catalog name after the fact. Lower-cases
// and strips to [a-z0-9], collapsing runs to a single '-'. Returns '' for a
// blank/absent name (so a missing drillName simply records no slug id).
function nameSlugId(disc, name) {
  const slug = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) return '';
  return `${disc}#${slug}`;
}

// Look up a player by id on ANY team (lib/team_players.js). The 16 original
// Jr. Rangers 10U players always resolve, even with no member record; any other
// player must be on a team's members list. Unknown -> null.
async function findPlayer(id) {
  return resolvePlayer(id);
}

// Seasonal-billing gate for the acting player (server enforcement). A gated
// team's player must not be able to RECORD a completion via the API. We resolve
// the player's team from their membership and block only when that team is
// gated. isGated() is a complete no-op (returns false) unless BILLING_ENFORCED=1.
//
// FAIL OPEN: if the player has no membership or no teamCode, or anything throws,
// we ALLOW the write -- billing must never wrongly lock a real kid out of logging
// their work. This guards the write path only; reads (GET) are never gated.
async function playerIsGated(playerId) {
  try {
    const member = await getMember(playerId);
    const teamCode = member && member.teamCode;
    if (!teamCode) return false;
    return await isGated(teamCode);
  } catch {
    return false;
  }
}

// Parse the request body whether Vercel already parsed it (object) or handed
// us a raw JSON string. Returns {} on anything unparseable.
function parseBody(req) {
  const b = req.body;
  if (!b) return {};
  if (typeof b === 'object') return b;
  if (typeof b === 'string') {
    try {
      return JSON.parse(b);
    } catch {
      return {};
    }
  }
  return {};
}

// Which disciplines are "fully done" for the player given a set of completed
// drill ids. A discipline is fully done when it has at least one 'disc:' id AND
// no further truth is available server-side about the day's drill COUNT (the
// server does not know how many drills a given day renders). So this returns the
// disciplines the player has at least started/finished a drill in; the client,
// which knows today's rendered count, confirms "all drills" locally. We still
// return a conservative per-discipline rollup so the hydration can set the
// thwapDone|<today>|<disc> signal when a discipline's drills are all checked.
function doneDisciplines(drillIds) {
  const out = {};
  for (const did of drillIds) {
    const disc = String(did).split(':')[0];
    if (disc) out[disc] = true;
  }
  return out;
}

// GET: return the authenticated player's completed drill ids for today.
async function handleGet(req, res) {
  const claims = await sessionClaims(req);
  if (!claims) {
    return res.status(401).json({ error: 'session required' });
  }
  // The session player is the ONLY id trusted here (no client-sent id), so one
  // player can never read or spoof another's completion state.
  const entry = await findPlayer(claims.playerId);
  if (!entry) {
    return res.status(400).json({ error: 'unknown player' });
  }
  const goalie = await isGoalie(entry.id);
  const view = String((req.query && req.query.view) || '');
  if (Object.hasOwn(WATCH_VIEWS, view)) {
    // Self only: a ?player= naming anyone but the session player is refused.
    const asked = String((req.query && req.query.player) || '').trim().toLowerCase();
    if (asked && asked !== entry.id) {
      return res.status(403).json({ error: 'not your account' });
    }
    res.setHeader('Cache-Control', 'no-store');
    return WATCH_VIEWS[view](res, entry, goalie);
  }
  if (view) {
    return res.status(400).json({ error: 'unknown view' });
  }
  // ?week=1 : union the signed-in player's completed drill ids across the current
  // Monday-based week (self-only by construction, since the player is taken from
  // the SESSION, never a client id). Lets a kid's own stat page mark the exact
  // drills they did this week. Default (no week) stays today-only, unchanged.
  const wantWeek = String((req.query && req.query.week) || '') === '1';
  if (wantWeek) {
    const days = weekDates();
    const sets = await Promise.all(days.map((d) => getDrillDone(entry.id, d)));
    const seen = Object.create(null);
    const drills = [];
    for (const set of sets) {
      for (const id of set) {
        if (!seen[id]) { seen[id] = 1; drills.push(id); }
      }
    }
    return res.status(200).json({
      ok: true,
      player: entry.id,
      week: { start: days[0], end: days[days.length - 1] },
      goalie,
      drills,
      disciplines: doneDisciplines(drills),
    });
  }

  const date = localDateStr();
  const drills = await getDrillDone(entry.id, date);
  return res.status(200).json({
    ok: true,
    player: entry.id,
    date,
    goalie,
    drills,
    disciplines: doneDisciplines(drills),
  });
}

// GET ?view=today: today's list from the shared drill library, with done flags.
async function viewToday(res, entry, goalie) {
  const date = localDateStr();
  let coachPlan = null;
  try {
    coachPlan = entry.teamCode ? await getTeamPlan(entry.teamCode) : null;
  } catch {
    coachPlan = null; // no plan -> built-in rotation, same as the web fallback
  }
  const list = todayList(dayIndexForDate(date), { goalie, coachPlan });
  const done = new Set(await getDrillDone(entry.id, date));
  return res.status(200).json({
    ok: true,
    date,
    restDay: list.restDay,
    bonusDay: list.bonusDay,
    goalie,
    drills: list.drills.map((d) => ({ ...d, done: done.has(d.id) })),
  });
}

// GET ?view=rings: this week's count toward each discipline's weekly goal.
async function viewRings(res, entry, goalie) {
  const days = weekDates();
  const [row] = await weekBoard([entry.id]);
  const goals = weekGoals(goalie);
  const rings = {};
  for (const disc of ['stick', thirdDiscipline(goalie), 'dryland']) {
    rings[disc] = { done: (row && row[disc]) || 0, goal: goals[disc] };
  }
  return res.status(200).json({
    ok: true,
    week: { start: days[0], end: days[days.length - 1] },
    goalie,
    rings,
  });
}

// GET ?view=season: where the player is on the season path, plus badge stars.
// The book and badges come from lib/season_book.js, the same loader
// /api/board?action=journey uses, so the watch and journey.html agree.
async function viewSeason(res, entry) {
  const { book, badges } = await seasonBookFor(entry.id, localDateStr());
  const nextScene = TIERS[book.tierIndex + 1] || null;
  return res.status(200).json({
    ok: true,
    season: book.season,
    seasonOver: book.seasonOver,
    trainingDays: book.trainingDays,
    dots: book.dots,
    totalDots: book.totalDots,
    tierIndex: book.tierIndex,
    tier: book.tier,
    nextTier: nextScene,
    dotsToNextTier: book.dotsToNextTier,
    dotsToFinish: book.dotsToFinish,
    complete: book.complete,
    step: book.step,
    stepsDone: book.stepsDone,
    daysToNextStep: book.daysToNextStep,
    nextScene,
    badgeStars: badges.badgeStars,
    nextStar: nextStarFor(badges.badges),
  });
}

// The name the team goal line uses. Standings says "Rangers" for the original
// team; any other team uses its own name.
async function teamNameFor(teamCode) {
  if (!teamCode || teamCode === RANGERS_TEAM_CODE) return 'Rangers';
  try {
    const t = await getTeam(teamCode);
    return (t && t.name) || 'Your team';
  } catch {
    return 'Your team';
  }
}

// GET ?view=team: this week's team goal, the numbers the Standings bar shows.
async function viewTeam(res, entry) {
  const teamCode = entry.teamCode || RANGERS_TEAM_CODE;
  const ids = await teamPlayerIds(teamCode);
  const days = weekDates();
  const [rows, goal, teamName] = await Promise.all([
    weekBoard(ids),
    currentTeamGoal({ teamCode, teamIds: ids }),
    teamNameFor(teamCode),
  ]);
  const total = rows.reduce((n, r) => n + teamBarCount(r), 0);
  const mine = teamBarCount(rows.find((r) => r.id === entry.id));
  return res.status(200).json({
    ok: true,
    teamName,
    week: { start: days[0], end: days[days.length - 1] },
    goal: goal.goal,
    total,
    toGo: Math.max(0, goal.goal - total),
    mine,
  });
}

// The watch reads, all session-gated and self-only (see handleGet).
const WATCH_VIEWS = { today: viewToday, rings: viewRings, season: viewSeason, team: viewTeam };

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return handleGet(req, res);
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method not allowed' });
  }

  const body = parseBody(req);
  const { player, discipline, drillId, drillName, date } = body;
  const undo = body.undo === true || body.undo === 'true';
  const backfill = body.backfill === true || body.backfill === 'true';

  // Validate the player exists on a team (needed for both bump and drill paths).
  const entry = await findPlayer(player);
  if (!entry) {
    return res.status(400).json({ error: 'unknown player' });
  }

  // Session gate (applies to every write). A valid session is REQUIRED and may
  // only log its OWN player's work: no session -> 401, a different player -> 403.
  const claims = await sessionClaims(req);
  if (!claims) {
    return res.status(401).json({ error: 'session required' });
  }
  if (claims.playerId !== entry.id) {
    return res.status(403).json({ error: 'not your account' });
  }

  // --- Undo path: remove a drill id for today, no count change --------------
  // An un-mark must sync across devices but must NOT decrement the all-time
  // count or stickers (earned work stays earned). It carries only a drillId.
  if (undo) {
    if (!drillId) {
      return res.status(400).json({ error: 'drillId required for undo' });
    }
    const drills = await removeDrillDone(entry.id, String(drillId));
    return res.status(200).json({ ok: true, undo: true, drills });
  }

  // --- Backfill path: record a drill id for today, no count change ----------
  // Mirror of the undo path, for correcting completions that were counted
  // BEFORE the per-drill id was recorded (e.g. passing logged by an older client
  // that sent no drillId). The aggregate count is already correct, so a normal
  // mark would double-count; this records ONLY the per-day drill id so a second
  // device can re-draw the checkmark. Session-gated to the player's own account
  // exactly like undo, and like undo it never touches the count or stickers.
  if (backfill) {
    if (!drillId) {
      return res.status(400).json({ error: 'drillId required for backfill' });
    }
    // A backfill may target a specific past day (same validated window as a mark),
    // so a forgotten completion can be re-identified on the day it happened.
    let bfWhen = null;
    if (date !== undefined && date !== null && date !== '') {
      bfWhen = validBackdate(date);
      if (!bfWhen) return res.status(400).json({ error: 'bad date' });
    }
    const onDay = bfWhen || localDateStr();
    let drills = await addDrillDone(entry.id, String(drillId), onDay);
    // Optional name-stable id, so the week-detail can mark the exact drill. The
    // discipline is taken from the drillId prefix ('<disc>:<index>').
    if (drillName) {
      const disc = String(drillId).split(':')[0];
      const slugId = nameSlugId(disc, drillName);
      if (slugId) drills = await addDrillDone(entry.id, slugId, onDay);
    }
    return res.status(200).json({ ok: true, backfill: true, drills });
  }

  // --- Mark path -----------------------------------------------------------
  // The discipline bump is the original behaviour and is still required for a
  // normal mark (it feeds the leaderboard). A drillId, when present, ALSO records
  // which drill, for cross-device hydration. drillId alone (no discipline) is
  // rejected so a malformed client cannot record a drill without a real bump.
  if (!DISCIPLINES.includes(discipline)) {
    return res.status(400).json({ error: 'bad discipline' });
  }

  // Position gate: a player may only log a POSITION discipline that applies to
  // their position. disciplinesForPlayer() (lib/positions.js: the member
  // store's position, GOALIE_IDS fallback) decides goalie -> netplay, skater ->
  // shoot, so a mismatched write can never misfile work.
  // `iq` (Hockey IQ) and `pass` (Passing) are UNIVERSAL disciplines every position
  // does, so they are exempt from the position gate -- they are intentionally NOT in
  // disciplinesFor (which stays the radar/participation triad), so they would fail
  // this check.
  if (discipline !== 'iq' && discipline !== 'pass' && !(await disciplinesForPlayer(entry.id)).includes(discipline)) {
    return res.status(400).json({ error: 'discipline not for this position' });
  }

  // Seasonal-billing gate: block RECORDING a completion for a gated team. This
  // mirrors the coach set-plan guard and is a no-op unless BILLING_ENFORCED=1.
  // Fails open (see playerIsGated), so an unconfigured billing system never
  // locks anyone out.
  if (await playerIsGated(claims.playerId)) {
    return res.status(402).json({ error: 'season not active', gated: true });
  }

  // Optional backdating: a player (or a parent on their behalf) correcting a
  // forgotten log may attribute this completion to a recent day. When `date` is
  // supplied it MUST be a valid, recent 'YYYY-MM-DD' (within the last 7 days, not
  // in the future); an invalid value is REJECTED here rather than silently filed
  // as today, so a bad date can never corrupt the streak/weekly split. Absent
  // `date` logs today, exactly as before.
  let when = null;
  if (date !== undefined && date !== null && date !== '') {
    when = validBackdate(date);
    if (!when) {
      return res.status(400).json({ error: 'bad date' });
    }
  }

  // Per-drill idempotency guard (prevents the leaderboard over-count bug).
  // The client's own done-state guard is per-device (DOM class + localStorage),
  // so re-POSTing the same completion from another device, after a storage
  // clear, or after the per-day key rotates would otherwise bump the aggregate
  // count AND append a second dated event every time -- silently inflating the
  // weekly/all-time totals (observed on Passing, whose 10-drill/2-session layout
  // made duplicate marks easy to trigger). When a stable `drillId` is supplied
  // and that id is ALREADY recorded in the target day's completed set, this is a
  // duplicate mark: record nothing new and return the current counts unchanged.
  // The drill-done set is the server's authoritative "did this exact drill that
  // day" record (addDrillDone is itself idempotent), so it is the right key to
  // dedup the count against. Marks WITHOUT a drillId (legacy clients) cannot be
  // deduped and keep the prior always-bump behaviour.
  if (drillId) {
    const dayFor = when || localDateStr();
    const already = await getDrillDone(entry.id, dayFor);
    if (already.includes(String(drillId))) {
      const cur = await getPlayer(entry.id);
      const player = cur ? { id: String(entry.id).toLowerCase(), ...cur } : null;
      return res.status(200).json({ player, ok: true, duplicate: true, drills: already });
    }
  }

  // Bump the aggregate count + dated event (unchanged behaviour; `when` only
  // moves the day the days/events are attributed to, never the all-time count).
  const updated = await bumpPlayer(entry.id, discipline, when);

  // If a stable drill id was supplied, record it in the per-day completed set so
  // other devices can re-draw the checkmark. A missing drillId keeps the endpoint
  // fully backward-compatible (old clients send only { player, discipline }).
  let drills;
  if (drillId) {
    drills = await addDrillDone(entry.id, String(drillId), when || localDateStr());
  }
  // Also record a NAME-STABLE id so the stat week-detail can mark the exact drill
  // done (the positional id above is only resolvable within one day's list).
  // Stamped on the SAME day as the completion (`when` for a backdate, else today).
  if (drillName) {
    const slugId = nameSlugId(discipline, drillName);
    if (slugId) drills = await addDrillDone(entry.id, slugId, when || localDateStr());
  }

  return res.status(200).json({ player: updated, ok: true, drills: drills || null });
}
