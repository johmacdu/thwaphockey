// api/login.js
//
// Consolidated parent sign-in router (Phase 1 server sessions). One serverless
// function that dispatches on ?action= so the four login actions cost ONE
// function slot instead of four (Vercel Hobby caps a deployment at 12).
//
//   POST /api/login?action=request-code  { playerId }               -> emails a 6-digit code to the
//                                          parent email(s) ON FILE for that player (never a typed one)
//   POST /api/login?action=verify        { playerId, code, keep }    -> checks the code, sets the cookie
//   POST /api/login?action=code-signin   { playerId, code, email, keep, teamCode?, quiet? }
//                                          -> checks the jersey+season code. A browser the parent
//                                          already approved (remembered-device cookie) or one that
//                                          already holds a valid session for this player gets the
//                                          HTTP-only session cookie. A NEW browser does not: the
//                                          server emails the parent(s) on file a one-time code and
//                                          answers { needsParentCode: true, sent }; the client then
//                                          calls verify with that code. quiet=true (the silent
//                                          self-heal) never emails. A matching code with no parent
//                                          email on file answers { needsParentEmail: true }.
//                                          Every failure (unknown player, wrong code, missing field)
//                                          is the same 401 { error: 'bad code' }.
//   GET  /api/login?action=session                                   -> { authed, player }
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
//   POST /api/login?action=watch-request { teamCode, code, deviceLabel }
//                                          (older shape { playerId, code, teamCode?,
//                                          deviceLabel } still accepted)
//                                          -> { ok, requestId, sent } and emails each
//                                          parent on file an Approve link. The team +
//                                          code shape finds the ONE player on that team
//                                          whose jersey code matches. 401 'bad code' for
//                                          a wrong code, an unknown team or player, or two
//                                          players sharing that number (never picks one)
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
// Rate limits (lib/rate_limit.js): request-code, watch-request and code-signin
// each allow 3 per player per 15 minutes and 10 per IP per hour; watch-request
// and code-signin also allow 20 per team code per hour (code-signin counts a
// request with no team code against the Jr. Rangers 10U bucket). IP, team and (when sent) player id are counted before
// the player is looked up, so a 429 says nothing about whether a player exists.
//
// There is no public team player list: team codes are not secret, so a list
// keyed only by a team code would hand anyone first names and jersey numbers.
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
  readSessionCookie, sessionConfigured, refreshSession,
  mintDeviceToken, deviceCookie, deviceRemembered,
} from '../lib/session_store.js';
import {
  resolveSigninPlayer, findPlayerByTeamCode, codeMatches, RANGERS_TEAM_CODE,
} from '../lib/signin_players.js';
import { getMember, getTeam, parentEmailList } from '../lib/teams_store.js';
import {
  allowEmailAction, allowWatchRequest, allowWatchRequestPlayer, allowCodeSignin,
} from '../lib/rate_limit.js';
import { sha256 } from '../lib/photo_store.js';
import {
  sessionClaims, cleanLabel, createWatchRequest, pollWatchRequest, peekApproval,
  decideApproval, mintManageToken, verifyManageToken, listWatches, revokeWatch,
  watchClaimsLive,
} from '../lib/watch_store.js';

// The player sign-in code is the jersey number followed by a season year. Both
// the current (2026-27) and prior year are accepted, mirroring the client check.
// CODE_SEASONS and codeMatches live in lib/signin_players.js.

// The parent email for a NEW browser (code-signin with a correct player code on
// a device the parent has not approved). Plain text, no em-dashes or middots.
export function newDeviceEmailText({ name, code }) {
  return (
    `${name} is signing in to Thwap Hockey on a new device.\n\n` +
    `To let them in, enter this one-time code on the sign-in screen. Your one-time code is: ${code}\n\n` +
    `It works once and expires in 10 minutes. If Keep me signed in is on, that device will not ask again for 30 days.\n\n` +
    `If you did not expect this, ignore this email. Nobody can sign in as ${name} on that device without this code.\n`
  );
}

