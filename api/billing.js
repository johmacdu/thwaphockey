// api/billing.js
//
// Seasonal team billing. Three actions on one serverless function (Vercel's
// 12-function cap):
//   POST ?action=create-checkout  { code, seasons:[<key>,...] } -> { url }
//   POST ?action=webhook          Stripe events -> records paid seasons
//   GET  ?action=status&code=XXX  -> { active, free, currentSeason, paidSeasons }
//   GET  ?action=screen&code=XXX  -> coach billing screen { paid[], buyable[] }
//
// Stripe is lazy-imported and only touched when a secret key is configured, so
// the status endpoint (and the unit tests) work without any Stripe setup. The
// raw body is read by hand (bodyParser off) because the webhook signature check
// needs the exact bytes Stripe sent.

import { getTeam } from '../lib/teams_store.js';
import { recordPayment, billingStatus, billingScreen, setTeamFree } from '../lib/billing_store.js';
import { parseSeasonKey, isSeasonKey, priceCentsForKey, currentSeasonKey } from '../lib/seasons.js';

export const config = { api: { bodyParser: false } };

function methodGuard(req, res, method) {
  if (req.method !== method) {
    res.status(405).json({ error: 'method not allowed' });
    return false;
  }
  return true;
}

async function readRaw(req) {
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  try {
    const chunks = [];
    for await (const c of req) chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
    return Buffer.concat(chunks).toString('utf8');
  } catch {
    return '';
  }
}

let _stripe;
async function getStripe() {
  if (_stripe !== undefined) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    _stripe = null;
    return null;
  }
  const Stripe = (await import('stripe')).default;
  _stripe = new Stripe(key);
  return _stripe;
}

// A season's Stripe Price id comes from its env var (see lib/seasons.js).
function priceIdForKey(key) {
  const s = parseSeasonKey(key);
  return s ? process.env[s.env] || '' : '';
}

function originOf(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'thwaphockey.com';
  return `${proto}://${host}`;
}

async function createCheckout(req, res) {
  if (!methodGuard(req, res, 'POST')) return;
  const stripe = await getStripe();
  if (!stripe) return res.status(503).json({ error: 'billing not configured' });

  let body = {};
  try {
    body = JSON.parse((await readRaw(req)) || '{}');
  } catch {
    return res.status(400).json({ error: 'bad json' });
  }

  const code = String(body.code || '').trim();
  const seasons = Array.isArray(body.seasons) ? body.seasons.filter(isSeasonKey) : [];
  if (!code) return res.status(400).json({ error: 'code required' });
  if (!seasons.length) return res.status(400).json({ error: 'at least one valid season required' });
  if (!(await getTeam(code))) return res.status(404).json({ error: 'team not found' });

  const line_items = [];
  for (const k of seasons) {
    const price = priceIdForKey(k);
    if (!price) return res.status(503).json({ error: `missing Stripe price for ${k}` });
    line_items.push({ price, quantity: 1 });
  }

  const origin = originOf(req);
  const meta = { teamCode: code, seasons: seasons.join(',') };
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items,
    success_url: `${origin}/?billing=success`,
    cancel_url: `${origin}/?billing=cancel`,
    metadata: meta,
    payment_intent_data: { metadata: meta },
  });
  return res.status(200).json({ ok: true, url: session.url });
}

async function webhook(req, res) {
  if (!methodGuard(req, res, 'POST')) return;
  const stripe = await getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) return res.status(503).json({ error: 'billing not configured' });

  const raw = await readRaw(req);
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, secret);
  } catch {
    return res.status(400).json({ error: 'signature verification failed' });
  }

  if (event.type === 'checkout.session.completed') {
    const obj = (event.data && event.data.object) || {};
    const md = obj.metadata || {};
    const code = md.teamCode || '';
    const seasons = String(md.seasons || '').split(',').filter(isSeasonKey);
    for (const k of seasons) {
      await recordPayment(code, k, {
        amountCents: priceCentsForKey(k),
        currency: obj.currency || 'usd',
        stripeSession: obj.id,
      });
    }
  }
  return res.status(200).json({ received: true });
}

async function status(req, res) {
  if (!methodGuard(req, res, 'GET')) return;
  const code = String((req.query && req.query.code) || '').trim();
  if (!code) return res.status(400).json({ error: 'code required' });
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true, ...(await billingStatus(code)) });
}

// GET ?action=screen&code=XXX -> the coach billing screen: seasons already paid
// (with receipt amount/date) and the seasons the team can still buy. Read-only,
// so it stays public like status; no payment data is trusted from the client.
async function screen(req, res) {
  if (!methodGuard(req, res, 'GET')) return;
  const code = String((req.query && req.query.code) || '').trim();
  if (!code) return res.status(400).json({ error: 'code required' });
  if (!(await getTeam(code))) return res.status(404).json({ error: 'team not found' });
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true, ...(await billingScreen(code)) });
}

// Valid comp codes (e.g. MacDuffie2016 for Lewie's Jr. Rangers 10U) live in
// BILLING_COMP_CODES, comma-separated. A comp code frees the CURRENT season when
// redeemed; re-apply the same code each season.
function compCodes() {
  return String(process.env.BILLING_COMP_CODES || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
function isCompCode(c) {
  const code = String(c || '').trim();
  return !!code && compCodes().some((v) => v.toLowerCase() === code.toLowerCase());
}

// POST ?action=redeem { code, comp } -> comps the current season for the team.
// The comp code itself is the authorization (no token needed).
async function redeem(req, res) {
  if (!methodGuard(req, res, 'POST')) return;
  let body = {};
  try {
    body = JSON.parse((await readRaw(req)) || '{}');
  } catch {
    return res.status(400).json({ error: 'bad json' });
  }
  const code = String(body.code || '').trim();
  const comp = String(body.comp || '').trim();
  if (!code) return res.status(400).json({ error: 'code required' });
  if (!isCompCode(comp)) return res.status(403).json({ error: 'invalid code' });
  if (!(await getTeam(code))) return res.status(404).json({ error: 'team not found' });
  const season = currentSeasonKey();
  await recordPayment(code, season, { amountCents: 0, currency: 'usd', stripeSession: `comp:${comp}` });
  return res.status(200).json({ ok: true, season, active: true });
}

// Admin-only: comp a team (free) or un-comp it. Gated by a shared env secret so
// it needs no coach/admin token plumbing. Used to keep Lewie's team free.
async function setFree(req, res) {
  if (!methodGuard(req, res, 'POST')) return;
  const secret = process.env.BILLING_ADMIN_SECRET;
  let body = {};
  try {
    body = JSON.parse((await readRaw(req)) || '{}');
  } catch {
    return res.status(400).json({ error: 'bad json' });
  }
  if (!secret || body.secret !== secret) return res.status(401).json({ error: 'unauthorized' });
  const code = String(body.code || '').trim();
  if (!code) return res.status(400).json({ error: 'code required' });
  const b = await setTeamFree(code, body.free === true);
  return res.status(200).json({ ok: true, code, free: b ? b.free : false });
}

export default async function handler(req, res) {
  const action = String((req.query && req.query.action) || '').toLowerCase();
  switch (action) {
    case 'create-checkout':
      return createCheckout(req, res);
    case 'webhook':
      return webhook(req, res);
    case 'status':
      return status(req, res);
    case 'screen':
      return screen(req, res);
    case 'set-free':
      return setFree(req, res);
    case 'redeem':
      return redeem(req, res);
    default:
      return res.status(400).json({ error: 'unknown action' });
  }
}
