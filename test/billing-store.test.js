// test/billing-store.test.js
//
// Unit tests for lib/billing_store.js with an in-memory FakeRedis (no network).
// Covers: empty/new teams, free (comp) teams like Lewie's, recording a paid
// season and the active-only-within-that-season rule, case-insensitive team
// codes, rejection of bad season keys, and the status summary.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FakeRedis } from './fakeRedis.js';

const fake = new FakeRedis();
vi.mock('@upstash/redis', () => ({ Redis: class { constructor() { return fake; } } }));

// Import AFTER the mock is registered, so billing_store captures the FakeRedis.
const {
  getTeamBilling,
  setTeamFree,
  recordPayment,
  hasPaidSeason,
  isTeamActive,
  billingStatus,
  billingScreen,
  paidSeasons,
  recordSubscription,
  subscriptionCustomer,
  subscriptionActive,
  billingEnforced,
  isGated,
} = await import('../lib/billing_store.js');

const FW = new Date('2025-10-15T19:00:00Z'); // Fall/Winter 2025
const SP = new Date('2026-04-15T19:00:00Z'); // Spring 2026

describe('billing_store', () => {
  beforeEach(() => { fake.map.clear(); });
  afterEach(() => { delete process.env.BILLING_ENFORCED; });

  it('a brand-new team is empty and inactive', async () => {
    expect(await getTeamBilling('RANGER10U')).toEqual({ free: false, seasons: {}, subscription: null });
    expect(await isTeamActive('RANGER10U', FW)).toBe(false);
    expect(await paidSeasons('RANGER10U')).toEqual([]);
  });

  it('a free (comp) team is always active, no payment needed', async () => {
    await setTeamFree('LEWIE', true);
    expect(await isTeamActive('LEWIE', FW)).toBe(true);
    expect(await isTeamActive('LEWIE', SP)).toBe(true);
    expect(await billingStatus('LEWIE', FW)).toMatchObject({ free: true, active: true, currentSeason: 'fw-2025' });
  });

  it('a recorded season activates the team only within that season', async () => {
    await recordPayment('ABC1234', 'fw-2025', { amountCents: 35000, stripeSession: 'cs_test_1' });
    expect(await hasPaidSeason('ABC1234', 'fw-2025')).toBe(true);
    expect(await isTeamActive('ABC1234', FW)).toBe(true); // inside fall/winter
    expect(await isTeamActive('ABC1234', SP)).toBe(false); // spring not paid
    expect(await paidSeasons('ABC1234')).toEqual(['fw-2025']);
    const b = await getTeamBilling('ABC1234');
    expect(b.seasons['fw-2025']).toMatchObject({ amountCents: 35000, currency: 'usd', stripeSession: 'cs_test_1' });
    expect(b.seasons['fw-2025'].paidAt).toBeTruthy();
  });

  it('is case-insensitive on the team code and rejects bad season keys', async () => {
    await recordPayment('abc1234', 'sp-2026', { amountCents: 9000 });
    expect(await hasPaidSeason('ABC1234', 'sp-2026')).toBe(true); // same team, different case
    expect(await recordPayment('ABC1234', 'winter', {})).toBeNull();
    expect(await hasPaidSeason('ABC1234', 'winter')).toBe(false);
  });

  it('billingStatus reports the current season and the paid list', async () => {
    await recordPayment('T1', 'fw-2025', { amountCents: 35000 });
    await recordPayment('T1', 'sp-2026', { amountCents: 9000 });
    const s = await billingStatus('T1', FW);
    expect(s.currentSeason).toBe('fw-2025');
    expect(s.active).toBe(true);
    expect(s.paidSeasons.sort()).toEqual(['fw-2025', 'sp-2026']);
  });

  it('billingScreen lists paid seasons with receipts and the seasons left to buy', async () => {
    await recordPayment('SCR1', 'fw-2025', { amountCents: 35000, stripeSession: 'cs_live_1' });
    const screen = await billingScreen('SCR1', FW);

    // Already paid: the current Fall/Winter, with its receipt fields and not a comp.
    expect(screen.currentSeason).toBe('fw-2025');
    expect(screen.active).toBe(true);
    expect(screen.paid).toHaveLength(1);
    expect(screen.paid[0]).toMatchObject({
      key: 'fw-2025', label: 'Fall/Winter 2025-26', amountCents: 35000, comp: false, current: true,
    });
    expect(screen.paid[0].paidAt).toBeTruthy();

    // Buyable: the next two seasons ahead, priced, with fw-2025 dropped (already paid).
    expect(screen.buyable.map((s) => s.key)).toEqual(['sp-2026', 'os-2026']);
    expect(screen.buyable[0]).toMatchObject({ key: 'sp-2026', priceCents: 9000, current: false });
  });

  it('an active subscription keeps a team active in every season, with no per-season payment', async () => {
    await recordSubscription('SUB1', {
      id: 'sub_1', customer: 'cus_1', status: 'active',
      priceId: 'price_annual', amountCents: 50000,
      currentPeriodEnd: '2026-10-01T00:00:00.000Z', cancelAtPeriodEnd: false,
    });
    expect(subscriptionActive((await getTeamBilling('SUB1')).subscription)).toBe(true);
    expect(await isTeamActive('SUB1', FW)).toBe(true);
    expect(await isTeamActive('SUB1', SP)).toBe(true); // covers spring too, nothing bought per-season
    expect(await subscriptionCustomer('SUB1')).toBe('cus_1');
    const st = await billingStatus('SUB1', SP);
    expect(st).toMatchObject({ subscribed: true, active: true });
    const scr = await billingScreen('SUB1', FW);
    expect(scr.subscribed).toBe(true);
    expect(scr.subscription).toMatchObject({ status: 'active', cancelAtPeriodEnd: false });
    expect(scr.subscription.renewsAt).toBe('2026-10-01T00:00:00.000Z');
  });

  it('a canceled subscription stops covering the team', async () => {
    await recordSubscription('SUB2', { id: 'sub_2', customer: 'cus_2', status: 'active' });
    expect(await isTeamActive('SUB2', FW)).toBe(true);
    await recordSubscription('SUB2', { status: 'canceled' }); // keeps the stored customer id
    expect(await isTeamActive('SUB2', FW)).toBe(false);
    expect(await subscriptionCustomer('SUB2')).toBe('cus_2'); // retained for the portal
    expect((await billingStatus('SUB2', FW)).subscribed).toBe(false);
  });

  it('past_due is a grace window that still counts as active', () => {
    expect(subscriptionActive({ status: 'past_due' })).toBe(true);
    expect(subscriptionActive({ status: 'canceled' })).toBe(false);
    expect(subscriptionActive(null)).toBe(false);
  });

  it('billingScreen flags a comp season and a free team', async () => {
    await recordPayment('SCR2', 'fw-2025', { amountCents: 0, stripeSession: 'comp:macduffie2016' });
    const screen = await billingScreen('SCR2', FW);
    expect(screen.paid[0]).toMatchObject({ key: 'fw-2025', comp: true });

    await setTeamFree('SCR3', true);
    const free = await billingScreen('SCR3', FW);
    expect(free).toMatchObject({ free: true, active: true });
    expect(free.paid).toEqual([]);
    expect(free.buyable.map((s) => s.key)).toEqual(['fw-2025', 'sp-2026', 'os-2026']);
  });

  it('recordPayment is idempotent: re-paying a season overwrites the receipt, never duplicates', async () => {
    await recordPayment('RP', 'fw-2025', { amountCents: 35000, stripeSession: 'cs_1' });
    await recordPayment('RP', 'fw-2025', { amountCents: 35000, stripeSession: 'cs_2' });
    const b = await getTeamBilling('RP');
    expect(Object.keys(b.seasons)).toEqual(['fw-2025']);
    expect(b.seasons['fw-2025'].stripeSession).toBe('cs_2');
  });

  it('recordSubscription records cancel-at-period-end and surfaces it on the screen (still active until period end)', async () => {
    await recordSubscription('CPE', {
      id: 's', customer: 'c', status: 'active', priceId: 'price_annual',
      amountCents: 50000, currentPeriodEnd: '2026-10-01T00:00:00.000Z', cancelAtPeriodEnd: true,
    });
    const scr = await billingScreen('CPE', FW);
    expect(scr.subscribed).toBe(true); // active through the end of the paid period
    expect(scr.subscription).toMatchObject({ status: 'active', cancelAtPeriodEnd: true });
  });
});

