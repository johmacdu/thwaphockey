// test/about-mobile-parallax.test.js
//
// Mobile parallax for the About page's two pinned sections -- "How the team
// trains together" and "For coaches" (Woody, Oct 6 2026). Matching
// beatflyfishing.com's "Built for the water", the pinned-crossfade effect must
// run on MOBILE, not just desktop:
//   1. Below 900px, each .pin becomes a tall scroll track (--steps * 100vh) and
//      its .pin-sticky pins to the top (position:sticky; top:0; height:100svh).
//   2. The crossfade JS no longer early-returns on mobile (the old
//      matchMedia('(min-width:900px)') desktop-only gate is gone); it drives the
//      step/phone .on crossfade by scroll progress on every viewport.
//   3. prefers-reduced-motion falls back to the static stacked list (.reduce +
//      every step .on, no pinned track).
//
// @vitest-environment node

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../about.html'), 'utf8');

describe('About page mobile parallax', () => {
  it('1. below 900px each .pin is a tall track and the card pins (sticky, 100svh)', () => {
    // a mobile media branch exists for the pinned parallax
    expect(html).toMatch(/@media\(max-width:899px\)[^{]*\{/);
    // tall scroll track driven by --steps
    expect(html).toContain('.pin:not(.reduce){height:calc(var(--steps,3) * 100vh)}');
    // the inner card pins to the top of the viewport for a full screen height
    expect(html).toMatch(/\.pin:not\(\.reduce\) \.pin-sticky\{position:sticky;top:0;height:100svh/);
  });

  it('2. the crossfade JS runs on mobile (no desktop-only early return)', () => {
    // the old desktop-only gate must be gone
    expect(html).not.toContain("window.matchMedia('(min-width:900px)')");
    // the scroll handler + progress->step mapping is still present
    expect(html).toContain("window.addEventListener('scroll', onScroll");
    expect(html).toContain('var idx=Math.floor(p*n)');
  });

  it('3. prefers-reduced-motion falls back to the static stacked list', () => {
    expect(html).toContain("window.matchMedia('(prefers-reduced-motion:reduce)')");
    // reduced-motion tags the pin .reduce and shows every step
    expect(html).toContain("pin.classList.add('reduce')");
    expect(html).toMatch(/\.pin:not\(\.reduce\)/); // the pinned rules are scoped OFF of .reduce
  });

  it('both target sections use the .pin machinery', () => {
    // Team section (4 steps) and Coaches section (3 steps, .coach)
    expect(html).toMatch(/sec-team[\s\S]*?class='pin'[^>]*--steps:4/);
    expect(html).toMatch(/sec-coach[\s\S]*?class='pin coach'[^>]*--steps:3/);
  });
});
