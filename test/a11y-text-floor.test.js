// test/a11y-text-floor.test.js
//
// App-wide accessibility floor (docs/visual-design.md: "Nothing smaller than
// ~12px anywhere"), plus the light-mode training colors that must stay at
// WCAG AA (4.5:1) on the light page and white cards.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(resolve(__dirname, '..', f), 'utf8');
const PAGES = ['index.html', 'hockey_game_goals.html', 'about.html', 'journey.html'];

// The avatar's pixel art uses font-size as its scale unit (em-based blocks), not
// as text, so its wrapper is the one allowed exception.
const SCALE_UNITS = /\.av-wrap\s*\{[^}]*$/;

describe('text size floor: 12px', () => {
  for (const page of PAGES) {
    it(`${page} sets no text below 12px`, () => {
      const src = read(page);
      const tiny = [];
      for (const m of src.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)) {
        if (Number(m[1]) >= 12) continue;
        const before = src.slice(Math.max(0, m.index - 200), m.index);
        if (SCALE_UNITS.test(before)) continue;
        tiny.push(`${m[1]}px near: ${before.slice(-60).replace(/\s+/g, ' ')}`);
      }
      expect(tiny).toEqual([]);
    });
  }
  it('the eyebrow token is 12px in the app and Game Day Goals', () => {
    for (const page of ['index.html', 'hockey_game_goals.html']) {
      const m = /--fs-eyebrow:\s*(\d+)px/.exec(read(page));
      if (m) expect(Number(m[1])).toBeGreaterThanOrEqual(12);
    }
  });
});

describe('light-mode training colors (Home "Today\'s training" links)', () => {
  const src = read('index.html');
  const lum = (hex) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  for (const d of ['stick', 'shoot', 'dryland', 'iq', 'pass']) {
    it(`.disc-${d} passes 4.5:1 in light mode`, () => {
      const m = new RegExp(`html\\[data-theme='light'\\] \\.disc-${d}\\{color:(#[0-9A-Fa-f]{6})\\}`).exec(src);
      expect(m, `light override for .disc-${d}`).not.toBeNull();
      for (const bg of ['#F3F7F4', '#FFFFFF', '#FBFDFB']) expect(ratio(m[1], bg)).toBeGreaterThanOrEqual(4.5);
    });
  }
});
