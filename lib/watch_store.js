// lib/watch_store.js
//
// Parent approval of a kid's Apple Watch sign-in (docs/apple-watch-design.md,
// section 6, Option B), the per-player list of approved watches, and the watch
// session token. Lives in lib/ so it costs no Vercel function slot; the HTTP
// actions are in api/login.js.
//
// Flow:
//   1. The watch sends the jersey code (watch-request). The server stores a
//      pending request and emails each parent ON FILE a one-time approve link.
//   2. The parent opens the link (watch-approve.html) and taps Approve or Not me.
//   3. The watch polls watch-status with its requestId. After approval the next
//      poll hands back the watch session token ONCE and deletes the request.
//
// Data model (Upstash Redis). Every secret is stored only as a SHA-256 hash, so
// a read of the store can never hand out a working requestId, approve link or
// session token:
//   watchreq:<sha256(requestId)>     { pid, label, status, createdAt, expiresAt,
//                                      approveHashes, deviceId?, exp? }  TTL 15 min
//                                    (10 more minutes after approval, for the poll)
//   watchapprove:<sha256(approveT)>  { reqHash, emailHash }              TTL 15 min
//   watch:<pid>                      [ { deviceId, label, approvedAt, exp, tokenHash } ]
//
// Tokens (all HMAC-SHA256 with the session secret, each with its own domain
// prefix so one kind can never be replayed as another):
//   watch session  <pid>.w<deviceId>.<exp>.<sig>      'thwap-watch-session:'
//                  Same 4-part shape as the web session, but the plain
//                  verifySession() in lib/session_store.js REJECTS it (different
//                  signing prefix). Only sessionClaims() below accepts it, and only
//                  while the watch is still on the player's list (revocation).
//   manage link    <pid>.<exp>.<nonce>.<sig>          'thwap-watch-manage:'
//                  The parent's "see or remove watches" capability. Stateless,
//                  expires after 30 days (the life of a watch session).
//   requestId and approve token are 256-bit random values (base64url), not signed.
//
// COPPA boundary: nothing here stores a parent email; only its hash (to record
// which on-file parent approved). Device labels are trimmed, plain text.

import crypto from 'crypto';
import { sha256, safeEqualHex } from './photo_store.js';
import { verifySession, readSessionCookie } from './session_store.js';
import { getKv } from './photo_common.js';

export const WATCH_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days (design doc section 15)
export const WATCH_REQUEST_TTL_MS = 15 * 60 * 1000; // approve link + pending request: 15 minutes
export const WATCH_PICKUP_TTL_MS = 10 * 60 * 1000; // after approval, the watch has 10 minutes to collect
export const MANAGE_LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000; // remove-a-watch link: 30 days
export const MAX_WATCHES = 5; // per player; approving a sixth drops the oldest

const SESSION_PREFIX = 'thwap-watch-session:';
const MANAGE_PREFIX = 'thwap-watch-manage:';

function secret() {
  return process.env.SESSION_TOKEN_SECRET || process.env.PHOTO_TOKEN_SECRET || '';
}
const hmac = (prefix, body) => crypto.createHmac('sha256', secret()).update(prefix + body).digest('hex');
const idNorm = (id) => String(id || '').trim().toLowerCase();

// 256 bits of randomness, url-safe. Used for requestId and approve tokens.
export function randomSecret() {
  return crypto.randomBytes(32).toString('base64url');
}

// A device label from the watch, made safe to show in an email and on a page:
// printable characters only, no angle brackets, at most 40 characters.
export function cleanLabel(raw) {
  const s = String(raw == null ? '' : raw)
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40)
    .trim();
  return s || 'Apple Watch';
}

// --- watch session token ----------------------------------------------------

export function mintWatchToken(playerId, deviceId, exp) {
  if (!secret()) return null;
  const body = `${idNorm(playerId)}.w${deviceId}.${exp}`;
  return `${body}.${hmac(SESSION_PREFIX, body)}`;
}

