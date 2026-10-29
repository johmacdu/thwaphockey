// api/photo/upload.js
//
// POST (Authorization: Bearer <uploadToken>) { playerId, imageData }
//   imageData is a data URL (data:image/jpeg|png;base64,...), already cropped
//   and downscaled by the client. The server checks it really is a JPEG/PNG,
//   strips EXIF/GPS/text metadata, and stores it to Vercel Blob under a random
//   key that carries no name. The previous blob (if any) is deleted so a
//   replaced photo does not stay reachable.
// -> { url }
//
// The upload token is checked FIRST, so a caller without one cannot learn
// whether a player exists. Only the photo upload token works here: a web
// session, coach, admin or watch token is refused.

import { put, del } from '@vercel/blob';
import { getKv, parseBody, isRosterPlayer, uploadConfigured, cleanImage } from '../../lib/photo_common.js';
import { verifyToken, putPhoto, getPhoto, randomKey } from '../../lib/photo_store.js';
import { hit } from '../../lib/rate_limit.js';

export const UPLOAD_LIMIT = 10; // uploads per player per hour
const UPLOAD_WINDOW_SEC = 60 * 60;

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
  res.setHeader('Cache-Control', 'no-store');
  if (!uploadConfigured()) return res.status(503).json({ error: 'photo service not configured' });

  const { playerId, imageData } = parseBody(req);
  const pid = String(playerId || '').trim().toLowerCase();
  const tokenPlayer = verifyToken(bearer(req));
  if (!tokenPlayer || !pid || tokenPlayer !== pid) return res.status(401).json({ error: 'not verified' });
  // A player removed from every team after the token was minted.
  if (!(await isRosterPlayer(pid))) return res.status(401).json({ error: 'not verified' });

  const kv = getKv();
  if (!(await hit(kv, 'photo-upload:pid', pid, UPLOAD_LIMIT, UPLOAD_WINDOW_SEC))) {
    return res.status(429).json({ error: 'too many requests, try again later' });
  }

  const img = cleanImage(imageData);
  if (img.error) return res.status(400).json({ error: img.error });

  const key = `photos/${randomKey()}.${img.ext}`;
  const blob = await put(key, img.buf, {
    access: 'public',
    contentType: `image/${img.ext}`,
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
  const prev = await getPhoto(kv, pid);
  await putPhoto(kv, pid, blob.url, key);
  if (prev && prev.url && prev.url !== blob.url) {
    try { await del(prev.url, { token: process.env.BLOB_READ_WRITE_TOKEN }); } catch { /* already gone */ }
  }

  return res.status(200).json({ url: blob.url });
}
