// test/game-goals-prep-window.test.js
//
// Source guards for the player next-game (Game Day Goals) card's visibility
// window in index.html. jsdom cannot run index.html (its drill YouTube iframes
// crash it under resources:'usable'), so these are plain string assertions on
// the card's state machine, matching the approach in game-goals.test.js.
//
// Rule under test: the card is HIDDEN until 2 days before the game.
//  - days > 2  -> card.hidden = true (no card at all, no "opens soon" text)
//  - 0..2 days -> card shown, "Set your game goals" prompt
//  - days < 0  -> card shown, post-game "How did it go? Log your goals"
//  - goals set -> "Your game goals are set" done-state wins regardless

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');

describe('Player Game Day Goals card 2-day visibility window', () => {
  it('is hidden by default so it never flashes before the window is confirmed', () => {
    expect(html).toMatch(/id='pNextGame'[^>]*hidden/);
    expect(html).toMatch(/\.pnextgame\[hidden\]\{display:none\}/);
  });

  it('hides the card entirely when the game is more than 2 days out', () => {
    expect(html).toMatch(/if\(days>2\)\{\s*card\.hidden=true;\s*return;\s*\}/);
    expect(html).toMatch(/card\.hidden=false;/);
  });

  it('no longer shows the "Goals open 2 days before the game" preview text', () => {
    expect(html).not.toContain('Goals open 2 days before the game');
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
