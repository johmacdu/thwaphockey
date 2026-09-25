// test/player-self-edit.test.js
//
// Guards:
//  - Player self-edit on the Team page: a signed-in, non-coach player can edit
//    ONLY their own card. Pencil is player-gated (body.is-authed:not(.is-coach)),
//    self-edit mode marks only .pcard-you-card editable, and the sheet posts to
//    self-update-player. Verified by execution (own card opens, other does not).
//  - Coach chip on the Team page is tappable in BOTH views (player chip opens a
//    read-only info sheet; coach's own chip opens the editable profile).
//  - Backend self-update-player is authorized by the player's OWN code.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
const coachJs = readFileSync(resolve(__dirname, '../api/coach.js'), 'utf8');

function bootPlayer() {
  const store = { bfPlayer: 'Liam Delatorre' };
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://x/#roster',
    beforeParse(w) {
      w.HTMLMediaElement.prototype.play = () => Promise.resolve();
      w.HTMLMediaElement.prototype.pause = () => {};
      w.scrollTo = () => {};
      w.fetch = (u) => {
        const s = String(u); let b = { ok: true };
        if (s.includes('team-coaches')) b = { ok: true, coaches: [{ name: 'Jason Coach', role: 'head' }] };
        else if (s.includes('action=roster')) b = { ok: true, members: [{ playerId: 'liam', firstName: 'Liam', lastName: 'Delatorre', number: 29, parentEmail: 'a@b.com' }] };
        else b = { players: [] };
        return Promise.resolve({ ok: true, json: () => Promise.resolve(b) });
      };
      const ls = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; }, clear: () => {} };
      Object.defineProperty(w, 'localStorage', { value: ls, configurable: true });
      Object.defineProperty(w.document, 'cookie', { get: () => 'thwapAuth=x', set: () => {}, configurable: true });
    },
  });
  return dom.window;
}

describe('Player self-edit: only the player edits themselves', () => {
  let w;
  beforeAll(async () => { w = bootPlayer(); await new Promise((r) => setTimeout(r, 200)); });

  it('shows the player pencil for a signed-in non-coach', () => {
    expect(w.document.body.classList.contains('is-coach')).toBe(false);
    expect(w.document.getElementById('rosterEditSelf')).toBeTruthy();
  });
  it('marks the signed-in player own card and opens their sheet', () => {
    const you = w.document.querySelector('#roster-grid .pcard-you-card');
    expect(you && you.getAttribute('data-name')).toBe('Liam Delatorre');
    w.document.getElementById('rosterEditSelf').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    expect(w.document.body.classList.contains('roster-selfediting')).toBe(true);
    you.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(w.document.getElementById('playerSelfSheet').hidden).toBe(false);
    expect(w.document.getElementById('psFirst').value).toBe('Liam');
  });
  it('tapping another player card does NOT open the self sheet', () => {
    w.document.getElementById('playerSelfSheet').hidden = true;
    const other = w.document.querySelector('#roster-grid .pcard[data-name="Alder Reese"]');
    other.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(w.document.getElementById('playerSelfSheet').hidden).toBe(true);
  });
});

describe('Coach chip tappable in both views', () => {
  it('player-view coach chips render a name button that opens the info sheet', async () => {
    const w = bootPlayer();
    await new Promise((r) => setTimeout(r, 200));
    const btn = w.document.querySelector('#coachStrip .bcoach-nmbtn');
    expect(btn).toBeTruthy();
    btn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    expect(w.document.getElementById('coachInfoSheet').hidden).toBe(false);
  });
  it('the read-only coach info sheet + helper exist', () => {
    expect(html).toContain("id='coachInfoSheet'");
    expect(html).toContain('window.thwapShowCoachInfo=function');
  });
});

describe('Backend: self-update-player is authorized by the player own code', () => {
  it('checks the submitted code against jersey + season year and only updates that player', () => {
    expect(coachJs).toContain("case 'self-update-player': return selfUpdatePlayer(req, res);");
    expect(coachJs).toContain('async function selfUpdatePlayer');
    expect(coachJs).toMatch(/entered !== cur \+ '2027' && entered !== cur \+ '2026'/);
    // position is NOT editable via self-update (coach owns roster position)
    const fn = coachJs.slice(coachJs.indexOf('async function selfUpdatePlayer'), coachJs.indexOf('async function adminRoster'));
    expect(fn).toContain('updateMember(pid, { firstName, lastName, number, parentEmail, parentEmail2 })');
  });
});

describe('CSS gates: player-only pencil + own-card-only edit', () => {
  it('the player pencil is scoped to a signed-in non-coach', () => {
    expect(html).toContain('body.is-authed:not(.is-coach) .roster-playeronly{display:block}');
  });
  it('self-edit mode makes only the own card editable', () => {
    expect(html).toContain('body.roster-selfediting #roster-grid .pcard:not(.pcard-you-card){opacity:.4;pointer-events:none}');
  });
  it('coach pencil is hidden for a signed-in player, and self-edit shows Cancel + Done', () => {
    const w = bootPlayer();
    return new Promise((r) => setTimeout(r, 200)).then(() => {
      const d = w.document;
      d.body.classList.remove('login-locked'); d.body.classList.add('is-authed');
      const g = (el) => (el ? w.getComputedStyle(el).display : 'none');
      // the middle (coach) pencil must NOT show for a player
      expect(g(d.getElementById('rosterEdit'))).toBe('none');
      // the player pencil shows
      expect(g(d.getElementById('rosterEditSelf'))).not.toBe('none');
      // entering self-edit reveals BOTH Cancel and Done (the bug: only Done showed)
      d.getElementById('rosterEditSelf').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
      expect(g(d.getElementById('rosterEditSelfActions'))).toBe('flex');
      expect(g(d.getElementById('rosterEditSelfCancel'))).not.toBe('none');
      expect(g(d.getElementById('rosterEditSelfDone'))).not.toBe('none');
    });
  });
});
