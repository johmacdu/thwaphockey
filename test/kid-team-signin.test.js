// test/kid-team-signin.test.js
//
// EXECUTION test: a kid on a team other than the built-in Jr Rangers signs in
// with their team code, and then sees their own team (not the Rangers).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));

const FALCONS = [
  { playerId: 'sam', firstName: 'Sam', lastName: 'Lee', number: 9, position: 'F' },
  { playerId: 'ava', firstName: 'Ava', lastName: 'Cruz', number: 30, position: 'G' },
];

async function boot({ url = 'https://thwaphockey.com/', cookie = '', storage = {}, signin } = {}) {
  const calls = [];
  const vc = new VirtualConsole(); // jsdom cannot reload; keep that noise out of the run
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url, virtualConsole: vc,
    beforeParse(window) {
      window.scrollTo = () => {};
      window.HTMLMediaElement.prototype.play = () => Promise.resolve();
      if (cookie) window.document.cookie = cookie;
      for (const [k, v] of Object.entries(storage)) window.localStorage.setItem(k, v);
      window.fetch = (u, opts = {}) => {
        calls.push({ url: String(u), body: opts.body ? JSON.parse(opts.body) : null });
        const reply = (status, j) => Promise.resolve({ ok: status < 300, status, json: () => Promise.resolve(j) });
        if (/action=code-signin/.test(u)) return reply(signin ? signin.status : 401, signin ? signin.body : { error: 'bad code' });
        if (/action=roster/.test(u) && /code=FALCONS42/.test(u)) return reply(200, { ok: true, team: { code: 'FALCONS42', name: 'Falcons 10U' }, members: FALCONS });
        return reply(404, {});
      };
    },
  });
  await tick(100);
  const w = dom.window;
  return { w, $: (id) => w.document.getElementById(id), calls };
}

function fillSignIn(t, { team = 'FALCONS42', code = '92026' } = {}) {
  t.$('loginTeam').value = 'code';
  t.$('loginTeam').dispatchEvent(new t.w.Event('change'));
  t.$('loginTeamCode').value = team;
  t.$('loginEmail').value = 'sam@example.com';
  t.$('loginPw').value = code;
  t.$('loginConsent').checked = true;
  t.$('loginForm').dispatchEvent(new t.w.Event('submit', { cancelable: true }));
}

describe('sign-in sheet: My team has a code', () => {
  it('offers the choice and shows the Team code field only when picked', async () => {
    const t = await boot({ url: 'https://thwaphockey.com/#login' });
    expect([...t.$('loginTeam').options].map((o) => o.textContent)).toContain('My team has a code');
    expect(t.$('loginTeamCodeField').hidden).toBe(true);
    t.$('loginTeam').value = 'code';
    t.$('loginTeam').dispatchEvent(new t.w.Event('change'));
    expect(t.$('loginTeamCodeField').hidden).toBe(false);
  });

  it('a ?team= link picks it and fills the code in', async () => {
    const t = await boot({ url: 'https://thwaphockey.com/?team=falcons42#login' });
    expect(t.$('loginTeam').value).toBe('code');
    expect(t.$('loginTeamCode').value).toBe('FALCONS42');
    expect(t.$('loginTeamCodeField').hidden).toBe(false);
  });

  it('asks the server with the team code and no player id, then remembers the team', async () => {
    const t = await boot({ url: 'https://thwaphockey.com/#login',
      signin: { status: 200, body: { ok: true, player: { id: 'sam', name: 'Sam', number: 9, teamCode: 'FALCONS42', teamName: 'Falcons 10U' } } } });
    fillSignIn(t);
    await tick();
    const call = t.calls.find((c) => /code-signin/.test(c.url));
    expect(call.body).toMatchObject({ teamCode: 'FALCONS42', code: '92026' });
    expect(call.body.playerId).toBeUndefined();
    expect(t.calls.some((c) => /coach-login/.test(c.url))).toBe(false);
    const rec = JSON.parse(decodeURIComponent(t.w.document.cookie.match(/thwapAuth=([^;]*)/)[1]));
    expect(rec).toMatchObject({ pid: 'sam', name: 'Sam', team: 'FALCONS42', teamName: 'Falcons 10U', num: 9 });
    expect(t.w.localStorage.getItem('thwapKidTeamName')).toBe('Falcons 10U');
  });

  it('a wrong code says so', async () => {
    const t = await boot({ url: 'https://thwaphockey.com/#login' });
    fillSignIn(t, { code: '992026' });
    await tick();
    expect(t.$('loginErr').textContent).toBe('That team code or your code did not match.');
  });

  it('a new device goes to the parent step', async () => {
    const t = await boot({ url: 'https://thwaphockey.com/#login',
      signin: { status: 200, body: { ok: false, needsParentCode: true, sent: true, player: { id: 'sam', name: 'Sam', number: 9 } } } });
    fillSignIn(t);
    await tick();
    expect(t.$('loginParentView').hidden).toBe(false);
  });

  it('needs a team code', async () => {
    const t = await boot({ url: 'https://thwaphockey.com/#login' });
    fillSignIn(t, { team: '' });
    expect(t.$('loginErr').textContent).toBe('Enter your team code.');
  });
});

