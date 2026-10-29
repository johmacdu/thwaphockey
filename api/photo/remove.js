// api/photo/remove.js
//
// POST (Authorization: Bearer <uploadToken>) { playerId } -> deletes the photo
//   and withdraws its PHOTO consent (photoConsent:<player>). The sign-in consent
//   record (consent:<player>, api/login.js) is never touched here.
//
// POST (admin)  { all: true }                                   -> DRY RUN
// POST (admin)  { all: true, confirm: 'DELETE ALL PLAYER PHOTOS' } -> deletes
//   Retires every stored player photo once the character has replaced them
//   (docs/avatar-roadmap.md). For each player on every team: deletes the blob, the
//   photo record and the PHOTO consent record (never the sign-in consent). Without the exact confirm
//   phrase it only reports what WOULD be deleted, so the admin page can show the
//   list first. Lives in this file (not a new one) to stay under the Vercel
//   Hobby 12-function cap.
//
// POST (admin)  { orphans: true }                                  -> DRY RUN
// POST (admin)  { orphans: true, confirm: 'DELETE ORPHANED PHOTOS' } -> deletes
//   One-time cleanup of photo files left in Blob storage by replacements made
//   before PR #488 (which started deleting the old file). Lists every object
//   under photos/ and keeps any that a current photo record points at (every
//   photo:<player> key in the store, plus every player on every team). Only the
//   rest are orphans. Without the exact confirm phrase it deletes nothing and
//   returns the list and count. If the referenced set cannot be read, it stops
//   with a 500 and deletes nothing.

import { del, list } from '@vercel/blob';
import { getKv, parseBody, uploadConfigured, adminOk } from '../../lib/photo_common.js';
import { verifyToken, getPhoto, removePhoto, getPhotoConsent, removePhotoConsent } from '../../lib/photo_store.js';
import { ROSTER } from '../../lib/store.js';
import { listAllTeamCodes } from '../../lib/teams_store.js';
import { teamPlayerIds } from '../../lib/team_players.js';

// Every known player id: the Jr. Rangers 10U ROSTER first, then each team's
// members, deduped. The retire sweep covers every team, not only the 16.
async function allPlayerIds() {
  let ids = ROSTER.map((p) => p.id);
  for (const code of await listAllTeamCodes()) ids = ids.concat(await teamPlayerIds(code));
  return Array.from(new Set(ids));
}

export const RETIRE_CONFIRM = 'DELETE ALL PLAYER PHOTOS';
export const ORPHAN_CONFIRM = 'DELETE ORPHANED PHOTOS';
export const ORPHAN_PREFIX = 'photos/';

// Every blob a current photo record points at, by url AND by pathname. Reads
// both every photo:<player> key in the store (so a player who left every team
// but still has a record keeps the file) and every known player id.
async function referencedPhotos(kv) {
  const refs = new Set();
  const add = (rec) => {
    if (!rec || typeof rec !== 'object') return;
    if (rec.url) {
      refs.add(String(rec.url));
      try { refs.add(new URL(String(rec.url)).pathname.replace(/^\//, '')); } catch { /* not a url */ }
    }
    if (rec.key) refs.add(String(rec.key));
  };
  let cursor = '0';
  do {
    const [next, keys] = await kv.scan(cursor, { match: 'photo:*', count: 500 });
    for (const k of keys || []) {
      if (String(k).split(':').length !== 2) continue; // photo:<player> only
      add(await kv.get(k));
    }
    cursor = String(next);
  } while (cursor !== '0');
  for (const id of await allPlayerIds()) add(await getPhoto(kv, id));
  return refs;
}

async function listPhotoBlobs() {
  const out = [];
  let cursor;
  do {
    const page = await list({ prefix: ORPHAN_PREFIX, cursor, limit: 1000, token: process.env.BLOB_READ_WRITE_TOKEN });
    for (const b of page.blobs || []) out.push(b);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out;
}

async function sweepOrphans(req, res, body) {
  res.setHeader('Cache-Control', 'no-store');
  const doIt = body.confirm === ORPHAN_CONFIRM;
  let refs;
  let blobs;
  try {
    refs = await referencedPhotos(getKv());
    blobs = await listPhotoBlobs();
  } catch {
    return res.status(500).json({ error: 'could not read photo records or storage; nothing was deleted' });
  }
  const orphans = blobs
    .filter((b) => b && b.url && !refs.has(String(b.url)) && !refs.has(String(b.pathname || '')))
    .map((b) => ({ pathname: b.pathname, url: b.url, size: b.size, uploadedAt: b.uploadedAt }));
  let deleted = 0;
  if (doIt) {
    for (let i = 0; i < orphans.length; i += 100) {
      const chunk = orphans.slice(i, i + 100).map((o) => o.url);
      await del(chunk, { token: process.env.BLOB_READ_WRITE_TOKEN });
      deleted += chunk.length;
    }
  }
  return res.status(200).json({ dryRun: !doIt, count: orphans.length, deleted, scanned: blobs.length, orphans });
}

async function retireAll(req, res, body) {
  const kv = getKv();
  const doIt = body.confirm === RETIRE_CONFIRM;
  const players = [];
  for (const id of await allPlayerIds()) {
    const p = { id };
    const [photo, consent] = await Promise.all([getPhoto(kv, p.id), getPhotoConsent(kv, p.id)]);
    const hasPhoto = !!(photo && photo.url);
    const hasConsent = !!consent;
    if (!hasPhoto && !hasConsent) continue;
    players.push({ id: p.id, hasPhoto, hasConsent });
    if (!doIt) continue;
    if (hasPhoto) {
      try { await del(photo.url, { token: process.env.BLOB_READ_WRITE_TOKEN }); } catch { /* blob may already be gone */ }
      await removePhoto(kv, p.id);
    }
    if (hasConsent) await removePhotoConsent(kv, p.id);
  }
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ dryRun: !doIt, deleted: doIt ? players.length : 0, players });
}

function bearer(req) {
  const h = req.headers && (req.headers.authorization || req.headers.Authorization);
  if (!h || typeof h !== 'string' || !h.startsWith('Bearer ')) return '';
  return h.slice(7).trim();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method not allowed' });
  }
  if (!uploadConfigured()) return res.status(503).json({ error: 'photo service not configured' });

  const body = parseBody(req);
  if (body.orphans === true) {
    if (!adminOk(req)) return res.status(401).json({ error: 'unauthorized' });
    return sweepOrphans(req, res, body);
  }
  if (body.all === true) {
    if (!adminOk(req)) return res.status(401).json({ error: 'unauthorized' });
    return retireAll(req, res, body);
  }

  // Token FIRST, so a caller without one cannot learn whether a player exists.
  const pid = String(body.playerId || '').trim().toLowerCase();
  const tokenPlayer = verifyToken(bearer(req));
  if (!tokenPlayer || !pid || tokenPlayer !== pid) {
    return res.status(401).json({ error: 'not verified' });
  }

  const kv = getKv();
  const rec = await getPhoto(kv, pid);
  if (rec && rec.url) {
    try { await del(rec.url, { token: process.env.BLOB_READ_WRITE_TOKEN }); } catch { /* blob may already be gone */ }
  }
  await removePhoto(kv, pid);
  await removePhotoConsent(kv, pid);

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true });
}