// Signature + expiry only (no revocation check). Returns
// { playerId, deviceId, exp } or null.
export function verifyWatchToken(token, now = Date.now()) {
  if (!secret() || !token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const [pid, dev, expStr, sig] = parts;
  if (!pid || !/^w[0-9a-f]{32}$/.test(dev)) return null;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < now) return null;
  if (!safeEqualHex(sig, hmac(SESSION_PREFIX, `${pid}.${dev}.${expStr}`))) return null;
  return { playerId: pid, deviceId: dev.slice(1), exp };
}

// --- manage (remove a watch) capability link --------------------------------

export function mintManageToken(playerId, now = Date.now()) {
  if (!secret()) return null;
  const exp = now + MANAGE_LINK_TTL_MS;
  const nonce = crypto.randomBytes(8).toString('hex');
  const body = `${idNorm(playerId)}.${exp}.${nonce}`;
  return `${body}.${hmac(MANAGE_PREFIX, body)}`;
}

export function verifyManageToken(token, now = Date.now()) {
  if (!secret() || !token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const [pid, expStr, nonce, sig] = parts;
  if (!pid || !/^[0-9a-f]{16}$/.test(nonce)) return null;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < now) return null;
  if (!safeEqualHex(sig, hmac(MANAGE_PREFIX, `${pid}.${expStr}.${nonce}`))) return null;
  return { playerId: pid, exp };
}

// --- approved watch list ----------------------------------------------------

const listKey = (pid) => `watch:${idNorm(pid)}`;
const reqKey = (requestId) => `watchreq:${sha256(requestId)}`;
const approveKey = (t) => `watchapprove:${sha256(t)}`;

async function readList(kv, pid, now) {
  const raw = await kv.get(listKey(pid));
  const list = Array.isArray(raw) ? raw : [];
  return list.filter((w) => w && w.deviceId && Number(w.exp) > now);
}

// Public view of a player's approved watches (no token hashes).
export async function listWatches(kv, playerId, now = Date.now()) {
  const list = await readList(kv, playerId, now);
  return list.map((w) => ({ deviceId: w.deviceId, label: w.label, approvedAt: w.approvedAt, exp: w.exp }));
}

// Remove one watch. Its token stops working on the very next request.
export async function revokeWatch(kv, playerId, deviceId, now = Date.now()) {
  const list = await readList(kv, playerId, now);
  const next = list.filter((w) => w.deviceId !== String(deviceId || ''));
  if (next.length === list.length) return false;
  await kv.set(listKey(playerId), next);
  return true;
}

async function addWatch(kv, playerId, entry, now) {
  const list = await readList(kv, playerId, now);
  list.push(entry);
  list.sort((a, b) => a.approvedAt - b.approvedAt);
  while (list.length > MAX_WATCHES) list.shift();
  await kv.set(listKey(playerId), list);
}

// A watch token that is signed, unexpired AND still on the player's list.
export async function watchClaimsLive(kv, token, now = Date.now()) {
  const c = verifyWatchToken(token, now);
  if (!c) return null;
  const list = await readList(kv, c.playerId, now);
  const want = sha256(token);
  const hit = list.find((w) => w.deviceId === c.deviceId && safeEqualHex(w.tokenHash, want));
  return hit ? c : null;
}

// The ONE session check for endpoints the watch uses. Accepts the web session
// (lib/session_store.js, no storage read, unchanged) or a live watch token.
// Returns { playerId, emailHash, exp, kind: 'web' | 'watch', deviceId? } or null.
export async function sessionClaims(req, kv) {
  const token = readSessionCookie(req);
  if (!token) return null;
  const web = verifySession(token);
  if (web) return { ...web, kind: 'web' };
  if (!/^[^.]+\.w[0-9a-f]{32}\./.test(token)) return null; // not a watch token: skip the read
  const w = await watchClaimsLive(kv || getKv(), token);
  return w ? { playerId: w.playerId, emailHash: '', exp: w.exp, kind: 'watch', deviceId: w.deviceId } : null;
}

// --- requests and approvals -------------------------------------------------

