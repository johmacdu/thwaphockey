// test/billing-endpoint.test.js
//
// Unit tests for api/billing.js with Stripe and Redis both faked (no network, no
// keys). Covers status (public), create-checkout (team guard + Stripe URL),
// webhook (signature-gated recording), and the active-season read-back.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FakeRedis } from './fakeRedis.js';
import { currentSeasonKey } from '../lib/seasons.js';

const fake = new FakeRedis();
vi.mock('@upstash/redis', () => ({ Redis: class { constructor() { return fake; } } }));

// Fake Stripe: checkout returns a URL and CAPTURES the create options (so tests
// can assert the mode + metadata that every later webhook relies on to find the
// team). constructEvent echoes the body only when the webhook secret matches (so
// we can exercise the bad-signature path). `stripeCalls` is hoisted so the mock
// factory can reference it despite vi.mock hoisting.
const { stripeCalls } = vi.hoisted(() => ({ stripeCalls: { checkout: [], portal: [] } }));
vi.mock('stripe', () => ({
  default: class {
    constructor() {}
    checkout = { sessions: { create: async (opts) => { stripeCalls.checkout.push(opts); return { id: 'cs_test_123', url: 'https://checkout.test/cs' }; } } };
    billingPortal = { sessions: { create: async (opts) => { stripeCalls.portal.push(opts); return { url: 'https://portal.test/ps' }; } } };
    webhooks = {
      constructEvent: (raw, _sig, secret) => {
        if (secret !== 'whsec_test') throw new Error('bad signature');
        return JSON.parse(raw);
      },
    };
  },
}));

process.env.STRIPE_SECRET_KEY = 'sk_test_x';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
process.env.STRIPE_PRICE_FW = 'price_fw';
process.env.STRIPE_PRICE_SP = 'price_sp';
process.env.STRIPE_PRICE_OS = 'price_os';
process.env.STRIPE_PRICE_ANNUAL = 'price_annual';
process.env.BILLING_ADMIN_SECRET = 'adm_s';
process.env.BILLING_COMP_CODES = 'MacDuffie2016, OtherComp';

const handler = (await import('../api/billing.js')).default;
const { getTeamBilling, hasPaidSeason, recordPayment, isTeamActive } = await import('../lib/billing_store.js');

function makeRes() {
  const r = { statusCode: 200, body: null, headers: {} };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  return r;
}
async function call(reqObj) {
  const res = makeRes();
  await handler(reqObj, res);
  return res;
}

