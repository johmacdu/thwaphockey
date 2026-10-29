// api/photo/request-code.js
//
// POST { email, playerId } -> emails a 6-digit code to that parent email, but
// ONLY when it is one of the parent emails on file for that player (the team
// member record). Typing any other address sends nothing, so an email the
// caller controls cannot stand in for a parent's consent.
//
// Always answers the same { ok: true } for an unknown player, a player with no
// emails on file, and an email that is not on file, so this cannot be used to
// probe the roster or learn a family's address. Rate limits (lib/rate_limit.js:
// per IP and per player, plus the per-email hourly cap) are counted BEFORE any
// lookup, so a 429 reveals nothing either.

import { getKv, parseBody, photoPlayer, photoParentEmails, photoOtpId, emailConfigured, sendCodeEmail } from '../../lib/photo_common.js';
import { checkAndBumpRate, putOtp, randomCode } from '../../lib/photo_store.js';
import { allowEmailAction } from '../../lib/rate_limit.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const tooMany = (res) => res.status(429).json({ error: 'too many requests, try again later' });

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method not allowed' });
  }
  res.setHeader('Cache-Control', 'no-store');
  if (!emailConfigured()) return res.status(503).json({ error: 'photo service not configured' });

  const { email, playerId } = parseBody(req);
  const cleanEmail = String(email || '').trim().toLowerCase();
  const pid = String(playerId || '').trim().toLowerCase();
  if (!EMAIL_RE.test(cleanEmail)) return res.status(400).json({ error: 'bad email' });

  const kv = getKv();
  if (!(await allowEmailAction(kv, 'photo-request-code', pid, req))) return tooMany(res);
  if (!(await checkAndBumpRate(kv, 'photo:' + cleanEmail))) return tooMany(res);

  const player = await photoPlayer(pid);
  const onFile = player ? await photoParentEmails(pid) : [];
  if (!onFile.includes(cleanEmail)) return res.status(200).json({ ok: true });

  const code = randomCode();
  await putOtp(kv, photoOtpId(pid, cleanEmail), code);
  // A mail hiccup is not reported back: the answer must not differ by email.
  await sendCodeEmail(cleanEmail, code, player.name || 'your player');
  return res.status(200).json({ ok: true });
}
