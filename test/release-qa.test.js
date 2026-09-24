// test/release-qa.test.js
//
// Release bug-bash hardening for the Jr Rangers 10U launch. Two jobs:
//   1. A GENERAL sweep that catches the recurring Thwap bug class once and for
//      all: an element that starts with the `hidden` attribute still shows if a
//      CSS rule gives it display:flex/inline-flex/grid, because that explicit
//      display beats the browser's implicit [hidden]{display:none}. Every such
//      selector needs its own `.selector[hidden]{display:none}`. This test finds
//      every offender structurally, so a new one fails CI instead of shipping.
//   2. Coach-view and player-view behavior guards.
//
// @vitest-environment jsdom

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
let doc;
beforeAll(() => { doc = new DOMParser().parseFromString(html, 'text/html'); });

// ---------------------------------------------------------------------------
// 1. The [hidden]-vs-display sweep (whole bug class)
// ---------------------------------------------------------------------------
describe('Every hidden element that has display:flex/grid also has a [hidden] override', () => {
  // Collect the class of every element that carries the `hidden` attribute in
  // the shipped markup (this is how the app hides panels on load).
  function classesOfHiddenElements() {
    const out = new Set();
    for (const el of doc.querySelectorAll('[hidden]')) {
      el.classList.forEach((c) => out.add(c));
    }
    return out;
  }

  // For a class, does the stylesheet give it an explicit non-none display, and
  // is there a matching `.class[hidden]{display:none}` override?
  function displayRuleFor(cls) {
    const m = html.match(new RegExp('\\.' + cls.replace(/[-]/g, '\\-') + '\\{([^}]*)\\}'));
    if (!m) return null;
    const d = m[1].match(/display:(flex|inline-flex|grid|block)/);
    return d ? d[1] : null;
  }
  function hasOverride(cls) {
    return html.includes('.' + cls + '[hidden]{display:none}');
  }

  it('no hidden element is left visible by a display:flex/inline-flex/grid rule', () => {
    const offenders = [];
    for (const cls of classesOfHiddenElements()) {
      const disp = displayRuleFor(cls);
      if (disp && disp !== 'block' && !hasOverride(cls)) {
        offenders.push(`.${cls} (display:${disp}, no [hidden] override)`);
      }
    }
    expect(offenders, `add \`.selector[hidden]{display:none}\` for: ${offenders.join(', ')}`).toEqual([]);
  });

  // Pin the three fixed this pass so a regression names them directly.
  it('.actionbar (drill-picker bar), .addform (add game), .bcoach (add assistant) each have the override', () => {
    expect(html).toMatch(/\.actionbar\[hidden\]\{display:none\}/);
    expect(html).toMatch(/\.addform\[hidden\]\{display:none\}/);
    expect(html).toMatch(/\.bcoach\[hidden\]\{display:none\}/);
  });
});

// ---------------------------------------------------------------------------
// 2. Coach-view guards
// ---------------------------------------------------------------------------
describe('Coach view: core structure the coach depends on', () => {
  it('coach home exists and the Add-assistant button starts hidden', () => {
    expect(doc.getElementById('coachhome')).toBeTruthy();
    const asst = doc.getElementById('coachAddAsst');
    expect(asst).toBeTruthy();
    expect(asst.hasAttribute('hidden')).toBe(true);
  });
  it('the drill-picker action bar (#dpkBar) starts hidden', () => {
    const bar = doc.getElementById('dpkBar');
    expect(bar).toBeTruthy();
    expect(bar.hasAttribute('hidden')).toBe(true);
  });
  it('the schedule add-game form (#schedAddForm) starts hidden', () => {
    const f = doc.getElementById('schedAddForm');
    expect(f).toBeTruthy();
    expect(f.hasAttribute('hidden')).toBe(true);
  });
  it('coach fetches are broadly guarded by a .catch (no bare un-caught fetch chains)', () => {
    const fetches = (html.match(/fetch\(/g) || []).length;
    const catches = (html.match(/\.catch\(/g) || []).length;
    expect(catches).toBeGreaterThanOrEqual(Math.floor(fetches * 0.8));
  });
});

// ---------------------------------------------------------------------------
// 3. Player-view guards
// ---------------------------------------------------------------------------
describe('Player view: core structure the kid depends on', () => {
  it('player home exists', () => {
    expect(doc.getElementById('home')).toBeTruthy();
  });
  it('no user-facing text leaks the player-code format', () => {
    expect(html).not.toMatch(/player number plus the season year/i);
    expect(html).not.toMatch(/jersey number followed by the season year/i);
  });
  it('the three drill pages exist for the kid to open', () => {
    expect(doc.getElementById('stick')).toBeTruthy();
    expect(doc.getElementById('shoot')).toBeTruthy();
    expect(doc.getElementById('dryland')).toBeTruthy();
  });
});
