// api/login.js
//
// Consolidated parent sign-in router (Phase 1 server sessions). One serverless
// function that dispatches on ?action= so the four login actions cost ONE
// function slot instead of four (Vercel Hobby caps a deployment at 12).
//
//   POST /api/login?action=request-code  { playerId }               -> emails a 6-digit code to the
//                                          parent email(s) ON FILE for that player (never a typed one)
//   POST /api/login?action=verify        { playerId, code, keep }    -> checks the code, sets the cookie
//   POST /api/login?action=code-signin   { playerId, code, email, keep } -> verifies the
//                                          jersey+season code (the existing sign-in) and sets
//                                          the HTTP-only cookie. Same UX as today, now server-checked.
//   GET  /api/login?action=session                                   -> { authed, player }
//   GET  /api/login?action=team-players&code=<TEAMCODE>              -> { ok, team:{name},
//                                          players:[{id, firstName, number}] } for a name
//                                          picker (no last names, emails or photos)
//
// Players resolve from the multi-team members store (lib/signin_players.js), so
// a player on any team can sign in. The 16 original Jr. Rangers 10U players
// fall back to the built-in ROSTER. request-code, verify and code-signin accept
// an optional teamCode; when sent, the player must be on that team.
//   POST /api/login?action=logout                                    -> clears the cookie
//                                          (and removes the watch from the list when
//                                          the caller is a signed-in watch)
//
// Apple Watch parent approval (docs/apple-watch-design.md section 6, Option B;
// storage and tokens in lib/watch_store.js):
//   POST /api/login?action=watch-request { playerId, code, teamCode?, deviceLabel }
//                                          -> { ok, requestId, sent } and emails each
//                                          parent on file an Approve link. 401 on a bad
//                                          jersey code (or an unknown player, same answer)
//   GET  /api/login?action=watch-status&requestId=
//                                          -> { status: pending|approved|denied|expired,
//                                          token?, exp?, player? }; the token is handed
//                                          out once, then the request is gone
//   GET  /api/login?action=watch-approve&t= -> what is being approved (does NOT approve,
//                                          so an email scanner prefetching the link is harmless)
//   POST /api/login?action=watch-approve { t, decision: 'approve'|'deny' }
//                                          -> single use, 15-minute link; approve issues a
//                                          30-day watch session and records parent consent
//   GET  /api/login?action=watch-list&t=<manage link>  -> { ok, player, watches }
//   POST /api/login?action=watch-revoke { t: <manage link>, deviceId }  -> { ok, removed }
//
// Rate limits (lib/rate_limit.js): request-code and watch-request each allow 3
// per player per 15 minutes and 10 per IP per hour, counted before the player is
// looked up so a 429 says nothing about whether a player exists.
//
// Behavior is identical to the previous api/login/<action>.js files; only the
// packaging changed. Reuses the photo flow's OTP + rate-limit + mail + consent
// helpers. Env: RESEND_API_KEY, PHOTO_FROM_EMAIL, PHOTO_TOKEN_SECRET,
// KV_REST_API_* / UPSTASH_REDIS_REST_*, and SESSION_TOKEN_SECRET (falls back to
// PHOTO_TOKEN_SECRET).

import { getKv, parseBody, emailConfigured } from '../lib/photo_common.js';
import { checkAndBumpRate, putOtp, randomCode, checkOtp, recordConsent } from '../lib/photo_store.js';
import {
  mintSession, verifySession, sessionCookie, clearSessionCookie,
  readSessionCookie, sessionConfigured,
} from '../lib/session_store.js';
import { resolveSigninPlayer, listTeamPlayersPublic } from '../lib/signin_players.js';
import { getMember, parentEmailList } from '../lib/teams_store.js';
import { allowEmailAction } from '../lib/rate_limit.js';
import { sha256 } from '../lib/photo_store.js';
import {
  sessionClaims, cleanLabel, createWatchRequest, pollWatchRequest, peekApproval,
  decideApproval, mintManageToken, verifyManageToken, listWatches, revokeWatch,
  watchClaimsLive,
} from '../lib/watch_store.js';

// The player sign-in code is the jersey number followed by a season year. Both
// the current (2026-27) and prior year are accepted, mirroring the client check.
const CODE_SEASONS = ['2026', '2027'];

// Email a one-time SIGN-IN code (distinct copy from the photo-consent code).
async function sendLoginCode(email, code, playerName) {
  const from = process.env.PHOTO_FROM_EMAIL;
  const key = process.env.RESEND_API_KEY;
  if (!from || !key) return false;
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from, to: [email],
        subject: 'Your Thwap Hockey sign-in code',
        text:
          `Here is the sign-in code for ${playerName} on Thwap Hockey.\n\n` +
          `Your one-time code is: ${code}\n\n` +
          `It expires in 10 minutes. If you did not ask to sign in, you can ignore this email.`,
      }),
    });
    return resp.ok;
  } catch (e) {
    return false;
  }
}

