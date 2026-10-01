// api/board.js
//
// GET  /api/board               -> { players: [ { id, stick, shoot, dryland, streak, stickers, updatedAt, cheers }, ... ] }
// GET  /api/board?tf=week       -> { players: [ { id, stick, shoot, dryland, netplay, cheers }, ... ] }  (current week counts)
// POST /api/board?action=cheer  body: { to }  -> { ok, count } | { ok, already } | 4xx
// POST /api/board?action=fire   body: { to }  -> { ok, count } | { ok, already } | 4xx
//
// The GET half is the read-only leaderboard: it always returns the full roster
// (zeroed for players not yet in the store) and now folds in each player's
// all-time cheer count via listCheers() so a card can show "N cheers" from the
// same board fetch it already makes. tf=week behaviour is unchanged except for
// the added cheers field.
//
// The POST half is folded in here (rather than a new top-level api function) to
// stay under Vercel Hobby's 12-function cap. action=cheer sends one cheer from
// the AUTHENTICATED session player to the { to } teammate, deduped per day in the
// store. The sender is NEVER taken from the body: it is the signed-in session, so
// a kid cannot cheer as someone else.

import { listPlayers, weekBoard, listCheers, sendCheer, listFires, sendFire, isRosterPlayer } from '../lib/store.js';
import { verifySession, readSessionCookie } from '../lib/session_store.js';

// Parse the request body whether Vercel already parsed it (object) or handed us
// a raw JSON string. Returns {} on anything unparseable. Mirrors api/done.js.
function parseBody(req) {
  const b = req && req.body;
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

// POST /api/board?action=cheer : the signed-in session player cheers { to }.
async function handleCheer(req, res) {
  // Who is cheering is the authenticated session, never the body.
  const claims = verifySession(readSessionCookie(req));
  if (!claims) {
    return res.status(401).json({ error: 'session required' });
  }
  const from = claims.playerId;

  const { to } = parseBody(req);
  const target = String(to || '').toLowerCase();
  if (!target || !isRosterPlayer(target) || target === from) {
    return res.status(400).json({ error: 'bad target' });
  }

  const result = await sendCheer(from, target);
  if (!result.ok) {
    // Store-level rejection (self / off-roster) maps to a 400; the checks above
    // already cover these, so this is a belt-and-suspenders guard.
    return res.status(400).json({ error: result.error || 'rejected' });
  }
  return res.status(200).json(result);
}

// POST /api/board?action=fire : the signed-in session player sends "On fire" to
// { to }. Independent of cheer (its own count + per-day dedup), same safety: the
// sender is the authenticated session, never the body.
async function handleFire(req, res) {
  const claims = verifySession(readSessionCookie(req));
  if (!claims) {
    return res.status(401).json({ error: 'session required' });
  }
  const from = claims.playerId;

  const { to } = parseBody(req);
  const target = String(to || '').toLowerCase();
  if (!target || !isRosterPlayer(target) || target === from) {
    return res.status(400).json({ error: 'bad target' });
  }

  const result = await sendFire(from, target);
  if (!result.ok) {
    return res.status(400).json({ error: result.error || 'rejected' });
  }
  return res.status(200).json(result);
}

export default async function handler(req, res) {
  // POST is only the cheer action; anything else POSTed is rejected.
  if (req.method === 'POST') {
    const action = req.query && req.query.action;
    if (action === 'cheer') {
      return handleCheer(req, res);
    }
    if (action === 'fire') {
      return handleFire(req, res);
    }
    return res.status(400).json({ error: 'unknown action' });
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method not allowed' });
  }

  const tf = req.query && req.query.tf;

  // Read the roster for the requested timeframe AND the cheer + fire counts
  // together, then merge both onto each player by id. listCheers / listFires each
  // mirror the mget pattern so this is two extra round trips, not one per player.
  const [players, cheers, fires] = await Promise.all([
    tf === 'week' ? weekBoard() : listPlayers(),
    listCheers(),
    listFires(),
  ]);
  const cheerById = {};
  for (const c of cheers) cheerById[c.id] = c.cheers;
  const fireById = {};
  for (const f of fires) fireById[f.id] = f.fires;
  const withCheers = players.map((p) => ({
    ...p,
    cheers: cheerById[p.id] || 0,
    fire: fireById[p.id] || 0,
  }));

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ players: withCheers });
}
