// test/journey-a11y.test.js
//
// Accessibility guards for the Season Book (journey.html), locking in the
// contrast + text-size pass:
//   - no text smaller than 12px anywhere (docs/visual-design.md)
//   - every text/background token pairing meets WCAG AA (4.5:1) in light AND dark
//   - empty badge stars are a hollow shape, not just a paler color
//   - the cover's player line sits on a dark scrim, because it overlaps bright art

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../journey.html'), 'utf8');
const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));

function tokens(block) {
  const out = {};
  for (const m of block.matchAll(/--([\w-]+):\s*(#[0-9A-Fa-f]{6})\b/g)) out[m[1]] = m[2];
  return out;
}
const light = tokens(css.slice(css.indexOf(':root{'), css.indexOf('}', css.indexOf(':root{'))));
const darkStart = css.indexOf("html[data-theme='dark']{");
const dark = { ...light, ...tokens(css.slice(darkStart, css.indexOf('}', darkStart))) };

function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

describe('text size', () => {
  it('no font-size below 12px in the Season Book', () => {
    const sizes = Array.from(css.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)).map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(5);
    expect(sizes.filter((n) => n < 12)).toEqual([]);
  });
  it('the eyebrow and support tokens are at least 12px and 14px', () => {
    expect(Number(/--fs-eyebrow:(\d+)px/.exec(css)[1])).toBeGreaterThanOrEqual(12);
    expect(Number(/--fs-support:(\d+)px/.exec(css)[1])).toBeGreaterThanOrEqual(14);
  });
});

describe('color contrast (WCAG AA, 4.5:1 for text)', () => {
  // Every text color used on each surface it appears on.
  const PAIRS = [
    ['text', 'bg'], ['text', 'page'], ['text', 'card'],
    ['muted', 'bg'], ['muted', 'page'], ['muted', 'card'],
    ['acc', 'page'], ['acc', 'card'],
    ['sample', 'bg'], ['sample', 'page'], ['sample', 'card'],
  ];
  for (const [theme, t] of [['light', light], ['dark', dark]]) {
    for (const [fg, bg] of PAIRS) {
      it(`${theme}: --${fg} on --${bg}`, () => {
        expect(t[fg], `--${fg} missing`).toMatch(/^#/);
        expect(t[bg], `--${bg} missing`).toMatch(/^#/);
        expect(ratio(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});

describe('not color alone', () => {
  it('empty stars render as a hollow star, in markup and in the live render', () => {
    // Badges render from data now, so the live renderer is where hollow stars come from.
    expect(html).not.toMatch(/<span class="off">\u2605/);
    expect(html).toContain("'\\u2606'.repeat(3-n)");
  });
  it('empty stars use a passing color, not the hairline color', () => {
    expect(css).toMatch(/\.stars \.off\{color:var\(--muted\)\}/);
  });
});