function tooMany(res) {
  return res.status(429).json({ error: 'too many requests, try again later' });
}

// Links in emails always point at the real site, never at the request's Host
// header (a forged Host would otherwise send the parent's Approve link to
// someone else's server).
function siteBase() {
  return String(process.env.SITE_URL || 'https://thwaphockey.com').replace(/\/+$/, '');
}

// The parent's watch approval email. Plain text, no em-dashes or middots.
export function watchEmailText({ name, label, approveUrl, manageUrl }) {
  return (
    `${name} wants to use Thwap Hockey on a watch ("${label}").\n\n` +
    `To approve this watch, open this link and tap Approve:\n${approveUrl}\n\n` +
    `The link works once and expires in 15 minutes. After you approve, ${name} can use Thwap on this watch for 30 days without asking again.\n\n` +
    `If you did not expect this, ignore this email. Nothing happens unless you tap Approve.\n\n` +
    `To see or remove watches signed in as ${name}:\n${manageUrl}\n`
  );
}

async function sendWatchEmail(email, fields) {
  const from = process.env.PHOTO_FROM_EMAIL;
  const key = process.env.RESEND_API_KEY;
  if (!from || !key) return false;
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from, to: [email],
        subject: `Approve ${fields.name}'s watch for Thwap Hockey`,
        text: watchEmailText(fields),
      }),
    });
    return resp.ok;
  } catch (e) {
    return false;
  }
}

function isSecure(req) {
  return String(req.headers['x-forwarded-proto'] || '').includes('https') || true;
}

// POST { playerId } -> emails a one-time code to the parent email(s) ON FILE for
// that player (never to a caller-supplied address), keyed by the player so any
// parent's inbox can complete the sign-in. Always answers ok (with a count of how
// many emails were sent) so it cannot be used to probe the roster.
async function requestCode(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'method not allowed' }); }
  res.setHeader('Cache-Control', 'no-store');
  if (!emailConfigured()) return res.status(503).json({ error: 'login not configured' });

  const { playerId, teamCode } = parseBody(req);
  const pid = String(playerId || '').toLowerCase();
  const kv = getKv();
  // Counted for every call, known player or not, so a 429 cannot probe the roster.
  if (!(await allowEmailAction(kv, 'request-code', pid, req))) return tooMany(res);
  const player = await resolveSigninPlayer(pid, teamCode);
  if (!player) return res.status(200).json({ ok: true, sent: 0 });

  const allowed = await checkAndBumpRate(kv, 'pid:' + pid);
  if (!allowed) return res.status(429).json({ error: 'too many requests, try again later' });

  const member = await getMember(pid);
  const emails = member ? parentEmailList(member) : [];
  if (!emails.length) return res.status(200).json({ ok: true, sent: 0 });

  const code = randomCode();
  await putOtp(kv, 'pid:' + pid, code);
  let sent = 0;
  for (const em of emails) { if (await sendLoginCode(em, code, player.name || 'your player')) sent += 1; }
  return res.status(200).json({ ok: true, sent });
}

async function verify(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'method not allowed' }); }
  if (!emailConfigured() || !sessionConfigured()) return res.status(503).json({ error: 'login not configured' });

  const { playerId, code, keep, teamCode } = parseBody(req);
  const pid = String(playerId || '').toLowerCase();
  const player = await resolveSigninPlayer(pid, teamCode);
  if (!player || !/^\d{6}$/.test(String(code || ''))) {
    return res.status(400).json({ error: 'bad input' });
  }

  const kv = getKv();
  res.setHeader('Cache-Control', 'no-store');
  const result = await checkOtp(kv, 'pid:' + pid, String(code));
  if (result !== 'ok') return res.status(401).json({ error: 'bad code', reason: result });

  // Consent anchor: the primary on-file parent email.
  const member = await getMember(pid);
  const emails = member ? parentEmailList(member) : [];
  const consentEmail = emails[0] || '';
  if (consentEmail) await recordConsent(kv, pid, consentEmail);
  const token = mintSession(pid, consentEmail);
  if (!token) return res.status(503).json({ error: 'login not configured' });
  res.setHeader('Set-Cookie', sessionCookie(token, { keep: !!keep, secure: isSecure(req) }));

  return res.status(200).json({ ok: true, player: { id: player.id, name: player.name, number: player.number } });
}

