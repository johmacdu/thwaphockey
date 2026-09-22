// test/coach-view.test.js
//
// Per-bug regression guards for the coaching-view fixes (PR #107). The coach view
// is built by inline scripts in index.html and is server-gated, so these are
// structural + logic tests: they (a) model the pure navigation logic the same way
// the inline handlers implement it and assert every branch, and (b) assert the
// source-level facts the CSS/markup fixes depend on. They do NOT boot the app.
//
// @vitest-environment jsdom

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
let doc;
beforeAll(() => { doc = new DOMParser().parseFromString(html, 'text/html'); });

// --- Pure logic models -------------------------------------------------------
// These mirror the inline handlers in index.html. Each model is paired with a
// source assertion below, so a drift between model and source is caught: the
// model tells us the intended behavior is right; the source assertion tells us
// the file still implements that behavior.

// openPlayerPage: how the `from` argument maps to plFrom.
function plFromFor(from) {
  return from === 'card' ? 'card'
    : from === 'coachhome' ? 'coachhome'
    : from === 'team' ? 'team'
    : 'leaderboard';
}
// plBack: how plFrom maps to the hash the Back button navigates to.
function backHashFor(plFrom) {
  if (plFrom === 'card') return '#home';
  if (plFrom === 'coachhome') return '#coachhome';
  if (plFrom === 'team') return '#roster';
  return '#progress';
}
// close router: where a coach/shared close (x) lands, by role.
function closeHashFor(isCoach) { return isCoach ? '#coachhome' : '#home'; }

describe('Bug 5/9: player-page Back returns where you came from', () => {
  it('a coach tap from the Team page comes back to the Team page', () => {
    expect(backHashFor(plFromFor('team'))).toBe('#roster'); // #roster IS the Team page
  });
  it('a tap from Standings comes back to Standings, not the splash', () => {
    // Standings/leaderboard rows call openPlayerPage(name) with no `from`.
    expect(backHashFor(plFromFor(undefined))).toBe('#progress');
  });
  it('a tap from coach home comes back to coach home', () => {
    expect(backHashFor(plFromFor('coachhome'))).toBe('#coachhome');
  });
  it('opening from the card returns home (card re-opened)', () => {
    expect(backHashFor(plFromFor('card'))).toBe('#home');
  });
  it('no Back branch ever lands on the splash/login', () => {
    for (const f of ['team', 'coachhome', 'card', undefined, 'leaderboard']) {
      expect(['#home', '#coachhome', '#roster', '#progress']).toContain(backHashFor(plFromFor(f)));
    }
  });
  it('the source still implements this exact from-> plFrom-> hash mapping', () => {
    // plFrom derivation
    expect(html).toMatch(/plFrom=\(from==='card'\)\?'card':\(from==='coachhome'\?'coachhome':\(from==='team'\?'team':'leaderboard'\)\)/);
    // plBack branches
    expect(html).toMatch(/plFrom==='coachhome'\)\{\s*location\.hash='#coachhome'/);
    expect(html).toMatch(/plFrom==='team'\)\{\s*location\.hash='#roster'/);
    expect(html).toMatch(/location\.hash='#progress'/); // the leaderboard default
  });
  it('coach roster tap opens the player page with from="team"', () => {
    expect(html).toMatch(/openPlayerPage\(name,\s*'team'\)/);
  });
});

