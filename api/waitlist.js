// api/waitlist.js
//
// POST { association, ageLevel, email }  -> records a waitlist signup (public).
// GET  (admin token)                     -> lists/exports signups (JSON or CSV).
//
// First-party waitlist for THWAP. Each signup is stored in Upstash Redis (the
// same store the rest of the app uses), so the data stays private with no third
// party. Kept intentionally small: one endpoint, no account model.
//
// Env:
//   KV_REST_API_* / UPSTASH_REDIS_REST_*  Redis (required; POST + GET 503 without)
//   WAITLIST_ADMIN_TOKEN                  enables GET read-back (off if unset)
//   WAITLIST_NOTIFY_EMAIL                 where new-signup emails go (optional)
//   RESEND_API_KEY, PHOTO_FROM_EMAIL      reused from the photo flow to send mail

import { getKv, parseBody } from './_photo_common.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Redis keys: a list of JSON signups (newest first) plus a set of emails that
// keeps the flow idempotent, so a parent who submits twice is not double-counted.
const LIST_KEY = 'waitlist:entries';
const EMAILS_KEY = 'waitlist:emails';

// Mirror store.js env detection: the Vercel Upstash integration injects either
// KV_REST_API_* or UPSTASH_REDIS_REST_*. Missing both means not set up.
function kvConfigured() {
  return !!(
    (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL) &&
    (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN)
  );
}

export default async function handler(req, res) {
  if (req.method === 'POST') return handlePost(req, res);
  if (req.method === 'GET') return handleGet(req, res);
  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'method not allowed' });
}

// ---- Public signup -------------------------------------------------------
async function handlePost(req, res) {
  if (!kvConfigured()) return res.status(503).json({ error: 'waitlist not configured' });

  const { association, ageLevels, region, email } = parseBody(req);
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanAssoc = String(association || '').trim().slice(0, 120);
  // Canonical age codes (6U/8U/10U/12U), region-independent, deduped.
  const ages = Array.isArray(ageLevels)
    ? [...new Set(ageLevels.map((a) => String(a).trim().slice(0, 12)).filter(Boolean))].slice(0, 10)
    : [];
  const cleanRegion = String(region || '').trim().toUpperCase().slice(0, 2) || null;

  if (!EMAIL_RE.test(cleanEmail)) return res.status(400).json({ error: 'bad email' });
  if (!cleanAssoc) return res.status(400).json({ error: 'association required' });
  if (!ages.length) return res.status(400).json({ error: 'age level required' });

  const kv = getKv();

  // Idempotent: sadd returns the count of NEW members (0 if the email is already
  // present), so a repeat submit succeeds without writing a duplicate row.
  const isNew = await kv.sadd(EMAILS_KEY, cleanEmail);
  const entry = { email: cleanEmail, association: cleanAssoc, ageLevels: ages, region: cleanRegion, ts: Date.now() };
  if (isNew) {
    await kv.lpush(LIST_KEY, JSON.stringify(entry));
    // Fire the notification but never fail the signup if mail hiccups.
    try { await notifySignup(entry); } catch { /* non-fatal */ }
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true, added: !!isNew });
}

// ---- Admin read-back / export -------------------------------------------
async function handleGet(req, res) {
  if (!kvConfigured()) return res.status(503).json({ error: 'waitlist not configured' });
  const secret = process.env.WAITLIST_ADMIN_TOKEN;
  if (!secret) return res.status(503).json({ error: 'read-back not enabled' });
  if (!adminOk(req, secret)) return res.status(401).json({ error: 'unauthorized' });

  const kv = getKv();
  const raw = await kv.lrange(LIST_KEY, 0, -1); // newest first
  const entries = (raw || []).map((v) => (typeof v === 'string' ? safeParse(v) : v)).filter(Boolean);

  res.setHeader('Cache-Control', 'no-store');
  const format = req.query && req.query.format;
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="thwap-waitlist.csv"');
    return res.status(200).send(toCsv(entries));
  }
  return res.status(200).json({ count: entries.length, entries });
}

function adminOk(req, secret) {
  const auth = req.headers && req.headers.authorization ? String(req.headers.authorization) : '';
  const bearer = auth.indexOf('Bearer ') === 0 ? auth.slice(7) : '';
  const q = (req.query && (req.query.key || req.query.token)) || '';
  return bearer === secret || String(q) === secret;
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

function toCsv(entries) {
  const head = ['email', 'association', 'ageLevels', 'region', 'signedUp'];
  const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const ages = (e) => (Array.isArray(e.ageLevels) ? e.ageLevels.join('; ') : e.ageLevel || '');
  const rows = entries.map((e) =>
    [e.email, e.association, ages(e), e.region || '', e.ts ? new Date(e.ts).toISOString() : ''].map(esc).join(',')
  );
  return [head.join(','), ...rows].join('\r\n') + '\r\n';
}

// ---- Notification (reuses the Resend key from the photo flow) ------------
async function notifySignup(entry) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.PHOTO_FROM_EMAIL;
  const to = process.env.WAITLIST_NOTIFY_EMAIL;
  if (!key || !from || !to) return false; // notifications not configured; skip quietly

  const ages = Array.isArray(entry.ageLevels) ? entry.ageLevels.join(', ') : entry.ageLevel || '';
  const body = {
    from,
    to: [to],
    subject: `New THWAP waitlist signup: ${entry.association} (${ages})`,
    text:
      `A new parent joined the THWAP waitlist.\n\n` +
      `Association: ${entry.association}\n` +
      `Age levels:  ${ages}\n` +
      `Region:      ${entry.region || 'unknown'}\n` +
      `Email:       ${entry.email}\n` +
      `When:        ${new Date(entry.ts).toISOString()}\n`,
  };
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return resp.ok;
}
