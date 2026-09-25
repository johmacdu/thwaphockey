// test/voice-picker.test.js
//
// EXECUTION test: boots index.html in jsdom and checks the drill-narration voice
// picker on ALL three discipline lists. Guards the bug where the picker used shared
// ids (#vWord/#vSheet) so only the first (dryland) picker worked - stick/shoot were
// dead. Also guards the voice list: only Canadian + Minnesotan unlocked, the rest
// locked, no "American".

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');

let win, doc;
beforeAll(async () => {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: false }) });
      window.scrollTo = () => {};
    },
  });
  win = dom.window; doc = win.document;
  await new Promise((r) => setTimeout(r, 50));
});

describe('Drill narration voice picker (all three disciplines, no id collision)', () => {
  it('renders a picker on dryland, stick AND shoot lists (3 total, class-scoped not id)', () => {
    const picks = doc.querySelectorAll('.vpick');
    expect(picks.length).toBe(3);
    // no shared ids that would collide
    expect(doc.getElementById('vWord')).toBeNull();
    expect(doc.getElementById('vSheet')).toBeNull();
    picks.forEach((p) => {
      expect(p.querySelector('.vword')).toBeTruthy();
      expect(p.querySelector('.vsheet')).toBeTruthy();
    });
  });

  it('each picker opens its OWN sheet independently (stick tap does not open dryland)', () => {
    const picks = doc.querySelectorAll('.vpick');
    const stick = picks[1]; // dryland, stick, shoot order
    const stickWord = stick.querySelector('.vword');
    const stickSheet = stick.querySelector('.vsheet');
    const drylandSheet = picks[0].querySelector('.vsheet');
    expect(stickSheet.hidden).toBe(true);
    stickWord.dispatchEvent(new win.Event('click', { bubbles: true }));
    expect(stickSheet.hidden).toBe(false);   // stick's own sheet opened
    expect(drylandSheet.hidden).toBe(true);  // dryland's did NOT
  });

  it('only Canadian + Minnesotan are unlocked; the rest are locked; no American', () => {
    expect(win.THWAP_VOICES.filter((v) => !v.unlockAt).map((v) => v.label).sort())
      .toEqual(['Canadian', 'Minnesotan']);
    expect(win.THWAP_VOICES.some((v) => v.label === 'American')).toBe(false);
    const labels = win.THWAP_VOICES.map((v) => v.label);
    ['New Yorker', 'Chicagoan', 'Bostonian', 'French Canadian', 'Finn', 'Swede', 'Russian', 'Dane']
      .forEach((l) => expect(labels).toContain(l));
    // a picker shows the locked ones as locked chips
    const lockedChips = doc.querySelectorAll('.vpick .vopt.locked');
    expect(lockedChips.length).toBeGreaterThan(0);
  });

  it('the sheet is an absolute overlay (floats on top, does not shift items down)', () => {
    // .vsheet must be position:absolute so opening it overlays rather than pushing
    // the drill rows down; .vpick is the positioning anchor.
    expect(html).toMatch(/\.vsheet\{position:absolute;/);
    expect(html).toMatch(/\.vpick\{[^}]*position:relative/);
  });

  it('renders ALL voice rows (scrollable), not a truncated list', () => {
    // Same list for every team (demo included) - the picker emits one row per voice.
    const out = win.voicePickerHTML();
    const tmp = doc.createElement('div'); tmp.innerHTML = out;
    expect(tmp.querySelectorAll('.vopt').length).toBe(win.THWAP_VOICES.length);
    // the overlay caps visible height and scrolls, so every row stays reachable
    expect(html).toMatch(/\.vsheet\{[^}]*max-height:252px[^}]*overflow-y:auto/);
  });
});
