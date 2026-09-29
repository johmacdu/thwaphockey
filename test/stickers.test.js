// test/stickers.test.js
//
// P2 client-side test for the Sticker Book earned/locked derivation in
// index.html. Mirrors the JSDOM harness in test/hero-do-summary.test.js.
//
// The earned-state rule, as READ from the sticker-book IIFE in index.html:
//   playerId()    = first word of localStorage['bfPlayer'] lowercased, else 'guest'
//   earnedCount() = parseInt(localStorage['thwapEarned:<playerId>'] || '0')
//   STARTER       = 3   (every player starts with 3 unlocked to seed the fun)
//   EARNED        = min(max(earnedCount, STARTER), files.length)
//   Then cell i is EARNED when i < EARNED, otherwise LOCKED.
//   The count line reads "<EARNED> of <files.length> earned".
//
// The only external dependency is fetch('stickers/stickers.json'); we stub
// window.fetch with a known manifest so the grid renders deterministically. The
// sticker script runs on load and populates #stickGrid via a promise chain, so
// the test flushes microtasks before asserting.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

// A fixed 8-sticker manifest for deterministic index math.
const MANIFEST = ['a.png', 'b.png', 'c.png', 'd.png', 'e.png', 'f.png', 'g.png', 'h.png'];

// Render index.html in JSDOM with:
//   - a stubbed fetch that returns MANIFEST for stickers.json;
//   - localStorage seeded with the given player id + earned counter.
// Returns { document, window } once the sticker grid has been populated.
async function render({ player = 'Lewie M', earned = null, manifest = MANIFEST } = {}) {
  const seed = {};
  if (player != null) seed['bfPlayer'] = player;
  if (earned != null) {
    const pid = String(player || 'guest').trim().split(/\s+/)[0].toLowerCase();
    seed['thwapEarned:' + pid] = String(earned);
  }

  const inject = '<script>' +
    'window.__seed=' + JSON.stringify(seed) + ';' +
    'window.__manifest=' + JSON.stringify(manifest) + ';' +
    // seed localStorage before the app scripts read it
    'try{for(var k in window.__seed){localStorage.setItem(k, window.__seed[k]);}}catch(e){}' +
    // stub fetch so stickers.json resolves to our manifest (any other URL -> empty)
    'window.fetch=function(u){' +
    "  if(String(u).indexOf('stickers.json')>=0){return Promise.resolve({json:function(){return Promise.resolve(window.__manifest);}});}" +
    '  return Promise.resolve({json:function(){return Promise.resolve([]);},ok:true,status:200});' +
    '};' +
    '</script>';
  const doc = html.replace('<head>', '<head>' + inject);
  const dom = new JSDOM(doc, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/' });

  // Flush the fetch().then().then() chain that fills the grid.
  for (let i = 0; i < 10; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 0));
  }
  return { document: dom.window.document, window: dom.window };
}

function cells(document) {
  return [...document.getElementById('stickGrid').querySelectorAll('.stickcell')];
}

describe('Sticker Book earned-state', () => {
  it('a brand-new player (0 completions) shows the STARTER floor of 3 earned', async () => {
    const { document } = await render({ player: 'Newkid', earned: 0 });
    const grid = document.getElementById('stickGrid');
    expect(grid).toBeTruthy();
    const cs = cells(document);
    expect(cs.length).toBe(MANIFEST.length);
    // First 3 earned, rest locked.
    const earned = cs.filter((c) => c.classList.contains('earned'));
    const locked = cs.filter((c) => c.classList.contains('locked'));
    expect(earned.length).toBe(3);
    expect(locked.length).toBe(MANIFEST.length - 3);
    expect(document.getElementById('stickCount').textContent).toBe('3 of 8 earned');
  });

  it('earned cells carry a draggable sticker image; locked cells show the mystery "?"', async () => {
    const { document } = await render({ player: 'Newkid', earned: 0 });
    const cs = cells(document);
    // cell 0 earned -> has an <img>, no "?"
    expect(cs[0].classList.contains('earned')).toBe(true);
    expect(cs[0].querySelector('img')).toBeTruthy();
    // cell 7 locked -> no <img>, shows the mystery span
    expect(cs[7].classList.contains('locked')).toBe(true);
    expect(cs[7].querySelector('img')).toBeNull();
    expect(cs[7].querySelector('.stick-myst')).toBeTruthy();
  });

  it('more completions than the starter earn proportionally more stickers', async () => {
    const { document } = await render({ player: 'Lewie', earned: 5 });
    const cs = cells(document);
    expect(cs.filter((c) => c.classList.contains('earned')).length).toBe(5);
    expect(cs.filter((c) => c.classList.contains('locked')).length).toBe(3);
    expect(document.getElementById('stickCount').textContent).toBe('5 of 8 earned');
  });

  it('a completion count at or below the starter still shows exactly the starter (floor)', async () => {
    const { document } = await render({ player: 'Lewie', earned: 2 });
    // max(2, STARTER=3) = 3
    expect(cells(document).filter((c) => c.classList.contains('earned')).length).toBe(3);
    expect(document.getElementById('stickCount').textContent).toBe('3 of 8 earned');
  });

  it('earned count is clamped to the number of stickers available (never over 100%)', async () => {
    const { document } = await render({ player: 'Lewie', earned: 999 });
    const cs = cells(document);
    // min(max(999,3), 8) = 8 -> all earned, none locked
    expect(cs.filter((c) => c.classList.contains('earned')).length).toBe(MANIFEST.length);
    expect(cs.filter((c) => c.classList.contains('locked')).length).toBe(0);
    expect(document.getElementById('stickCount').textContent).toBe('8 of 8 earned');
  });

  it("the earned count is per-player (reads thwapEarned:<playerId> for the signed-in player)", async () => {
    // Lewie has 6 completions; the counter key is namespaced by his id.
    const { document } = await render({ player: 'Lewie M', earned: 6 });
    expect(cells(document).filter((c) => c.classList.contains('earned')).length).toBe(6);
    expect(document.getElementById('stickCount').textContent).toBe('6 of 8 earned');
  });

  it('a different manifest size changes the total and the clamp', async () => {
    const small = ['x.png', 'y.png', 'z.png', 'w.png'];
    const { document } = await render({ player: 'Lewie', earned: 0, manifest: small });
    // 4 stickers, starter floor 3 -> "3 of 4 earned"
    expect(cells(document).length).toBe(4);
    expect(document.getElementById('stickCount').textContent).toBe('3 of 4 earned');
  });
});
