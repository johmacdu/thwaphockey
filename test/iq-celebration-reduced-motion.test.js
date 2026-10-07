// test/iq-celebration-reduced-motion.test.js
//
// EXECUTION test: boots index.html in jsdom and fires the Hockey IQ completion
// celebration (window.thwapCategoryDone('iq'), the exact call iqSubmit makes on
// Submit). Guards that Sass SHOWS UP in both motion modes:
//   - normal motion  -> the animated Sass cameo (.cf-cameo, sliding celly)
//   - reduced motion -> a STILL Sass cameo (.cf-cameo.cf-still), not just a text
//     badge (the regression this fix addresses).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');

async function boot({ reduce }) {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://thwaphockey.com/',
    beforeParse(window) {
      window.scrollTo = () => {};
      window.HTMLMediaElement.prototype.play = () => Promise.resolve();
      // prefers-reduced-motion is read at parse time by the celebration engine.
      window.matchMedia = (q) => ({
        matches: reduce && /reduced-motion/.test(q),
        media: q, onchange: null,
        addListener() {}, removeListener() {},
        addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
      });
    },
  });
  await new Promise((r) => setTimeout(r, 60));
  const win = dom.window;
  try { Object.keys(win.localStorage).forEach((k) => { if (/thwapCatCeleb/.test(k)) win.localStorage.removeItem(k); }); } catch (e) { /* noop */ }
  return win;
}

describe('Hockey IQ celebration: Sass shows up', () => {
  it('reduced motion: a STILL Sass cameo appears (not just a text badge)', async () => {
    const win = await boot({ reduce: true });
    expect(typeof win.thwapCategoryDone).toBe('function');
    win.thwapCategoryDone('iq');
    const still = win.document.querySelector('.cf-cameo.cf-still');
    expect(still).toBeTruthy();
    expect(still.getAttribute('src')).toBe('login/sass-celly.webp');
  });

  it('normal motion: the animated Sass cameo appears', async () => {
    const win = await boot({ reduce: false });
    win.thwapCategoryDone('iq');
    const cameo = win.document.querySelector('.cf-cameo');
    expect(cameo).toBeTruthy();
    expect(cameo.getAttribute('src')).toBe('login/sass-celly.webp');
    expect(cameo.classList.contains('cf-still')).toBe(false); // the animated cameo, not the still variant
  });
});
