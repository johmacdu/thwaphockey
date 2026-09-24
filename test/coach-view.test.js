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
  it('the staff pencil is right-aligned to the row edge', () => {
    const m = html.match(/\.staff-pencil\{([^}]*)\}/);
    expect(m).not.toBeNull();
    expect(m[1]).toMatch(/margin-left:auto/);
  });
  it('the staff pencil is a round button', () => {
    const m = html.match(/\.staff-pencil\{([^}]*)\}/);
    expect(m[1]).toMatch(/border-radius:50%/);
  });
});

describe('Bug 7: Players-header edit is a pencil icon', () => {
  it('the control has an aria-label and a pencil glyph, not the word Edit', () => {
    const edit = doc.getElementById('rosterEdit');
    expect(edit).toBeTruthy();
    expect(edit.getAttribute('aria-label')).toBeTruthy();
    expect((edit.textContent || '').trim()).not.toBe('Edit');
  });
  it('it is a right-aligned round button', () => {
    const m = html.match(/\.roster-edit\{([^}]*)\}/);
    expect(m).not.toBeNull();
    expect(m[1]).toMatch(/border-radius:50%/);
    expect(m[1]).toMatch(/margin-left:auto/);
  });
});

describe('Bug 8: +Player add card is a themed slot', () => {
  it('the add card uses the dark card front, not a solid white background', () => {
    const m = html.match(/\.pcard-add\{([^}]*)\}/);
    expect(m).not.toBeNull();
    expect(m[1]).not.toMatch(/background:\s*#fff/i);
    expect(m[1]).toMatch(/linear-gradient/); // dark themed card front
  });
});

describe('Bug 5 (fallback): roster cards target the player page', () => {
  it('every roster card links to #player, none to the coach-hidden #home', () => {
    const cards = [...doc.querySelectorAll('#roster-grid .pcard[data-name]')];
    expect(cards.length).toBeGreaterThan(0);
    cards.forEach((c) => expect(c.getAttribute('href')).toBe('#player'));
  });
});

