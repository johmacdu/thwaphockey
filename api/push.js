// api/push.js
//
// Push NOTIFICATION PLUMBING endpoint for Thwap Hockey. ONE serverless function
// (the only one this feature adds) that dispatches on ?action=, keeping the
// Vercel Hobby 12-function cap intact. All token storage + fan-out logic lives in
// lib/push_store.js (import-only, not counted as a function).
//
// Actions:
//   POST ?action=register    { token, platform }   -> store this device's token
//                              (PLAYER session-gated; playerId comes from the
//                               session claims, NEVER the body)
//   POST ?action=unregister  { token }             -> drop this device's token
//                              (PLAYER session-gated, same as register)
//   POST ?action=send        { playerId? | team?, payload }  -> fan a payload out
//                              (ADMIN-ONLY: a manual/admin test trigger; uses the
//                               MOCK sender today, so it delivers nothing yet)
//   GET|POST ?action=status                                 -> per-player token
//                              COUNTS only (ADMIN-ONLY diagnostics read): NEVER
//                              the raw token strings, just tallies + platforms.
//                              Delivers nothing; a pure read of registration state.
//
// SCOPE: this is the SEND MACHINERY plus a manual admin test trigger only. It
// invents no notification copy and no automatic triggers. Push is MOCKED and
// credentials-pending (pushConfigured() === false), which every send response
// echoes so the state is never ambiguous.
//
// Auth:
//   register / unregister  -> the parent/player SESSION cookie (readSessionCookie
//                             + verifySession), the same gate api/board.js and
//                             api/done.js use. The player is the session's own
//                             claim, so a device can only register itself.
//   send                   -> admin, using the SAME contract as api/coach.js
//                             requireAdmin (an admin session token OR the shared
//                             THWAP_ADMIN_TOKEN / WAITLIST_ADMIN_TOKEN env secret).
//                             requireAdmin is not exported from coach.js, so the
//                             identical check is reproduced here against the same
//                             admin:<email> session shape + env secret names.

import { verifySession, readSessionCookie } from '../lib/session_store.js';
import { parseBody } from '../lib/photo_common.js';
import { ROSTER } from '../lib/store.js';
import { listMembers, getAdmin } from '../lib/teams_store.js';
import {
  registerToken, unregisterToken, listTokens, sendToTokens, pushConfigured,
  statusSummary,
} from '../lib/push_store.js';

// --- admin gate (same contract as api/coach.js requireAdmin) ----------------
// An admin SESSION token mints playerId 'admin:<hex(email)>' (coach.js mintAdminToken),
// so an admin token is recognized by that prefix and the hex-decoded email must
// resolve to a real admin record. The shared env key is the legacy fallback.
function hexDecode(s) { return Buffer.from(String(s), 'hex').toString('utf8'); }

function adminFromToken(token) {
  const claims = verifySession(token);
  if (!claims || !String(claims.playerId || '').startsWith('admin:')) return null;
  try { return { email: hexDecode(String(claims.playerId).slice('admin:'.length)) }; }
  catch { return null; }
}

function sharedKeyOk(req) {
  const secret = process.env.THWAP_ADMIN_TOKEN || process.env.WAITLIST_ADMIN_TOKEN || '';
  if (!secret) return false;
  const auth = (req.headers && req.headers.authorization) ? String(req.headers.authorization) : '';
  const bearer = auth.indexOf('Bearer ') === 0 ? auth.slice(7) : '';
  const q = (req.query && (req.query.key || req.query.token)) || '';
  return bearer === secret || String(q) === secret;
}

// True when the request carries valid admin auth. Returns a boolean (the caller
// writes the 401) so method + validation checks can fire BEFORE auth.
async function isAdmin(req) {
  const { adminToken } = parseBody(req);
  const auth = (req.headers && req.headers.authorization) ? String(req.headers.authorization) : '';
  const bearer = auth.indexOf('Bearer ') === 0 ? auth.slice(7) : '';
  const token = adminToken || (req.query && req.query.adminToken) || bearer || '';
  const a = adminFromToken(token);
  if (a && (await getAdmin(a.email))) return true;
  return sharedKeyOk(req);
}

function methodGuard(req, res, want) {
  if (req.method !== want) {
    res.setHeader('Allow', want);
    res.status(405).json({ error: 'method not allowed' });
    return false;
  }
  return true;
}

