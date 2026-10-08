// test/drill-rollover-authoritative.test.js
//
// Guard for the "drills already marked done every morning" bug (Teddy #11).
// Thwap runs as an installed home-screen app reopened without a full reload;
// nothing re-read the date on resume and hydrate was ADD-ONLY, so a prior-day
// "done" view survived into the new day. Fix: hydrate is AUTHORITATIVE on a
// confirmed 200 (clears today's local done to match the server), plus a
// day-rollover resume guard clears today's state when the calendar day changed.
// These assertions lock that behavior AND that it stays FAIL-OPEN (an offline /
// non-authoritative read never wipes real completions). Keyed on the server set,
// not any player id, so it protects every player.
//
// Mirrors drill-hydrate.test.js boot (jsdom, ?day=0 weekday, fetch stub).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');

async function boot() {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://thwaphockey.com/?day=0',
    beforeParse(window) {
      window.document.cookie = 'thwapAuth=1';
      try { window.localStorage.setItem('bfPlayer', 'Teddy'); } catch (e) { /* ignore */ }
      window.scrollTo = () => {};
      window.fetch = (url, opts) => {
        const method = (opts && opts.method) || 'GET';
        if (String(url).indexOf('/api/done') >= 0 && method === 'GET') {
          // new day: server reports NOTHING done
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, player: 'teddy', date: '2026-10-08', drills: [], disciplines: {} }) });
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
      };
    },
  });
  const win = dom.window;
  await new Promise((r) => setTimeout(r, 120));
  return win;
}

function stickDone(win) {
  return win.document.getElementById('stickList').querySelectorAll('.exrow.done').length;
}
function seedStaleDone(win) {
  const n = win.document.getElementById('stickList').querySelectorAll('.exrow').length;
  const ids = [];
  for (let i = 0; i < n; i += 1) ids.push('stick:' + i);
  // mark every stick row done (as a prior-evening session would have left it)
  win.__thwapDrillApply.stick(ids.map((_, i) => i));
  return n;
}

describe('day-rollover: thwapClearTodayDone exists and clears today\'s done', () => {
  it('exposes the clear hook', async () => {
    const win = await boot();
    expect(typeof win.thwapClearTodayDone).toBe('function');
  });

  it('clears a stale prior-day done view (rows + signal) for any player', async () => {
    const win = await boot();
    const n = seedStaleDone(win);
    expect(stickDone(win)).toBe(n); // stale "done" present
    win.thwapClearTodayDone();
    expect(stickDone(win)).toBe(0); // cleared
    // the thwapDone|<today>|stick signal is gone
    let anySig = false;
    for (let k = 0; k < win.localStorage.length; k += 1) {
      const key = win.localStorage.key(k);
      if (/^thwapDone\|.*\|stick$/.test(key) && win.localStorage.getItem(key) === '1') anySig = true;
    }
    expect(anySig).toBe(false);
  });
});

describe('authoritative hydrate clears to match the server; offline is fail-open', () => {
  it('authoritative empty set (new day) clears stale done', async () => {
    const win = await boot();
    const n = seedStaleDone(win);
    expect(stickDone(win)).toBe(n);
    win.thwapApplyServerDone([], true); // confirmed 200, nothing done today
    expect(stickDone(win)).toBe(0);
  });

  it('NON-authoritative (offline/healed) read NEVER wipes real completions', async () => {
    const win = await boot();
    const n = seedStaleDone(win);
    expect(stickDone(win)).toBe(n);
    win.thwapApplyServerDone([]); // authoritative omitted = offline / fallback
    expect(stickDone(win)).toBe(n); // preserved, add-only behavior intact
  });

  it('authoritative set re-applies exactly the server\'s drills', async () => {
    const win = await boot();
    seedStaleDone(win);
    win.thwapApplyServerDone(['stick:0'], true); // server says only row 0 done today
    const rows = win.document.getElementById('stickList').querySelectorAll('.exrow');
    expect(rows[0].classList.contains('done')).toBe(true);
    if (rows.length > 1) expect(rows[1].classList.contains('done')).toBe(false);
  });
});
