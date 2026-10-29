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

// Re-mint a session from verified claims (same player and email hash, a fresh
// expiry). Used when a device that already holds a valid session signs in again,
// so a current user is never sent back through the parent step.
export function refreshSession(claims, now = Date.now(), ttlMs = SESSION_TTL_MS) {
  const secret = sessionSecret();
  if (!secret || !claims || !claims.playerId || !/^[0-9a-f]{64}$/.test(String(claims.emailHash || ''))) return null;
  const body = `${String(claims.playerId).toLowerCase()}.${claims.emailHash}.${now + ttlMs}`;
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

// --- remembered devices ----------------------------------------------------
// A parent approves a NEW browser once (the emailed code at verify). The server
// then sets a signed, HTTP-only "remembered device" cookie for that one player,
// so the same browser can sign in with the player code alone for 30 days
// without emailing the parent again. One cookie per player (siblings on one
// family iPad each get their own). Path=/api/login so it only rides along to
// the sign-in endpoints, never to page loads or other APIs.
//
//   thwapDev_<sha256(playerId)[0..16]> = <exp>.<hmac('device|pid|exp')>
//
// Stateless like the session token: it expires on its own and cannot be
// revoked early. It is only ever set when the parent chose "Keep me signed in".

export const DEVICE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const DEVICE_COOKIE_PATH = '/api/login';

export function deviceCookieName(playerId) {
  return 'thwapDev_' + sha256(String(playerId || '').toLowerCase()).slice(0, 16);
}

function deviceSig(pid, exp, secret) {
  return crypto.createHmac('sha256', secret).update(`device|${pid}|${exp}`).digest('hex');
}

export function mintDeviceToken(playerId, now = Date.now(), ttlMs = DEVICE_TTL_MS) {
  const secret = sessionSecret();
  if (!secret) return null;
  const pid = String(playerId || '').toLowerCase();
  const exp = now + ttlMs;
  return `${exp}.${deviceSig(pid, exp, secret)}`;
}

export function verifyDeviceToken(playerId, token, now = Date.now()) {
  const secret = sessionSecret();
  if (!secret || !token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const exp = Number(parts[0]);
  if (!Number.isFinite(exp) || exp < now) return false;
  const pid = String(playerId || '').toLowerCase();
  return safeEqualHex(parts[1], deviceSig(pid, parts[0], secret));
}

export function deviceCookie(playerId, token, { secure = true } = {}) {
  const parts = [
    `${deviceCookieName(playerId)}=${encodeURIComponent(token)}`,
    `Path=${DEVICE_COOKIE_PATH}`,
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(DEVICE_TTL_MS / 1000)}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

// True when the request carries a valid remembered-device cookie for playerId.
export function deviceRemembered(req, playerId) {
  const raw = (req && req.headers && (req.headers.cookie || req.headers.Cookie)) || '';
  const name = deviceCookieName(playerId);
  const m = String(raw).match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  if (!m) return false;
  let tok = '';
  try { tok = decodeURIComponent(m[1]); } catch { return false; }
  return verifyDeviceToken(playerId, tok);
}
