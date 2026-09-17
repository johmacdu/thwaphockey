// api/board.js
//
// GET /api/board -> { players: [ { id, stick, shoot, dryland, streak, stickers, updatedAt }, ... ] }
//
// Read-only leaderboard endpoint. Always returns the full roster (zeroed for
// players not yet in the store). Never cached, so the board is always live.

import { listPlayers } from './store.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method not allowed' });
  }

  const players = await listPlayers();

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ players });
}
