// api/done.js
//
// POST /api/done  body: { player, discipline, drillId?, undo? }
//   - { player, discipline }            : marks one discipline done (bumps the
//                                         aggregate count + dated event). Original
//                                         behaviour, unchanged and still valid.
//   - { ..., drillId }                  : ALSO records that specific drill id in
//                                         the player's per-day completed SET, so a
//                                         second device can re-draw the checkmark.
//   - { player, drillId, undo:true }    : UN-marks that drill id for today. Removes
//                                         it from the per-day set WITHOUT touching
//                                         the aggregate count or stickers (an undo
//                                         should not decrement earned work). No
//                                         `discipline` bump happens on an undo.
//
// GET  /api/done   (authenticated)      : returns the signed-in player's completed
//                                         drill ids for TODAY plus which disciplines
//                                         are fully done, so the client can hydrate
//                                         every device. Keyed off the SESSION player,
//                                         never a client-sent id, to prevent spoofing.
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
  ROSTER,
  DISCIPLINES,
  disciplinesFor,
  bumpPlayer,
  addDrillDone,
  removeDrillDone,
  getDrillDone,
  localDateStr,
} from '../lib/store.js';
import { verifySession, readSessionCookie } from '../lib/session_store.js';
import { getMember } from '../lib/teams_store.js';
import { isGated } from '../lib/billing_store.js';

// Look up a roster entry by player id (lowercase first name).
function findPlayer(id) {
  const wanted = String(id || '').toLowerCase();
  return ROSTER.find((p) => p.id === wanted) || null;
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
  const claims = verifySession(readSessionCookie(req));
  if (!claims) {
    return res.status(401).json({ error: 'session required' });
  }
  // The session player is the ONLY id trusted here (no client-sent id), so one
  // player can never read or spoof another's completion state.
  const entry = findPlayer(claims.playerId);
  if (!entry) {
    return res.status(400).json({ error: 'unknown player' });
  }
  const date = localDateStr();
  const drills = await getDrillDone(entry.id, date);
  return res.status(200).json({
    ok: true,
    player: entry.id,
    date,
    drills,
    disciplines: doneDisciplines(drills),
  });
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return handleGet(req, res);
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method not allowed' });
  }

  const body = parseBody(req);
  const { player, discipline, drillId } = body;
  const undo = body.undo === true || body.undo === 'true';

  // Validate player exists on the roster (needed for both bump and drill paths).
  const entry = findPlayer(player);
  if (!entry) {
    return res.status(400).json({ error: 'unknown player' });
  }

  // Session gate (applies to every write). A valid session is REQUIRED and may
  // only log its OWN player's work: no session -> 401, a different player -> 403.
  const claims = verifySession(readSessionCookie(req));
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

  // --- Mark path -----------------------------------------------------------
  // The discipline bump is the original behaviour and is still required for a
  // normal mark (it feeds the leaderboard). A drillId, when present, ALSO records
  // which drill, for cross-device hydration. drillId alone (no discipline) is
  // rejected so a malformed client cannot record a drill without a real bump.
  if (!DISCIPLINES.includes(discipline)) {
    return res.status(400).json({ error: 'bad discipline' });
  }

  // Position gate: a player may only log a POSITION discipline that applies to
  // their position. disciplinesFor() is the single source of truth (goalie ->
  // netplay, skater -> shoot), so a mismatched write can never misfile work.
  // `iq` (Hockey IQ) is a UNIVERSAL discipline every position does, so it is
  // exempt from the position gate -- it is intentionally NOT in disciplinesFor
  // (which stays the radar/participation triad), so it would fail this check.
  if (discipline !== 'iq' && !disciplinesFor(entry.id).includes(discipline)) {
    return res.status(400).json({ error: 'discipline not for this position' });
  }

  // Seasonal-billing gate: block RECORDING a completion for a gated team. This
  // mirrors the coach set-plan guard and is a no-op unless BILLING_ENFORCED=1.
  // Fails open (see playerIsGated), so an unconfigured billing system never
  // locks anyone out.
  if (await playerIsGated(claims.playerId)) {
    return res.status(402).json({ error: 'season not active', gated: true });
  }

  // Bump the aggregate count + dated event (unchanged behaviour).
  const updated = await bumpPlayer(entry.id, discipline);

  // If a stable drill id was supplied, record it in the per-day completed set so
  // other devices can re-draw the checkmark. A missing drillId keeps the endpoint
  // fully backward-compatible (old clients send only { player, discipline }).
  let drills;
  if (drillId) {
    drills = await addDrillDone(entry.id, String(drillId));
  }

  return res.status(200).json({ player: updated, ok: true, drills: drills || null });
}
