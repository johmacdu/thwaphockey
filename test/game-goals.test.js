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
    expect(html).toMatch(/Next game I&rsquo;m playing/);
    expect(html).not.toMatch(/Today I&rsquo;m playing/);
  });

  it('goal categories are cards (bordered section shell), goals nested inside', () => {
    // .section is a card now (border + radius + bg), not just a top margin.
    expect(html).toMatch(/\.section\{margin-top:22px;border:1px solid var\(--line\);border-radius:18px/);
    // the open goals grid sits inside the card (inner padding, no divider border).
    expect(html).toMatch(/\.section\.open \.grid\{[^}]*padding:4px 18px 22px;border-bottom:0\}/);
  });
});

describe('Game-day category text matches the app type ramp', () => {
  it('the category subtitle is 16px like .nav p, and the title is 19px like .nav h2', () => {
    expect(html).toMatch(/\.section-head p\{[^}]*font-size:16px/);
    expect(html).toMatch(/\.section-head h2\{[^}]*font-size:19px/);
  });
  it('an expanded category has extra bottom padding under the title', () => {
    expect(html).toMatch(/\.section\.open \.section-head\{padding-bottom:20px\}/);
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