// Email a one-time SIGN-IN code (distinct copy from the photo-consent code).
// newDevice picks the new-device copy above; otherwise the plain sign-in code.
async function sendLoginCode(email, code, playerName, { newDevice = false } = {}) {
  const from = process.env.PHOTO_FROM_EMAIL;
  const key = process.env.RESEND_API_KEY;
  if (!from || !key) return false;
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from, to: [email],
        subject: newDevice
          ? `${playerName} is signing in on a new device`
          : 'Your Thwap Hockey sign-in code',
        text: newDevice
          ? newDeviceEmailText({ name: playerName, code })
          : `Here is the sign-in code for ${playerName} on Thwap Hockey.\n\n` +
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
  res.setHeader('Cache-Control', 'no-store');
  // An unknown player and a malformed code look exactly like a player with no
  // code pending, so verify cannot be used to probe the roster either.
  const player = /^\d{6}$/.test(String(code || '')) ? await resolveSigninPlayer(pid, teamCode) : null;
  if (!player) return res.status(401).json({ error: 'bad code', reason: 'none' });

  const kv = getKv();
  const result = await checkOtp(kv, 'pid:' + pid, String(code));
  if (result !== 'ok') return res.status(401).json({ error: 'bad code', reason: result });

  // Consent anchor: the primary on-file parent email.
  const member = await getMember(pid);
  const emails = member ? parentEmailList(member) : [];
  const consentEmail = emails[0] || '';
  if (consentEmail) await recordConsent(kv, pid, consentEmail);
  const token = mintSession(pid, consentEmail);
  if (!token) return res.status(503).json({ error: 'login not configured' });
  const cookies = [sessionCookie(token, { keep: !!keep, secure: isSecure(req) })];
  // The parent just approved this browser. With Keep me signed in, remember it
  // for this player so the player code alone works here for 30 days. A shared
  // computer (keep off) is never remembered.
  if (keep) {
    const dev = mintDeviceToken(pid);
    if (dev) cookies.push(deviceCookie(pid, dev, { secure: isSecure(req) }));
  }
  res.setHeader('Set-Cookie', cookies.length === 1 ? cookies[0] : cookies);

  return res.status(200).json({ ok: true, player: { id: player.id, name: player.name, number: player.number } });
}

