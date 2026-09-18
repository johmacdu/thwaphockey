// test/frontend.smoke.test.js
//
// Frontend smoke test for index.html. The frontend is a single static HTML file
// with inline scripts, so this is a smoke test (parse + structural + content
// assertions) rather than deep unit tests: it catches real regressions (broken
// markup, missing key elements, banned punctuation creeping back, the streak
// banner flashing on) without a risky refactor of the inline IIFEs.
//
// @vitest-environment jsdom

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');

let doc;
beforeAll(() => {
  // Parse the markup into a real DOM. We do NOT execute the inline scripts here
  // (jsdom would need runScripts + network for fonts); parsing + querying the
  // structure is what catches markup regressions.
  doc = new DOMParser().parseFromString(html, 'text/html');
});

describe('index.html structure', () => {
  it('parses as an HTML document with a title', () => {
    expect(doc.querySelector('title')?.textContent).toContain('Thwap Hockey');
  });

  it('has balanced <section> tags (open === close === 8)', () => {
    const open = (html.match(/<section id=/g) || []).length;
    const close = (html.match(/<\/section>/g) || []).length;
    expect(open).toBe(close);
    expect(open).toBe(8);
  });

  it('#home is the last section (required for :target hash nav)', () => {
    const sections = [...doc.querySelectorAll('section[id]')];
    expect(sections[sections.length - 1].id).toBe('home');
  });

  it('has the three discipline drill sections', () => {
    for (const id of ['stick', 'shoot', 'dryland']) {
      expect(doc.getElementById(id), `#${id} exists`).toBeTruthy();
    }
  });

  it('has the leaderboard board + timeframe controls', () => {
    expect(doc.getElementById('board')).toBeTruthy();
    expect(doc.querySelectorAll('#timeframe .segbtn').length).toBeGreaterThanOrEqual(2);
  });
});

describe('inline scripts', () => {
  it('contains multiple inline <script> blocks that are non-empty', () => {
    const blocks = html.match(/<script>[\s\S]*?<\/script>/g) || [];
    expect(blocks.length).toBeGreaterThanOrEqual(10);
    expect(blocks.every((b) => b.replace(/<\/?script>/g, '').trim().length > 0)).toBe(true);
  });

  it('every inline script is syntactically valid JS', () => {
    const blocks = html.match(/<script>([\s\S]*?)<\/script>/g) || [];
    for (const b of blocks) {
      const code = b.replace(/<\/?script>/g, '');
      // Throws on a syntax error; the test fails with the offending message.
      // eslint-disable-next-line no-new, no-new-func
      expect(() => new Function(code)).not.toThrow();
    }
  });
});

describe('content rules', () => {
  it('has no em-dash, en-dash, or middle-dot in the source', () => {
    expect(html.includes('\u2014'), 'em-dash present').toBe(false);
    expect(html.includes('\u2013'), 'en-dash present').toBe(false);
    expect(html.includes('\u00b7'), 'middle-dot present').toBe(false);
  });

  it('hides the team streak banner by default (no fake streak flash)', () => {
    const banner = doc.getElementById('lbStreak');
    expect(banner).toBeTruthy();
    expect(banner.getAttribute('style') || '').toContain('display:none');
  });
});

describe('accessibility', () => {
  it('has a keyboard focus-visible ring rule', () => {
    expect(html).toMatch(/:focus-visible/);
  });

  it('gives the timeframe tabs at least a 44px tap target', () => {
    const m = html.match(/\.segbtn\{[^}]*min-height:(\d+)px/);
    expect(m, 'segbtn has a min-height').not.toBeNull();
    expect(Number(m[1])).toBeGreaterThanOrEqual(44);
  });

  it('labels the icon-only controls (kebab + theme toggle)', () => {
    expect(doc.getElementById('kebab')?.getAttribute('aria-label')).toBeTruthy();
    expect(doc.getElementById('themeToggle')?.getAttribute('aria-label')).toBeTruthy();
  });
});
