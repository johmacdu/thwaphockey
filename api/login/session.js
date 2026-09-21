// api/login/session.js
//
// GET -> { authed, player } based on the HTTP-only session cookie.
//
// The server-side gate: reads the thwapSession cookie, verifies its HMAC and
// expiry, and reports whether the caller is signed in and for which player.
// Stateless (no store read) because the token is self-verifying. Never echoes
// the token or the raw email back.

import { verifySession, readSessionCookie, sessionConfigured } from '../session_store.js';
import { ROSTER } from '../store.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method not allowed' });
  }
  res.setHeader('Cache-Control', 'no-store');
  if (!sessionConfigured()) return res.status(200).json({ authed: false });

  const token = readSessionCookie(req);
  const claims = verifySession(token);
  if (!claims) return res.status(200).json({ authed: false });

  const player = ROSTER.find((p) => p.id === claims.playerId);
  return res.status(200).json({
    authed: true,
    player: player ? { id: player.id, name: player.name, number: player.number } : { id: claims.playerId },
  });
}
