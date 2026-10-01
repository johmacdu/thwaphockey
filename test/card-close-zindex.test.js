// test/card-close-zindex.test.js
//
// Guards the card-viewer close button stacking fix.
//
// BUG: in the player-card viewer (.cardoverlay), the close button (.cardclose)
// and the 3D card scene (.cardscene) are siblings. .cardscene is
// position:relative with perspective, which creates a stacking context whose
// card-layer descendants paint high; .cardclose was position:absolute with NO
// z-index, so it painted BEHIND the card and was hard to tap.
//
// FIX: give .cardclose a positive z-index so it lifts above the auto-level
// .cardscene sibling (and all its descendants) inside the overlay.
//
// Source guard only: this is a paint-order (stacking) property that jsdom does
// not lay out or composite, so there is nothing to exercise at runtime. The
// authoritative check is that the .cardclose rule carries a positive z-index.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');

describe('card viewer close button stacking', () => {
  it('.cardclose rule carries a positive z-index', () => {
    // Isolate the .cardclose declaration block (the base rule, not a selector
    // that merely contains the string, e.g. the CLOSE_SEL list in JS).
    const m = html.match(/\.cardclose\s*\{([^}]*)\}/);
    expect(m, '.cardclose CSS rule should exist').toBeTruthy();
    const body = m[1];
    const zi = body.match(/z-index\s*:\s*(\d+)/);
    expect(zi, '.cardclose should declare a z-index').toBeTruthy();
    expect(Number(zi[1])).toBeGreaterThan(0);
  });

  it('.cardclose stays position:absolute and keeps pointer events', () => {
    const m = html.match(/\.cardclose\s*\{([^}]*)\}/);
    const body = m[1];
    expect(body).toContain('position:absolute');
    expect(body).not.toContain('pointer-events:none');
  });
});