// Web sign-in with the player code (jersey number + season year, e.g. #72 in
// 2026-27 -> "722027"). The code is guessable, so it is NOT enough on its own:
//   1. A browser that already holds a valid session for this player just gets a
//      fresh one (current users are never pushed back through the parent step).
//   2. Otherwise every call is rate limited per IP, per team and per player
//      BEFORE the lookup, and every failure is the same 401 'bad code'.
//   3. A correct code on a browser the parent approved before (remembered-device
//      cookie set at verify) gets a session.
//   4. A correct code on a NEW browser gets no session. The parent(s) on file
//      are emailed a one-time code and the client asks for it (verify).
async function codeSignin(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'method not allowed' }); }
  res.setHeader('Cache-Control', 'no-store');
  if (!sessionConfigured()) return res.status(503).json({ error: 'sessions not configured' });

  const { playerId, code, keep, teamCode, quiet } = parseBody(req);
  let pid = String(playerId || '').trim().toLowerCase();
  const team = String(teamCode || '').trim().toUpperCase();
  const kv = getKv();
  const secure = isSecure(req);
  let teamName = '';
  const publicP = (p) => ({ id: p.id, name: p.name, number: p.number, teamCode: p.teamCode, teamName });
  const loadTeamName = async (p) => { try { const t = p ? await getTeam(p.teamCode) : null; teamName = (t && t.name) || ''; } catch { teamName = ''; } };

  // A kid on any team signs in with their team code plus their own code, and no
  // player id (the browser only knows the built-in Jr. Rangers list). Find the
  // one player on that team whose code matches; two kids sharing a number on one
  // team is refused exactly like a wrong code. Spend a limit first.
  let limited = false;
  if (!pid && team) {
    if (!(await allowCodeSignin(kv, { playerId: `team:${team}`, teamCode: team }, req))) return tooMany(res);
    limited = true;
    const hit = await findPlayerByTeamCode(team, code);
    if (!hit) return res.status(401).json({ error: 'bad code' });
    pid = hit.id;
  }

  // 1. Already signed in as this player on this browser (a web session, not a
  // watch token). Proof is the signed cookie itself, so no limit is spent.
  const claims = pid ? await sessionClaims(req, kv) : null;
  if (claims && claims.kind === 'web' && claims.playerId === pid) {
    const p = await resolveSigninPlayer(pid, team || undefined);
    if (codeMatches(p, code)) {
      await loadTeamName(p);
      const token = refreshSession(claims);
      if (token) res.setHeader('Set-Cookie', sessionCookie(token, { keep: !!keep, secure }));
      return res.status(200).json({ ok: true, player: publicP(p) });
    }
  }

  // 2. Limits first, then one answer for every failure.
  if (!limited && !(await allowCodeSignin(kv, { playerId: pid, teamCode: team || RANGERS_TEAM_CODE }, req))) return tooMany(res);
  const player = pid ? await resolveSigninPlayer(pid, team || undefined) : null;
  if (!player || !codeMatches(player, code)) return res.status(401).json({ error: 'bad code' });
  await loadTeamName(player);

  const member = await getMember(pid);
  const emails = member ? parentEmailList(member) : [];

  // 3. A browser the parent already approved for this player.
  if (deviceRemembered(req, pid)) {
    const token = mintSession(pid, emails[0] || '');
    if (!token) return res.status(503).json({ error: 'sessions not configured' });
    res.setHeader('Set-Cookie', sessionCookie(token, { keep: !!keep, secure }));
    return res.status(200).json({ ok: true, player: publicP(player) });
  }

  // 4. A new browser needs the parent. The code matched, so saying why is safe.
  if (!emails.length) return res.status(200).json({ ok: false, needsParentEmail: true });
  if (quiet) return res.status(200).json({ ok: false, needsParentCode: true, sent: false });
  if (!emailConfigured()) return res.status(503).json({ error: 'login not configured' });
  // Shares request-code's per-player email budget (5 per hour), so resend and
  // repeat sign-ins together cannot flood a family's inbox.
  if (!(await checkAndBumpRate(kv, 'pid:' + pid))) return tooMany(res);
  const otp = randomCode();
  await putOtp(kv, 'pid:' + pid, otp);
  let sent = 0;
  for (const em of emails) {
    if (await sendLoginCode(em, otp, player.name || 'Your player', { newDevice: true })) sent += 1;
  }
  return res.status(200).json({ ok: false, needsParentCode: true, sent: sent > 0, player: publicP(player) });
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

// POST { teamCode, code, deviceLabel } from the watch (or the older
// { playerId, code, teamCode?, deviceLabel }).
async function watchRequest(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'method not allowed' }); }
  res.setHeader('Cache-Control', 'no-store');
  if (!emailConfigured() || !sessionConfigured()) return res.status(503).json({ error: 'login not configured' });

  const { playerId, code, teamCode, deviceLabel } = parseBody(req);
  const asked = String(playerId || '').trim().toLowerCase();
  const team = String(teamCode || '').trim().toUpperCase();
  const kv = getKv();
  // Before the jersey code check, so the limits also cap code guessing.
  if (!(await allowWatchRequest(kv, { playerId: asked, teamCode: team }, req))) return tooMany(res);

  let player = null;
  if (asked) {
    const p = await resolveSigninPlayer(asked, team || undefined);
    player = codeMatches(p, code) ? p : null;
  } else if (team) {
    player = await findPlayerByTeamCode(team, code);
  }
  // A wrong code, an unknown team or player, and two players sharing a number
  // all get the same answer.
  if (!player) return res.status(401).json({ error: 'bad code' });
  // The team + code shape had no player id to count before the lookup.
  if (!asked && !(await allowWatchRequestPlayer(kv, player.id))) return tooMany(res);
  const pid = player.id;

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
  if (action === 'watch-request') return watchRequest(req, res);
  if (action === 'watch-status') return watchStatus(req, res);
  if (action === 'watch-approve') return watchApprove(req, res);
  if (action === 'watch-list') return watchList(req, res);
  if (action === 'watch-revoke') return watchRevoke(req, res);
  return res.status(404).json({ error: 'unknown login action' });
}

// Exported for unit tests (call the sub-handlers directly with a query.action-free req).
export const _handlers = {
  requestCode, verify, codeSignin, session, logout,
  watchRequest, watchStatus, watchApprove, watchList, watchRevoke,
};
