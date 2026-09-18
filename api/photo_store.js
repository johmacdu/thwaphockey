// api/photo_store.js
//
// Helpers for the parent-gated player photo feature. Kept separate from store.js
// so the photo logic is testable with a fake client and easy to reason about.
//
// Data model (Upstash Redis):
//   otp:<email>            { codeHash, expiresAt, attempts }        (~10 min life)
//   otprate:<email>        integer request count in the last hour   (rate limit)
//   consent:<playerId>     { emailHash, grantedAt }                 (consent record)
//   photo:<playerId>       { url, key, updatedAt }                  (stored photo)
//
// Nothing here reads a credential file. Secrets come only from process.env.
// The image blob itself lives in Vercel Blob; this store only holds its URL/key.

import crypto from 'crypto';

// --- config from env (never hardcode secrets) ------------------------------
export const OTP_TTL_MS = 10 * 60 * 1000; // code lives 10 minutes
export const OTP_MAX_ATTEMPTS = 5; // wrong-code tries before the code is dead
export const RATE_MAX_PER_HOUR = 5; // request-code calls per email per hour
export const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // verified parent: 30 days

function tokenSecret() {
  return process.env.PHOTO_TOKEN_SECRET || '';
}

// --- small crypto helpers --------------------------------------------------
export function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

// Constant-time string compare that never throws on length mismatch.
export function safeEqualHex(a, b) {
  const ba = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export function randomCode() {
  // 6 digits, zero-padded, from a uniform 0..999999 draw.
  const n = crypto.randomInt(0, 1000000);
  return String(n).padStart(6, '0');
}

export function randomKey() {
  return crypto.randomBytes(16).toString('hex');
}

// --- upload token: HMAC(playerId + "." + exp) ------------------------------
// Format: <playerId>.<exp>.<sig>  (all url-safe). Verified without storage.
export function mintToken(playerId, now = Date.now()) {
  const secret = tokenSecret();
  if (!secret) return null;
  const exp = now + TOKEN_TTL_MS;
  const body = `${playerId}.${exp}`;
  const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');
  return `${body}.${sig}`;
}

// Returns the playerId the token authorizes, or null if invalid/expired.
export function verifyToken(token, now = Date.now()) {
  const secret = tokenSecret();
  if (!secret || !token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [playerId, expStr, sig] = parts;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < now) return null;
  const expected = crypto.createHmac('sha256', secret).update(`${playerId}.${expStr}`).digest('hex');
  if (!safeEqualHex(sig, expected)) return null;
  return playerId;
}

// --- store operations (client is injected so tests use FakeRedis) ----------
const otpKey = (email) => `otp:${String(email).toLowerCase()}`;
const rateKey = (email) => `otprate:${String(email).toLowerCase()}`;
const consentKey = (playerId) => `consent:${String(playerId).toLowerCase()}`;
const photoKey = (playerId) => `photo:${String(playerId).toLowerCase()}`;

// Rate limit: allow RATE_MAX_PER_HOUR request-code calls per email per hour.
// Returns true if the call is allowed (and records it), false if over the limit.
export async function checkAndBumpRate(kv, email, now = Date.now()) {
  const key = rateKey(email);
  const cur = (await kv.get(key)) || null;
  let count = 0;
  let windowStart = now;
  if (cur && typeof cur === 'object' && Number.isFinite(cur.windowStart)) {
    if (now - cur.windowStart < 60 * 60 * 1000) {
      count = cur.count || 0;
      windowStart = cur.windowStart;
    }
  }
  if (count >= RATE_MAX_PER_HOUR) return false;
  await kv.set(key, { count: count + 1, windowStart });
  return true;
}

export async function putOtp(kv, email, code, now = Date.now()) {
  await kv.set(otpKey(email), {
    codeHash: sha256(code),
    expiresAt: now + OTP_TTL_MS,
    attempts: 0,
  });
}

// Check a submitted code. Returns 'ok' | 'bad' | 'expired' | 'locked' | 'none'.
// On a wrong code, increments attempts. On success, deletes the OTP.
export async function checkOtp(kv, email, code, now = Date.now()) {
  const rec = await kv.get(otpKey(email));
  if (!rec || typeof rec !== 'object') return 'none';
  if (now >= rec.expiresAt) return 'expired';
  if ((rec.attempts || 0) >= OTP_MAX_ATTEMPTS) return 'locked';
  if (safeEqualHex(sha256(code), rec.codeHash)) {
    await kv.set(otpKey(email), { ...rec, attempts: rec.attempts, consumed: true, expiresAt: 0 });
    return 'ok';
  }
  await kv.set(otpKey(email), { ...rec, attempts: (rec.attempts || 0) + 1 });
  return 'bad';
}

export async function recordConsent(kv, playerId, email, now = Date.now()) {
  await kv.set(consentKey(playerId), { emailHash: sha256(String(email).toLowerCase()), grantedAt: now });
}

export async function putPhoto(kv, playerId, url, key, now = Date.now()) {
  await kv.set(photoKey(playerId), { url, key, updatedAt: now });
}

export async function getPhoto(kv, playerId) {
  const rec = await kv.get(photoKey(playerId));
  return rec && typeof rec === 'object' ? rec : null;
}

export async function removePhoto(kv, playerId) {
  await kv.set(photoKey(playerId), null);
}
