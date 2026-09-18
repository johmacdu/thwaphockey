// api/photo/get.js
//
// GET ?playerId=<id> -> { url } if a photo exists, else 404.
// Public read of the stored URL only. The image blob itself is public but its
// key is unguessable, and it is only ever shown on that player's own card.

import { getKv, isRosterPlayer } from '../_photo_common.js';
import { getPhoto } from '../photo_store.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method not allowed' });
  }
  const playerId = req.query && req.query.playerId;
  if (!isRosterPlayer(playerId)) return res.status(400).json({ error: 'unknown player' });

  const kv = getKv();
  const rec = await getPhoto(kv, playerId);
  res.setHeader('Cache-Control', 'no-store');
  if (!rec || !rec.url) return res.status(404).json({ error: 'no photo' });
  return res.status(200).json({ url: rec.url });
}
