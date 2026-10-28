// The blocky character prototype (avatar.js) stays hidden unless the device
// opts in with ?avatar=1, and buildFront only swaps the photo slot when it is on.
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';

const SRC = fs.readFileSync(path.join(__dirname, '..', 'avatar.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function load(url) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url, runScripts: 'outside-only' });
  dom.window.eval(SRC);
  return dom.window;
}

describe('avatar preview flag', () => {
  it('is off by default', () => {
    const w = load('https://thwaphockey.com/');
    expect(w.thwapAvatar.on()).toBe(false);
  });
  it('turns on with ?avatar=1 and off with ?avatar=0', () => {
    const w = load('https://thwaphockey.com/?avatar=1');
    expect(w.thwapAvatar.on()).toBe(true);
    w.history.replaceState(null, '', '/?avatar=0');
    w.eval(SRC);
    expect(w.thwapAvatar.on()).toBe(false);
  });
});

describe('avatar html', () => {
  it('renders the number escaped and falls back to the default look', () => {
    const w = load('https://thwaphockey.com/');
    const h = w.thwapAvatar.html({ jersey: 'nope', skin: 'nope', num: '<b>72' });
    expect(h).toContain('av-wrap');
    expect(h).toContain('&#60;b&#62;72');
    expect(h).not.toContain('<b>72');
  });
  it('lookFor keeps the player number even if a saved look has one', () => {
    const w = load('https://thwaphockey.com/');
    w.localStorage.setItem('thwapLooks', JSON.stringify({ lewie: { jersey: 'black', num: '99' } }));
    const look = w.thwapAvatar.lookFor({ num: '72' }, 'Lewie');
    expect(look.jersey).toBe('black');
    expect(look.num).toBe('72');
  });
});

describe('buildFront wiring', () => {
  it('loads avatar.js and only swaps the photo when the flag is on', () => {
    expect(INDEX).toContain("<script src='avatar.js'></script>");
    expect(INDEX).toMatch(/var photo = avOn\s*\n\s*\? window\.thwapAvatar\.html/);
  });
});

describe('buildFront in the real page', () => {
  async function page(flag) {
    const html = INDEX.replace("<script src='avatar.js'></script>", '<script>' + SRC + '</script>');
    const dom = new JSDOM(html, {
      url: 'https://thwaphockey.com/' + (flag ? '?avatar=1' : ''),
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      beforeParse(window) {
        window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: false }) });
        window.scrollTo = () => {};
      },
    });
    await new Promise((r) => setTimeout(r, 50));
    return dom.window;
  }
  it('shows the photo when the flag is off', async () => {
    const w = await page(false);
    const out = w.buildFront({ first: 'Lewie', num: '72', pos: 'FD' }, 'lewie', null);
    expect(out).toContain('cf2-photo');
    expect(out).not.toContain('av-wrap');
  });
  it('shows the character (with the roster number) when the flag is on', async () => {
    const w = await page(true);
    const out = w.buildFront({ first: 'Lewie', num: '72', pos: 'FD' }, 'lewie', 'cards/x.png');
    expect(out).toContain('av-wrap');
    expect(out).not.toContain('cf2-photo');
    expect(out).toContain('>72<');
  });
});

describe('texture urls', () => {
  it('never put a quoted url inside the single-quoted style attribute', () => {
    const w = load('https://thwaphockey.com/');
    for (const jersey of ['red', 'black', 'white', 'forest']) {
      const h = w.thwapAvatar.html({ jersey, num: '9' });
      expect(h).not.toMatch(/url\('/);
      const doc = new JSDOM('<div>' + h + '</div>').window.document;
      // Every face keeps its full style (a broken quote would cut it short).
      for (const f of doc.querySelectorAll('.av-f')) expect(f.getAttribute('style')).toMatch(/background-size:100% 100%/);
    }
  });
});
