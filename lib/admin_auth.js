// lib/admin_auth.js
//
// Where admin credentials may come from. The legacy shared admin key
// (THWAP_ADMIN_TOKEN / WAITLIST_ADMIN_TOKEN) is accepted ONLY in a request
// header (Authorization: Bearer <key>), never in the URL: a ?key= query string
// lands in browser history, proxy logs and the Vercel request log. The admin
// SESSION token (email + password login) is read from the JSON body
// (adminToken) or the same Bearer header, also never from the URL.

import crypto from 'crypto';

// The Bearer value from the Authorization header, or ''.
export function bearerFrom(req) {
  const h = req && req.headers && (req.headers.authorization || req.headers.Authorization);
  if (!h || typeof h !== 'string' || !h.startsWith('Bearer ')) return '';
  return h.slice(7).trim();
}

export function sharedAdminSecret() {
  return process.env.THWAP_ADMIN_TOKEN || process.env.WAITLIST_ADMIN_TOKEN || '';
}

// Constant-time compare (hash first so the lengths always match).
function sameSecret(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// True when the request carries the shared admin key in the Authorization
// header. A key in the query string is ignored. Fails closed with no secret.
export function sharedKeyOk(req, secret = sharedAdminSecret()) {
  if (!secret) return false;
  const b = bearerFrom(req);
  return !!b && sameSecret(b, secret);
}

// The admin session token candidate: the JSON body field, else the Bearer header.
export function adminTokenFrom(req, body) {
  const t = body && typeof body === 'object' ? body.adminToken : '';
  return (typeof t === 'string' && t) || bearerFrom(req) || '';
}
