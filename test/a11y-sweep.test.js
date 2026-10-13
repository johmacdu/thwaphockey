// test/a11y-sweep.test.js
//
// Accessibility sweep guards (static markup). Locks in the fixes from the a11y
// pass so they do not silently regress:
//   - every HTML document declares a language (<html lang>)
//   - the native bottom tab bar buttons (player + coach) have accessible names
//   - icon-only controls (close buttons, the card theme/image buttons) carry an
//     aria-label
//   - form inputs that have no visible <label> carry an aria-label
//   - critical brand/mascot images have a meaningful alt
//   - the multiple <nav> landmarks are distinguishable (unique accessible names)
//   - reduced-motion coverage exists for the looping cheerpop stride frames and
//     the Game Day puck-rain celebration
//
// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(resolve(__dirname, '..', f), 'utf8');
const indexSrc = read('index.html');
const goalsSrc = read('hockey_game_goals.html');
const aboutSrc = read('about.html');

// Parse static markup only (no script execution): we are checking the authored
// HTML attributes, not runtime behaviour.
function docFrom(src) {
  return new JSDOM(src).window.document;
}

// Accessible-name approximation for a control: aria-label / aria-labelledby /
// title, visible text (ignoring aria-hidden decorative children), or a non-empty
// img alt. Good enough to catch a control a screen reader would announce as blank.
function hasName(el) {
  if ((el.getAttribute('aria-label') || '').trim()) return true;
  if (el.getAttribute('aria-labelledby')) return true;
  if ((el.getAttribute('title') || '').trim()) return true;
  const clone = el.cloneNode(true);
  clone.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
  if ((clone.textContent || '').replace(/\s+/g, ' ').trim()) return true;
  for (const img of el.querySelectorAll('img')) {
    if ((img.getAttribute('alt') || '').trim() && img.getAttribute('aria-hidden') !== 'true') return true;
  }
  return false;
}

describe('a11y: document language', () => {
  it('index.html declares lang on <html>', () => {
    expect(docFrom(indexSrc).documentElement.getAttribute('lang')).toBeTruthy();
  });
  it('about.html and hockey_game_goals.html declare lang on <html>', () => {
    expect(docFrom(aboutSrc).documentElement.getAttribute('lang')).toBeTruthy();
    expect(docFrom(goalsSrc).documentElement.getAttribute('lang')).toBeTruthy();
  });
});

describe('a11y: native tab bar buttons have accessible names', () => {
  const doc = docFrom(indexSrc);
  const bar = doc.getElementById('tabbar');
  it('the tab bar exists with its nav label', () => {
    expect(bar).toBeTruthy();
    expect((bar.getAttribute('aria-label') || '').trim()).toBeTruthy();
  });
  it('every player + coach tab button announces a name (visible label text)', () => {
    const btns = [...bar.querySelectorAll('.tabbar-btn')];
    expect(btns.length).toBeGreaterThanOrEqual(10); // 5 player + 5 coach
    for (const b of btns) {
      expect(hasName(b), `tab button href=${b.getAttribute('href')}`).toBe(true);
    }
  });
});

describe('a11y: icon-only controls carry an accessible name', () => {
  const doc = docFrom(indexSrc);
  it('every close button (glassclose / pgate-x / login-x / cardclose) has a name', () => {
    const closers = [
      ...doc.querySelectorAll('.glassclose, .pgate-x, .login-x, .cardclose, .sugg-close, .policy-x, .cs-x, .pe-edel'),
    ];
    expect(closers.length).toBeGreaterThan(5);
    for (const c of closers) {
      expect(hasName(c), `closer id=${c.id} class=${c.className}`).toBe(true);
    }
  });
  it('the card theme + image buttons (text injected only when opened) still have an aria-label', () => {
    for (const id of ['cardThemeBtn', 'cardImageBtn']) {
      const el = doc.getElementById(id);
      expect(el, id).toBeTruthy();
      expect((el.getAttribute('aria-label') || '').trim(), id).toBeTruthy();
    }
  });
});

describe('a11y: form inputs without a visible label have an aria-label', () => {
  const doc = docFrom(indexSrc);
  it('labelled-or-aria for every non-hidden text/email/password/file/textarea input', () => {
    const labelFors = new Set([...doc.querySelectorAll('label[for]')].map((l) => l.getAttribute('for')));
    const fields = [...doc.querySelectorAll('input, textarea, select')].filter((el) => {
      const t = (el.getAttribute('type') || 'text').toLowerCase();
      return !['hidden', 'submit', 'button', 'reset', 'image', 'checkbox', 'radio'].includes(t);
    });
    const bad = fields.filter((el) => {
      if (el.closest('label')) return false;
      if (el.id && labelFors.has(el.id)) return false;
      if ((el.getAttribute('aria-label') || '').trim()) return false;
      if (el.getAttribute('aria-labelledby')) return false;
      if ((el.getAttribute('title') || '').trim()) return false;
      return true;
    });
    expect(bad.map((el) => `#${el.id}`)).toEqual([]);
  });

  it('the Game Day teach textarea has an aria-label', () => {
    const ta = docFrom(goalsSrc).getElementById('pgTeach');
    expect(ta).toBeTruthy();
    expect((ta.getAttribute('aria-label') || '').trim()).toBeTruthy();
  });
});

describe('a11y: critical images have meaningful alt text', () => {
  const doc = docFrom(indexSrc);
  it('no <img> is missing the alt attribute entirely', () => {
    const missing = [...doc.querySelectorAll('img')].filter((i) => !i.hasAttribute('alt'));
    expect(missing.map((i) => i.getAttribute('src'))).toEqual([]);
  });
  it('brand wordmark / logo images announce "Thwap Hockey"', () => {
    const brandImgs = [...doc.querySelectorAll('img.brandmark, img.brandlogo, img.login-wordmark')];
    expect(brandImgs.length).toBeGreaterThan(0);
    for (const img of brandImgs) {
      expect((img.getAttribute('alt') || '').toLowerCase(), img.className).toContain('thwap');
    }
  });
});

describe('a11y: multiple nav landmarks are distinguishable', () => {
  const doc = docFrom(indexSrc);
  it('every <nav> has an accessible name and the names are unique', () => {
    const navs = [...doc.querySelectorAll('nav')];
    expect(navs.length).toBeGreaterThanOrEqual(2);
    const names = navs.map((n) => (n.getAttribute('aria-label') || n.getAttribute('aria-labelledby') || '').trim());
    for (const n of names) expect(n).toBeTruthy();
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('a11y: reduced-motion coverage for looping/celebration animations', () => {
  it('index.html silences the infinitely-looping cheerpop stride frames under reduced motion', () => {
    // The .cheerpop.out stride frames animate `infinite`; the reduced-motion block
    // must stop .cheerpop-frame so Sass does not skate in place.
    const block = indexSrc.match(/@media \(prefers-reduced-motion: reduce\)\{[^@]*cheerpop-frame[^@]*\}/);
    expect(block, 'reduced-motion block covering .cheerpop-frame').toBeTruthy();
    expect(block[0]).toMatch(/\.cheerpop\s*\.cheerpop-frame\{animation:none/);
  });
  it('hockey_game_goals.html puckRain() bails out under reduced motion', () => {
    // The guard sits between `function puckRain(){` and the first `var layer=`.
    const fn = goalsSrc.match(/function puckRain\(\)\{[\s\S]*?var layer=/);
    expect(fn, 'puckRain function head').toBeTruthy();
    expect(fn[0]).toMatch(/prefers-reduced-motion: reduce/);
    expect(fn[0]).toMatch(/\breturn\b/);
  });
});
