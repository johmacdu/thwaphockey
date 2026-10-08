// test/footer-menu-and-policy.test.js
//
// Bugs (Woody, Oct 7 2026):
//  1. The splash crash/impact sound played even when the footer SOUND icon was off.
//     It gated on thwapMuted() (narration) but not thwapSfxOn (the sound icon).
//  2. Report a bug / Request a feature should live ONLY in the in-product footer
//     kebab (index), NOT on the About page footer kebab.
//  3. Terms of Use / Privacy Policy should live ONLY on the About page footer kebab,
//     NOT in the in-product (index) footer kebab.
//  4. On About, tapping Terms/Privacy must open a full page WITH a close button
//     (About had no policy page/openPolicy at all).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const index = readFileSync(resolve(root, 'index.html'), 'utf8');
const about = readFileSync(resolve(root, 'about.html'), 'utf8');

function footMenu(html) {
  const i = html.indexOf("id='footMenu'");
  const j = html.indexOf('</div>', i);
  return html.slice(i, j);
}

describe('Bug 1: splash impact sound respects the sound (SFX) toggle', () => {
  it('thwapPlaySplashHit returns early when thwapSfxOn is off', () => {
    const i = index.indexOf('function thwapPlaySplashHit');
    const block = index.slice(i, index.indexOf('}', index.indexOf('_thwapHit.play()', i)));
    expect(block).toMatch(/localStorage\.getItem\('thwapSfxOn'\)==='0'\) return/);
  });
});

describe('Bug 2 + 3: footer kebab item placement', () => {
  it('index (in-product) footer menu HAS Report a bug + Request a feature', () => {
    const m = footMenu(index);
    expect(m).toContain('Thwap%20bug%20report');
    expect(m).toContain('Thwap%20feature%20request');
  });

  it('index (in-product) footer menu does NOT have Terms or Privacy', () => {
    const m = footMenu(index);
    expect(m).not.toContain('Terms of Use');
    expect(m).not.toContain('Privacy Policy');
  });

  it('about footer menu HAS Terms of Use + Privacy Policy', () => {
    const m = footMenu(about);
    expect(m).toContain('Terms of Use');
    expect(m).toContain('Privacy Policy');
  });

  it('about footer menu does NOT have Report a bug or Request a feature', () => {
    const m = footMenu(about);
    expect(m).not.toContain('Thwap%20bug%20report');
    expect(m).not.toContain('Thwap%20feature%20request');
  });
});

describe('Bug 4: About opens Terms/Privacy as a full page with a close button', () => {
  it('about.html has the full-page policy overlay markup + close button', () => {
    expect(about).toContain("class='policy-page' id='policySheet'");
    expect(about).toContain("id='policyClose'");
    expect(about).toMatch(/\.policy-page\{position:fixed;inset:0/);
  });

  it('about.html wires menuTerms/menuPrivacy to openPolicy and exposes thwapOpenPolicy', () => {
    expect(about).toContain('window.thwapOpenPolicy=openPolicy;');
    expect(about).toMatch(/menuTerms.*openPolicy\('terms'\)/s);
    expect(about).toMatch(/menuPrivacy.*openPolicy\('privacy'\)/s);
    expect(about).toContain('function closePolicy()');
  });

  it('about.html carries the real Terms + Privacy copy (same source as the app)', () => {
    expect(about).toContain('Thwap Hockey is a home-training app');
    expect(about).toContain('Thwap Hockey is built for children');
  });
});
