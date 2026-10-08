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

// Real FCM/APNs delivery. credentials-pending: this is intentionally a stub so
// the plumbing is complete and testable without secrets. Wiring it up means
// reading a service-account/key from process.env (NEVER committed), POSTing each
// token to FCM, and tallying per-token success/failure here.
async function fcmSender(_tokenRecords, _payload) {
  // credentials-pending: no FCM credentials are wired, so this path is unreachable
  // today (pushConfigured() is false, so sendToTokens never selects it). When
  // credentials arrive, implement the real POST to FCM here and return the live
  // { sent, failed } tally. Returning a zeroed failure keeps a mis-wire honest
  // rather than silently claiming delivery.
  return { sent: 0, failed: _tokenRecords.length };
}

// True once real push credentials are wired. FALSE now: there are no FCM/APNs
// credentials in the environment, so every send runs through the mock. api/push.js
// echoes this so a caller can see the system is in credentials-pending mode.
export function pushConfigured() {
  return false;
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
