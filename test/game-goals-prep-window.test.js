// test/game-goals-prep-window.test.js
//
// Source guards for the player next-game card's visibility window in index.html.
// jsdom cannot run index.html (its drill YouTube iframes crash it under
// resources:'usable'), so these are plain string assertions on the card's state
// machine, matching the approach in game-goals.test.js.
//
// Rule under test: a flat next-game TAG shows above the Hands card more than 48
// hours before the game; inside 48 hours it becomes the Game Day Goals card.
//  - hours > 48  -> tag shown ("Next game ..."), goals card hidden
//  - hours <= 48 -> tag hidden, goals card shown ("Set your game goals")
//  - days < 0    -> card shown, post-game "How did it go? Log your goals"
//  - goals set   -> "Your game goals are set" done-state wins regardless

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');

describe('Player next-game tag + Game Day Goals 48h window', () => {
  it('both the tag and the card start hidden so neither flashes before the window is confirmed', () => {
    expect(html).toMatch(/id='nextGameTag'[^>]*hidden/);
    expect(html).toMatch(/id='pNextGame'[^>]*hidden/);
    expect(html).toMatch(/\.pnextgame\[hidden\]\{display:none\}/);
    expect(html).toMatch(/\.nextgame-tag\[hidden\]\{display:none\}/);
  });

  it('gates on EXACT hours to game start, not calendar days', () => {
    // hoursUntil uses the game date + time (noon fallback)
    expect(html).toMatch(/function hoursUntil\(g\)\{[^}]*g\.date[^}]*g\.time/);
  });

  it('more than 48h out: show the flat tag, hide the goals card', () => {
    expect(html).toMatch(/if\(hrs>48\)\{\s*if\(card\) card\.hidden=true;/);
    expect(html).toMatch(/tag\.hidden=false;/);
    // the tag is a FLAT pill, not a card (Woody's no-cards-without-navigation rule)
    expect(html).toMatch(/\.nextgame-tag\{[^}]*border-radius:999px/);
    // sized to its content, not full-width (it is a grid child, so justify-self:start)
    expect(html).toMatch(/\.nextgame-tag\{[^}]*justify-self:start/);
    // the opponent name is bolded
    expect(html).toMatch(/<b>'\+opp\+'<\/b>/);
  });

  it('inside 48h: hide the tag, show the goals card', () => {
    expect(html).toMatch(/if\(tag\) tag\.hidden=true;\s*card\.hidden=false;/);
  });

  it('within the window, prompts to set goals', () => {
    expect(html).toMatch(/if\(days>=0\)\{[^}]*Set your game goals/);
  });

  it('shows a post-game log prompt once the game has passed', () => {
    expect(html).toMatch(/else \{[^}]*How did it go\? Log your goals/);
  });

  it('only drives the CTA when goals are not already set', () => {
    expect(html).toMatch(/if\(cta&&!set\)\{/);
  });

  it('the done-state still wins', () => {
    expect(html).toMatch(/Your game goals are set[\s\S]*png-cta-done/);
  });
});
