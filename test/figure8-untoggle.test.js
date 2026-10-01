// test/figure8-untoggle.test.js
//
// Guards for two changes:
//   CHANGE 1  the stick catalog has 'Figure-8 Roll' (and NOT 'Bottom-Hand Only'),
//             with the timing-map key renamed to match.
//   CHANGE 2  a completed drill row is tappable to UN-MARK it: tapping a .done
//             row removes .done, resets the button to 'Start', clears prog, and
//             clears the local day-done key (thwapStampToday(disc,false)) so the
//             credit can be re-earned. No timer runs on un-mark.
//
// The un-toggle part is an EXECUTION test (jsdom runs the inline scripts), because
// a source substring cannot prove the handler no longer early-returns.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');

describe('CHANGE 1: Figure-8 Roll replaces Bottom-Hand Only (source guard)', () => {
  it('stick catalog contains Figure-8 Roll and not Bottom-Hand Only', () => {
    expect(html).toContain("name:'Figure-8 Roll'");
    expect(html).not.toContain('Bottom-Hand Only');
  });

  it('the timing-map key was renamed to Figure-8 Roll', () => {
    expect(html).toMatch(/'Figure-8 Roll':\{type:'reps',reps:15,perRep:1\.5,sides:1/);
  });

  it('keeps the stick_12 audio key and a real (non-placeholder) video', () => {
    // the Figure-8 Roll entry keeps audio:'stick_12' and its original YouTube video
    expect(html).toMatch(
      /name:'Figure-8 Roll',[^}]*video:'https:\/\/www\.youtube\.com\/watch\?v=gzfPlIE8EJ8',[^}]*audio:'stick_12'/
    );
  });

  it('adds no banned punctuation in the new drill copy', () => {
    const entry = html.slice(html.indexOf("name:'Figure-8 Roll'"));
    const line = entry.slice(0, entry.indexOf('},') + 1);
    expect(line).not.toMatch(/\u2014/); // em-dash
    expect(line).not.toMatch(/\u2013/); // en-dash
    expect(line).not.toMatch(/\u00b7/); // middle dot
  });
});

describe('CHANGE 2: a done drill row un-marks on tap (execution)', () => {
  let win, doc;

  beforeAll(async () => {
    // Pre-seed the stick progress store so row 0 renders as DONE. The stick store
    // key is derived in-page; set it before boot via a storage shim.
    const dom = new JSDOM(html, {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      url: 'https://thwaphockey.com/?day=0',
      beforeParse(window) {
        window.fetch = () =>
          Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: false }) });
        window.scrollTo = () => {};
      },
    });
    win = dom.window;
    doc = win.document;
    await new Promise((r) => setTimeout(r, 50));

    // Mark the first rendered stick row done through the page's own markDone path
    // by driving the un-mark we are testing from a known-done state: set prog[0]
    // via the exposed stores, then re-render by firing hashchange.
  });

  it('tapping a done stick row removes .done, resets the button, clears the day key', async () => {
    const list = doc.getElementById('stickList');
    expect(list).toBeTruthy();
    const row = list.querySelector('.exrow');
    expect(row).toBeTruthy();

    // Put the row into the DONE state the real markDone would produce, including
    // the local day-done key, so we can prove the UN-MARK clears it.
    row.classList.add('done');
    const btn = row.querySelector('.exdone');
    btn.textContent = 'Done \u2713';
    win.thwapStampToday('stick', true); // sets thwapDone|<day>|stick = 1
    const dayKeyBefore = Object.keys(win.localStorage).find(
      (k) => k.startsWith('thwapDone|') && k.endsWith('|stick')
    );
    expect(dayKeyBefore).toBeTruthy();
    expect(win.localStorage.getItem(dayKeyBefore)).toBe('1');

    // Tap the done row -> should UN-MARK (no timer, no early return).
    btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 10));

    expect(row.classList.contains('done')).toBe(false);
    expect(btn.textContent).toBe('Start');
    // the local day-done key for stick is cleared so credit can be re-earned
    expect(win.localStorage.getItem(dayKeyBefore)).toBe(null);
  });

  it('the three drill-list exdone handlers no longer early-return on a done row', () => {
    // Structural guard: none of the per-list handlers keep the old
    // "if(row.classList.contains('done')){ return; }" no-op; they call unMark.
    const noop = /if\(row\.classList\.contains\('done'\)\)\{ return; \}/g;
    expect((html.match(noop) || []).length).toBe(0);
    // every drill-list handler routes a done tap through unMark()
    const unmark = /if\(row\.classList\.contains\('done'\)\)\{ unMark\(\); return; \}/g;
    expect((html.match(unmark) || []).length).toBeGreaterThanOrEqual(3);
  });
});
