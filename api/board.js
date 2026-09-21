// api/board.js
//
// GET /api/board            -> { players: [ { id, stick, shoot, dryland, streak, stickers, updatedAt }, ... ] }
// GET /api/board?tf=week    -> { players: [ { id, stick, shoot, dryland }, ... ] }  (current week counts)
//
// Read-only leaderboard endpoint. Always returns the full roster (zeroed for
// players not yet in the store). Never cached, so the board is always live.
// The default (no query) returns cumulative all-time counts exactly as before;
// tf=week returns per-player current-week discipline counts (Monday-based week).

import { listPlayers, weekBoard } from './_store.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method not allowed' });
  }

  const tf = req.query && req.query.tf;
  const players = tf === 'week' ? await weekBoard() : await listPlayers();

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ players });
}
