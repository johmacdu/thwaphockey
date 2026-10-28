// api/photo/request-code.js
//
// POST { email, playerId } -> emails a 6-digit code to the parent.
// Rate-limited per email. Never leaks whether an email is "known" (there is no
// account model here; any parent email can request a code for a known player on any team).

import { getKv, parseBody, photoPlayer, emailConfigured, sendCodeEmail } from '../../lib/photo_common.js';
import { checkAndBumpRate, putOtp, randomCode } from '../../lib/photo_store.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method not allowed' });
  }
  if (!emailConfigured()) return res.status(503).json({ error: 'photo service not configured' });

  const { email, playerId } = parseBody(req);
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(cleanEmail)) return res.status(400).json({ error: 'bad email' });
  const player = await photoPlayer(playerId);
  if (!player) return res.status(400).json({ error: 'unknown player' });

  const kv = getKv();
  const allowed = await checkAndBumpRate(kv, cleanEmail);
  if (!allowed) return res.status(429).json({ error: 'too many requests, try again later' });

  const code = randomCode();
  await putOtp(kv, cleanEmail, code);

  const sent = await sendCodeEmail(cleanEmail, code, player ? player.name : 'your player');
  // Do not fail loudly if the mail send hiccups; the code is stored either way.
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true, sent: !!sent });
}
