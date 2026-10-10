// lib/push_store.js
//
// Server-side push NOTIFICATION PLUMBING for Thwap Hockey.
//
// This file is the ONE place that stores device push tokens and fans a payload
// out to them. It is IMPORT-ONLY (no `export default`), so Vercel does NOT count
// it as a serverless function (only api/*.js with a default export count against
// the Hobby 12-function cap). api/push.js is the single function that drives it.
//
// SCOPE (deliberately narrow): this is the SEND MACHINERY only. It invents no
// notification copy and no triggers. The real FCM/APNs call is a clearly-marked
// `// credentials-pending` stub that is never reached until credentials are
// wired; the default sender is a MOCK that touches no network. pushConfigured()
// returns false until that happens.
//
// Data model (mirrors the player/days/events JSON-array idiom in store.js):
//
//   Key:   pushtokens:<playerId>   (playerId = lowercase first name, e.g. "lewie")
//   Value: JSON array of { token, platform:'web'|'ios'|'android', ua, at },
//          newest LAST, deduped by token, capped to the TOKENS_CAP newest.
//
// A device registers its token when the player turns Notifications on in the
// native app; it unregisters on toggle-off or sign-out. A later server-side push
// looks up a player's tokens and fans the payload out to them.

import { Redis } from '@upstash/redis';
import crypto from 'crypto';

// Same env-var fallback as lib/store.js: the Vercel Upstash integration injects
// either KV_REST_API_* or UPSTASH_REDIS_REST_*. Accept whichever is present.
const kv = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Keep a bounded number of tokens per player (a kid has a handful of devices).
const TOKENS_CAP = 10;

const PLATFORMS = ['web', 'ios', 'android'];

const pushTokensKeyFor = (id) => `pushtokens:${String(id).toLowerCase()}`;

