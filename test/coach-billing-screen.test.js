// test/coach-billing-screen.test.js
//
// EXECUTION test: boots index.html in jsdom AS A COACH and drives the coach-home
// "Team billing" card (window.thwapRenderBilling) against a mocked
// /api/billing?action=screen response. Guards the proactive billing screen
// (see paid seasons + buy seasons ahead), which is separate from the reactive
// paywall banner.
//
// The coach session is seeded into localStorage before parse so the coach-boot
// script adds body.is-coach and routes to #coachhome, where the card renders.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');

const COACH = { token: 'tkn', email: 'coach@test.com', name: 'Coach', teams: ['TESTTEAM'], teamList: [{ code: 'TESTTEAM', name: 'Test Team' }], childPlayerId: null };

async function boot(screen, { search = '' } = {}) {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: `https://thwaphockey.com/${search}`,
    beforeParse(window) {
      window.scrollTo = () => {};
      window.HTMLMediaElement.prototype.play = () => Promise.resolve();
      try { window.localStorage.setItem('thwapCoach', JSON.stringify(COACH)); } catch (e) { /* noop */ }
      window.fetch = (u) => {
        const url = String(u);
        if (url.indexOf('action=screen') >= 0) {
          if (screen === null) return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ error: 'team not found' }) });
          return Promise.resolve({ ok: true, json: () => Promise.resolve(screen) });
        }
        // Everything else the coach boot touches: benign empty responses.
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: false }) });
      };
    },
  });
  await new Promise((r) => setTimeout(r, 120));
  return dom.window;
}

describe('coach billing screen (coach home card)', () => {
  it('a paying team shows paid seasons, a receipt note, and buy-ahead buttons', async () => {
    const win = await boot({
      ok: true, free: false, enforced: true, currentSeason: 'fw-2025', active: true,
      paid: [{ key: 'fw-2025', label: 'Fall/Winter 2025-26', paidAt: '2025-10-01T12:00:00.000Z', amountCents: 35000, comp: false, current: true }],
      buyable: [
        { key: 'sp-2026', label: 'Spring 2026', priceCents: 9000, current: false },
        { key: 'os-2026', label: 'Off-season 2026', priceCents: 6000, current: false },
      ],
    });
    const wrap = win.document.getElementById('chBilling');
    const card = win.document.getElementById('chBillingCard');
    expect(wrap.hidden).toBe(false);
    expect(card.textContent).toContain('You are set for Fall/Winter 2025-26');
    expect(card.textContent).toContain('Fall/Winter 2025-26');
    expect(card.textContent).toContain('$350');
    expect(card.textContent).toContain('Stripe emails a receipt');
    const buys = card.querySelectorAll('.chb-buy[data-key]'); // season buttons (the Subscribe CTA has no data-key)
    expect(buys.length).toBe(2);
    expect(Array.from(buys).map((b) => b.getAttribute('data-key'))).toEqual(['sp-2026', 'os-2026']);
    // Buy-ahead says "Buy ahead" (not "Pay now") since the current season is paid.
    expect(buys[0].textContent).toBe('Buy ahead');
    // A non-subscribed team is also offered the annual auto-renew.
    expect(card.querySelector('#chbSub')).toBeTruthy();
  });

  it('a comped (free) team shows comped and no buy buttons', async () => {
    const win = await boot({
      ok: true, free: true, enforced: true, currentSeason: 'fw-2025', active: true,
      paid: [], buyable: [{ key: 'fw-2025', label: 'Fall/Winter 2025-26', priceCents: 35000, current: true }],
    });
    const card = win.document.getElementById('chBillingCard');
    expect(win.document.getElementById('chBilling').hidden).toBe(false);
    expect(card.textContent).toContain('comped');
    expect(card.querySelectorAll('.chb-buy').length).toBe(0);
  });

  it('an unpaid team shows "Pay now" for the current season', async () => {
    const win = await boot({
      ok: true, free: false, enforced: true, currentSeason: 'fw-2025', active: false,
      paid: [], buyable: [{ key: 'fw-2025', label: 'Fall/Winter 2025-26', priceCents: 35000, current: true }],
    });
    const card = win.document.getElementById('chBillingCard');
    expect(card.textContent).toContain('No season is active');
    const buy = card.querySelector('.chb-buy[data-key]');
    expect(buy).toBeTruthy();
    expect(buy.textContent).toBe('Pay now');
  });

  it('a success return from Stripe shows a confirmation line', async () => {
    const win = await boot({
      ok: true, free: false, enforced: true, currentSeason: 'fw-2025', active: true,
      paid: [{ key: 'fw-2025', label: 'Fall/Winter 2025-26', paidAt: '2025-10-01T12:00:00.000Z', amountCents: 35000, comp: false, current: true }],
      buyable: [],
    }, { search: '?billing=success' });
    const msg = win.document.getElementById('chbMsg');
    expect(msg).toBeTruthy();
    expect(msg.textContent).toContain('Payment received');
  });

  it('hides the card when the screen call fails (missing team)', async () => {
    const win = await boot(null);
    expect(win.document.getElementById('chBilling').hidden).toBe(true);
  });

  it('a subscribed team shows the subscription + Manage, and no buy/subscribe buttons', async () => {
    const win = await boot({
      ok: true, free: false, enforced: true, currentSeason: 'fw-2025', active: true,
      subscribed: true,
      subscription: { status: 'active', renewsAt: '2026-08-01T00:00:00.000Z', cancelAtPeriodEnd: false, amountCents: 50000 },
      paid: [], buyable: [{ key: 'sp-2026', label: 'Spring 2026', priceCents: 9000, current: false }],
    });
    const card = win.document.getElementById('chBillingCard');
    expect(card.textContent).toContain('renews automatically');
    expect(card.querySelector('#chbManage')).toBeTruthy();
    expect(card.querySelector('#chbSub')).toBeNull(); // no Subscribe CTA once subscribed
    expect(card.querySelectorAll('.chb-buy[data-key]').length).toBe(0); // buyable suppressed
  });

  it('an unsubscribed team is offered a Subscribe button', async () => {
    const win = await boot({
      ok: true, free: false, enforced: true, currentSeason: 'fw-2025', active: false,
      subscribed: false, subscription: null,
      paid: [], buyable: [{ key: 'fw-2025', label: 'Fall/Winter 2025-26', priceCents: 35000, current: true }],
    });
    const sub = win.document.getElementById('chbSub');
    expect(sub).toBeTruthy();
    expect(sub.textContent).toBe('Subscribe');
  });

  it('a subscription set to cancel shows auto-renew is off', async () => {
    const win = await boot({
      ok: true, free: false, enforced: true, currentSeason: 'fw-2025', active: true,
      subscribed: true,
      subscription: { status: 'active', renewsAt: '2026-08-01T00:00:00.000Z', cancelAtPeriodEnd: true, amountCents: 50000 },
      paid: [], buyable: [],
    });
    const card = win.document.getElementById('chBillingCard');
    expect(card.textContent).toContain('Auto-renew is off');
    expect(card.querySelector('#chbManage')).toBeTruthy();
  });
});
