// api/photo/admin-put.js
//
// POST (admin key via Bearer or ?key=)  { playerId, imageData, consent }
//   consent = { method: 'text'|'in_person'|'written'|'email', grantedBy: '<parent name>' }
//
// The admin-assisted path for when a parent gave permission out of band (e.g.
// texted the photo to the admin) instead of using the email-code flow. It does
// NOT fake a verified-email consent: it records HOW consent was given, WHO gave
// it, and WHICH admin recorded it, so the stored consent record is truthful.
//
// imageData is a data URL (data:image/...;base64,...), already cropped/downscaled
// by the client. Stored to Vercel Blob under an unguessable key.
// -> { url }

import { put } from '@vercel/blob';
import { getKv, parseBody, isRosterPlayer, uploadConfigured, adminOk } from '../../lib/photo_common.js';
import { putPhoto, recordAdminConsent, randomKey, CONSENT_METHODS } from '../../lib/photo_store.js';

const MAX_BYTES = 400 * 1024; // ~400KB cap on the already-downscaled image
const DATA_URL_RE = /^data:image\/(png|jpeg|jpg|webp);base64,([a-zA-Z0-9+/]+=*)$/;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method not allowed' });
  }
  if (!adminOk(req)) return res.status(401).json({ error: 'unauthorized' });
  if (!uploadConfigured()) return res.status(503).json({ error: 'photo service not configured' });

  const { playerId, imageData, consent } = parseBody(req);
  if (!isRosterPlayer(playerId)) return res.status(400).json({ error: 'unknown player' });

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
  await recordAdminConsent(kv, playerId, { method, grantedBy, recordedBy: 'admin' });
  await putPhoto(kv, playerId, blob.url, key);

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true, url: blob.url });
}
