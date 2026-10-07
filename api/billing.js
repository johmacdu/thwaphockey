// api/billing.js
//
// Seasonal team billing on one serverless function (Vercel's 12-function cap):
//   POST ?action=create-checkout      { code, seasons:[<key>,...] } -> { url }
//   POST ?action=create-subscription  { code } -> { url }  (annual auto-renew)
//   POST ?action=portal               { code } -> { url }  (Stripe billing portal)
//   POST ?action=webhook              Stripe events -> records seasons + subscription,
//                                     and emails a pre-renewal heads-up (invoice.upcoming)
//   GET  ?action=status&code=XXX      -> { active, free, subscribed, currentSeason, ... }
//   GET  ?action=screen&code=XXX      -> coach billing screen { paid[], buyable[], subscription }
//
// Stripe is lazy-imported and only touched when a secret key is configured, so
// the status endpoint (and the unit tests) work without any Stripe setup. The
// raw body is read by hand (bodyParser off) because the webhook signature check
// needs the exact bytes Stripe sent.

import { getTeam } from '../lib/teams_store.js';
import {
  recordPayment, billingStatus, billingScreen, setTeamFree,
  recordSubscription, subscriptionCustomer,
} from '../lib/billing_store.js';
import { parseSeasonKey, isSeasonKey, priceCentsForKey, currentSeasonKey, ANNUAL_SUB } from '../lib/seasons.js';

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

// Annual auto-renew: a subscription Checkout Session for the recurring $500/yr
// price. The teamCode rides on BOTH the session and the subscription metadata so
// every later subscription webhook (renewal, cancel) can find the team.
async function createSubscription(req, res) {
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
  if (!code) return res.status(400).json({ error: 'code required' });
  if (!(await getTeam(code))) return res.status(404).json({ error: 'team not found' });

  const price = process.env[ANNUAL_SUB.env] || '';
  if (!price) return res.status(503).json({ error: 'missing Stripe price for the annual subscription' });

  const origin = originOf(req);
  const meta = { teamCode: code };
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price, quantity: 1 }],
    success_url: `${origin}/?billing=success`,
    cancel_url: `${origin}/?billing=cancel`,
    metadata: meta,
    subscription_data: { metadata: meta },
  });
  return res.status(200).json({ ok: true, url: session.url });
}

// Open the Stripe Billing Portal for a team's customer: where a coach updates the
// card, cancels/resumes, and downloads past invoices (so we never build receipts).
async function portal(req, res) {
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
  if (!code) return res.status(400).json({ error: 'code required' });
  const customer = await subscriptionCustomer(code);
  if (!customer) return res.status(404).json({ error: 'no subscription for this team' });

  const origin = originOf(req);
  const session = await stripe.billingPortal.sessions.create({ customer, return_url: `${origin}/?billing=portal` });
  return res.status(200).json({ ok: true, url: session.url });
}

// Map a Stripe Subscription object to our stored shape. current_period_end moved
// onto the subscription item in newer API versions, so read either spot.
function subFromStripe(obj) {
  const item = (obj.items && obj.items.data && obj.items.data[0]) || {};
  const price = item.price || {};
  const cpe = obj.current_period_end || item.current_period_end || null;
  return {
    id: obj.id,
    customer: obj.customer,
    status: obj.status,
    priceId: price.id || null,
    amountCents: Number(price.unit_amount) || 0,
    currentPeriodEnd: cpe ? new Date(cpe * 1000).toISOString() : null,
    cancelAtPeriodEnd: obj.cancel_at_period_end === true,
  };
}

// Transactional email via Resend (same provider as login codes / waitlist).
// Fire-and-forget and guarded: with no Resend key configured it is a no-op, so
// billing keeps working without email set up.
async function sendEmail(to, subject, text) {
  const from = process.env.PHOTO_FROM_EMAIL;
  const key = process.env.RESEND_API_KEY;
  if (!from || !key || !to) return false;
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, text }),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

// Stripe invoice.upcoming -> a friendly heads-up BEFORE the subscription renews,
// so a coach is never surprised by the annual charge (fewer chargebacks). Stripe
// sends this a configurable number of days before renewal when the event is
// enabled. The email address comes from Stripe's invoice, never the client.
async function sendRenewalReminder(inv) {
  const email = inv && inv.customer_email;
  if (!email) return false;
  const amount = (Number(inv.amount_due) || 0) / 100;
  const amountStr = amount % 1 ? amount.toFixed(2) : String(amount);
  const when = inv.next_payment_attempt || inv.period_end || null;
  const dateStr = when
    ? new Date(when * 1000).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' })
    : 'soon';
  return sendEmail(
    email,
    'Your Thwap Hockey team renews soon',
    `Heads up: your Thwap Hockey team subscription renews on ${dateStr} for $${amountStr}.\n\n`
    + 'No action is needed if you want to keep training. To manage or cancel, open Thwap Hockey, '
    + 'go to Team billing, and tap Manage subscription.\n\n'
    + 'Thanks for being part of Thwap.'
  );
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
    // One-time season passes.
    const seasons = String(md.seasons || '').split(',').filter(isSeasonKey);
    for (const k of seasons) {
      await recordPayment(code, k, {
        amountCents: priceCentsForKey(k),
        currency: obj.currency || 'usd',
        stripeSession: obj.id,
      });
    }
    // Subscription checkout: activate immediately so the team is covered even
    // before the customer.subscription.created event lands. The .updated event
    // then fills in the renewal date + price.
    if (obj.mode === 'subscription' && obj.subscription && code) {
      await recordSubscription(code, { id: obj.subscription, customer: obj.customer, status: 'active' });
    }
  } else if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
    const obj = (event.data && event.data.object) || {};
    const code = (obj.metadata && obj.metadata.teamCode) || '';
    if (code) await recordSubscription(code, subFromStripe(obj));
  } else if (event.type === 'customer.subscription.deleted') {
    const obj = (event.data && event.data.object) || {};
    const code = (obj.metadata && obj.metadata.teamCode) || '';
    if (code) await recordSubscription(code, { ...subFromStripe(obj), status: 'canceled' });
  } else if (event.type === 'invoice.upcoming') {
    // Pre-renewal heads-up email. No-op unless Resend is configured.
    await sendRenewalReminder((event.data && event.data.object) || {});
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
    case 'create-subscription':
      return createSubscription(req, res);
    case 'portal':
      return portal(req, res);
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
