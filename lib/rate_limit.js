// lib/rate_limit.js
//
// Fixed-window rate limits for the emailed-code endpoints (api/login.js
// request-code and watch-request). Counters live in KV with a TTL equal to the
// window, so a window cleans itself up and a key can never lock someone out for
// longer than one window.
//
//   rl:<scope>:<sha256(id)>   integer count for the current window (TTL = window)
//
// The id (a player id or a client IP) is HASHED before it becomes part of a key,
// so the store never holds a raw IP address.
//
// Limits (per action, chosen for a kid-and-parent audience):
//   per player : 3 requests per 15 minutes  (a parent re-sending a code twice is fine,
//                a script hammering one child's parents is not)
//   per IP     : 10 requests per hour       (a family on one home network signing in
//                two or three kids still fits; a scanner does not)
//   per team   : 20 watch-requests per hour per team code (watch-request only).
//                The watch signs in with team code + jersey code and no player
//                id, so this is the bucket that caps guessing jersey codes
//                against one team. Team codes are not secret.
// The existing 5-per-hour per-player limit in lib/photo_store.js still applies to
// request-code on top of these.

import { sha256 } from './photo_store.js';

export const PLAYER_LIMIT = 3;
export const PLAYER_WINDOW_SEC = 15 * 60;
export const IP_LIMIT = 10;
export const IP_WINDOW_SEC = 60 * 60;
export const TEAM_LIMIT = 20;
export const TEAM_WINDOW_SEC = 60 * 60;

// Count one hit against <scope>:<id>. Returns true when the call is allowed.
// incr is atomic, so two simultaneous requests cannot both slip under the limit.
export async function hit(kv, scope, id, limit, windowSec) {
  const key = `rl:${scope}:${sha256(String(id || '').toLowerCase())}`;
  const n = await kv.incr(key);
  if (n === 1) {
    await kv.expire(key, windowSec);
  } else if (n > limit) {
    // Self-heal: if the TTL was ever lost (the expire after the first incr
    // failed), set it now so the key cannot block this id forever.
    const ttl = await kv.ttl(key);
    if (ttl < 0) await kv.expire(key, windowSec);
  }
  return n <= limit;
}

// The caller's IP. Vercel sets x-real-ip and puts the client first in
// x-forwarded-for. Falls back to the socket address, then a fixed bucket (so a
// request with no address at all still shares one limit rather than none).
export function clientIp(req) {
  const h = (req && req.headers) || {};
  const real = String(h['x-real-ip'] || '').trim();
  if (real) return real;
  const xff = String(h['x-forwarded-for'] || '').split(',')[0].trim();
  if (xff) return xff;
  const sock = req && req.socket && req.socket.remoteAddress;
  return sock ? String(sock) : 'unknown';
}

// Both limits for one emailed-code action. The IP is checked first and both are
// counted even for unknown players, so a 429 never tells a caller whether a
// player id exists.
export async function allowEmailAction(kv, action, playerId, req) {
  const ipOk = await hit(kv, `${action}:ip`, clientIp(req), IP_LIMIT, IP_WINDOW_SEC);
  if (!ipOk) return false;
  return hit(kv, `${action}:pid`, playerId || '-', PLAYER_LIMIT, PLAYER_WINDOW_SEC);
}

// The watch-request limits, all counted BEFORE any player lookup so a 429 never
// says whether a player or a code exists: per IP, then per team code (when one
// is sent), then per player id (when one is sent, the older request shape).
// Team codes are compared case-insensitively (hit() lowercases the id).
export async function allowWatchRequest(kv, { playerId, teamCode }, req) {
  if (!(await hit(kv, 'watch-request:ip', clientIp(req), IP_LIMIT, IP_WINDOW_SEC))) return false;
  const team = String(teamCode || '').trim();
  if (team && !(await hit(kv, 'watch-request:team', team, TEAM_LIMIT, TEAM_WINDOW_SEC))) return false;
  const pid = String(playerId || '').trim();
  if (pid && !(await hit(kv, 'watch-request:pid', pid, PLAYER_LIMIT, PLAYER_WINDOW_SEC))) return false;
  return true;
}

// Count one watch-request against a player AFTER the team + code shape found
// them (no id was known before the lookup). Only a caller who already sent a
// correct code can see this 429, so it reveals nothing new; it keeps a correct
// code from flooding that family's inbox. Same bucket as the playerId shape.
export async function allowWatchRequestPlayer(kv, playerId) {
  return hit(kv, 'watch-request:pid', playerId || '-', PLAYER_LIMIT, PLAYER_WINDOW_SEC);
}