const SAM = 'thwapAuth=' + encodeURIComponent(JSON.stringify({ pid: 'sam', name: 'Sam', email: 'sam@example.com', year: '2026', team: 'FALCONS42', teamName: 'Falcons 10U', num: 9, ts: 1 }));

describe('a signed-in kid on another team', () => {
  it('sees their own roster, not the Rangers', async () => {
    const t = await boot({ url: 'https://thwaphockey.com/#roster', cookie: SAM, storage: { bfPlayer: 'Sam' } });
    expect(t.w.thwapKidTeamCode()).toBe('FALCONS42');
    expect(t.calls.some((c) => /action=roster&code=FALCONS42/.test(c.url))).toBe(true);
    const names = [...t.w.document.querySelectorAll('#roster-grid .pcard[data-name]')].map((c) => c.getAttribute('data-name'));
    expect(names).toEqual(['Sam Lee', 'Ava Cruz']);
    expect(t.w.document.querySelector('#roster-grid .pcard[data-pid="sam"]').classList.contains('pcard-you-card')).toBe(true);
  });

  it('sees the team name, not Rangers', async () => {
    const t = await boot({ url: 'https://thwaphockey.com/#home', cookie: SAM, storage: { bfPlayer: 'Sam' } });
    expect(t.$('homeKicker').textContent).toBe('Falcons 10U');
    expect(t.$('lbKicker').textContent).toBe('Falcons 10U');
    expect(t.$('rosterKicker').textContent).toBe('Falcons 10U, 2 players');
    expect(t.w.thwapTeamLabel).toBe('Falcons 10U');
  });

  it('card facts come from their team roster', async () => {
    const t = await boot({ cookie: SAM, storage: { bfPlayer: 'Sam' } });
    expect(t.w.thwapDemoInfo('Ava Cruz')).toEqual({ num: '30', pos: 'G', photo: '' });
    // The Team grid's own redraw uses the same facts (not the Rangers list).
    expect(t.w.thwapInfoFor('Ava Cruz').info).toMatchObject({ num: '30', pos: 'G' });
  });

  it('a Rangers kid is unchanged', async () => {
    const lewie = 'thwapAuth=' + encodeURIComponent(JSON.stringify({ pid: 'lewie', name: 'Lewie Reese', email: 'x@example.com', year: '2026', ts: 1 }));
    const t = await boot({ url: 'https://thwaphockey.com/#roster', cookie: lewie, storage: { bfPlayer: 'Lewie Reese' } });
    expect(t.w.thwapKidOtherTeam()).toBe(false);
    expect(t.w.document.querySelectorAll('#roster-grid .pcard[data-name]').length).toBeGreaterThan(10);
    expect(t.calls.some((c) => /action=roster&code=FALCONS42/.test(c.url))).toBe(false);
  });
});