// Store a pending request and one approve token per on-file parent email.
// Returns { requestId, approvals: [{ email, token }] }.
export async function createWatchRequest(kv, { playerId, label, emails }, now = Date.now()) {
  const requestId = randomSecret();
  const rh = sha256(requestId);
  const approvals = emails.map((email) => ({ email, token: randomSecret() }));
  for (const a of approvals) {
    await kv.set(approveKey(a.token), { reqHash: rh, emailHash: sha256(String(a.email).toLowerCase()) },
      { px: WATCH_REQUEST_TTL_MS });
  }
  await kv.set(reqKey(requestId), {
    pid: idNorm(playerId),
    label,
    status: 'pending',
    createdAt: now,
    expiresAt: now + WATCH_REQUEST_TTL_MS,
    approveHashes: approvals.map((a) => sha256(a.token)),
  }, { px: WATCH_REQUEST_TTL_MS });
  return { requestId, approvals };
}

// Look up an approve link WITHOUT using it (an email scanner that prefetches the
// link must not approve anything). Returns { approve, request } or null.
export async function peekApproval(kv, t, now = Date.now()) {
  if (!t || typeof t !== 'string' || t.length > 100) return null;
  const approve = await kv.get(approveKey(t));
  if (!approve || typeof approve !== 'object') return null;
  const request = await kv.get(`watchreq:${approve.reqHash}`);
  if (!request || typeof request !== 'object') return null;
  if (request.status !== 'pending' || now >= request.expiresAt) return null;
  return { approve, request };
}

async function burnApproveTokens(kv, request) {
  const keys = (request.approveHashes || []).map((h) => `watchapprove:${h}`);
  if (keys.length) await kv.del(...keys);
}

// Use an approve link. decision is 'approve' or 'deny'. Single use, and only ONE
// decision per request even when two parents tap at the same moment: a
// set-if-absent lock on the request is the gate.
// Returns { status: 'approved' | 'denied', request, approve, deviceId?, exp? }
// or null when the link is unknown, used, or expired.
export async function decideApproval(kv, t, decision, now = Date.now()) {
  const peek = await peekApproval(kv, t, now);
  if (!peek) return null;
  const { approve, request } = peek;
  const lock = await kv.set(`watchdecide:${approve.reqHash}`, 1, { nx: true, px: WATCH_REQUEST_TTL_MS });
  if (lock !== 'OK') return null;
  await kv.del(approveKey(t));
  await burnApproveTokens(kv, request);
  const rk = `watchreq:${approve.reqHash}`;
  if (decision !== 'approve') {
    await kv.set(rk, { ...request, status: 'denied', approveHashes: [] }, { px: WATCH_PICKUP_TTL_MS });
    return { status: 'denied', request, approve };
  }
  const deviceId = crypto.randomBytes(16).toString('hex');
  const exp = now + WATCH_SESSION_TTL_MS;
  const token = mintWatchToken(request.pid, deviceId, exp);
  if (!token) return null;
  await addWatch(kv, request.pid, { deviceId, label: request.label, approvedAt: now, exp, tokenHash: sha256(token) }, now);
  // The raw token is NOT stored: it is re-derived from (pid, deviceId, exp) at pickup.
  await kv.set(rk, { ...request, status: 'approved', approveHashes: [], deviceId, exp }, { px: WATCH_PICKUP_TTL_MS });
  return { status: 'approved', request, approve, deviceId, exp };
}

// The watch's poll. Returns { status } and, exactly once after approval,
// { status: 'approved', token, exp, playerId }. Unknown ids read as 'expired' so
// a guessed id learns nothing.
export async function pollWatchRequest(kv, requestId, now = Date.now()) {
  if (!requestId || typeof requestId !== 'string' || requestId.length > 100) return { status: 'expired' };
  const rk = reqKey(requestId);
  const request = await kv.get(rk);
  if (!request || typeof request !== 'object') return { status: 'expired' };
  if (request.status === 'pending') {
    return now >= request.expiresAt ? { status: 'expired' } : { status: 'pending' };
  }
  // Approved or denied: the request is consumed by this read. Only the caller
  // whose del removes the record gets the answer, so the token goes out once.
  const won = await kv.del(rk);
  if (won !== 1) return { status: 'expired' };
  if (request.status === 'denied') return { status: 'denied' };
  const token = mintWatchToken(request.pid, request.deviceId, request.exp);
  // A parent may have removed the watch between Approve and pickup.
  if (!token || !(await watchClaimsLive(kv, token, now))) return { status: 'denied' };
  return { status: 'approved', token, exp: request.exp, playerId: request.pid };
}
