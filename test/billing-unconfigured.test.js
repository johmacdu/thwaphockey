// test/billing-unconfigured.test.js
//
// The pre-go-live state: Stripe is NOT configured yet (no STRIPE_SECRET_KEY /
// STRIPE_WEBHOOK_SECRET). Every Stripe-touching action must return a clean 503
// (never crash), while the read-only status/screen endpoints and the
// Stripe-independent comp-code redemption keep working. This guards the invariant
// that the billing system is inert and safe before the operator wires Stripe up.
//
// This file deliberately imports api/billing.js with the Stripe env UNSET. Vitest
// isolates module + env state per test file, so the lazy getStripe() memoizes null
// here without affecting the configured billing-endpoint tests.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FakeRedis } from './fakeRedis.js';
import { currentSeasonKey } from '../lib/seasons.js';

const fake = new FakeRedis();
vi.mock('@upstash/redis', () => ({ Redis: class { constructor() { return fake; } } }));

// Make sure Stripe looks unconfigured regardless of the ambient shell env.
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;
delete process.env.BILLING_ENFORCED;

const handler = (await import('../api/billing.js')).default;
const { getTeamBilling, hasPaidSeason } = await import('../lib/billing_store.js');

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

describe('api/billing with Stripe not configured (pre-go-live)', () => {
  beforeEach(() => { fake.map.clear(); });

  it('every Stripe-touching action returns a clean 503, never a crash', async () => {
    for (const action of ['create-checkout', 'create-subscription', 'portal', 'webhook']) {
      const res = await call({ method: 'POST', query: { action }, headers: {}, body: '{}' });
      expect(res.statusCode, action).toBe(503);
      expect(res.body.error, action).toBeTruthy();
    }
  });

  it('status is still live (public, no Stripe needed) and reports inactive', async () => {
    const res = await call({ method: 'GET', query: { action: 'status', code: 'ANY1' }, headers: {} });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, active: false, free: false });
    expect(res.body.enforced).toBe(false); // enforcement off by default too
  });

  it('screen is still live for a real team', async () => {
    fake._seed('team:PUB1', { code: 'PUB1', name: 'Public Team' });
    const res = await call({ method: 'GET', query: { action: 'screen', code: 'PUB1' }, headers: {} });
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.buyable)).toBe(true);
  });

  it('comp-code redemption works WITHOUT Stripe (Lewie can be comped before Stripe is wired)', async () => {
    process.env.BILLING_COMP_CODES = 'MacDuffie2016';
    fake._seed('team:LEWIE', { code: 'LEWIE' });
    const res = await call({ method: 'POST', query: { action: 'redeem' }, headers: {}, body: JSON.stringify({ code: 'LEWIE', comp: 'MacDuffie2016' }) });
    delete process.env.BILLING_COMP_CODES;
    expect(res.statusCode).toBe(200);
    expect(await hasPaidSeason('LEWIE', currentSeasonKey(new Date()))).toBe(true);
  });

  it('set-free (admin comp) works WITHOUT Stripe', async () => {
    process.env.BILLING_ADMIN_SECRET = 'adm_s';
    const res = await call({ method: 'POST', query: { action: 'set-free' }, headers: {}, body: JSON.stringify({ code: 'LEWIE', free: true, secret: 'adm_s' }) });
    delete process.env.BILLING_ADMIN_SECRET;
    expect(res.statusCode).toBe(200);
    expect((await getTeamBilling('LEWIE')).free).toBe(true);
  });
});
