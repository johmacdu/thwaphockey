// test/game-goals-prep-window.test.js
//
// Source guards for the player next-game card's 2-day "set your goals" prep
// window in index.html. jsdom cannot run index.html (its drill YouTube iframes
// crash it under resources:'usable'), so these are plain string assertions on
// the CTA state machine, matching the approach in game-goals.test.js.
//
// Rule under test: goals should be set at least 2 days before a game.
//  - days > 2  -> calm "Goals open 2 days before the game" (png-cta-soon)
//  - 0..2 days -> "Set your game goals" prompt (window open)
//  - days < 0  -> post-game "How did it go? Log your goals"
//  - goals set -> "Your game goals are set" done-state wins regardless

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');

describe('Player next-game 2-day goals prep window', () => {
  it('opens the prompt only within 2 days (else a calm "soon" state)', () => {
    expect(html).toMatch(/if\(days>2\)\{[^}]*Goals open 2 days before the game[^}]*png-cta-soon/);
    expect(html).toMatch(/else if\(days>=0\)\{[^}]*Set your game goals/);
  });

  it('shows a post-game log prompt once the game has passed', () => {
    expect(html).toMatch(/else \{[^}]*How did it go\? Log your goals/);
  });

  it('only drives the CTA when goals are not already set', () => {
    expect(html).toMatch(/if\(cta&&!set\)\{/);
  });

  it('the done-state still wins and clears the soon-state class', () => {
    expect(html).toMatch(/Your game goals are set[\s\S]*png-cta-done[\s\S]*remove\('png-cta-soon'\)/);
  });

  it('defines the calm soon-state style', () => {
    expect(html).toMatch(/\.png-cta-soon\{color:var\(--muted\)/);
  });
});
