// api/done.js
//
// POST /api/done  body: { player, pin, discipline }
//
// Marks one discipline done for a player, guarded by a per-player PIN.
// The PIN is the player's jersey number followed by the season year
// (e.g. Lewie #72 in 2027 -> "722027"). This is a lightweight, kid-friendly
// gate to stop a kid logging work for a teammate -- NOT real security.
//
// Success  -> 200 { player: <updated counts> }
// Bad PIN  -> 403 { error: 'bad pin' }
// Bad input-> 400 { error: ... }
// Non-POST -> 405

import { ROSTER, DISCIPLINES, bumpPlayer } from '../lib/store.js';

// Season year drives the PIN suffix; overridable via env, defaults to 2027.
const SEASON_YEAR = process.env.SEASON_YEAR || '2027';

// Look up a roster entry by player id (lowercase first name).
function findPlayer(id) {
  const wanted = String(id || '').toLowerCase();
  return ROSTER.find((p) => p.id === wanted) || null;
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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method not allowed' });
  }

  const { player, pin, discipline } = parseBody(req);

  // Validate discipline.
  if (!DISCIPLINES.includes(discipline)) {
    return res.status(400).json({ error: 'bad discipline' });
  }

  // Validate player exists on the roster.
  const entry = findPlayer(player);
  if (!entry) {
    return res.status(400).json({ error: 'unknown player' });
  }

  // Server-side PIN check: jersey number + season year.
  const expectedPin = String(entry.number) + SEASON_YEAR;
  if (String(pin) !== expectedPin) {
    return res.status(403).json({ error: 'bad pin' });
  }

  const updated = await bumpPlayer(entry.id, discipline);
  return res.status(200).json({ player: updated });
}
