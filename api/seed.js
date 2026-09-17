// api/seed.js
//
// POST /api/seed  (header: x-seed-key: <SEED_KEY>)
//
// One-time / idempotent seeding endpoint. Creates every roster player with
// zeroed counts if they don't already exist, then returns the roster with
// current counts. Existing players are left untouched.
//
// Gated by a shared secret in the x-seed-key header, compared against
// process.env.SEED_KEY. If SEED_KEY is not set, the endpoint refuses outright
// (fail closed) so it can never run seeded-open in an unconfigured deploy.

import { ROSTER, getPlayer, setPlayer, listPlayers } from './store.js';

function zeroCounts() {
  return { stick: 0, shoot: 0, dryland: 0, streak: 0, stickers: 0, updatedAt: null };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method not allowed' });
  }

  const configured = process.env.SEED_KEY;
  if (!configured) {
    // Fail closed: no key configured means seeding is disabled.
    return res.status(403).json({ error: 'seeding disabled' });
  }

  const provided = req.headers['x-seed-key'];
  if (provided !== configured) {
    return res.status(403).json({ error: 'bad seed key' });
  }

  // Seed any missing players with zeroed counts; leave existing ones alone.
  let created = 0;
  for (const p of ROSTER) {
    const existing = await getPlayer(p.id);
    if (!existing) {
      await setPlayer(p.id, zeroCounts());
      created += 1;
    }
  }

  const players = await listPlayers();
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ created, players });
}
