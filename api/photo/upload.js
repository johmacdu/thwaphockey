// api/photo/upload.js
//
// POST (Authorization: Bearer <uploadToken>) { playerId, imageData }
//   imageData is a data URL (data:image/...;base64,...), already cropped and
//   downscaled by the client. Stored to Vercel Blob under an unguessable key.
// -> { url }

import { put } from '@vercel/blob';
import { getKv, parseBody, isRosterPlayer, uploadConfigured } from '../../lib/photo_common.js';
import { verifyToken, putPhoto, randomKey } from '../../lib/photo_store.js';

const MAX_BYTES = 400 * 1024; // ~400KB cap on the already-downscaled image
const DATA_URL_RE = /^data:image\/(png|jpeg|jpg|webp);base64,([a-zA-Z0-9+/]+=*)$/;

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

  const { playerId, imageData } = parseBody(req);
  if (!isRosterPlayer(playerId)) return res.status(400).json({ error: 'unknown player' });

  const tokenPlayer = verifyToken(bearer(req));
  if (!tokenPlayer || tokenPlayer !== String(playerId).toLowerCase()) {
    return res.status(401).json({ error: 'not verified' });
  }

  const m = DATA_URL_RE.exec(String(imageData || ''));
  if (!m) return res.status(400).json({ error: 'bad image' });
  const ext = m[1] === 'jpg' ? 'jpeg' : m[1];
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length === 0 || buf.length > MAX_BYTES) return res.status(400).json({ error: 'image too big' });

  const kv = getKv();
  const key = `photos/${String(playerId).toLowerCase()}-${randomKey()}.${ext}`;
  const blob = await put(key, buf, {
    access: 'public',
    contentType: `image/${ext}`,
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
  await putPhoto(kv, playerId, blob.url, key);

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ url: blob.url });
}
