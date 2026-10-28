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
  const player = await resolveSigninPlayer(pid, teamCode);
  if (!player) return res.status(200).json({ ok: true, sent: 0 });

  const kv = getKv();
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

  const claims = verifySession(readSessionCookie(req));
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

function logout(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'method not allowed' }); }
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Set-Cookie', clearSessionCookie({ secure: isSecure(req) }));
  return res.status(200).json({ ok: true });
}

export default async function handler(req, res) {
  const action = String((req.query && req.query.action) || '').toLowerCase();
  if (action === 'request-code') return requestCode(req, res);
  if (action === 'verify') return verify(req, res);
  if (action === 'code-signin') return codeSignin(req, res);
  if (action === 'session') return session(req, res);
  if (action === 'logout') return logout(req, res);
  if (action === 'team-players') return teamPlayers(req, res);
  return res.status(404).json({ error: 'unknown login action' });
}

// Exported for unit tests (call the sub-handlers directly with a query.action-free req).
export const _handlers = { requestCode, verify, codeSignin, session, logout, teamPlayers };
