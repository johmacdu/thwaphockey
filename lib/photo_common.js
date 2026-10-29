// lib/photo_common.js
//
// Shared bits for the photo endpoints: the Redis client, body parsing, player
// membership (any team), and the "is the service configured" gate. Endpoints stay thin.

import { Redis } from '@upstash/redis';
import { verifySession, readSessionCookie } from './session_store.js';
import { resolvePlayer } from './team_players.js';
import { getMember, parentEmailList } from './teams_store.js';
import { sharedKeyOk, adminTokenFrom } from './admin_auth.js';

// Build the Upstash client from whichever env the integration injected.
export function getKv() {
  return new Redis({
    url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
  });
}

export function parseBody(req) {
  const b = req.body;
  if (!b) return {};
  if (typeof b === 'object') return b;
  if (typeof b === 'string') {
    try { return JSON.parse(b); } catch { return {}; }
  }
  return {};
}

// The photo player, on ANY team (lib/team_players.js): the 16 original Jr.
// Rangers 10U players always resolve, any other player must be on a team's
// members list. Returns { id, name, number, teamCode } or null.
export async function photoPlayer(playerId) {
  return resolvePlayer(playerId);
}

// True when playerId is a known player on any team. ASYNC (it reads the members
// store), so every caller must await it.
export async function isRosterPlayer(playerId) {
  return !!(await resolvePlayer(playerId));
}

// The parent emails ON FILE for a player (the team member record a coach keeps).
// The photo email code only goes to one of these, so typing any address cannot
// stand in for a parent's consent. [] when the player has none on file.
export async function photoParentEmails(playerId) {
  try {
    return parentEmailList(await getMember(String(playerId || '').trim().toLowerCase()));
  } catch {
    return [];
  }
}

// The KV id the photo email code is stored under: bound to BOTH the player and
// the parent email, so a code asked for one player cannot unlock another, and
// namespaced so it never collides with the sign-in code (otp:pid:<id>).
export function photoOtpId(playerId, email) {
  return `photo:${String(playerId || '').trim().toLowerCase()}:${String(email || '').trim().toLowerCase()}`;
}

// The signed-in WEB player behind the thwapSession cookie, or ''. Only the web
// session counts: a watch token, a coach token or an admin token is not a
// player session here (resolvePlayer finds no player for coach:/admin: ids).
export function sessionPlayerId(req) {
  const claims = verifySession(readSessionCookie(req));
  return claims && claims.playerId ? String(claims.playerId).toLowerCase() : '';
}

// Admin auth: accepts the email+password admin SESSION TOKEN (admin: namespaced,
// HMAC-verified) from the adminToken body field or an Authorization: Bearer,
// OR the legacy shared server secret in the Authorization: Bearer header only.
// Nothing is read from the URL (lib/admin_auth.js). Fails closed.
export function adminOk(req) {
  const token = adminTokenFrom(req, parseBody(req));
  const claims = token ? verifySession(token) : null;
  if (claims && String(claims.playerId || '').startsWith('admin:')) return true;
  return sharedKeyOk(req);
}

// Fail closed: the email + token features need these env vars. Missing any of
// them means the service is not set up, so the endpoint answers 503 rather than
// crashing or half-working.
export function emailConfigured() {
  return !!(process.env.RESEND_API_KEY && process.env.PHOTO_FROM_EMAIL && process.env.PHOTO_TOKEN_SECRET);
}
export function uploadConfigured() {
  return !!(process.env.BLOB_READ_WRITE_TOKEN && process.env.PHOTO_TOKEN_SECRET);
}

// Send the code via Resend's REST API (no SDK dependency). Returns true on 2xx.
export async function sendCodeEmail(email, code, playerName) {
  const from = process.env.PHOTO_FROM_EMAIL;
  const key = process.env.RESEND_API_KEY;
  const body = {
    from,
    to: [email],
    subject: 'Your Thwap Hockey photo code',
    text:
      `A parent asked to add or change ${playerName}'s photo on Thwap Hockey.\n\n` +
      `Your one-time code is: ${code}\n\n` +
      `It expires in 10 minutes. If you did not ask for this, you can ignore this email.`,
  };
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return resp.ok;
}