// The go-live safety property: the whole paywall is dead code until the operator
// flips BILLING_ENFORCED=1. isGated() must be a complete no-op before then, and
// must never gate a covered team (free/comp, paid season, or active subscription)
// after.
describe('enforcement gate (no-op until BILLING_ENFORCED=1)', () => {
  beforeEach(() => { fake.map.clear(); });
  afterEach(() => { delete process.env.BILLING_ENFORCED; });

  it('billingEnforced() is true ONLY for the exact string "1"', () => {
    delete process.env.BILLING_ENFORCED;
    expect(billingEnforced()).toBe(false);
    for (const v of ['0', 'true', 'yes', 'on', '']) {
      process.env.BILLING_ENFORCED = v;
      expect(billingEnforced()).toBe(false);
    }
    process.env.BILLING_ENFORCED = '1';
    expect(billingEnforced()).toBe(true);
  });

  it('isGated() is false while enforcement is OFF, even for a genuinely unpaid team', async () => {
    delete process.env.BILLING_ENFORCED;
    expect(await isTeamActive('UNPAID', FW)).toBe(false); // genuinely inactive...
    expect(await isGated('UNPAID', FW)).toBe(false); // ...but never gated pre-go-live
  });

  it('isGated() gates an unpaid team only once enforcement is ON', async () => {
    process.env.BILLING_ENFORCED = '1';
    expect(await isGated('UNPAID', FW)).toBe(true);
  });

  it('isGated() never gates a covered team (free, paid season, or active subscription), even when enforced', async () => {
    process.env.BILLING_ENFORCED = '1';
    await setTeamFree('FREE', true);
    await recordPayment('PAID', 'fw-2025', { amountCents: 35000 });
    await recordSubscription('SUBB', { id: 's', customer: 'c', status: 'active' });
    expect(await isGated('FREE', FW)).toBe(false);
    expect(await isGated('PAID', FW)).toBe(false);
    expect(await isGated('SUBB', FW)).toBe(false);
  });

  it('billingStatus echoes enforced + gated flags straight from the env', async () => {
    process.env.BILLING_ENFORCED = '1';
    expect(await billingStatus('NADA', FW)).toMatchObject({ enforced: true, active: false, gated: true });
    delete process.env.BILLING_ENFORCED;
    expect(await billingStatus('NADA', FW)).toMatchObject({ enforced: false, active: false, gated: false });
  });

  it('fails OPEN: a store-read failure never gates a team, even when enforced', async () => {
    process.env.BILLING_ENFORCED = '1';
    // a genuinely unpaid team still gates when the read succeeds (paywall works)
    expect(await isGated('UNPAID2', FW)).toBe(true);
    // but if the Redis read THROWS, an unreadable record counts as active...
    vi.spyOn(fake, 'get').mockRejectedValueOnce(new Error('redis down'));
    expect(await isTeamActive('UNPAID2', FW)).toBe(true);
    // ...so a blip never wrongly locks a real team out
    vi.spyOn(fake, 'get').mockRejectedValueOnce(new Error('redis down'));
    expect(await isGated('UNPAID2', FW)).toBe(false);
    vi.restoreAllMocks();
  });
});