describe('api/billing', () => {
  beforeEach(() => { fake.map.clear(); stripeCalls.checkout.length = 0; stripeCalls.portal.length = 0; });

  it('status: unknown team is inactive with a valid shape', async () => {
    const res = await call({ method: 'GET', query: { action: 'status', code: 'ZZZ9999' }, headers: {} });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, free: false, active: false });
    expect(typeof res.body.currentSeason).toBe('string');
  });

  it('create-checkout: returns a Stripe URL for an existing team', async () => {
    fake._seed('team:ABC1234', { code: 'ABC1234', name: 'Test Team' });
    const res = await call({
      method: 'POST', query: { action: 'create-checkout' }, headers: { host: 'thwaphockey.com' },
      body: JSON.stringify({ code: 'ABC1234', seasons: ['fw-2025', 'sp-2026'] }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.url).toContain('checkout.test');
  });

  it('create-checkout: 404 for a missing team, 400 for no valid season', async () => {
    const miss = await call({ method: 'POST', query: { action: 'create-checkout' }, headers: {}, body: JSON.stringify({ code: 'NOPE', seasons: ['fw-2025'] }) });
    expect(miss.statusCode).toBe(404);
    fake._seed('team:ABC1234', { code: 'ABC1234' });
    const bad = await call({ method: 'POST', query: { action: 'create-checkout' }, headers: {}, body: JSON.stringify({ code: 'ABC1234', seasons: ['winter'] }) });
    expect(bad.statusCode).toBe(400);
  });

  it('webhook: records the paid season from checkout.session.completed', async () => {
    const event = { type: 'checkout.session.completed', data: { object: { id: 'cs_x', currency: 'usd', metadata: { teamCode: 'ABC1234', seasons: 'fw-2025' } } } };
    const res = await call({ method: 'POST', query: { action: 'webhook' }, headers: { 'stripe-signature': 't=1,v1=x' }, body: JSON.stringify(event) });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ received: true });
    expect(await hasPaidSeason('ABC1234', 'fw-2025')).toBe(true);
    const b = await getTeamBilling('ABC1234');
    expect(b.seasons['fw-2025']).toMatchObject({ amountCents: 35000, currency: 'usd', stripeSession: 'cs_x' });
  });

  it('webhook: a bad signature is rejected and records nothing', async () => {
    const prev = process.env.STRIPE_WEBHOOK_SECRET;
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_WRONG';
    const event = { type: 'checkout.session.completed', data: { object: { id: 'cs_y', metadata: { teamCode: 'T2', seasons: 'fw-2025' } } } };
    const res = await call({ method: 'POST', query: { action: 'webhook' }, headers: { 'stripe-signature': 'x' }, body: JSON.stringify(event) });
    process.env.STRIPE_WEBHOOK_SECRET = prev;
    expect(res.statusCode).toBe(400);
    expect(await hasPaidSeason('T2', 'fw-2025')).toBe(false);
  });

  it('status: a recorded current season reads back as active', async () => {
    const key = currentSeasonKey(new Date());
    await recordPayment('T3', key, { amountCents: 1 });
    const res = await call({ method: 'GET', query: { action: 'status', code: 'T3' }, headers: {} });
    expect(res.body.active).toBe(true);
    expect(res.body.currentSeason).toBe(key);
    expect(res.body.paidSeasons).toContain(key);
  });

  it('unknown action -> 400', async () => {
    const res = await call({ method: 'GET', query: { action: 'nope' }, headers: {} });
    expect(res.statusCode).toBe(400);
  });

  it('set-free: comps a team with the admin secret, rejects a bad one', async () => {
    const ok = await call({ method: 'POST', query: { action: 'set-free' }, headers: {}, body: JSON.stringify({ code: 'LEWIE1', free: true, secret: 'adm_s' }) });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toMatchObject({ ok: true, free: true });
    expect((await getTeamBilling('LEWIE1')).free).toBe(true);
    const bad = await call({ method: 'POST', query: { action: 'set-free' }, headers: {}, body: JSON.stringify({ code: 'LEWIE1', free: false, secret: 'WRONG' }) });
    expect(bad.statusCode).toBe(401);
    expect((await getTeamBilling('LEWIE1')).free).toBe(true); // unchanged
  });

  it('status: BILLING_ENFORCED gates an unpaid team', async () => {
    process.env.BILLING_ENFORCED = '1';
    const res = await call({ method: 'GET', query: { action: 'status', code: 'UNPAID9' }, headers: {} });
    delete process.env.BILLING_ENFORCED;
    expect(res.body).toMatchObject({ enforced: true, active: false, gated: true });
  });

  it('redeem: a valid comp code comps the current season (case-insensitive)', async () => {
    fake._seed('team:MACD', { code: 'MACD' });
    const res = await call({ method: 'POST', query: { action: 'redeem' }, headers: {}, body: JSON.stringify({ code: 'MACD', comp: 'macduffie2016' }) });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, active: true });
    expect(await hasPaidSeason('MACD', currentSeasonKey(new Date()))).toBe(true);
    const b = await getTeamBilling('MACD');
    expect(b.seasons[currentSeasonKey(new Date())].stripeSession).toBe('comp:macduffie2016');
  });

  it('redeem: invalid comp code -> 403, missing team -> 404', async () => {
    fake._seed('team:MACD', { code: 'MACD' });
    const bad = await call({ method: 'POST', query: { action: 'redeem' }, headers: {}, body: JSON.stringify({ code: 'MACD', comp: 'nope' }) });
    expect(bad.statusCode).toBe(403);
    const miss = await call({ method: 'POST', query: { action: 'redeem' }, headers: {}, body: JSON.stringify({ code: 'GHOST', comp: 'MacDuffie2016' }) });
    expect(miss.statusCode).toBe(404);
  });

  it('screen: lists paid seasons and the seasons left to buy for a real team', async () => {
    fake._seed('team:SCRN1', { code: 'SCRN1', name: 'Screen Team' });
    const key = currentSeasonKey(new Date());
    await recordPayment('SCRN1', key, { amountCents: 1234, stripeSession: 'cs_scr' });
    const res = await call({ method: 'GET', query: { action: 'screen', code: 'SCRN1' }, headers: {} });
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.paid.map((s) => s.key)).toContain(key);
    expect(res.body.buyable.map((s) => s.key)).not.toContain(key); // already paid, dropped
    expect(Array.isArray(res.body.buyable)).toBe(true);
  });

  it('screen: 404 for a missing team, 400 without a code', async () => {
    const miss = await call({ method: 'GET', query: { action: 'screen', code: 'GHOST9' }, headers: {} });
    expect(miss.statusCode).toBe(404);
    const noCode = await call({ method: 'GET', query: { action: 'screen' }, headers: {} });
    expect(noCode.statusCode).toBe(400);
  });

  it('create-subscription: returns a Stripe URL for an existing team, 404 otherwise', async () => {
    fake._seed('team:SUBT', { code: 'SUBT', name: 'Sub Team' });
    const ok = await call({ method: 'POST', query: { action: 'create-subscription' }, headers: { host: 'thwaphockey.com' }, body: JSON.stringify({ code: 'SUBT' }) });
    expect(ok.statusCode).toBe(200);
    expect(ok.body.url).toContain('checkout.test');
    const miss = await call({ method: 'POST', query: { action: 'create-subscription' }, headers: {}, body: JSON.stringify({ code: 'NOPE' }) });
    expect(miss.statusCode).toBe(404);
  });

  it('webhook: customer.subscription.created activates the team every season', async () => {
    const event = {
      type: 'customer.subscription.created',
      data: { object: {
        id: 'sub_x', customer: 'cus_x', status: 'active', cancel_at_period_end: false,
        current_period_end: 1790000000,
        metadata: { teamCode: 'SUBW' },
        items: { data: [{ current_period_end: 1790000000, price: { id: 'price_annual', unit_amount: 50000 } }] },
      } },
    };
    const res = await call({ method: 'POST', query: { action: 'webhook' }, headers: { 'stripe-signature': 'x' }, body: JSON.stringify(event) });
    expect(res.statusCode).toBe(200);
    const b = await getTeamBilling('SUBW');
    expect(b.subscription).toMatchObject({ id: 'sub_x', customer: 'cus_x', status: 'active', amountCents: 50000 });
    expect(await isTeamActive('SUBW', new Date('2026-05-15T19:00:00Z'))).toBe(true); // spring, nothing bought per-season
  });

  it('webhook: customer.subscription.deleted cancels the team but keeps the customer id', async () => {
    const mk = (type, status) => ({ type, data: { object: { id: 'sub_d', customer: 'cus_d', status, metadata: { teamCode: 'SUBD' }, items: { data: [{ price: { id: 'price_annual', unit_amount: 50000 } }] } } } });
    await call({ method: 'POST', query: { action: 'webhook' }, headers: { 'stripe-signature': 'x' }, body: JSON.stringify(mk('customer.subscription.created', 'active')) });
    expect(await isTeamActive('SUBD', new Date())).toBe(true);
    await call({ method: 'POST', query: { action: 'webhook' }, headers: { 'stripe-signature': 'x' }, body: JSON.stringify(mk('customer.subscription.deleted', 'canceled')) });
    const b = await getTeamBilling('SUBD');
    expect(b.subscription.status).toBe('canceled');
    expect(b.subscription.customer).toBe('cus_d');
    expect(await isTeamActive('SUBD', new Date())).toBe(false);
  });

  it('portal: opens for a team with a subscription, 404 without one', async () => {
    const event = { type: 'customer.subscription.created', data: { object: { id: 'sub_p', customer: 'cus_p', status: 'active', metadata: { teamCode: 'PORT1' }, items: { data: [{ price: { id: 'price_annual', unit_amount: 50000 } }] } } } };
    await call({ method: 'POST', query: { action: 'webhook' }, headers: { 'stripe-signature': 'x' }, body: JSON.stringify(event) });
    const ok = await call({ method: 'POST', query: { action: 'portal' }, headers: { host: 'thwaphockey.com' }, body: JSON.stringify({ code: 'PORT1' }) });
    expect(ok.statusCode).toBe(200);
    expect(ok.body.url).toContain('portal.test');
    const miss = await call({ method: 'POST', query: { action: 'portal' }, headers: {}, body: JSON.stringify({ code: 'NOSUB' }) });
    expect(miss.statusCode).toBe(404);
  });

  it('webhook: invoice.upcoming emails a renewal heads-up via Resend', async () => {
    const prevFetch = global.fetch;
    const calls = [];
    global.fetch = async (url, opts) => { calls.push({ url: String(url), opts }); return { ok: true, json: async () => ({ id: 'email_1' }) }; };
    process.env.RESEND_API_KEY = 're_test';
    process.env.PHOTO_FROM_EMAIL = 'hi@thwaphockey.com';
    try {
      const event = { type: 'invoice.upcoming', data: { object: { customer_email: 'coach@team.com', amount_due: 50000, next_payment_attempt: 1790000000 } } };
      const res = await call({ method: 'POST', query: { action: 'webhook' }, headers: { 'stripe-signature': 'x' }, body: JSON.stringify(event) });
      expect(res.statusCode).toBe(200);
      const sent = calls.find((c) => c.url.indexOf('api.resend.com') >= 0);
      expect(sent).toBeTruthy();
      const body = JSON.parse(sent.opts.body);
      expect(body.to).toEqual(['coach@team.com']);
      expect(body.text).toContain('$500');
      expect(body.subject).toMatch(/renews/i);
    } finally {
      global.fetch = prevFetch;
      delete process.env.RESEND_API_KEY;
      delete process.env.PHOTO_FROM_EMAIL;
    }
  });

  it('webhook: invoice.upcoming is a no-op (still 200) when Resend is not configured', async () => {
    const prevFetch = global.fetch;
    const calls = [];
    global.fetch = async (url, opts) => { calls.push(String(url)); return { ok: true, json: async () => ({}) }; };
    delete process.env.RESEND_API_KEY; // not configured
    try {
      const event = { type: 'invoice.upcoming', data: { object: { customer_email: 'coach@team.com', amount_due: 50000 } } };
      const res = await call({ method: 'POST', query: { action: 'webhook' }, headers: { 'stripe-signature': 'x' }, body: JSON.stringify(event) });
      expect(res.statusCode).toBe(200);
      expect(calls.find((u) => u.indexOf('api.resend.com') >= 0)).toBeFalsy();
    } finally {
      global.fetch = prevFetch;
    }
  });

  // --- Checkout validation + the metadata webhooks depend on -----------------
  it('create-checkout: 400 without a code, 400 when no season is valid', async () => {
    fake._seed('team:ABC1234', { code: 'ABC1234' });
    const noCode = await call({ method: 'POST', query: { action: 'create-checkout' }, headers: {}, body: JSON.stringify({ seasons: ['fw-2025'] }) });
    expect(noCode.statusCode).toBe(400);
    const noSeason = await call({ method: 'POST', query: { action: 'create-checkout' }, headers: {}, body: JSON.stringify({ code: 'ABC1234', seasons: ['bogus'] }) });
    expect(noSeason.statusCode).toBe(400);
  });

  it('create-checkout: 400 on malformed JSON', async () => {
    const res = await call({ method: 'POST', query: { action: 'create-checkout' }, headers: {}, body: '{not json' });
    expect(res.statusCode).toBe(400);
  });

  it('create-checkout: 503 when a valid season has no configured Stripe price', async () => {
    fake._seed('team:ABC1234', { code: 'ABC1234' });
    const prev = process.env.STRIPE_PRICE_SP;
    delete process.env.STRIPE_PRICE_SP;
    const res = await call({ method: 'POST', query: { action: 'create-checkout' }, headers: {}, body: JSON.stringify({ code: 'ABC1234', seasons: ['sp-2026'] }) });
    process.env.STRIPE_PRICE_SP = prev;
    expect(res.statusCode).toBe(503);
    expect(res.body.error).toMatch(/missing Stripe price/);
  });

  it('create-checkout: one-time (payment) session carries teamCode + comma-joined seasons + line items', async () => {
    fake._seed('team:ABC1234', { code: 'ABC1234' });
    await call({ method: 'POST', query: { action: 'create-checkout' }, headers: { host: 'thwaphockey.com' }, body: JSON.stringify({ code: 'ABC1234', seasons: ['fw-2025', 'sp-2026'] }) });
    const opts = stripeCalls.checkout.at(-1);
    expect(opts.mode).toBe('payment');
    expect(opts.metadata).toEqual({ teamCode: 'ABC1234', seasons: 'fw-2025,sp-2026' });
    expect(opts.payment_intent_data.metadata).toEqual({ teamCode: 'ABC1234', seasons: 'fw-2025,sp-2026' });
    expect(opts.line_items).toEqual([{ price: 'price_fw', quantity: 1 }, { price: 'price_sp', quantity: 1 }]);
    expect(opts.success_url).toContain('billing=success');
    expect(opts.cancel_url).toContain('billing=cancel');
  });

  it('create-subscription: 400 without a code, 503 when the annual price is unset', async () => {
    const noCode = await call({ method: 'POST', query: { action: 'create-subscription' }, headers: {}, body: JSON.stringify({}) });
    expect(noCode.statusCode).toBe(400);
    fake._seed('team:SUBT', { code: 'SUBT' });
    const prev = process.env.STRIPE_PRICE_ANNUAL;
    delete process.env.STRIPE_PRICE_ANNUAL;
    const res = await call({ method: 'POST', query: { action: 'create-subscription' }, headers: {}, body: JSON.stringify({ code: 'SUBT' }) });
    process.env.STRIPE_PRICE_ANNUAL = prev;
    expect(res.statusCode).toBe(503);
  });

  it('create-subscription: subscription session carries teamCode on BOTH the session and subscription_data', async () => {
    fake._seed('team:SUBT', { code: 'SUBT' });
    await call({ method: 'POST', query: { action: 'create-subscription' }, headers: { host: 'thwaphockey.com' }, body: JSON.stringify({ code: 'SUBT' }) });
    const opts = stripeCalls.checkout.at(-1);
    expect(opts.mode).toBe('subscription');
    expect(opts.line_items).toEqual([{ price: 'price_annual', quantity: 1 }]);
    expect(opts.metadata).toEqual({ teamCode: 'SUBT' });
    expect(opts.subscription_data.metadata).toEqual({ teamCode: 'SUBT' });
  });

  it('portal: 400 without a code', async () => {
    const res = await call({ method: 'POST', query: { action: 'portal' }, headers: {}, body: JSON.stringify({}) });
    expect(res.statusCode).toBe(400);
  });

  // --- Webhook: subscription lifecycle beyond the happy path -----------------
  it('webhook: a subscription-mode checkout.session.completed activates the team immediately', async () => {
    // The .created event may land after the user is already back in the app, so
    // the subscription-mode checkout session must cover them right away.
    const event = { type: 'checkout.session.completed', data: { object: { id: 'cs_sub', mode: 'subscription', subscription: 'sub_live', customer: 'cus_live', metadata: { teamCode: 'SUBNOW' } } } };
    const res = await call({ method: 'POST', query: { action: 'webhook' }, headers: { 'stripe-signature': 'x' }, body: JSON.stringify(event) });
    expect(res.statusCode).toBe(200);
    const b = await getTeamBilling('SUBNOW');
    expect(b.subscription).toMatchObject({ id: 'sub_live', customer: 'cus_live', status: 'active' });
    expect(await isTeamActive('SUBNOW', new Date())).toBe(true);
  });

  it('webhook: customer.subscription.updated flips cancelAtPeriodEnd and keeps past_due active (grace window)', async () => {
    const mk = (status, cancel) => ({
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_u', customer: 'cus_u', status, cancel_at_period_end: cancel, current_period_end: 1790000000, metadata: { teamCode: 'SUBU' }, items: { data: [{ price: { id: 'price_annual', unit_amount: 50000 } }] } } },
    });
    await call({ method: 'POST', query: { action: 'webhook' }, headers: { 'stripe-signature': 'x' }, body: JSON.stringify(mk('active', false)) });
    await call({ method: 'POST', query: { action: 'webhook' }, headers: { 'stripe-signature': 'x' }, body: JSON.stringify(mk('past_due', true)) });
    const b = await getTeamBilling('SUBU');
    expect(b.subscription.status).toBe('past_due');
    expect(b.subscription.cancelAtPeriodEnd).toBe(true);
    expect(await isTeamActive('SUBU', new Date())).toBe(true); // past_due is kept active while Stripe retries
  });

  it('webhook: reads current_period_end off the subscription item when the top-level field is absent (newer API)', async () => {
    const event = { type: 'customer.subscription.created', data: { object: { id: 'sub_item', customer: 'cus_item', status: 'active', metadata: { teamCode: 'ITEMEND' }, items: { data: [{ current_period_end: 1790000000, price: { id: 'price_annual', unit_amount: 50000 } }] } } } };
    await call({ method: 'POST', query: { action: 'webhook' }, headers: { 'stripe-signature': 'x' }, body: JSON.stringify(event) });
    const b = await getTeamBilling('ITEMEND');
    expect(b.subscription.currentPeriodEnd).toBe(new Date(1790000000 * 1000).toISOString());
  });

  it('webhook: a subscription event with NO teamCode metadata is a safe no-op', async () => {
    const event = { type: 'customer.subscription.created', data: { object: { id: 'sub_na', customer: 'cus_na', status: 'active', metadata: {}, items: { data: [{ price: { id: 'price_annual', unit_amount: 50000 } }] } } } };
    const res = await call({ method: 'POST', query: { action: 'webhook' }, headers: { 'stripe-signature': 'x' }, body: JSON.stringify(event) });
    expect(res.statusCode).toBe(200);
    expect([...fake.map.keys()].filter((k) => k.startsWith('teamBilling:'))).toEqual([]);
  });

  it('webhook: an unhandled event type is accepted (200) and records nothing', async () => {
    const event = { type: 'payment_intent.succeeded', data: { object: { id: 'pi_x' } } };
    const res = await call({ method: 'POST', query: { action: 'webhook' }, headers: { 'stripe-signature': 'x' }, body: JSON.stringify(event) });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ received: true });
    expect([...fake.map.keys()].filter((k) => k.startsWith('teamBilling:'))).toEqual([]);
  });

  it('webhook: records EVERY season from a multi-season checkout', async () => {
    const event = { type: 'checkout.session.completed', data: { object: { id: 'cs_multi', currency: 'usd', metadata: { teamCode: 'MULTI', seasons: 'fw-2025,sp-2026,os-2026' } } } };
    await call({ method: 'POST', query: { action: 'webhook' }, headers: { 'stripe-signature': 'x' }, body: JSON.stringify(event) });
    expect(await hasPaidSeason('MULTI', 'fw-2025')).toBe(true);
    expect(await hasPaidSeason('MULTI', 'sp-2026')).toBe(true);
    expect(await hasPaidSeason('MULTI', 'os-2026')).toBe(true);
  });

  it('webhook: 503 when the webhook secret is not configured', async () => {
    const prev = process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const res = await call({ method: 'POST', query: { action: 'webhook' }, headers: { 'stripe-signature': 'x' }, body: '{}' });
    process.env.STRIPE_WEBHOOK_SECRET = prev;
    expect(res.statusCode).toBe(503);
  });

  // --- Comp codes (MacDuffie2016 = Lewie's Jr. Rangers 10U) ------------------
  it('redeem: 400 without a team code', async () => {
    const res = await call({ method: 'POST', query: { action: 'redeem' }, headers: {}, body: JSON.stringify({ comp: 'MacDuffie2016' }) });
    expect(res.statusCode).toBe(400);
  });

  it('redeem (MacDuffie2016): comps the CURRENT season only, and must be re-applied each season', async () => {
    fake._seed('team:LEWIE', { code: 'LEWIE' });
    const res = await call({ method: 'POST', query: { action: 'redeem' }, headers: {}, body: JSON.stringify({ code: 'LEWIE', comp: 'MacDuffie2016' }) });
    expect(res.statusCode).toBe(200);
    const season = currentSeasonKey(new Date());
    expect(res.body.season).toBe(season);
    expect(await isTeamActive('LEWIE', new Date())).toBe(true); // covered now
    // Only the current season is comped: a date in a different season is NOT
    // covered until the code is redeemed again that season.
    const candidates = ['2025-10-15', '2026-05-15', '2026-08-15', '2027-02-15'].map((s) => new Date(`${s}T19:00:00Z`));
    const other = candidates.find((dt) => currentSeasonKey(dt) !== season);
    expect(other).toBeTruthy();
    expect(await isTeamActive('LEWIE', other)).toBe(false);
  });

  it('redeem: with BILLING_COMP_CODES unset, every comp code is invalid (403)', async () => {
    fake._seed('team:LEWIE', { code: 'LEWIE' });
    const prev = process.env.BILLING_COMP_CODES;
    delete process.env.BILLING_COMP_CODES;
    const res = await call({ method: 'POST', query: { action: 'redeem' }, headers: {}, body: JSON.stringify({ code: 'LEWIE', comp: 'MacDuffie2016' }) });
    process.env.BILLING_COMP_CODES = prev;
    expect(res.statusCode).toBe(403);
  });

  // --- set-free (admin comp toggle) + method guards -------------------------
  it('set-free: toggles a team free then un-free with the admin secret; 400 without a code', async () => {
    await call({ method: 'POST', query: { action: 'set-free' }, headers: {}, body: JSON.stringify({ code: 'FT', free: true, secret: 'adm_s' }) });
    expect((await getTeamBilling('FT')).free).toBe(true);
    await call({ method: 'POST', query: { action: 'set-free' }, headers: {}, body: JSON.stringify({ code: 'FT', free: false, secret: 'adm_s' }) });
    expect((await getTeamBilling('FT')).free).toBe(false);
    const noCode = await call({ method: 'POST', query: { action: 'set-free' }, headers: {}, body: JSON.stringify({ free: true, secret: 'adm_s' }) });
    expect(noCode.statusCode).toBe(400);
  });

  it('method guards: create-checkout rejects GET, status rejects POST', async () => {
    expect((await call({ method: 'GET', query: { action: 'create-checkout' }, headers: {} })).statusCode).toBe(405);
    expect((await call({ method: 'POST', query: { action: 'status', code: 'X' }, headers: {}, body: '{}' })).statusCode).toBe(405);
  });
});