// Phase 1 server sessions. The player types the SAME code they use today (jersey
// number + season year, e.g. #72 in 2026-27 -> "722027"). We verify it on the
// SERVER and issue the HTTP-only session cookie, so the session cannot be forged
// and write endpoints can trust who the caller is. The player's UX is unchanged.
async function codeSignin(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'method not allowed' }); }
  res.setHeader('Cache-Control', 'no-store');
  if (!sessionConfigured()) return res.status(503).json({ error: 'sessions not configured' });

  const { playerId, code, email, keep, teamCode } = parseBody(req);
  const pid = String(playerId || '').toLowerCase();
  const player = await resolveSigninPlayer(pid, teamCode);
  if (!player) return res.status(400).json({ error: 'unknown player' });

  const c = String(code || '').trim();
  const ok = player.numbers.some((n) => CODE_SEASONS.some((y) => c === `${n}${y}`));
  if (!ok) return res.status(401).json({ error: 'bad code' });

  const token = mintSession(pid, String(email || '').toLowerCase());
  if (!token) return res.status(503).json({ error: 'sessions not configured' });
  res.setHeader('Set-Cookie', sessionCookie(token, { keep: !!keep, secure: isSecure(req) }));
  return res.status(200).json({ ok: true, player: { id: player.id, name: player.name, number: player.number } });
}

async function session(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'method not allowed' }); }
  res.setHeader('Cache-Control', 'no-store');
  if (!sessionConfigured()) return res.status(200).json({ authed: false });

  const claims = await sessionClaims(req, getKv());
  if (!claims) return res.status(200).json({ authed: false });
  const player = await resolveSigninPlayer(claims.playerId);
  return res.status(200).json({
    authed: true,
    player: player ? { id: player.id, name: player.name, number: player.number } : { id: claims.playerId },
  });
}

// GET ?code=<TEAMCODE> -> the team's players for a name picker. Public (only a
// team code is needed), so it returns first name + jersey number ONLY.
async function teamPlayers(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'method not allowed' }); }
  res.setHeader('Cache-Control', 'no-store');
  const code = String((req.query && req.query.code) || '').trim();
  if (!code) return res.status(400).json({ error: 'team code required' });
  const out = await listTeamPlayersPublic(code);
  if (!out) return res.status(404).json({ error: 'unknown team' });
  return res.status(200).json({ ok: true, team: out.team, players: out.players });
}

async function logout(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'method not allowed' }); }
  res.setHeader('Cache-Control', 'no-store');
  // A watch signing out also drops off the parent's watch list, so its token is
  // dead on the server too, not just deleted from the watch.
  const token = readSessionCookie(req);
  if (sessionConfigured() && /^[^.]+\.w[0-9a-f]{32}\./.test(token)) {
    const kv = getKv();
    const w = await watchClaimsLive(kv, token);
    if (w) await revokeWatch(kv, w.playerId, w.deviceId);
  }
  res.setHeader('Set-Cookie', clearSessionCookie({ secure: isSecure(req) }));
  return res.status(200).json({ ok: true });
}

// --- Apple Watch parent approval -------------------------------------------

const publicPlayer = (p) => ({ id: p.id, name: p.name, number: p.number });

// POST { playerId, code, teamCode?, deviceLabel } from the watch.
async function watchRequest(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'method not allowed' }); }
  res.setHeader('Cache-Control', 'no-store');
  if (!emailConfigured() || !sessionConfigured()) return res.status(503).json({ error: 'login not configured' });

  const { playerId, code, teamCode, deviceLabel } = parseBody(req);
  const pid = String(playerId || '').trim().toLowerCase();
  const kv = getKv();
  // Before the jersey code check, so the limit also caps code guessing.
  if (!(await allowEmailAction(kv, 'watch-request', pid, req))) return tooMany(res);

  const player = await resolveSigninPlayer(pid, teamCode);
  const c = String(code || '').trim();
  const codeOk = !!player && player.numbers.some((n) => CODE_SEASONS.some((y) => c === `${n}${y}`));
  // An unknown player and a wrong code get the same answer.
  if (!codeOk) return res.status(401).json({ error: 'bad code' });

  const member = await getMember(pid);
  const emails = member ? parentEmailList(member) : [];
  const label = cleanLabel(deviceLabel);
  const { requestId, approvals } = await createWatchRequest(kv, { playerId: pid, label, emails });
  const name = player.name || 'Your player';
  const base = siteBase();
  let sent = 0;
  for (const a of approvals) {
    const manage = mintManageToken(pid);
    const ok = await sendWatchEmail(a.email, {
      name, label,
      approveUrl: `${base}/watch-approve#t=${a.token}`,
      manageUrl: `${base}/watch-approve#m=${manage}`,
    });
    if (ok) sent += 1;
  }
  // sent is true/false only: never an address, never how many parents are on file.
  return res.status(200).json({ ok: true, requestId, sent: sent > 0 });
}