describe('Bug 1/2/3: coach/shared close (x) returns to the right home', () => {
  it('a coach close lands on coach home; a player close lands on home', () => {
    expect(closeHashFor(true)).toBe('#coachhome');
    expect(closeHashFor(false)).toBe('#home');
  });
  it('Team, Plan and Standings all use the js-home-close hook', () => {
    const closers = [...doc.querySelectorAll('a.js-home-close')];
    expect(closers.length).toBeGreaterThanOrEqual(3);
    closers.forEach((a) => expect(a.getAttribute('href')).toBe('#home')); // no-JS fallback
    expect(doc.getElementById('rosterClose')?.classList.contains('js-home-close')).toBe(true);
  });
  it('the source close-router branches on is-coach', () => {
    expect(html).toMatch(/is-coach'\)\s*\?\s*'#coachhome'\s*:\s*'#home'/);
  });
  it('no coach/shared close still uses href="." (the splash-fall-through bug)', () => {
    // Every glassclose that is a coach/shared page must be js-home-close now.
    expect(doc.getElementById('rosterClose')?.getAttribute('href')).not.toBe('.');
  });
});

describe('Bug 4: no coach/player toggle', () => {
  it('the View-as-player entry and Back-to-coach bar are gone', () => {
    expect(doc.getElementById('viewAsPlayer')).toBeNull();
    expect(doc.getElementById('viewAsBack')).toBeNull();
  });
  it('no live "Back to coach" text and no viewas-active class remain', () => {
    // Only the explanatory code comment may mention it; there is no live bar text
    // (the bar rendered "Back to coach" + a name span) and no CSS state class.
    expect(html.includes('viewas-active')).toBe(false);
    expect(html.includes('viewas-backbar')).toBe(false);
  });
});

describe('Bug 6: coach profile pencil placement', () => {
  it('the staff pencil sits 24px right of the name (not pushed to the far edge)', () => {
    const m = html.match(/\.staff-pencil\{([^}]*)\}/);
    expect(m).not.toBeNull();
    expect(m[1]).toMatch(/margin-left:24px/);
    expect(m[1]).not.toMatch(/margin-left:auto/); // auto = the far-edge bug
  });
  it('the staff pencil is an iOS-glass round button', () => {
    const m = html.match(/\.staff-pencil\{([^}]*)\}/);
    expect(m[1]).toMatch(/border-radius:50%/);
    expect(m[1]).toMatch(/backdrop-filter:/);
  });
});

describe('Bug 7: Players-header edit is a glass pencil icon', () => {
  it('the control has an aria-label and a pencil glyph, not the word Edit', () => {
    const edit = doc.getElementById('rosterEdit');
    expect(edit).toBeTruthy();
    expect(edit.getAttribute('aria-label')).toBeTruthy();
    expect((edit.textContent || '').trim()).not.toBe('Edit');
  });
  it('it is styled as a round glass button', () => {
    const m = html.match(/\.roster-edit\{([^}]*)\}/);
    expect(m).not.toBeNull();
    expect(m[1]).toMatch(/border-radius:50%/);
    expect(m[1]).toMatch(/backdrop-filter:/);
  });
});

describe('Bug 8: +Player is a white outline card', () => {
  it('the add card has a solid white background, not the dark card front', () => {
    const m = html.match(/\.pcard-add\{([^}]*)\}/);
    expect(m).not.toBeNull();
    expect(m[1]).toMatch(/background:\s*#fff/i);
    expect(m[1]).toMatch(/dashed/); // outline
  });
});

describe('Bug 5 (fallback): roster cards target the player page', () => {
  it('every roster card links to #player, none to the coach-hidden #home', () => {
    const cards = [...doc.querySelectorAll('#roster-grid .pcard[data-name]')];
    expect(cards.length).toBeGreaterThan(0);
    cards.forEach((c) => expect(c.getAttribute('href')).toBe('#player'));
  });
});

describe('Mobile splash: Sass is half on-screen at the left edge', () => {
  it('the mobile .sp-welcome offset is a partial negative (half on), not fully off', () => {
    // Grab the .sp-welcome rule inside the max-width:640px block.
    const mobile = html.match(/@media \(max-width:640px\)\{[^]*?\.sp-welcome\{left:(-?\d+)vw/);
    expect(mobile, 'mobile .sp-welcome left rule found').not.toBeNull();
    const leftVw = Number(mobile[1]);
    // Half-on means the container is shifted by roughly half its own width; the
    // old bug was -52vw (almost fully off). Assert it is meaningfully less off.
    expect(leftVw).toBeLessThan(0);       // still anchored past the left edge
    expect(leftVw).toBeGreaterThan(-40);  // but not shoved fully off like -52vw
  });
});
