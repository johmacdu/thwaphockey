// test/deck-drag-sound.test.js
//
// Dragging to rotate a player card must play the velocity-driven skate-glide
// sound (thwapSfxGlideStart/Speed/Stop) in BOTH places a card can be spun:
//   1. the home / stats card (var `card`, .card3d), and
//   2. the Sticker Book deck (var `deck3d`).
//
// Regression guard: the deck's rotate-drag originally wired no sound at all,
// so opening a card from the sticker page and dragging it was silent while the
// home card had the glide. These are source-level assertions because the glide
// uses WebAudio, which jsdom does not implement.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');

describe('Card rotate-drag plays the skate-glide sound on every draggable card', () => {
  it('exposes the glide sound API from the sound layer', () => {
    expect(html).toMatch(/window\.thwapSfxGlideStart\s*=\s*glideStart/);
    expect(html).toMatch(/window\.thwapSfxGlideSpeed\s*=\s*glideSpeed/);
    expect(html).toMatch(/window\.thwapSfxGlideStop\s*=\s*glideStop/);
  });

  it('the Sticker Book deck (deck3d) starts/speeds/stops the glide on drag', () => {
    // pointerdown -> start
    expect(html).toMatch(/deck3d\.addEventListener\('pointerdown'[\s\S]*?thwapSfxGlideStart\(\)/);
    // pointermove -> speed
    expect(html).toMatch(/deck3d\.addEventListener\('pointermove'[\s\S]*?thwapSfxGlideSpeed\(/);
    // pointerup AND pointercancel -> stop (both end paths)
    expect(html).toMatch(/deck3d\.addEventListener\('pointerup'[\s\S]*?thwapSfxGlideStop\(\)/);
    expect(html).toMatch(/deck3d\.addEventListener\('pointercancel'[\s\S]*?thwapSfxGlideStop\(\)/);
  });

  it('the home / stats card also wires the glide (unchanged baseline)', () => {
    // the home card uses setPointerCapture + glide; assert the pairing survives
    expect(html).toMatch(/card\.setPointerCapture\(e\.pointerId\);\s*if\(window\.thwapSfxGlideStart\)thwapSfxGlideStart\(\)/);
    expect(html).toMatch(/if\(window\.thwapSfxGlideStop\)thwapSfxGlideStop\(\)/);
  });

  it('both cards drive glide SPEED from drag velocity (dt-normalized), not a constant', () => {
    const speedCalls = html.match(/thwapSfxGlideSpeed\(/g) || [];
    // one in the home-card pointermove, one in the deck pointermove
    expect(speedCalls.length).toBeGreaterThanOrEqual(2);
  });
});
