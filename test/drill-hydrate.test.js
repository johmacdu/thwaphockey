// test/drill-hydrate.test.js
//
// EXECUTION test: boots index.html in jsdom with a fetch stub standing in for
// GET /api/done, and verifies the cross-device hydration path:
//   - the server-returned drill ids re-draw the right checkmarks (right boxes),
//   - a fetch error FAILS OPEN (no crash, no wrongly-cleared boxes).
// Mirrors drill-render.test.js (same ?day=0 weekday pin + beforeParse stubs).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');

// Boot the app with a controllable fetch. `getDrills` is what GET /api/done
// returns; `getThrows` makes every fetch reject (the fail-open case).
async function boot({ getDrills = [], getThrows = false } = {}) {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://thwaphockey.com/?day=0', // Thursday: a training weekday
    beforeParse(window) {
      // Signed-in player so the on-load hydrate guard (authed + bfPlayer) passes.
      window.document.cookie = 'thwapAuth=1';
      try { window.localStorage.setItem('bfPlayer', 'Lewie'); } catch (e) { /* ignore */ }
      window.scrollTo = () => {};
      window.fetch = (url, opts) => {
        if (getThrows) return Promise.reject(new Error('offline'));
        const method = (opts && opts.method) || 'GET';
        if (String(url).indexOf('/api/done') >= 0 && method === 'GET') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ ok: true, player: 'lewie', date: '2026-10-01', drills: getDrills, disciplines: {} }),
          });
        }
        // any other call (POST marks, session mint) succeeds quietly
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
      };
    },
  });
  const win = dom.window;
  // let the on-load IIFEs render AND the async hydrate fetch resolve + re-render
  await new Promise((r) => setTimeout(r, 120));
  return win;
}

describe('cross-device hydration marks the right boxes', () => {
  it('exposes the hydration + apply hooks', async () => {
    const win = await boot({ getDrills: [] });
    expect(typeof win.thwapHydrateDone).toBe('function');
    expect(typeof win.thwapApplyServerDone).toBe('function');
    expect(typeof win.thwapUnmarkDone).toBe('function');
    // each discipline registered an apply hook
    expect(typeof win.__thwapDrillApply.stick).toBe('function');
    expect(typeof win.__thwapDrillApply.shoot).toBe('function');
    expect(typeof win.__thwapDrillApply.dryland).toBe('function');
  });

  it('a server drill id checks the matching row on this (second) device', async () => {
    const win = await boot({ getDrills: ['stick:0', 'shoot:0'] });
    const stickRows = win.document.getElementById('stickList').querySelectorAll('.exrow');
    const shootRows = win.document.getElementById('shootList').querySelectorAll('.exrow');
    expect(stickRows.length).toBeGreaterThan(0);
    expect(shootRows.length).toBeGreaterThan(0);
    // index 0 of each list is now rendered done (hydrated from the server)
    expect(stickRows[0].classList.contains('done')).toBe(true);
    expect(shootRows[0].classList.contains('done')).toBe(true);
  });

  it('a drill id NOT returned stays unchecked (only the right boxes)', async () => {
    const win = await boot({ getDrills: ['stick:0'] });
    const stickRows = win.document.getElementById('stickList').querySelectorAll('.exrow');
    expect(stickRows[0].classList.contains('done')).toBe(true);
    // a later stick row that the server did not report is NOT marked
    if (stickRows.length > 1) {
      expect(stickRows[1].classList.contains('done')).toBe(false);
    }
  });

  it('applying the full set stamps the discipline done signal (no earned re-bump)', async () => {
    const win = await boot({ getDrills: [] });
    // how many stick rows render today, and apply ALL of them
    const n = win.document.getElementById('stickList').querySelectorAll('.exrow').length;
    const earnedBefore = win.thwapGetEarned();
    const ids = [];
    for (let i = 0; i < n; i += 1) ids.push('stick:' + i);
    win.thwapApplyServerDone(ids);
    // every stick row is done
    const done = win.document.getElementById('stickList').querySelectorAll('.exrow.done').length;
    expect(done).toBe(n);
    // the unified done signal for stick is set (thwapDone|<today>|stick=1)
    let stickSignalSet = false;
    for (let k = 0; k < win.localStorage.length; k += 1) {
      const key = win.localStorage.key(k);
      if (/^thwapDone\|.*\|stick$/.test(key) && win.localStorage.getItem(key) === '1') stickSignalSet = true;
    }
    expect(stickSignalSet).toBe(true);
    // hydration must NOT inflate the earned/sticker count (that is per originating device)
    expect(win.thwapGetEarned()).toBe(earnedBefore);
  });
});

describe('hydration fails open', () => {
  it('a fetch error leaves the app rendered and crashes nothing', async () => {
    const win = await boot({ getThrows: true });
    // lists still render normally despite the failed hydrate fetch
    const stickRows = win.document.getElementById('stickList').querySelectorAll('.exrow');
    expect(stickRows.length).toBeGreaterThan(0);
    // nothing wrongly marked done by a failed fetch
    expect(stickRows[0].classList.contains('done')).toBe(false);
    // the hook is still callable and resolves (fail-open contract)
    await expect(win.thwapHydrateDone()).resolves.toBeTruthy();
  });
});
