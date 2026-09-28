// test/game-goals.test.js
//
// String-based guards for hockey_game_goals.html. We do NOT parse it with jsdom:
// its drill/preview YouTube iframes crash jsdom under resources:'usable'. These
// are plain source assertions, which is enough to lock in the two fixes.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../hockey_game_goals.html'), 'utf8');

describe('Game-day goals page', () => {
  it('the position mad-lib reads "Next game", not "Today"', () => {
    expect(html).toMatch(/id="ngTip"[^>]*>Next game/);
    expect(html).toMatch(/I&rsquo;m playing <span class="pos-hold"><button[^>]*id="posWord"/);
    expect(html).not.toMatch(/Today I&rsquo;m playing/);
  });

  it('the trailing period is glued to the position word so it never orphans on a line', () => {
    // button + "." live together inside .pos-hold, which is nowrap
    expect(html).toMatch(/<span class="pos-hold"><button[^>]*id="posWord"[^>]*>forward<\/button>\.<\/span>/);
    expect(html).toMatch(/\.pos-hold\{white-space:nowrap\}/);
  });

  it('goal categories are cards (bordered section shell), goals nested inside', () => {
    // .section is a card now (border + radius + bg), not just a top margin.
    expect(html).toMatch(/\.section\{margin-top:22px;border:1px solid var\(--line\);border-radius:18px/);
    // the open goals grid sits inside the card (inner padding, no divider border).
    expect(html).toMatch(/\.section\.open \.grid\{[^}]*padding:4px 18px 22px;border-bottom:0\}/);
  });
});

describe('Game-day goal cards pop and breathe', () => {
  it('base goal cards have a shadow and a bigger grid gap', () => {
    expect(html).toMatch(/\.goal\{[^}]*box-shadow:0 2px 7px/);
    expect(html).toMatch(/\.grid\{[^}]*gap:18px\}/);
  });
  it('selected goal cards get a 2px green ring and glow', () => {
    expect(html).toMatch(/box-shadow: inset 0 0 0 2px var\(--green\), 0 4px 11px rgba\(47,191,113,\.16\)/);
  });
});

describe('Game-day category text matches the app ramp + expanded padding', () => {
  it('subtitle 16px (like .nav p), title 19px, expanded header has bottom padding', () => {
    expect(html).toMatch(/\.section-head p\{[^}]*font-size:16px/);
    expect(html).toMatch(/\.section-head h2\{[^}]*font-size:19px/);
    expect(html).toMatch(/\.section\.open \.section-head\{padding-bottom:20px\}/);
  });
});

describe('Next-game matchup is a tooltip, not a standing line', () => {
  it('the matchup fills a tooltip bubble on the Next game trigger (no visible kicker line)', () => {
    expect(html).toMatch(/class="ng-tip"[^>]*id="ngTip"/);
    expect(html).toMatch(/class="ng-tip-bubble" id="gpGame"/);
    // only one #gpGame (the old standing kicker div is gone)
    expect((html.match(/id="gpGame"/g) || []).length).toBe(1);
    // hover + focus + tap-open reveal it
    expect(html).toMatch(/\.ng-tip:hover \.ng-tip-bubble,\.ng-tip:focus-visible \.ng-tip-bubble,\.ng-tip\.open \.ng-tip-bubble\{display:block\}/);
  });
});

describe('Game-day position persists + seeds from roster', () => {
  it('setPos POSTs to set-game-position and load seeds from the player record', () => {
    expect(html).toMatch(/action=set-game-position/);
    expect(html).toMatch(/action=player&playerId=/);
    // roster FD (Forward and Defense) maps to the game-day "B"
    expect(html).toMatch(/rp==='FD'\|\|rp==='DF'\|\|rp\.indexOf\('\/'\)>=0\|\|rp==='B'/);
  });
});

describe('Game-day dart easter egg is correctly sized', () => {
  it('the width is on .gd-dart itself (the img IS .gd-dart, so .gd-dart img never matched)', () => {
    // the element is created as <img class="gd-dart">, so the size must be on .gd-dart
    expect(html).toMatch(/\.gd-dart\{[^}]*width:clamp\(56px,12vw,90px\)/);
    // and it's still created as a bare img with that class
    expect(html).toMatch(/createElement\('img'\); dart\.className='gd-dart'/);
  });
});

describe('Vision-focused game-day goals (Head Up on the Puck, Five Clean Passes)', () => {
  it('"Head Up on the Puck" (g44) lives in Brain / Pre-Scan with the eyes-up cue', () => {
    expect(html).toMatch(/<label class="goal goal-44" for="g44">/);
    expect(html).toMatch(/<h3>Head Up on the Puck<\/h3>/);
    expect(html).toMatch(/Eyes up, feel the puck\./);
  });

  it('"Five Clean Passes" (g45) is a countable passing goal with the tape-to-tape cue', () => {
    expect(html).toMatch(/<label class="goal goal-45" for="g45">/);
    expect(html).toMatch(/<h3>Five Clean Passes<\/h3>/);
    expect(html).toMatch(/Tape to tape, five times\./);
  });

  it('both new goals are fully wired: input, selected-state CSS, and final-view chip', () => {
    // hidden checkbox inputs
    expect(html).toMatch(/id="g44" class="choice-input"/);
    expect(html).toMatch(/id="g45" class="choice-input"/);
    // selected-state CSS + final-view reveal
    expect(html).toMatch(/#g44:checked ~ \.final-view \.final-44 \{ display:grid; \}/);
    expect(html).toMatch(/#g45:checked ~ \.final-view \.final-45 \{ display:grid; \}/);
    // final-view Game Plan chips
    expect(html).toMatch(/class="final-card final-44"/);
    expect(html).toMatch(/class="final-card final-45"/);
  });
});
