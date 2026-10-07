// test/views-structure.test.js
//
// Per-VIEW structural unit tests. The app is one static HTML file with inline
// scripts + a separate about.html, so like the other suites these are parse +
// structural assertions (no script execution): they lock that each view the
// user navigates to -- the SPLASH, the ABOUT page, the PLAYER views (home /
// Team / Standings / Stickers) and the COACH views (coach home / Plan) -- still
// exists with its key controls and its role-gating, so a refactor cannot
// silently drop a whole screen. The live-browser QA harness (qa/qa-views.cjs)
// is the behavioural companion; this is the fast regression net.
//
// @vitest-environment jsdom

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexHtml = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
const aboutHtml = readFileSync(resolve(__dirname, '../about.html'), 'utf8');

let idx, abt;
beforeAll(() => {
  idx = new DOMParser().parseFromString(indexHtml, 'text/html');
  abt = new DOMParser().parseFromString(aboutHtml, 'text/html');
});

// A view section must exist, be a real section, and carry some child content.
function sectionWithChildren(doc, id, minChildren = 1) {
  const el = doc.getElementById(id);
  expect(el, `#${id} section exists`).toBeTruthy();
  expect(el.children.length, `#${id} has children`).toBeGreaterThanOrEqual(minChildren);
  return el;
}

describe('View: SPLASH / sign-in (signed-out index.html)', () => {
  it('has the login overlay + backdrop (the frosted splash gate)', () => {
    expect(idx.getElementById('loginOverlay'), '#loginOverlay').toBeTruthy();
    expect(idx.getElementById('loginBackdrop'), '#loginBackdrop').toBeTruthy();
  });
  it('has the sign-in sheet with team select + email + code fields', () => {
    // Team dropdown + parent email + 6-digit code (no password, no player dropdown)
    expect(indexHtml).toContain('loginTeam');
    expect(indexHtml).toMatch(/id='loginEmail'|id="loginEmail"/);
    expect(indexHtml).toMatch(/one-time-code|id='loginCode'|id="loginCode"/);
  });
  it('exposes a glass close affordance on the sheet', () => {
    expect(idx.querySelector('.login-modal .glassclose, .glassclose'), 'glass close').toBeTruthy();
  });
  it('the auth-aware header carries guest links (About / Sign In / Join Waitlist)', () => {
    const guest = idx.querySelector('.nav-guest');
    expect(guest, '.nav-guest').toBeTruthy();
    expect(guest.textContent).toMatch(/About/i);
    expect(guest.textContent).toMatch(/Sign In/i);
    expect(guest.textContent).toMatch(/Waitlist/i);
  });
});

describe('View: ABOUT page (about.html)', () => {
  it('has a title and the brand header', () => {
    expect(abt.querySelector('title')?.textContent).toMatch(/thwap/i);
  });
  it('has the two parallax pin tracks (team-trains + for-coaches)', () => {
    const pins = abt.querySelectorAll('.pin');
    expect(pins.length, 'parallax .pin tracks').toBeGreaterThanOrEqual(2);
  });
  it('names both parallax sections by their eyebrows', () => {
    expect(aboutHtml).toMatch(/How the team trains together/i);
    expect(aboutHtml).toMatch(/For coaches/i);
  });
  it('has the live-demo phone embedding the real app', () => {
    const phone = abt.querySelector('.phone .phone-frame');
    expect(phone, '.phone-frame').toBeTruthy();
    expect(phone.getAttribute('src')).toMatch(/demo=1/);
  });
  it('mobile-centers the live-demo phone (margin:auto, not grid-only)', () => {
    expect(aboutHtml).toMatch(/\.phone\{[^}]*margin-left:auto/);
    expect(aboutHtml).toMatch(/\.phone\{[^}]*margin-right:auto/);
  });
});

describe('View: PLAYER home (#home)', () => {
  it('exists as the final section (required for :target hash nav)', () => {
    const sections = [...idx.querySelectorAll('section[id]')];
    expect(sections[sections.length - 1].id).toBe('home');
  });
  it('has the kid-voice greeting + the three discipline rows', () => {
    expect(idx.getElementById('homePlayer'), '#homePlayer greeting').toBeTruthy();
    for (const id of ['stick', 'shoot', 'dryland']) {
      expect(idx.getElementById(id), `#${id} discipline row`).toBeTruthy();
    }
  });
});

describe('View: PLAYER Team / roster (#roster)', () => {
  it('exists with the roster grid', () => {
    sectionWithChildren(idx, 'roster');
    expect(idx.getElementById('roster-grid'), '#roster-grid').toBeTruthy();
  });
  it('has a glass close back to home', () => {
    expect(idx.querySelector("#roster .glassclose"), '#roster close').toBeTruthy();
  });
});

describe('View: PLAYER Standings (#progress)', () => {
  it('exists with the board + timeframe tablist', () => {
    sectionWithChildren(idx, 'progress');
    expect(idx.getElementById('board'), '#board').toBeTruthy();
    expect(idx.querySelectorAll('#timeframe .segbtn').length, 'timeframe segments').toBeGreaterThanOrEqual(2);
  });
});

describe('View: PLAYER Stickers (#stickers)', () => {
  it('exists with the sticker book + player card deck', () => {
    sectionWithChildren(idx, 'stickers');
    expect(idx.getElementById('stickerBook'), '#stickerBook').toBeTruthy();
    expect(idx.getElementById('deckWrap'), '#deckWrap (card deck)').toBeTruthy();
  });
});

describe('View: COACH home (#coachhome)', () => {
  it('exists with the participation + development + attention blocks', () => {
    sectionWithChildren(idx, 'coachhome');
    expect(idx.getElementById('chDevLab'), 'Player goals block').toBeTruthy();
    expect(idx.getElementById('chAttnLab'), 'Not-training-yet block').toBeTruthy();
  });
  it('is gated to coaches: body.is-coach reveals it and hides player #home', () => {
    expect(indexHtml).toMatch(/body\.is-coach #home\{display:none!important\}/);
  });
});

describe('View: COACH Plan (#plan)', () => {
  it('exists with the plan grid', () => {
    sectionWithChildren(idx, 'plan');
    expect(idx.getElementById('planGrid'), '#planGrid').toBeTruthy();
  });
  it('coach nav exposes Team / Plan / Standings', () => {
    const coachNav = idx.querySelector('.toplinks .nav-coach');
    expect(coachNav, '.nav-coach').toBeTruthy();
    expect(coachNav.textContent).toMatch(/Team/);
    expect(coachNav.textContent).toMatch(/Plan/);
    expect(coachNav.textContent).toMatch(/Standings/);
  });
});

describe('Role gating: the three audiences are mutually exclusive', () => {
  it('guest sees guest nav; authed hides it; coach swaps to coach nav', () => {
    expect(indexHtml).toMatch(/body:not\(\.is-authed\) \.nav-guest\{display:inline-flex\}/);
    expect(indexHtml).toMatch(/body\.is-coach \.nav-authed\{display:none\}/);
    expect(indexHtml).toMatch(/body\.is-coach \.nav-coach\{display:inline-flex\}/);
  });
  it('every hash-routed view is a .page that hides until :target', () => {
    expect(indexHtml).toMatch(/\.page\{display:none\}/);
    expect(indexHtml).toMatch(/\.page:target\{display:block/);
  });
});
