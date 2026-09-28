// api/done.js
//
// POST /api/done  body: { player, discipline }
//
// Marks one discipline done for a player. The player is authenticated by their
// sign-in code before they reach this, so there is no separate PIN gate: a
// logged-in player logs their own work.
//
// Success  -> 200 { player: <updated counts> }
// Bad input-> 400 { error: ... }
// Non-POST -> 405

import { ROSTER, DISCIPLINES, disciplinesFor, bumpPlayer } from '../lib/store.js';
import { verifySession, readSessionCookie } from '../lib/session_store.js';

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

  const { player, discipline } = parseBody(req);

  // Validate discipline.
  if (!DISCIPLINES.includes(discipline)) {
    return res.status(400).json({ error: 'bad discipline' });
  }

  // Validate player exists on the roster.
  const entry = findPlayer(player);
  if (!entry) {
    return res.status(400).json({ error: 'unknown player' });
  }

  // Phase 2 server sessions. A valid session is REQUIRED, and may only log its
  // OWN player's work: no session -> 401, a session for a different player -> 403.
  // The client mints a session on sign-in and on boot; if one is ever missing it
  // transparently mints one and retries this write (window.thwapEnsureSession), so
  // a signed-in player is never blocked.
  const claims = verifySession(readSessionCookie(req));
  if (!claims) {
    return res.status(401).json({ error: 'session required' });
  }
  if (claims.playerId !== entry.id) {
    return res.status(403).json({ error: 'not your account' });
  }

  // Position gate: a player may only log a discipline that applies to their
  // position. A goalie's third discipline is Net play, a skater's is Shooting;
  // disciplinesFor() is the single source of truth. Without this a goalie's
  // session could bump 'shoot' (or a skater 'netplay') and misfile a real kid's
  // work in the wrong slot -- the exact fairness bug the client routing prevents,
  // enforced here on the server too.
  if (!disciplinesFor(entry.id).includes(discipline)) {
    return res.status(400).json({ error: 'discipline not for this position' });
  }

  // No PIN gate: a logged-in player logs their own work. The player is already
  // authenticated by their sign-in code, so requiring a second secret number
  // here only blocked real completions (a kid dismissing the prompt) without
  // adding meaningful protection (the "secret" was just the jersey number).
  const updated = await bumpPlayer(entry.id, discipline);
  return res.status(200).json({ player: updated });
}
