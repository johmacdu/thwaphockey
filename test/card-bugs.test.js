// test/card-bugs.test.js
//
// Guards three bugs fixed together:
//  1. Closed team-grid card hardcoded theme 'red' for everyone (open vs closed
//     card colors disagreed). Fixed by dropping the 'red' override so the grid
//     card uses cb2Theme(slug), matching the open card.
//  2. Card back showed weekly stats and read thwapBoard.week (often empty, so
//     "stats not updating"). Now shows ALL TIME and reads thwapBoard.all, with a
//     one-shot all-time board fetch (thwapEnsureAllBoard) that repaints cards.
//  3. Coach edit sheet PIN section: replaced the "change the jersey number to
//     reset" hint with a "Request new code" button that emails both parents.
//
// EXECUTION test where it matters (cb2Theme drives the plate, not a hardcoded
// colour) plus source guards for the wiring that jsdom cannot exercise (server
// fetches, the coach-gated edit sheet).

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
const coachJs = readFileSync(resolve(__dirname, '../api/coach.js'), 'utf8');

let win;
beforeAll(async () => {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: false }) });
      window.scrollTo = () => {};
    },
  });
  win = dom.window;
  await new Promise((r) => setTimeout(r, 50));
});

describe('Card color: closed grid card matches the open card (no hardcoded red)', () => {
  it('the roster grid paint no longer forces theme "red"', () => {
    // The only buildFront call that passed a 4th theme-override arg was the grid.
    expect(html).not.toMatch(/buildFront\(built\.info,\s*built\.slug,\s*photoUrl,\s*'red'\)/);
  });
  it('buildFront picks the plate from cb2Theme, so it is not always red', () => {
    expect(typeof win.buildFront).toBe('function');
    // liam hash-picks 'blue' among the default-unlocked {red,blue}; a hardcoded
    // 'red' would have shown red. Assert the plate reflects the per-player theme.
    const liam = win.buildFront({ first: 'Liam', num: '29', pos: 'D' }, 'liam', null);
    const lewie = win.buildFront({ first: 'Lewie', num: '72', pos: 'FD' }, 'lewie', null);
    expect(liam).toContain('cb2-th-blue');
    expect(lewie).toContain('cb2-th-red');
  });
});

describe('Card stats: prefer all-time, fall back to weekly when empty', () => {
  it('cb2Stat prefers a non-zero all-time row but falls back to the weekly board', () => {
    // The all-time backend counters can be all-zero; the card must then show the
    // weekly numbers rather than a wall of zeros.
    expect(html).toContain('function cb2Row(slug)');
    expect(html).toMatch(/a\.stick\|\|0\)\+\(a\.shoot\|\|0\)\+\(a\.dryland\|\|0\)\+\(a\.streak\|\|0\)\)>0\) return a/);
    expect(html).toMatch(/var wk=b\.week&&b\.week\[slug\]/);
    expect(html).toContain('function cb2Stat(slug,disc){ var r=cb2Row(slug); return r?(r[disc]||0):0; }');
  });
  it('renders real stats when all-time is zero but weekly has data', () => {
    win.thwapBoard = { all: { lewie: { stick: 0, shoot: 0, dryland: 0, streak: 0 } }, week: { lewie: { stick: 6, shoot: 6, dryland: 1, streak: 0 } } };
    const back = win.buildBack({ first: 'Lewie', num: '72', pos: 'FD' }, 'lewie');
    // weekly fallback: 6 stick, 6 shoot, 1 dryland, 13 total sessions
    expect(back).toContain('>6<');
    expect(back).toContain('>1<');
    expect(back).toContain('>13<');
  });
  it('the back card is labelled All time, not This week', () => {
    const back = win.buildBack({ first: 'Lewie', num: '72', pos: 'FD' }, 'lewie');
    expect(back).toContain('All time');
    expect(back).toContain('Total sessions');
    expect(back).not.toContain('This week');
    expect(back).not.toContain('Sessions this week');
  });
  it('exposes a one-shot all-time board fetch that repaints cards', () => {
    expect(typeof win.thwapEnsureAllBoard).toBe('function');
    expect(html).toContain('window.thwapRepaintRoster=repaintRosterGrid;');
  });
});

describe('Coach edit sheet: Request new code button (no jersey-reset hint)', () => {
  it('replaced the "change the jersey number" hint with a Request new code button', () => {
    expect(html).not.toContain('To reset it, change the jersey number above');
    expect(html).toContain("id='peReqCode'");
    expect(html).toContain('Request new code');
  });
  it('the button posts to the request-code action', () => {
    expect(html).toContain("action=request-code");
  });
});

describe('Backend: request-code emails BOTH parents', () => {
  it('requestCode sends to parentEmail and parentEmail2', () => {
    expect(coachJs).toContain('[m.parentEmail, m.parentEmail2]');
    // both addresses are collected then mailed in a loop
    expect(coachJs).toMatch(/for \(const clean of Object\.keys\(seen\)\)/);
  });
});

describe('Team edit mode: visually distinct + opens instantly', () => {
  it('edit mode adds a pencil badge and scale so it differs from a normal tap', () => {
    expect(html).toMatch(/roster-editing #roster-grid \.pcard:not\(\.pcard-add\)::after/);
    expect(html).toContain('transform:scale(.965)');
  });
  it('the edit sheet shows before the roster fetch resolves (instant open)', () => {
    // peSheetShow(true) is called synchronously, and the fetch only fills fields.
    const src = html.slice(html.indexOf('function openPlayerEdit'));
    const openIdx = src.indexOf('peSheetShow(true);');
    const fetchIdx = src.indexOf("fetch('/api/coach?action=roster");
    expect(openIdx).toBeGreaterThan(-1);
    expect(fetchIdx).toBeGreaterThan(-1);
    expect(openIdx).toBeLessThan(fetchIdx); // shown first, then fetched
  });
  it('seeds the jersey from the tapped card so it appears immediately', () => {
    expect(html).toContain("cardEl.querySelector('.pcard-bn')");
  });
});

describe('Coach page copy is tightened', () => {
  it('weekly-plan and team-goal intros are the short versions', () => {
    expect(html).not.toContain('Pick what your team trains each day. Tap a discipline to add or remove it');
    expect(html).not.toContain('Set one focus for the whole team. It shows in every');
    expect(html).toContain('Tap a discipline to set what your team trains each day, then Save.');
    expect(html).toContain('One team focus, shown in every player');
  });
});

describe('Flip card faces are Z-separated (iOS mirrored-front fix)', () => {
  // The card opened by tapping the home name / a Team-page card is the flip card
  // (.card3d / .cardface / .cardback), NOT the sticker deck. It had the same iOS
  // bleed-through risk (backface-visibility + overflow:hidden + border-radius with
  // no Z-separation), so the back showed a mirrored copy of the front on iPhone.
  it('.cardfront and .cardback each carry translateZ separation', () => {
    expect(html).toMatch(/\.cardfront\{transform:translateZ\(1px\);-webkit-transform:translateZ\(1px\)\}/);
    expect(html).toMatch(/\.cardback\{transform:rotateY\(180deg\) translateZ\(1px\);-webkit-transform:rotateY\(180deg\) translateZ\(1px\)\}/);
  });
});
