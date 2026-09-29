// api/reset.js
//
// POST /api/reset?player=<id>   (header: x-seed-key: <SEED_KEY>)
//   or POST /api/reset  body: { player: "<id>" }
//
// Resets ONE player's live data on the Vancouver Jr Rangers store back to zero:
// clears their counts (player:<id>), day history (days:<id>) and event log
// (events:<id>). The player is kept on the board (rewritten to zeroed counts),
// not deleted, so they still appear rather than vanishing.
//
// Gated by the SAME shared secret as api/seed.js (x-seed-key vs process.env.SEED_KEY).
// If SEED_KEY is not set, the endpoint refuses outright (fail closed).
//
// NOTE: per-device localStorage (earned stickers, uploaded photo) is NOT server
// state and is not touched here (that is cleared on the player's own device).
//
// Success   -> 200 { reset: "<id>", player: <zeroed counts> }
// Bad input -> 400 { error: ... }
// Bad key   -> 403 { error: ... }
// Non-POST  -> 405

import { ROSTER, resetPlayer, getPlayer } from '../lib/store.js';

// Find a roster entry by id (lowercase first name).
function findPlayer(id) {
  const wanted = String(id || '').toLowerCase();
  return ROSTER.find((p) => p.id === wanted) || null;
}

// Parse the body whether Vercel parsed it (object) or handed us a raw string.
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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method not allowed' });
  }

  const configured = process.env.SEED_KEY;
  if (!configured) {
    // Fail closed: no key configured means reset is disabled.
    return res.status(403).json({ error: 'reset disabled' });
  }

  const provided = req.headers['x-seed-key'];
  if (provided !== configured) {
    return res.status(403).json({ error: 'bad seed key' });
  }

  // Player id from the query string or the JSON body.
  const wanted = (req.query && req.query.player) || parseBody(req).player;
  if (!wanted) {
    return res.status(400).json({ error: 'missing player' });
  }

  const entry = findPlayer(wanted);
  if (!entry) {
    return res.status(400).json({ error: 'unknown player' });
  }

  const player = await resetPlayer(entry.id);
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ reset: entry.id, player });
}
