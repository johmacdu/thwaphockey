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
    expect(html).toMatch(/\.section\{margin-top:16px;border:1px solid var\(--line\);border-radius:18px/);
    // the open goals grid sits inside the card (inner padding, no divider border).
    expect(html).toMatch(/\.section\.open \.grid\{[^}]*padding:0 16px 18px;border-bottom:0\}/);
  });
});
