// test/drill-render.test.js
//
// EXECUTION test (not a string guard): boots index.html in jsdom, runs its inline
// scripts, and renders the Stickhandling + Shooting drill lists. This catches the
// class of bug where a cross-IIFE call (e.g. videoBlock, which lives in the dryland
// IIFE) throws a ReferenceError and blanks the whole list - which a source-substring
// assertion cannot see. Regression guard for the "stick/shoot drills are empty" bug.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');

let win;
beforeAll(async () => {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      // stub network + storage the inline scripts touch so they run to completion
      window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: false }) });
      window.scrollTo = () => {};
    },
  });
  win = dom.window;
  // let the on-load IIFEs (stick/shoot render synchronously) settle
  await new Promise((r) => setTimeout(r, 50));
});

describe('Drill lists actually render (no cross-IIFE ReferenceError)', () => {
  it('exposes videoBlock/ytid globally so stick + shoot IIFEs can call them', () => {
    expect(typeof win.videoBlock).toBe('function');
    expect(typeof win.ytid).toBe('function');
    const out = win.videoBlock({ video: 'https://www.youtube.com/watch?v=5daeyw6mRzA' });
    expect(out).toContain('exvid-link');
    expect(out).toContain('5daeyw6mRzA');
  });

  it('the Stickhandling list renders drill tiles (not empty)', () => {
    const list = win.document.getElementById('stickList');
    expect(list).toBeTruthy();
    expect(list.querySelectorAll('.exrow').length).toBeGreaterThan(0);
    // and the Watch-how link is present in the rendered tile
    expect(list.querySelector('.exvid-link')).toBeTruthy();
  });

  it('the Shooting list renders drill tiles (not empty)', () => {
    const list = win.document.getElementById('shootList');
    expect(list).toBeTruthy();
    expect(list.querySelectorAll('.exrow').length).toBeGreaterThan(0);
  });
});

describe('Drill intensity reduced (shooting -2, dryland cap 4)', () => {
  it('dryland caps at 4 drills and shooting renders 2 fewer than the day list', () => {
    // dryland cap
    expect(html).toMatch(/var CAP=4;/);
    // shooting render-time slice
    expect(html).toMatch(/SHOOT=SHOOT\.slice\(0, Math\.max\(1, SHOOT\.length-2\)\)/);
  });
  it('renders the reduced counts (dryland <= 4; shooting = day length - 2)', () => {
    // uses the win from the earlier beforeAll in this file
    const dryland = win.document.getElementById('drylandList').querySelectorAll('.exrow').length;
    const shoot = win.document.getElementById('shootList').querySelectorAll('.exrow').length;
    expect(dryland).toBeLessThanOrEqual(4);
    expect(dryland).toBeGreaterThan(0);
    const dayLens = (win.SHOOT_DAYS || []).map((d) => d.length);
    const maxDay = Math.max(...dayLens);
    // shooting shows 2 fewer than a full day (days are all 5 -> 3), min 1
    expect(shoot).toBe(Math.max(1, maxDay - 2));
  });
});
