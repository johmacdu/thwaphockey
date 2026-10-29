// api/photo/get.js
//
// GET ?playerId=<id> -> { url } if a photo exists, else 404.
//
// Who can read: a signed-in player (web thwapSession cookie) on the SAME team
// as that player, or an admin. Parent consent covers team-wide visibility, not
// the whole internet, and player ids are first names, so an open read let
// anyone fetch a child's photo by guessing a name.
//
// No session -> 401, checked before any lookup. With a session, an unknown
// player, a player on another team and a player with no photo all answer the
// same 404, so this cannot probe the roster or another team. A watch, coach or
// photo upload token is not a player session and is refused.

import { getKv, photoPlayer, adminOk, sessionPlayerId } from '../../lib/photo_common.js';
import { getPhoto } from '../../lib/photo_store.js';

const NONE = { error: 'no photo' };

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method not allowed' });
  }
  res.setHeader('Cache-Control', 'no-store');
  const admin = adminOk(req);
  const me = admin ? '' : sessionPlayerId(req);
  if (!admin && !me) return res.status(401).json({ error: 'sign in required' });

  const pid = String((req.query && req.query.playerId) || '').trim().toLowerCase();
  const target = pid ? await photoPlayer(pid) : null;
  if (!target) return res.status(404).json(NONE);
  if (!admin) {
    const viewer = await photoPlayer(me);
    if (!viewer || viewer.teamCode !== target.teamCode) return res.status(404).json(NONE);
  }

  const rec = await getPhoto(getKv(), pid);
  if (!rec || !rec.url) return res.status(404).json(NONE);
  return res.status(200).json({ url: rec.url });
}
