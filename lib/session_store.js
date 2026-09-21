// lib/session_store.js
//
// Parent sign-in sessions for Thwap Hockey.
//
// This is the server-enforced replacement for the client-only cookie gate. A
// session is a STATELESS HMAC-signed token (same design as the photo upload
// token in photo_store.js): the token itself carries the parent's player and a
// hashed email plus an expiry, and is verified with the shared secret without a
// storage round trip. It is delivered to the browser as an HTTP-only cookie so
// page JavaScript cannot read or forge it.
//
// COPPA boundary: the token holds the player id (a first name) and a HASH of the
// parent email (never the raw email), plus timestamps. No child PII beyond the
// first name the app already shows. The parent email is the consent anchor and
// is recorded (hashed) via recordConsent() in photo_store.js at verify time.
//
// Env:
//   SESSION_TOKEN_SECRET   HMAC secret (required; falls back to PHOTO_TOKEN_SECRET
//                          so a single secret can drive both features)
//
// No credential files are read here. Secrets come only from process.env.

import crypto from 'crypto';
import { sha256, safeEqualHex } from './photo_store.js';

// A signed session lives 30 days when "keep me signed in" is chosen, else it is
// a short browser session. The token always carries its own expiry; the cookie's
// Max-Age mirrors it (or is omitted for a session cookie).
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const SESSION_COOKIE = 'thwapSession';

function sessionSecret() {
  return process.env.SESSION_TOKEN_SECRET || process.env.PHOTO_TOKEN_SECRET || '';
}

// True when the signing secret is present. Endpoints fail closed (503) otherwise.
export function sessionConfigured() {
  return !!sessionSecret();
}

// Mint a session token. Format: <playerId>.<emailHash>.<exp>.<sig> (url-safe).
// ttlMs lets the caller issue a shorter-lived token; default is the 30-day life.
export function mintSession(playerId, email, now = Date.now(), ttlMs = SESSION_TTL_MS) {
  const secret = sessionSecret();
  if (!secret) return null;
  const pid = String(playerId).toLowerCase();
  const emailHash = sha256(String(email).toLowerCase());
  const exp = now + ttlMs;
  const body = `${pid}.${emailHash}.${exp}`;
  const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');
  return `${body}.${sig}`;
}

// Verify a session token. Returns { playerId, emailHash, exp } or null if the
// token is missing, malformed, tampered, or expired.
export function verifySession(token, now = Date.now()) {
  const secret = sessionSecret();
  if (!secret || !token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const [pid, emailHash, expStr, sig] = parts;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < now) return null;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${pid}.${emailHash}.${expStr}`)
    .digest('hex');
  if (!safeEqualHex(sig, expected)) return null;
  return { playerId: pid, emailHash, exp };
}

// --- cookie helpers --------------------------------------------------------
// HTTP-only + SameSite=Lax so the token is not readable by page JS and is not
// sent on cross-site requests. Secure is added on https (all Vercel deploys).

export function sessionCookie(token, { keep = false, secure = true } = {}) {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (secure) parts.push('Secure');
  if (keep) parts.push(`Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`); // else: session cookie
  return parts.join('; ');
}

export function clearSessionCookie({ secure = true } = {}) {
  const parts = [
    `${SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

// Read the session token from a request's Cookie header. Returns '' if absent.
export function readSessionCookie(req) {
  const raw = (req && req.headers && (req.headers.cookie || req.headers.Cookie)) || '';
  const m = String(raw).match(new RegExp('(?:^|; )' + SESSION_COOKIE + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : '';
}
