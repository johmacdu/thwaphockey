// api/login.js
//
// Consolidated parent sign-in router (Phase 1 server sessions). One serverless
// function that dispatches on ?action= so the four login actions cost ONE
// function slot instead of four (Vercel Hobby caps a deployment at 12).
//
//   POST /api/login?action=request-code  { email, playerId }        -> emails a 6-digit code
//   POST /api/login?action=verify        { email, playerId, code, keep } -> sets HTTP-only cookie
//   GET  /api/login?action=session                                   -> { authed, player }
//   POST /api/login?action=logout                                    -> clears the cookie
//
// Behavior is identical to the previous api/login/<action>.js files; only the
// packaging changed. Reuses the photo flow's OTP + rate-limit + mail + consent
// helpers. Env: RESEND_API_KEY, PHOTO_FROM_EMAIL, PHOTO_TOKEN_SECRET,
// KV_REST_API_* / UPSTASH_REDIS_REST_*, and SESSION_TOKEN_SECRET (falls back to
// PHOTO_TOKEN_SECRET).

import { getKv, parseBody, isRosterPlayer, emailConfigured, sendCodeEmail } from '../lib/photo_common.js';
import { checkAndBumpRate, putOtp, randomCode, checkOtp, recordConsent } from '../lib/photo_store.js';
import {
  mintSession, verifySession, sessionCookie, clearSessionCookie,
  readSessionCookie, sessionConfigured,
} from '../lib/session_store.js';
import { ROSTER } from '../lib/store.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isSecure(req) {
  return String(req.headers['x-forwarded-proto'] || '').includes('https') || true;
}

async function requestCode(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'method not allowed' }); }
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

async function verify(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'method not allowed' }); }
  if (!emailConfigured() || !sessionConfigured()) return res.status(503).json({ error: 'login not configured' });

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

  await recordConsent(kv, pid, cleanEmail);
  const token = mintSession(pid, cleanEmail);
  if (!token) return res.status(503).json({ error: 'login not configured' });
  res.setHeader('Set-Cookie', sessionCookie(token, { keep: !!keep, secure: isSecure(req) }));

  const player = ROSTER.find((p) => p.id === pid);
  return res.status(200).json({ ok: true, player: player ? { id: player.id, name: player.name, number: player.number } : { id: pid } });
}

function session(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'method not allowed' }); }
  res.setHeader('Cache-Control', 'no-store');
  if (!sessionConfigured()) return res.status(200).json({ authed: false });

  const claims = verifySession(readSessionCookie(req));
  if (!claims) return res.status(200).json({ authed: false });
  const player = ROSTER.find((p) => p.id === claims.playerId);
  return res.status(200).json({
    authed: true,
    player: player ? { id: player.id, name: player.name, number: player.number } : { id: claims.playerId },
  });
}

function logout(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'method not allowed' }); }
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Set-Cookie', clearSessionCookie({ secure: isSecure(req) }));
  return res.status(200).json({ ok: true });
}

export default async function handler(req, res) {
  const action = String((req.query && req.query.action) || '').toLowerCase();
  if (action === 'request-code') return requestCode(req, res);
  if (action === 'verify') return verify(req, res);
  if (action === 'session') return session(req, res);
  if (action === 'logout') return logout(req, res);
  return res.status(404).json({ error: 'unknown login action' });
}

// Exported for unit tests (call the sub-handlers directly with a query.action-free req).
export const _handlers = { requestCode, verify, session, logout };