describe('Coach homepage: tapping the coach name opens the profile editor', () => {
  // Isolate the coach profile editor IIFE (the block that wires #chProfileName).
  function profileIife() {
    const start = html.indexOf('Coach profile editor: name + photo');
    expect(start, 'coach profile editor block present').toBeGreaterThan(-1);
    // Take a generous window from the marker; enough to cover the IIFE body.
    return html.slice(start, start + 3400);
  }

  it('the coach hero name (#chProfileName) is a tappable button that opens the editor', () => {
    const name = doc.getElementById('chProfileName');
    expect(name).toBeTruthy();
    expect(name.tagName).toBe('BUTTON');
    // The editor gate it opens must exist.
    expect(doc.getElementById('coachProfileGate')).toBeTruthy();
    // The IIFE wires a click on the hero name.
    expect(profileIife()).toMatch(/getElementById\('chProfileName'\);\s*if\(heroName\)\s*heroName\.addEventListener\('click',open\)/);
  });

  it('the profile IIFE has no out-of-scope refs that throw before wiring the tap', () => {
    // These names live in the SEPARATE coaches-strip IIFE. Referencing them here
    // threw a ReferenceError at runtime, aborting the IIFE before the hero-name
    // listener was attached - which is exactly why the tap did nothing. Parsing
    // does not catch it (the throw is at execution), so assert on the source.
    const iife = profileIife();
    expect(iife.includes('if(editBtn) editBtn.addEventListener'), 'stray editBtn ref').toBe(false);
    // The submit handler must refresh via the window hook, not a bare render/load.
    expect(iife).toMatch(/window\.thwapReloadCoaches/);
    expect(iife.includes('if(res.j.coaches) render(res.j.coaches); else load();'), 'bare render/load call').toBe(false);
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

describe('Bug 2: a coach can never get stranded on the hidden #home', () => {
  it('a hashchange listener redirects a coach off #home to #coachhome', () => {
    // #home is display:none!important for a coach; without this redirect, any path
    // that lands a coach on #home (native href, handler race) shows a blank page,
    // which read as "the Team X does not close the page".
    expect(html).toMatch(/body\.classList\.contains\('is-coach'\)\)\{\s*location\.hash='#coachhome'/);
    // and #home is indeed force-hidden for coaches (the reason the redirect exists)
    expect(html).toMatch(/body\.is-coach #home\{display:none!important\}/);
  });
});

describe('Coach staff chip: tapping the coach name opens the profile editor', () => {
  it('the coach name is a scoped button (not the whole pill) that opens the profile', () => {
    expect(html).toMatch(/class="bcoach-nmbtn"/);
    expect(html).toMatch(/nmBtn\.addEventListener\('click',openProfile\)/);
    expect(html).toMatch(/\.bcoach-nmbtn\{[^}]*cursor:pointer/);
    // and NOT the whole-pill click that caused stray taps
    expect(html.includes("pill.classList.add('bcoach-tappable')")).toBe(false);
  });
});

describe('Remove-player confirm is a scrimmed modal', () => {
  it('.pe-confirm is a full-screen overlay with a scrim and [hidden] override', () => {
    expect(html).toMatch(/\.pe-confirm\{position:fixed;inset:0/);
    expect(html).toMatch(/\.pe-confirm\[hidden\]\{display:none\}/);
    expect(doc.getElementById('peConfirmScrim')).toBeTruthy();
    expect(doc.getElementById('peConfirmSub')).toBeTruthy();
  });
});

describe('Weekly plan card matches the team-goal card', () => {
  it('plancard shares the tgoal card shell and holds Save inside', () => {
    // same lime-tinted gradient shell as .tgoal-wrap
    expect(html).toMatch(/\.plancard\{[^}]*linear-gradient\(180deg,color-mix\(in srgb,var\(--lime\)/);
    expect(html).toMatch(/\.plancard-h\{[^}]*Archivo Black/);
    // Save plan button now lives inside the plancard
    const card=html.slice(html.indexOf("class='plancard'"), html.indexOf("class='tgoal-wrap'"));
    expect(card).toMatch(/id='planSave'/);
  });
});

describe('IDP focus card reads as one tappable unit', () => {
  it('the block is a card and the chevron is a circular affordance', () => {
    expect(html).toMatch(/\.idp\{[^}]*border:1px solid var\(--line\);border-radius:16px;background:var\(--card2\)\}/);
    expect(html).toMatch(/\.idp-view-chev\{[^}]*border-radius:50%/);
    // player (read-only) hides the chevron entirely
    expect(html).toMatch(/\.idp-view:disabled \.idp-view-chev\{display:none\}/);
  });
});

describe('Player stat page rings filter the activity list (week view)', () => {
  it('week rings are buttons carrying data-disc and toggle plFilter', () => {
    // ring is now a <button> with data-disc (not an inert div)
    expect(html).toMatch(/class='pl-ring"\+dim\+sel\+"' data-disc='"\+disc\+"'/);
    // ring tap toggles plFilter and re-renders
    expect(html).toMatch(/plFilter=\(plFilter===d\)\?'all':d; build\(\);/);
    // selected/dim styles exist
    expect(html).toMatch(/\.pl-ring\.pl-ring-sel\{/);
  });
});

describe('Recommend-a-drill card expands and collapses', () => {
  it('starts collapsed behind an expand link with a top-left close', () => {
    expect(doc.getElementById('suggExpand')).toBeTruthy();
    expect(doc.getElementById('suggClose')).toBeTruthy();
    expect(doc.getElementById('suggBox').hasAttribute('hidden')).toBe(true);
    expect(html).toMatch(/\.sugg-wrap\[hidden\]\{display:none\}/);
    expect(html).toMatch(/\.sugg-close\{[^}]*top:12px;left:12px/);
  });
});

describe('Drill picker cards are legible and accessible', () => {
  it('.dpk-main has a >=44px tap target and larger name text', () => {
    expect(html).toMatch(/\.dpk-main\{[^}]*min-height:64px/);
    expect(html).toMatch(/\.dpk-nm\{[^}]*font-size:18px/);
    expect(html).toMatch(/\.dpk-body ol\{[^}]*font-size:17px/);
  });
});

describe('Coach home hand waves like the player page', () => {
  it('the wave easter egg wires every .hero-wave (both homes), not just #heroWave', () => {
    expect(html).toMatch(/var waves=document\.querySelectorAll\('\.hero-wave'\)/);
    const coachHome=html.slice(html.indexOf("id='coachhome'"), html.indexOf("id='roster'"));
    expect(coachHome).toMatch(/class='hero-wave'/);
  });
});

describe('Roster edit mode: pencil toggles to Cancel/Done, cards drop the badge', () => {
  it('the header has a pencil plus a hidden Cancel/Done action pair', () => {
    expect(doc.getElementById('rosterEdit')).toBeTruthy();
    const acts=doc.getElementById('rosterEditActions');
    expect(acts).toBeTruthy();
    expect(acts.hasAttribute('hidden')).toBe(true);
    expect(doc.getElementById('rosterEditCancel')).toBeTruthy();
    expect(doc.getElementById('rosterEditDone')).toBeTruthy();
  });
  it('the [hidden] overrides beat body.is-coach .roster-coachonly{display:block}', () => {
    expect(html).toMatch(/body\.is-coach \.roster-editactions\[hidden\]\{display:none\}/);
    expect(html).toMatch(/body\.is-coach \.roster-edit\[hidden\]\{display:none\}/);
  });
  it('the per-card pencil badge (::after) is gone', () => {
    expect(html).not.toMatch(/#roster-grid \.pcard:not\(\.pcard-add\)::after/);
  });
  it('the pencil enters edit mode and Cancel/Done exit it', () => {
    expect(html).toMatch(/editBtn\.addEventListener\('click',function\(\)\{ setEditing\(true\); \}\)/);
    expect(html).toMatch(/editCancel\.addEventListener\('click',function\(\)\{ setEditing\(false\); \}\)/);
    expect(html).toMatch(/editDone\.addEventListener\('click',function\(\)\{ setEditing\(false\); \}\)/);
  });
});

describe('Player edit sheet: PIN hint explains how to reset', () => {
  it('tells the coach to change the jersey number, without leaking the code format', () => {
    expect(html).toMatch(/To reset it, change the jersey number/);
    expect(html).not.toMatch(/jersey number followed by the season year/i);
  });
});

describe('Add player is a side sheet, not a full page', () => {
  it('#addplayer is a hidden .sheet with a scrim and close, keeping the form ids', () => {
    const ap=doc.getElementById('addplayer');
    expect(ap).toBeTruthy();
    expect(ap.classList.contains('sheet')).toBe(true);
    expect(ap.hasAttribute('hidden')).toBe(true);
    expect(doc.getElementById('apScrim')).toBeTruthy();
    expect(doc.getElementById('apX')).toBeTruthy();
    expect(doc.getElementById('addPlayerForm')).toBeTruthy();
    expect(doc.getElementById('apFirst')).toBeTruthy();
  });
});

describe('Game Day card: lines below the title align under the title', () => {
  it('meta, focus, and cta are indented to clear the 40px goal-light + 10px gap', () => {
    // title (.png-opp) sits after a 40px icon + 10px gap inside .png-head, so the
    // lines below get a matching 50px left offset to align under the 'G'.
    expect(html).toMatch(/\.png-meta\{[^}]*padding-left:50px/);
    expect(html).toMatch(/\.png-cta\{[^}]*padding-left:50px/);
    expect(html).toMatch(/\.png-focus\{[^}]*margin-left:50px/);
    expect(html).toMatch(/\.egg-ico-sm\{width:40px\}/); // the offset assumption
  });
});

describe('Menus start closed: [hidden] overrides display', () => {
  // Recurring Thwap bug: a popup with the hidden attribute still shows because a
  // CSS rule gives it display:flex, which beats the browser's implicit
  // [hidden]{display:none}. Every flex/grid popup that starts hidden needs an
  // explicit [hidden]{display:none}. The footer menu (Sign out / Report a bug)
  // was open on load for exactly this reason.
  it('.footmenu has an explicit [hidden]{display:none} rule', () => {
    expect(html).toMatch(/\.footmenu\[hidden\]\{display:none\}/);
  });
  it('.kebabmenu has an explicit [hidden]{display:none} rule', () => {
    expect(html).toMatch(/\.kebabmenu\[hidden\]\{display:none\}/);
  });
  it('the footer menu items are left-aligned', () => {
    const m = html.match(/\.footmenu-item\{([^}]*)\}/);
    expect(m).not.toBeNull();
    expect(m[1]).toMatch(/text-align:left/);
  });
  it('.pgate has an explicit [hidden]{display:none} rule (full-screen overlay tap-blocker)', () => {
    // .pgate is position:fixed;inset:0;z-index:80. Without this, a hidden switch/
    // profile gate sat invisibly over the whole Team page and swallowed every tap
    // (incl. the close X) - the dead Team X for both player and coach.
    expect(html).toMatch(/\.pgate\[hidden\]\{display:none\}/);
  });
  it('the Team edit pencil meets the 44px tap target', () => {
    const m = html.match(/\.roster-edit\{([^}]*)\}/);
    expect(m).not.toBeNull();
    const w = m[1].match(/width:(\d+)px/), h = m[1].match(/height:(\d+)px/);
    expect(Number(w[1])).toBeGreaterThanOrEqual(44);
    expect(Number(h[1])).toBeGreaterThanOrEqual(44);
  });
  it('the Team edit pencil is gated coach-only (inside .roster-coachonly)', () => {
    const edit = doc.getElementById('rosterEdit');
    expect(edit).toBeTruthy();
    expect(edit.closest('.roster-coachonly')).not.toBeNull();
    // and .roster-coachonly is hidden by default, shown only for a coach
    expect(html).toMatch(/\.roster-coachonly\{display:none\}/);
    expect(html).toMatch(/body\.is-coach \.roster-coachonly\{display:block\}/);
  });
});
