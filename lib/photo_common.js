// lib/photo_common.js
//
// Shared bits for the photo endpoints: the Redis client, body parsing, roster
// membership, and the "is the service configured" gate. Endpoints stay thin.

import { Redis } from '@upstash/redis';
import { ROSTER } from './store.js';

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

export function isRosterPlayer(playerId) {
  const wanted = String(playerId || '').toLowerCase();
  return ROSTER.some((p) => p.id === wanted);
}

// Admin auth: same server secret admin.html + coach.js already use. Accepts the
// token as a Bearer header or ?key=/?token= query param. Fails closed when unset.
export function adminOk(req) {
  const secret = process.env.THWAP_ADMIN_TOKEN || process.env.WAITLIST_ADMIN_TOKEN || '';
  if (!secret) return false;
  const auth = (req.headers && req.headers.authorization) ? String(req.headers.authorization) : '';
  const bearer = auth.indexOf('Bearer ') === 0 ? auth.slice(7) : '';
  const q = (req.query && (req.query.key || req.query.token)) || '';
  return bearer === secret || String(q) === secret;
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
