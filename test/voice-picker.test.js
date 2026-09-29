// test/voice-picker.test.js
//
// EXECUTION test: boots index.html in jsdom and checks the drill-narration voice
// picker on ALL three discipline lists. Guards the bug where the picker used shared
// ids (#vWord/#vSheet) so only the first (dryland) picker worked - stick/shoot were
// dead. Also guards the day-based unlock ladder: Canadian + Minnesota are free, the
// rest (American, Boston, New Yorker, Russian, Swedish, Finnish) unlock by days of
// training and render as locked chips that name the accent and count down the days.

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
    // Pin to a WEEKDAY (?day=0 -> Thursday via dayIndex): dryland rests on
    // weekends, so on a Sat/Sun run its list is a rest card with no drill rows
    // and no voice picker. Pinning a weekday makes all three lists render.
    url: 'https://thwaphockey.com/?day=0',
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

  it('Canadian + Minnesota unlock at day 0; the paid accents form the day-ladder', () => {
    // Day-based ladder (#187): can/mn are free (unlockAt 0); every other voice
    // unlocks by days of training. On a fresh boot thwapTrainingDays()===0 so only
    // the free two are selectable.
    expect(win.THWAP_VOICES.filter((v) => !v.unlockAt).map((v) => v.label).sort())
      .toEqual(['Canadian', 'Minnesota']);
    // American (us) is part of the ladder (unlocks at 30 days), not removed.
    expect(win.THWAP_VOICES.some((v) => v.label === 'American')).toBe(true);
    const labels = win.THWAP_VOICES.map((v) => v.label);
    ['American', 'Boston', 'New Yorker', 'Russian', 'Swedish', 'Finnish']
      .forEach((l) => expect(labels).toContain(l));
    // Aspirational placeholders with no recorded audio are NOT shipped in the app
    // list (chi is generator-only; fca/dan were never generated).
    ['Chicagoan', 'French Canadian', 'Dane'].forEach((l) => expect(labels).not.toContain(l));
    // the paid accents render as locked chips...
    const lockedChips = doc.querySelectorAll('.vpick .vopt.locked');
    expect(lockedChips.length).toBeGreaterThan(0);
    // ...and each locked chip names the accent and counts down the days to unlock.
    expect(lockedChips[0].textContent).toMatch(/unlocks in \d+ days/);
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
