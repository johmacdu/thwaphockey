// api/photo/remove.js
//
// POST (Authorization: Bearer <uploadToken>) { playerId } -> deletes the photo.

import { del } from '@vercel/blob';
import { getKv, parseBody, isRosterPlayer, uploadConfigured } from '../_photo_common.js';
import { verifyToken, getPhoto, removePhoto } from '../_photo_store.js';

function bearer(req) {
  const h = req.headers && (req.headers.authorization || req.headers.Authorization);
  if (!h || typeof h !== 'string' || !h.startsWith('Bearer ')) return '';
  return h.slice(7).trim();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method not allowed' });
  }
  if (!uploadConfigured()) return res.status(503).json({ error: 'photo service not configured' });

  const { playerId } = parseBody(req);
  if (!isRosterPlayer(playerId)) return res.status(400).json({ error: 'unknown player' });

  const tokenPlayer = verifyToken(bearer(req));
  if (!tokenPlayer || tokenPlayer !== String(playerId).toLowerCase()) {
    return res.status(401).json({ error: 'not verified' });
  }

  const kv = getKv();
  const rec = await getPhoto(kv, playerId);
  if (rec && rec.url) {
    try { await del(rec.url, { token: process.env.BLOB_READ_WRITE_TOKEN }); } catch { /* blob may already be gone */ }
  }
  await removePhoto(kv, playerId);

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true });
}
