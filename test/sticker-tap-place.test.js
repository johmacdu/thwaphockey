// test/sticker-tap-place.test.js
//
// Guards the tap-to-place path for stickers. Problem it fixes: once many stickers are
// unlocked, a sticker at the bottom of the grid is far from the card, making a
// drag-to-card gesture nearly impossible (long travel, scroll fights the drag on touch).
// Fix: tapping a tray sticker PICKS it (lime ring + "Now tap your card" tip); tapping the
// visible card face then drops it there. Drag still works and is unchanged.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');

describe('Sticker tap-to-place wiring', () => {
  it('exposes the pick API and clears on Escape', () => {
    expect(html).toContain('window.thwapPickSticker=function');
    expect(html).toContain('window.thwapClearPick=function');
    expect(html).toContain("if(e.key==='Escape') window.thwapClearPick()");
  });

  it('a tray tap (no movement) picks instead of dragging', () => {
    // The tray cell starts a drag only after movement past the threshold; a release
    // without movement calls thwapPickSticker.
    expect(html).toContain('if(window.thwapStartTrayDrag) window.thwapStartTrayDrag(f, ev)');
    expect(html).toContain('if(!became){ if(window.thwapPickSticker) window.thwapPickSticker(f, cell); }');
  });

  it('tapping the visible card face places the picked sticker', () => {
    // thwapDecorateDeck wires a click on each face that drops PICK.file on the visible one.
    expect(html).toContain('if(!PICK.file) return');
    expect(html).toContain('window.thwapPlaced.add(vf.surface, PICK.file, q.x, q.y)');
    expect(html).toContain('window.thwapClearPick()');
  });
});

describe('Sticker tap-to-place behavior', () => {
  function boot() {
    const store = { bfPlayer: 'Lewie' };
    const dom = new JSDOM(html, {
      runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://x/#stickers',
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

  it('pick a tray sticker then tap the card face: it lands as a placed decal', async () => {
    const w = boot();
    await new Promise((r) => setTimeout(r, 250));
    // Deck must be registered.
    expect(typeof w.thwapPickSticker).toBe('function');
    expect(typeof w.thwapDeckRedraw).toBe('function');

    const front = w.document.getElementById('deckFront');
    expect(front).toBeTruthy();
    const before = front.querySelectorAll('.pl-decalwrap').length;

    // Pick a sticker (as if tapping a tray cell), then click the visible front face.
    w.thwapPickSticker('s1.png', null);
    front.getBoundingClientRect = () => ({ left: 0, top: 0, right: 200, bottom: 280, width: 200, height: 280 });
    front.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true, clientX: 100, clientY: 140 }));

    const after = front.querySelectorAll('.pl-decalwrap').length;
    expect(after).toBe(before + 1);
    // Pick cleared after placing.
    const list = JSON.parse(w.localStorage.getItem('thwapPlaced:lewie:front') || '[]');
    expect(list.some((p) => p.file === 's1.png')).toBe(true);
  });
});
