// test/join-thwap.test.js
//
// EXECUTION test: boots index.html in jsdom and walks the Join Thwap page
// (docs/team-onboarding.md) with a fake server: team -> about you -> email code
// -> plan -> ready, plus the day-one checklist on coach home.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

async function boot({ url = 'https://thwaphockey.com/', storage = {} } = {}) {
  const calls = [];
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url,
    beforeParse(window) {
      window.scrollTo = () => {};
      window.HTMLMediaElement.prototype.play = () => Promise.resolve();
      for (const [k, v] of Object.entries(storage)) window.localStorage.setItem(k, v);
      window.fetch = (u, opts = {}) => {
        const body = opts.body ? JSON.parse(opts.body) : {};
        calls.push({ url: String(u), body });
        const reply = (status, j) => Promise.resolve({ ok: status < 300, status, json: () => Promise.resolve(j) });
        if (/action=coach-start/.test(u)) return reply(200, { ok: true });
        if (/action=coach-verify/.test(u)) {
          return body.code === '123456'
            ? reply(200, { ok: true, token: 't', coach: { name: 'Dana Ortiz' }, team: { code: 'FALCONS42', name: 'Falcons 10U', ageGroup: '10U' } })
            : reply(401, { error: 'bad code' });
        }
        if (/action=create-subscription/.test(u)) return reply(200, { url: 'https://checkout.stripe.test/x' });
        return reply(404, {});
      };
    },
  });
  await tick(80);
  const w = dom.window;
  const $ = (id) => w.document.getElementById(id);
  return { w, $, calls };
}

function open(t) {
  t.$('loginCoach').click();
  return t.$('coachSignupForm');
}

describe('Join Thwap entry points', () => {
  it('the header says Join Thwap, not Join Waitlist', async () => {
    const t = await boot();
    expect(t.$('navWaitlist').textContent).toBe('Join Thwap');
    expect(t.w.document.querySelector('.nav-guest').textContent).not.toMatch(/Waitlist/);
  });
  it('opens on step 1 with no Back button', async () => {
    const t = await boot();
    const f = open(t);
    expect(f.hidden).toBe(false);
    expect(t.$('jnStepLab').textContent).toBe('Step 1 of 4');
    expect(t.$('jnTitle').textContent).toBe('Your team');
    expect(t.$('jnBack').hidden).toBe(true);
    expect(t.$('jn-team').hidden).toBe(false);
  });
});

describe('Join Thwap steps', () => {
  it('requires the association', async () => {
    const t = await boot();
    open(t);
    t.$('jnTeam').value = 'Falcons 10U';
    t.$('jnTeamGo').click();
    expect(t.$('jnTeamErr').textContent).toBe('Enter your association.');
    expect(t.$('jn-team').hidden).toBe(false);
  });

  it('walks team, about you, code and plan, and sends the right details', async () => {
    const t = await boot();
    open(t);
    t.$('jnTeam').value = 'Falcons 10U';
    t.$('jnAssoc').value = 'Portland Junior Hockey';
    t.$('jnTeamGo').click();
    expect(t.$('jnTitle').textContent).toBe('About you');
    expect(t.$('jnBack').hidden).toBe(false);

    t.$('jnName').value = 'Dana Ortiz';
    t.$('jnEmail').value = 'dana@example.com';
    t.w.document.querySelector("#jnRole [data-role='manager']").click();
    expect(t.$('jnRoleHint').textContent).toMatch(/Managers handle payment/);
    t.$('jnYouGo').click();
    expect(t.$('jnYouErr').textContent).toBe('Please agree to the Terms and Privacy Policy.');
    t.$('csConsent').checked = true;
    t.$('jnYouGo').click();
    await tick();
    const start = t.calls.find((c) => /coach-start/.test(c.url));
    expect(start.body).toMatchObject({ email: 'dana@example.com', name: 'Dana Ortiz', role: 'manager', team: 'Falcons 10U', association: 'Portland Junior Hockey', ageGroup: '10U' });
    expect(start.body.password).toBeUndefined();
    expect(t.$('jnTitle').textContent).toBe('Check your email');
    expect(t.$('jnSub').textContent).toMatch(/dana@example\.com/);

    t.$('jnCode').value = '111111';
    t.$('jnCodeGo').click();
    await tick();
    expect(t.$('jnCodeErr').textContent).toMatch(/not right/);

    t.$('jnCode').value = '123456';
    t.$('jnCodeGo').click();
    await tick();
    expect(t.$('jnTitle').textContent).toBe('Pick a plan');
    expect(t.$('jnBack').hidden).toBe(true);
    const coach = JSON.parse(t.w.localStorage.getItem('thwapCoach'));
    expect(coach).toMatchObject({ token: 't', role: 'manager', teams: ['FALCONS42'] });
    expect(t.w.document.querySelector('input[name="jnPlan"]:checked').value).toBe('yearly');
  });

  it('sends the picked plan to checkout', async () => {
    const t = await boot({ storage: { thwapJoin: JSON.stringify({ step: 'plan', code: 'FALCONS42' }) } });
    open(t);
    expect(t.$('jnTitle').textContent).toBe('Pick a plan');
    t.w.document.querySelector('input[name="jnPlan"][value="monthly"]').checked = true;
    t.$('jnPay').click();
    await tick();
    const sub = t.calls.find((c) => /create-subscription/.test(c.url));
    expect(sub.body).toEqual({ code: 'FALCONS42', plan: 'monthly' });
  });

  it('picks up where the coach left off', async () => {
    const t = await boot({ storage: { thwapJoin: JSON.stringify({ step: 'you', team: 'Falcons 10U', assoc: 'Portland Junior Hockey', age: '12U' }) } });
    open(t);
    expect(t.$('jnTitle').textContent).toBe('About you');
    t.$('jnBack').click();
    expect(t.$('jnTeam').value).toBe('Falcons 10U');
    expect(t.$('jnAge').value).toBe('12U');
  });

  it('shows the team code when back from checkout', async () => {
    // A coach coming back from Stripe is already signed in (coach-verify stored thwapCoach).
    const t = await boot({ url: 'https://thwaphockey.com/#joined', storage: {
      thwapJoin: JSON.stringify({ step: 'plan', code: 'FALCONS42' }),
      thwapCoach: JSON.stringify({ token: 't', email: 'dana@example.com', name: 'Dana Ortiz', teams: ['FALCONS42'], teamList: [{ code: 'FALCONS42', name: 'Falcons 10U' }] }),
    } });
    expect(t.$('coachSignupForm').hidden).toBe(false);
    expect(t.$('jnTitle').textContent).toBe('Your team is ready!');
    expect(t.$('csCode').textContent).toBe('FALCONS42');
  });
});

describe('coach home day-one checklist', () => {
  it('lists the steps for a team that just joined, with Pay done', async () => {
    const t = await boot({ storage: { thwapJoin: JSON.stringify({ step: 'done', code: 'FALCONS42' }) } });
    t.w.thwapJoinTodo();
    expect(t.$('jnTodo').hidden).toBe(false);
    expect(t.$('jnTodoPay').classList.contains('done')).toBe(true);
    expect(t.$('jnTodoPlayers').classList.contains('done')).toBe(false);
    expect(t.$('jnTodoInviteSub').textContent).toBe('Send your team code FALCONS42');
  });
  it('stays hidden for a team that did not join on this device', async () => {
    const t = await boot();
    t.w.thwapJoinTodo();
    expect(t.$('jnTodo').hidden).toBe(true);
  });
});
