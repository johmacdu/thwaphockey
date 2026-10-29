// api/photo/admin-put.js
//
// POST (admin: Authorization: Bearer <key or admin session>)  { playerId, imageData, consent }
//   consent = { method: 'text'|'in_person'|'written'|'email', grantedBy: '<parent name>' }
//
// The admin-assisted path for when a parent gave permission out of band (e.g.
// texted the photo to the admin) instead of using the email-code flow. It does
// NOT fake a verified-email consent: it records HOW consent was given, WHO gave
// it, and WHICH admin recorded it, so the stored consent record is truthful.
//
// imageData is a data URL (data:image/jpeg|png;base64,...), already cropped/downscaled
// by the client. Stored to Vercel Blob under an unguessable key.
// -> { url }

import { put, del } from '@vercel/blob';
import { getKv, parseBody, isRosterPlayer, uploadConfigured, adminOk, cleanImage } from '../../lib/photo_common.js';
import { putPhoto, getPhoto, recordAdminConsent, randomKey, CONSENT_METHODS } from '../../lib/photo_store.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method not allowed' });
  }
  if (!adminOk(req)) return res.status(401).json({ error: 'unauthorized' });
  if (!uploadConfigured()) return res.status(503).json({ error: 'photo service not configured' });

  const { playerId, imageData, consent } = parseBody(req);
  if (!(await isRosterPlayer(playerId))) return res.status(400).json({ error: 'unknown player' });

  // Consent is mandatory and must name a real out-of-band method + who granted it.
  const c = consent && typeof consent === 'object' ? consent : {};
  const method = String(c.method || '').trim();
  const grantedBy = String(c.grantedBy || '').trim();
  if (!CONSENT_METHODS.includes(method)) {
    return res.status(400).json({ error: 'consent method required' });
  }
  if (!grantedBy) {
    return res.status(400).json({ error: 'consent grantedBy (parent name) required' });
  }

  // Same checks as the parent upload: real JPEG/PNG only, metadata stripped,
  // a random key with no name in it, and the replaced blob deleted.
  const img = cleanImage(imageData);
  if (img.error) return res.status(400).json({ error: img.error });

  const kv = getKv();
  const key = `photos/${randomKey()}.${img.ext}`;
  const blob = await put(key, img.buf, {
    access: 'public',
    contentType: `image/${img.ext}`,
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
  const prev = await getPhoto(kv, playerId);
  await recordAdminConsent(kv, playerId, { method, grantedBy, recordedBy: 'admin' });
  await putPhoto(kv, playerId, blob.url, key);
  if (prev && prev.url && prev.url !== blob.url) {
    try { await del(prev.url, { token: process.env.BLOB_READ_WRITE_TOKEN }); } catch { /* already gone */ }
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true, url: blob.url });
}