// GET ?requestId= from the watch, every few seconds while it waits.
async function watchStatus(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'method not allowed' }); }
  res.setHeader('Cache-Control', 'no-store');
  if (!sessionConfigured()) return res.status(503).json({ error: 'login not configured' });
  const requestId = String((req.query && req.query.requestId) || '');
  const out = await pollWatchRequest(getKv(), requestId);
  if (out.status !== 'approved') return res.status(200).json({ status: out.status });
  const player = await resolveSigninPlayer(out.playerId);
  return res.status(200).json({
    status: 'approved',
    token: out.token,
    exp: out.exp,
    player: player ? publicPlayer(player) : { id: out.playerId },
  });
}

// GET ?t= shows what is being approved. POST { t, decision } decides.
async function watchApprove(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!sessionConfigured()) return res.status(503).json({ error: 'login not configured' });
  const kv = getKv();
  if (req.method === 'GET') {
    const t = String((req.query && req.query.t) || '');
    const peek = await peekApproval(kv, t);
    if (!peek) return res.status(200).json({ ok: false, status: 'expired' });
    const player = await resolveSigninPlayer(peek.request.pid);
    return res.status(200).json({
      ok: true,
      status: 'pending',
      player: { name: player ? player.name : peek.request.pid },
      deviceLabel: peek.request.label,
      expiresAt: peek.request.expiresAt,
    });
  }
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ error: 'method not allowed' }); }

  const { t, decision } = parseBody(req);
  const tok = String(t || '');
  const want = decision === 'approve' ? 'approve' : decision === 'deny' ? 'deny' : '';
  if (!want) return res.status(400).json({ error: 'bad decision' });

  const peek = await peekApproval(kv, tok);
  if (!peek) return res.status(200).json({ ok: false, status: 'expired' });
  const player = await resolveSigninPlayer(peek.request.pid);
  // Consent anchor: the link must have gone to an email that is STILL on file.
  let consentEmail = '';
  if (want === 'approve') {
    const member = await getMember(peek.request.pid);
    const emails = member ? parentEmailList(member) : [];
    consentEmail = emails.find((e) => sha256(String(e).toLowerCase()) === peek.approve.emailHash) || '';
    if (!player || !consentEmail) return res.status(200).json({ ok: false, status: 'expired' });
  }

  const out = await decideApproval(kv, tok, want);
  if (!out) return res.status(200).json({ ok: false, status: 'expired' });
  if (out.status === 'denied') return res.status(200).json({ ok: true, status: 'denied' });
  await recordConsent(kv, peek.request.pid, consentEmail);
  return res.status(200).json({
    ok: true,
    status: 'approved',
    player: { name: player.name },
    deviceLabel: peek.request.label,
    manage: mintManageToken(peek.request.pid),
  });
}

// GET ?t=<manage link> -> the player's approved watches.
async function watchList(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'method not allowed' }); }
  res.setHeader('Cache-Control', 'no-store');
  if (!sessionConfigured()) return res.status(503).json({ error: 'login not configured' });
  const cap = verifyManageToken(String((req.query && req.query.t) || ''));
  if (!cap) return res.status(401).json({ error: 'link expired' });
  const player = await resolveSigninPlayer(cap.playerId);
  const watches = await listWatches(getKv(), cap.playerId);
  return res.status(200).json({ ok: true, player: { name: player ? player.name : cap.playerId }, watches });
}

// POST { t: <manage link>, deviceId } -> removes that watch now.
async function watchRevoke(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'method not allowed' }); }
  res.setHeader('Cache-Control', 'no-store');
  if (!sessionConfigured()) return res.status(503).json({ error: 'login not configured' });
  const { t, deviceId } = parseBody(req);
  const cap = verifyManageToken(String(t || ''));
  if (!cap) return res.status(401).json({ error: 'link expired' });
  if (!/^[0-9a-f]{32}$/.test(String(deviceId || ''))) return res.status(400).json({ error: 'bad device' });
  const removed = await revokeWatch(getKv(), cap.playerId, String(deviceId));
  return res.status(200).json({ ok: true, removed });
}

export default async function handler(req, res) {
  const action = String((req.query && req.query.action) || '').toLowerCase();
  if (action === 'request-code') return requestCode(req, res);
  if (action === 'verify') return verify(req, res);
  if (action === 'code-signin') return codeSignin(req, res);
  if (action === 'session') return session(req, res);
  if (action === 'logout') return logout(req, res);
  if (action === 'team-players') return teamPlayers(req, res);
  if (action === 'watch-request') return watchRequest(req, res);
  if (action === 'watch-status') return watchStatus(req, res);
  if (action === 'watch-approve') return watchApprove(req, res);
  if (action === 'watch-list') return watchList(req, res);
  if (action === 'watch-revoke') return watchRevoke(req, res);
  return res.status(404).json({ error: 'unknown login action' });
}

// Exported for unit tests (call the sub-handlers directly with a query.action-free req).
export const _handlers = {
  requestCode, verify, codeSignin, session, logout, teamPlayers,
  watchRequest, watchStatus, watchApprove, watchList, watchRevoke,
};
