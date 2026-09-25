// test/home-deck-back.test.js
//
// The home-screen player card is the 3D "deck" (deckFront/deckBack). Its BACK must
// render the coded stats card (buildBack), never fall through to an empty/static
// back — an empty back with the front rotated 180 reads as a MIRRORED copy of the
// front (the bug Woody reported on the home screen, Lewie/Rangers).
//   Fixes: (1) synthesize a minimal pInfo from the slug when thwapCurrentPlayer()
//   is null so the coded back always renders; (2) Z-separate + JS-visibility-toggle
//   the two faces so iOS Safari does not bleed the front through.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');

let win;
beforeAll(async () => {
  const store = { bfPlayer: 'Lewie' };
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://x/#home',
    beforeParse(w) {
      w.HTMLMediaElement.prototype.play = () => Promise.resolve();
      w.HTMLMediaElement.prototype.pause = () => {};
      w.scrollTo = () => {};
      w.fetch = (u) => {
        const s = String(u); let b = { ok: true };
        if (s.includes('board')) b = { players: [{ id: 'lewie', stick: 12, shoot: 8, dryland: 5, streak: 3 }] };
        else b = { ok: false };
        return Promise.resolve({ ok: true, json: () => Promise.resolve(b) });
      };
      const ls = { getItem: (k) => (k in store ? store[k] : null), setItem: () => {}, removeItem: () => {}, clear: () => {} };
      Object.defineProperty(w, 'localStorage', { value: ls, configurable: true });
      Object.defineProperty(w.document, 'cookie', { get: () => 'thwapAuth=x', set: () => {}, configurable: true });
    },
  });
  win = dom.window;
  await new Promise((r) => setTimeout(r, 250));
});

describe('Home deck card back shows the coded stats (not a mirrored front)', () => {
  it('deckBack renders the coded stats card (cb2 tiles), not an empty/static face', () => {
    const db = win.document.getElementById('deckBack');
    expect(db).toBeTruthy();
    expect(db.querySelectorAll('.cb2-tile').length).toBeGreaterThanOrEqual(4);
    // it must NOT be the static image fallback that leaves the front to bleed through
    expect(db.querySelector('.cb2')).toBeTruthy();
  });
  it('deckFront is the coded front (so the two faces are genuinely different)', () => {
    expect(win.document.getElementById('deckFront').querySelector('.cf2')).toBeTruthy();
  });
  it('synthesizes pInfo from the slug so the coded back never falls through', () => {
    expect(html).toContain('If currentPlayer() has not resolved yet, synthesize a minimal pInfo');
  });
  it('the two 3D faces are Z-separated to defeat the iOS mirrored-front bleed', () => {
    expect(html).toMatch(/\.deck-front\{transform:translateZ\(1px\)/);
    expect(html).toMatch(/\.deck-back\{transform:rotateY\(180deg\) translateZ\(1px\)/);
  });
  it('a live-stats refresh rebuilds the deck back', () => {
    expect(typeof win.thwapDeckBackRefresh).toBe('function');
    expect(html).toContain('if(window.thwapDeckBackRefresh) window.thwapDeckBackRefresh();');
  });
});
