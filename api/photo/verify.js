// api/photo/verify.js
//
// POST { email, playerId, code } -> { uploadToken } on success, else 401.
// On success records the consent and mints a player-scoped upload token.
//
// The code is bound to the player AND the on-file parent email it was sent to
// (photoOtpId), so a code for one child cannot unlock another. An unknown
// player, no code pending, a wrong, expired or locked code all answer the same
// 401 with no reason, so verify cannot probe the roster or tell whether an
// email is a parent on file. Per-IP rate limit is counted before any lookup.

import { getKv, parseBody, photoPlayer, photoOtpId, emailConfigured } from '../../lib/photo_common.js';
import { checkOtp, recordConsent, mintToken } from '../../lib/photo_store.js';
import { hit, clientIp, IP_LIMIT, IP_WINDOW_SEC } from '../../lib/rate_limit.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method not allowed' });
  }
  res.setHeader('Cache-Control', 'no-store');
  if (!emailConfigured()) return res.status(503).json({ error: 'photo service not configured' });

  const { email, playerId, code } = parseBody(req);
  const cleanEmail = String(email || '').trim().toLowerCase();
  const pid = String(playerId || '').trim().toLowerCase();
  const kv = getKv();
  if (!(await hit(kv, 'photo-verify:ip', clientIp(req), IP_LIMIT, IP_WINDOW_SEC))) {
    return res.status(429).json({ error: 'too many requests, try again later' });
  }
  // Shape checks only (no lookup), so a 400 says nothing about the player.
  if (!EMAIL_RE.test(cleanEmail) || !pid || !/^\d{6}$/.test(String(code || ''))) {
    return res.status(400).json({ error: 'bad input' });
  }

  const player = await photoPlayer(pid);
  const result = player ? await checkOtp(kv, photoOtpId(pid, cleanEmail), String(code)) : 'none';
  if (result !== 'ok') return res.status(401).json({ error: 'bad code' });

  await recordConsent(kv, pid, cleanEmail);
  const uploadToken = mintToken(pid);
  if (!uploadToken) return res.status(503).json({ error: 'photo service not configured' });
  return res.status(200).json({ uploadToken });
}
