// lib/photo_common.js
//
// Shared bits for the photo endpoints: the Redis client, body parsing, player
// membership (any team), and the "is the service configured" gate. Endpoints stay thin.

import { Redis } from '@upstash/redis';
import { verifySession, readSessionCookie } from './session_store.js';
import { resolvePlayer } from './team_players.js';
import { getMember, parentEmailList } from './teams_store.js';

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

// --- uploaded image checks -------------------------------------------------
// The client re-encodes through a canvas (which drops metadata), but the server
// must not rely on that: a direct API call can send any bytes. Accept only a
// real JPEG or PNG (magic bytes must match the declared type), and strip every
// metadata block that can carry GPS, camera serials, names or dates.

export const MAX_IMAGE_BYTES = 400 * 1024; // ~400KB cap on the already-downscaled image
const DATA_URL_RE = /^data:image\/(png|jpeg|jpg);base64,([a-zA-Z0-9+/]+=*)$/;
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// JPEG: copy every segment up to the scan except APP1 (EXIF, XMP), APP13
// (Photoshop IPTC) and COM (comments). APP0 (JFIF), APP2 (ICC colour) and
// APP14 (Adobe colour transform) are kept so the image still decodes the same.
// Returns null for anything that is not a well-formed JPEG.
function stripJpeg(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  const out = [buf.subarray(0, 2)];
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) return null;
    let j = i;
    while (j < buf.length && buf[j] === 0xff) j++; // fill bytes
    if (j >= buf.length) return null;
    const marker = buf[j];
    const segStart = j - 1;
    if (marker === 0xd9) { out.push(buf.subarray(segStart, j + 1)); return Buffer.concat(out); }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { out.push(buf.subarray(segStart, j + 1)); i = j + 1; continue; }
    if (j + 2 >= buf.length) return null;
    const len = buf.readUInt16BE(j + 1);
    if (len < 2 || j + 1 + len > buf.length) return null;
    const segEnd = j + 1 + len;
    if (marker === 0xda) { out.push(buf.subarray(segStart)); return Buffer.concat(out); } // scan: rest is image data
    const drop = marker === 0xe1 || marker === 0xed || marker === 0xfe;
    if (!drop) out.push(buf.subarray(segStart, segEnd));
    i = segEnd;
  }
  return null;
}

// PNG: drop the eXIf, tEXt, zTXt, iTXt and tIME chunks; keep everything else.
// Returns null for anything that is not a well-formed PNG.
const PNG_DROP = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);
function stripPng(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIG)) return null;
  const out = [buf.subarray(0, 8)];
  let i = 8;
  let sawEnd = false;
  while (i + 12 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.subarray(i + 4, i + 8).toString('latin1');
    const end = i + 12 + len;
    if (end > buf.length) return null;
    if (!PNG_DROP.has(type)) out.push(buf.subarray(i, end));
    i = end;
    if (type === 'IEND') { sawEnd = true; break; }
  }
  return sawEnd ? Buffer.concat(out) : null;
}

export function stripImageMetadata(buf, ext) {
  if (ext === 'jpeg') return stripJpeg(buf);
  if (ext === 'png') return stripPng(buf);
  return null;
}

// Parse + validate an upload data URL. Returns { buf, ext } (metadata already
// stripped) or { error } with the message the endpoint answers 400 with.
export function cleanImage(imageData) {
  const m = DATA_URL_RE.exec(String(imageData || ''));
  if (!m) return { error: 'bad image' };
  const ext = m[1] === 'jpg' ? 'jpeg' : m[1];
  const raw = Buffer.from(m[2], 'base64');
  if (raw.length === 0 || raw.length > MAX_IMAGE_BYTES) return { error: 'image too big' };
  const buf = stripImageMetadata(raw, ext);
  if (!buf) return { error: 'bad image' };
  return { buf, ext };
}

// Admin auth: accepts the email+password admin SESSION TOKEN (admin: namespaced,
// HMAC-verified) OR the legacy shared server secret. Token is read from the
// adminToken field, ?adminToken=/?key=/?token=, or an Authorization: Bearer.
// Fails closed when neither authorizes.
export function adminOk(req) {
  // 1) admin session token
  const body = parseBody(req);
  const auth = (req.headers && req.headers.authorization) ? String(req.headers.authorization) : '';
  const bearer = auth.indexOf('Bearer ') === 0 ? auth.slice(7) : '';
  const qToken = (req.query && (req.query.adminToken || req.query.token)) || '';
  const token = body.adminToken || qToken || bearer || '';
  const claims = token ? verifySession(token) : null;
  if (claims && String(claims.playerId || '').startsWith('admin:')) return true;
  // 2) legacy shared secret
  const secret = process.env.THWAP_ADMIN_TOKEN || process.env.WAITLIST_ADMIN_TOKEN || '';
  if (!secret) return false;
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
