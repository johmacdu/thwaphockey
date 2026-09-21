// api/login/verify.js
//
// POST { email, playerId, code, keep } -> sets an HTTP-only session cookie.
//
// On a correct code: records COPPA consent (hashed email, via the shared photo
// store helper) and mints a stateless HMAC session token delivered as an
// HTTP-only, SameSite=Lax, Secure cookie. `keep` true -> 30-day cookie, else a
// browser-session cookie. Returns { ok, player } (never the raw token; the
// browser holds it only as a cookie it cannot read).

import { getKv, parseBody, isRosterPlayer, emailConfigured } from '../_photo_common.js';
import { checkOtp, recordConsent } from '../photo_store.js';
import { mintSession, sessionCookie, sessionConfigured } from '../session_store.js';
import { ROSTER } from '../store.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method not allowed' });
  }
  if (!emailConfigured() || !sessionConfigured()) {
    return res.status(503).json({ error: 'login not configured' });
  }

  const { email, playerId, code, keep } = parseBody(req);
  const cleanEmail = String(email || '').trim().toLowerCase();
  const pid = String(playerId || '').toLowerCase();
  if (!cleanEmail || !isRosterPlayer(pid) || !/^\d{6}$/.test(String(code || ''))) {
    return res.status(400).json({ error: 'bad input' });
  }

  const kv = getKv();
  const result = await checkOtp(kv, cleanEmail, String(code));
  res.setHeader('Cache-Control', 'no-store');
  if (result !== 'ok') return res.status(401).json({ error: 'bad code', reason: result });

  // Consent is anchored to the parent email (hashed), recorded per player.
  await recordConsent(kv, pid, cleanEmail);

  const token = mintSession(pid, cleanEmail);
  if (!token) return res.status(503).json({ error: 'login not configured' });

  const secure = String(req.headers['x-forwarded-proto'] || '').includes('https') || true;
  res.setHeader('Set-Cookie', sessionCookie(token, { keep: !!keep, secure }));

  const player = ROSTER.find((p) => p.id === pid);
  return res.status(200).json({ ok: true, player: player ? { id: player.id, name: player.name, number: player.number } : { id: pid } });
}