// Normalize Upstash's return (parsed array, raw JSON string, or missing) into an
// array without ever throwing. Same helper shape as store.js asArray.
function asArray(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

// Normalize a platform string to one of 'web' | 'ios' | 'android' (default 'web').
function normPlatform(p) {
  const v = String(p || '').trim().toLowerCase();
  return PLATFORMS.includes(v) ? v : 'web';
}

// Read a player's registered tokens, newest last. Always an array (empty for a
// fresh player), never throws.
export async function listTokens(playerId) {
  return asArray(await kv.get(pushTokensKeyFor(playerId)));
}

// Register (or refresh) one device token for a player. Dedups by token (a repeat
// registration moves the existing record to newest and refreshes its fields,
// never adding a duplicate), then caps to the TOKENS_CAP newest. A falsy/blank
// token is ignored (returns the unchanged list). Returns the resulting array.
export async function registerToken(playerId, { token, platform, ua } = {}) {
  const tok = String(token || '').trim();
  const current = await listTokens(playerId);
  if (!tok) return current;
  // Drop any existing record for this token so the refreshed one lands at the end.
  const without = current.filter((t) => t && t.token !== tok);
  without.push({
    token: tok,
    platform: normPlatform(platform),
    ua: String(ua || '').slice(0, 256),
    at: new Date().toISOString(),
  });
  const capped = without.length > TOKENS_CAP ? without.slice(without.length - TOKENS_CAP) : without;
  await kv.set(pushTokensKeyFor(playerId), capped);
  return capped;
}

// Remove one device token for a player. A no-op if the token is not present.
// Returns the resulting array.
export async function unregisterToken(playerId, token) {
  const tok = String(token || '').trim();
  const current = await listTokens(playerId);
  if (!tok) return current;
  const next = current.filter((t) => t && t.token !== tok);
  if (next.length === current.length) return current; // nothing removed
  await kv.set(pushTokensKeyFor(playerId), next);
  return next;
}

// --- Admin diagnostics (counts only, NEVER raw tokens) ---------------------
//
// Aggregate the stored tokens for a set of players into COUNTS, so an operator
// can see registration state without any token string leaving this file. A push
// token is credential-adjacent, so this returns tallies only: a per-player total
// plus a per-platform breakdown. Import-only, like the rest of this module.

// Count one player's tokens by platform. Returns { count, platforms:{web,ios,android} }.
// Never includes a token string.
export async function tokenCountsFor(playerId) {
  const tokens = await listTokens(playerId);
  const platforms = { web: 0, ios: 0, android: 0 };
  for (const t of tokens) {
    const p = normPlatform(t && t.platform);
    platforms[p] += 1;
  }
  return { count: tokens.length, platforms };
}

// Aggregate counts across many players. Returns
// { players:[{playerId,count,platforms}], totalTokens, pushConfigured }.
// COUNTS ONLY; no raw token string is ever read into the result.
export async function statusSummary(playerIds = []) {
  const ids = Array.from(new Set((playerIds || []).map((id) => String(id).toLowerCase())));
  const players = [];
  let totalTokens = 0;
  for (const pid of ids) {
    const { count, platforms } = await tokenCountsFor(pid);
    players.push({ playerId: pid, count, platforms });
    totalTokens += count;
  }
  return { players, totalTokens, pushConfigured: pushConfigured() };
}

// --- Sender ----------------------------------------------------------------
//
// sendToTokens fans one payload out to a list of token records. The actual
// delivery is INJECTED via opts.sender so a test (and today's un-credentialed
// production) uses the MOCK, which touches no network. The real FCM/APNs call is
// a credentials-pending stub below, selected only once pushConfigured() is true.
//
// A sender is: async (tokenRecords, payload) => { sent, failed }.

// Default sender: a pure MOCK. Reports every token as "sent", makes NO network
// call. This is what runs until real credentials are wired, so a test trigger
// exercises the full fan-out path without delivering (or needing) anything.
async function mockSender(tokenRecords, _payload) {
  return { sent: tokenRecords.length, failed: 0 };
}

// --- FCM HTTP v1 credentials + OAuth2 access token -------------------------
//
// The modern FCM send API (HTTP v1) authenticates with a short-lived Google
// OAuth2 access token, minted from the service-account JSON by signing a JWT
// (RS256) with the account's private key and exchanging it at Google's token
// endpoint. We use Node's built-in crypto for the signing, so this needs NO new
// dependency. The service-account JSON lives ONLY in process.env
// (FCM_SERVICE_ACCOUNT_JSON), never on disk or in the repo.

// Parse the service-account JSON from the env var. Returns the parsed object or
// null when the env var is absent or malformed (so the caller can fail honest).
function serviceAccount() {
  const raw = process.env.FCM_SERVICE_ACCOUNT_JSON || '';
  if (!raw) return null;
  try {
    const sa = JSON.parse(raw);
    if (sa && sa.client_email && sa.private_key) return sa;
    return null;
  } catch {
    return null;
  }
}

// The Firebase project id. Prefer the explicit env var; fall back to the
// project_id carried inside the service-account JSON so a single secret suffices.
function projectId() {
  const explicit = String(process.env.FCM_PROJECT_ID || '').trim();
  if (explicit) return explicit;
  const sa = serviceAccount();
  return sa && sa.project_id ? String(sa.project_id) : '';
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Mint a Google OAuth2 access token for the FCM scope by signing a JWT with the
// service account's RSA private key and exchanging it at oauth2.googleapis.com.
// Tokens are cached in-process until shortly before expiry so a burst of sends
// reuses one token. Returns the access-token string, or null when unconfigured
// or the exchange fails.
let _tokenCache = { token: '', exp: 0 };
async function accessToken(now = Date.now()) {
  if (_tokenCache.token && now < _tokenCache.exp - 60_000) return _tokenCache.token;
  const sa = serviceAccount();
  if (!sa) return null;
  const iat = Math.floor(now / 1000);
  const exp = iat + 3600;
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: sa.token_uri || 'https://oauth2.googleapis.com/token',
    iat,
    exp,
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claim))}`;
  let signature;
  try {
    signature = crypto.createSign('RSA-SHA256').update(signingInput).sign(sa.private_key);
  } catch {
    return null; // bad/garbled private key
  }
  const jwt = `${signingInput}.${b64url(signature)}`;
  let resp;
  try {
    resp = await fetch(sa.token_uri || 'https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }).toString(),
    });
  } catch {
    return null; // network failure reaching Google
  }
  if (!resp.ok) return null;
  let data;
  try { data = await resp.json(); } catch { return null; }
  if (!data || !data.access_token) return null;
  _tokenCache = {
    token: data.access_token,
    exp: now + (Number(data.expires_in || 3600) * 1000),
  };
  return _tokenCache.token;
}

// Shape the stored { token, platform } record + our payload into an FCM HTTP v1
// message body. Payload fields map to the notification title/body; any extra
// keys ride along as string data (FCM data values must be strings).
function fcmMessage(tokenRecord, payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const message = { token: tokenRecord.token };
  const title = p.title != null ? String(p.title) : '';
  const body = p.body != null ? String(p.body) : '';
  if (title || body) message.notification = { title, body };
  // Stringify any non-reserved payload keys as FCM data (strings only).
  const data = {};
  for (const [k, v] of Object.entries(p)) {
    if (k === 'title' || k === 'body') continue;
    if (v == null) continue;
    data[k] = typeof v === 'string' ? v : JSON.stringify(v);
  }
  if (Object.keys(data).length) message.data = data;
  return { message };
}

// Real FCM HTTP v1 delivery. Mints an OAuth2 access token from the service
// account, then POSTs each token's message to the per-project send endpoint and
// tallies per-token success/failure. A per-token 404/UNREGISTERED means the
// device token is dead; we count it failed (dead-token cleanup is a later slice,
// noted in the design doc). Returns the live { sent, failed } tally.
async function fcmSender(tokenRecords, payload) {
  const list = Array.isArray(tokenRecords) ? tokenRecords.filter(Boolean) : [];
  if (!list.length) return { sent: 0, failed: 0 };
  const pid = projectId();
  const at = await accessToken();
  // Unconfigured or token-exchange failure: fail honest, deliver nothing.
  if (!pid || !at) return { sent: 0, failed: list.length };
  const url = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(pid)}/messages:send`;
  let sent = 0, failed = 0;
  for (const rec of list) {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${at}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(fcmMessage(rec, payload)),
      });
      if (resp.ok) sent += 1; else failed += 1;
    } catch {
      failed += 1;
    }
  }
  return { sent, failed };
}

// True once real push credentials are wired: a parseable service-account JSON
// (FCM_SERVICE_ACCOUNT_JSON) AND a resolvable Firebase project id. When both are
// present sendToTokens selects the real fcmSender; otherwise it stays on the mock
// so an un-credentialed deploy delivers nothing rather than erroring. api/push.js
// echoes this so a caller can see whether the system is live or still mocked.
export function pushConfigured() {
  return !!(serviceAccount() && projectId());
}

// Fan `payload` out to `tokens` (an array of token records as stored). The sender
// is INJECTED (opts.sender); it defaults to the live sender when configured and
// the mock otherwise, so production today uses the mock without any caller change.
// Returns the sender's { sent, failed } tally (zeroed for an empty token list).
export async function sendToTokens(tokens, payload, opts = {}) {
  const list = Array.isArray(tokens) ? tokens.filter(Boolean) : [];
  if (!list.length) return { sent: 0, failed: 0 };
  const sender = opts.sender || (pushConfigured() ? fcmSender : mockSender);
  return sender(list, payload);
}
