// test/sticker-placement.test.js
//
// Two bugs this guards against:
//  (1) A placed sticker belongs to the SIGNED-IN player (stored under thwapPlaced:<pid>:<surface>).
//      It must render ONLY on that player's own card, never on a teammate card opened
//      read-only. Regression: buildFaces rendered placed stickers unconditionally, so the
//      viewer's stickers appeared on every teammate's card they looked at.
//  (2) The deck back face must keep its placed stickers after live stats rebuild the back
//      HTML. Regression: thwapDeckBackRefresh replaced deckBack.innerHTML (wiping decals)
//      and never re-rendered them, so a sticker dropped on the back vanished.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');

function boot(name, placed) {
  // placed: { 'thwapPlaced:lewie:front': '[...]', ... }
  const store = Object.assign({ bfPlayer: name }, placed || {});
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://x/#roster',
    beforeParse(w) {
      w.HTMLMediaElement.prototype.play = () => Promise.resolve();
      w.HTMLMediaElement.prototype.pause = () => {};
      w.scrollTo = () => {};
      w.fetch = (u) => {
        const s = String(u); let b = { ok: true };
        if (s.includes('board')) b = { players: [{ id: 'lewie', stick: 12, shoot: 8, dryland: 5, streak: 3 }] };
        else if (s.includes('stickers.json')) b = ['s1.png', 's2.png', 's3.png'];
        else b = { ok: false };
        return Promise.resolve({ ok: true, json: () => Promise.resolve(b) });
      };
      const ls = {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; }, clear: () => {},
      };
      Object.defineProperty(w, 'localStorage', { value: ls, configurable: true });
      Object.defineProperty(w.document, 'cookie', { get: () => 'thwapAuth=x', set: () => {}, configurable: true });
    },
  });
  return dom.window;
}

describe('Placed stickers are per-player and survive back rebuild', () => {
  it('render guards both faces on the viewer, not the viewed teammate', () => {
    // Both face renders must be gated on NOT viewing a teammate.
    expect(html).toContain("window.thwapRenderPlaced && !window.thwapViewTarget){ window.thwapRenderPlaced('front'");
    expect(html).toContain("window.thwapRenderPlaced && !window.thwapViewTarget){ window.thwapRenderPlaced('back'");
  });

  it('the deck back-refresh re-renders placed decals instead of wiping them', () => {
    // thwapDeckBackRefresh rebuilds the back HTML; it must redraw placed stickers after.
    const idx = html.indexOf('window.thwapDeckBackRefresh=function');
    expect(idx).toBeGreaterThan(-1);
    const body = html.slice(idx, idx + 500);
    expect(body).toContain('deckBack.innerHTML=window.buildBack');
    expect(body).toContain('window.thwapDeckRedraw()');
  });

  it("my placed sticker shows on MY card but NOT on a teammate card I open", async () => {
    const w = boot('Lewie', { 'thwapPlaced:lewie:front': JSON.stringify([{ file: 's1.png', x: 50, y: 50, rot: 0 }]) });
    await new Promise((r) => setTimeout(r, 200));
    w.document.body.classList.add('is-authed');

    // My own card: the placed decal renders.
    w.document.querySelector('#roster-grid .pcard[data-name="Lewie"]')
      .dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 150));
    const ownFront = w.document.getElementById('cardFront');
    expect(ownFront.querySelectorAll('.pl-decal').length).toBeGreaterThan(0);

    // Open a teammate card: my sticker must NOT appear on it.
    w.document.querySelector('#roster-grid .pcard[data-name="Liam Delatorre"]')
      .dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 150));
    expect(w.document.body.classList.contains('viewing-teammate')).toBe(true);
    expect(w.document.getElementById('cardFront').querySelectorAll('.pl-decal').length).toBe(0);
    expect(w.document.getElementById('cardBack').querySelectorAll('.pl-decal').length).toBe(0);
  });
});
