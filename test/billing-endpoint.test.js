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

// Fake Stripe: checkout returns a URL; constructEvent echoes the body only when
// the webhook secret matches (so we can exercise the bad-signature path).
vi.mock('stripe', () => ({
  default: class {
    constructor() {}
    checkout = { sessions: { create: async (opts) => ({ id: 'cs_test_123', url: 'https://checkout.test/cs', _opts: opts }) } };
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
process.env.BILLING_ADMIN_SECRET = 'adm_s';
process.env.BILLING_COMP_CODES = 'MacDuffie2016, OtherComp';

const handler = (await import('../api/billing.js')).default;
const { getTeamBilling, hasPaidSeason, recordPayment } = await import('../lib/billing_store.js');

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
  beforeEach(() => { fake.map.clear(); });

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
});
