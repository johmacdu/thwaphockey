// api/photo/verify.js
//
// POST { email, playerId, code } -> { uploadToken } on success, else 401.
// On success records the consent and mints a 30-day player-scoped upload token.

import { getKv, parseBody, isRosterPlayer, emailConfigured } from '../_photo_common.js';
import { checkOtp, recordConsent, mintToken } from '../_photo_store.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method not allowed' });
  }
  if (!emailConfigured()) return res.status(503).json({ error: 'photo service not configured' });

  const { email, playerId, code } = parseBody(req);
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!cleanEmail || !isRosterPlayer(playerId) || !/^\d{6}$/.test(String(code || ''))) {
    return res.status(400).json({ error: 'bad input' });
  }

  const kv = getKv();
  const result = await checkOtp(kv, cleanEmail, String(code));
  res.setHeader('Cache-Control', 'no-store');
  if (result !== 'ok') return res.status(401).json({ error: 'bad code', reason: result });

  await recordConsent(kv, playerId, cleanEmail);
  const uploadToken = mintToken(String(playerId).toLowerCase());
  if (!uploadToken) return res.status(503).json({ error: 'photo service not configured' });
  return res.status(200).json({ uploadToken });
}
