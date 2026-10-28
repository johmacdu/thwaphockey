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
//        Every roster player's look for teammate and roster cards. A look holds
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
  ROSTER,
  getPlayer,
  getTrainingDays,
  getLook,
  setLook,
  getGrants,
  listLooks,
  listGrants,
} from './store.js';
import { verifySession, readSessionCookie } from './session_store.js';
import {
  ITEMS,
  SLOTS,
  DEFAULT_LOOK,
  itemById,
  progressFrom,
  ruleProgress,
  unlockedIds,
  validateLook,
  sanitizeStoredLook,
  letterFromGrants,
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

function sessionPlayer(req) {
  const claims = verifySession(readSessionCookie(req));
  if (!claims) return { status: 401, error: 'session required' };
  const id = String(claims.playerId || '').toLowerCase();
  if (!ROSTER.some((p) => p.id === id)) return { status: 400, error: 'unknown player' };
  return { id };
}

async function progressFor(id) {
  const [counts, dayList, grants] = await Promise.all([getPlayer(id), getTrainingDays(id), getGrants(id)]);
  return { progress: progressFrom(counts, dayList), grants };
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
  return look;
}

export async function handleLooks(req, res) {
  const [all, grants] = await Promise.all([listLooks(), listGrants()]);
  const looks = {};
  for (const [id, v] of Object.entries(all)) looks[id] = catalogClean(v);
  const letters = {};
  for (const [id, g] of Object.entries(grants)) { const l = letterFromGrants(g); if (l) letters[id] = l; }
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ looks, letters });
}

export async function handleLookGet(req, res) {
  const who = sessionPlayer(req);
  if (who.error) return res.status(who.status).json({ error: who.error });
  const { progress, grants } = await progressFor(who.id);
  const stored = await getLook(who.id);
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
  });
}

export async function handleLookPost(req, res) {
  const who = sessionPlayer(req);
  if (who.error) return res.status(who.status).json({ error: who.error });
  const body = readBody(req);
  const { progress, grants } = await progressFor(who.id);
  const result = validateLook(body.look, progress, grants);
  if (!result.ok) return res.status(400).json({ error: result.error });
  await setLook(who.id, result.look);
  return res.status(200).json({ look: result.look });
}
