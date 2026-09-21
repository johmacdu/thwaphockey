// api/login/request-code.js
//
// POST { email, playerId } -> emails a 6-digit sign-in code to the parent.
//
// Phase 1 of real per-parent accounts: the parent proves they own the email by
// receiving a one-time code, then verify.js mints a server session. Reuses the
// same OTP + rate-limit + mail helpers as the photo flow so there is one code
// path to reason about. Rate-limited per email; never reveals whether an email
// is "known" (there is no password to leak against).
//
// Env: RESEND_API_KEY, PHOTO_FROM_EMAIL, PHOTO_TOKEN_SECRET (email + OTP),
//      KV_REST_API_* / UPSTASH_REDIS_REST_* (store).

import { getKv, parseBody, isRosterPlayer, emailConfigured, sendCodeEmail } from '../_photo_common.js';
import { checkAndBumpRate, putOtp, randomCode } from '../photo_store.js';
import { ROSTER } from '../store.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method not allowed' });
  }
  if (!emailConfigured()) return res.status(503).json({ error: 'login not configured' });

  const { email, playerId } = parseBody(req);
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(cleanEmail)) return res.status(400).json({ error: 'bad email' });
  if (!isRosterPlayer(playerId)) return res.status(400).json({ error: 'unknown player' });

  const kv = getKv();
  const allowed = await checkAndBumpRate(kv, cleanEmail);
  if (!allowed) return res.status(429).json({ error: 'too many requests, try again later' });

  const code = randomCode();
  await putOtp(kv, cleanEmail, code);

  const player = ROSTER.find((p) => p.id === String(playerId).toLowerCase());
  const sent = await sendCodeEmail(cleanEmail, code, player ? player.name : 'your player');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true, sent: !!sent });
}