// POST ?action=register { token, platform }. PLAYER session-gated: the playerId
// is read from the verified session claims, NOT the body, so a device can only
// register a token for the signed-in player.
async function register(req, res) {
  // Method + validation fire BEFORE auth (stored lesson), so a malformed call is
  // a 405/400 regardless of session state.
  if (!methodGuard(req, res, 'POST')) return;
  res.setHeader('Cache-Control', 'no-store');
  const { token, platform } = parseBody(req);
  if (!String(token || '').trim()) return res.status(400).json({ error: 'token required' });
  const claims = verifySession(readSessionCookie(req));
  if (!claims || !claims.playerId) return res.status(401).json({ error: 'sign in required' });
  const ua = (req.headers && (req.headers['user-agent'] || req.headers['User-Agent'])) || '';
  const tokens = await registerToken(claims.playerId, { token, platform, ua });
  return res.status(200).json({ ok: true, count: tokens.length });
}

// POST ?action=unregister { token }. Same PLAYER session gate as register.
async function unregister(req, res) {
  if (!methodGuard(req, res, 'POST')) return;
  res.setHeader('Cache-Control', 'no-store');
  const { token } = parseBody(req);
  if (!String(token || '').trim()) return res.status(400).json({ error: 'token required' });
  const claims = verifySession(readSessionCookie(req));
  if (!claims || !claims.playerId) return res.status(401).json({ error: 'sign in required' });
  const tokens = await unregisterToken(claims.playerId, token);
  return res.status(200).json({ ok: true, count: tokens.length });
}

// Resolve the set of player ids a send targets: an explicit playerId, or every
// member of a team code. Returns a de-duplicated lowercase id array.
async function resolveTargets({ playerId, team }) {
  if (playerId) return [String(playerId).toLowerCase()];
  if (team) {
    const ids = await listMembers(String(team).toUpperCase());
    return Array.from(new Set(ids.map((id) => String(id).toLowerCase())));
  }
  return [];
}

// POST ?action=send { playerId? | team?, payload }. ADMIN-ONLY manual test
// trigger. Fans the payload out to the target players' tokens via the MOCK sender
// (push is credentials-pending), returning the { sent, failed } tally and
// pushConfigured:false so the mocked state is explicit.
async function send(req, res) {
  // Method + validation BEFORE auth (stored lesson).
  if (!methodGuard(req, res, 'POST')) return;
  res.setHeader('Cache-Control', 'no-store');
  const { playerId, team, payload } = parseBody(req);
  if (!playerId && !team) return res.status(400).json({ error: 'playerId or team required' });
  if (!payload || typeof payload !== 'object') return res.status(400).json({ error: 'payload required' });
  if (playerId && !ROSTER.some((p) => p.id === String(playerId).toLowerCase())) {
    return res.status(400).json({ error: 'unknown player' });
  }
  if (!(await isAdmin(req))) return res.status(401).json({ error: 'admin auth required' });

  const targets = await resolveTargets({ playerId, team });
  let tokens = [];
  for (const pid of targets) {
    tokens = tokens.concat(await listTokens(pid));
  }
  const { sent, failed } = await sendToTokens(tokens, payload);
  return res.status(200).json({
    ok: true, sent, failed, players: targets.length, tokens: tokens.length,
    pushConfigured: pushConfigured(),
  });
}

// GET|POST ?action=status. ADMIN-ONLY diagnostics read: returns per-player token
// COUNTS and platform tallies so an operator can see registration state. It
// delivers nothing and NEVER returns a raw token string (a token is
// credential-adjacent). Both GET and POST are accepted so an operator can hit it
// from a browser or a scripted admin call.
async function status(req, res) {
  // Method + validation BEFORE auth (stored lesson): reject anything but GET/POST
  // regardless of admin state.
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method not allowed' });
  }
  res.setHeader('Cache-Control', 'no-store');
  if (!(await isAdmin(req))) return res.status(401).json({ error: 'admin auth required' });

  const summary = await statusSummary(ROSTER.map((p) => p.id));
  return res.status(200).json(summary);
}

export default async function handler(req, res) {
  const action = String((req.query && req.query.action) || '').toLowerCase();
  switch (action) {
    case 'register': return register(req, res);
    case 'unregister': return unregister(req, res);
    case 'send': return send(req, res);
    case 'status': return status(req, res);
    default: return res.status(404).json({ error: 'unknown push action' });
  }
}

// Exported for unit tests (call sub-handlers directly with a query.action-free req).
export const _handlers = { register, unregister, send, status };
