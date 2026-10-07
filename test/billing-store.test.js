// test/billing-store.test.js
//
// Unit tests for lib/billing_store.js with an in-memory FakeRedis (no network).
// Covers: empty/new teams, free (comp) teams like Lewie's, recording a paid
// season and the active-only-within-that-season rule, case-insensitive team
// codes, rejection of bad season keys, and the status summary.

import { describe, it, expect, beforeEach, vi } from 'vitest';
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
} = await import('../lib/billing_store.js');

const FW = new Date('2025-10-15T19:00:00Z'); // Fall/Winter 2025
const SP = new Date('2026-04-15T19:00:00Z'); // Spring 2026

describe('billing_store', () => {
  beforeEach(() => { fake.map.clear(); });

  it('a brand-new team is empty and inactive', async () => {
    expect(await getTeamBilling('RANGER10U')).toEqual({ free: false, seasons: {} });
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
});
