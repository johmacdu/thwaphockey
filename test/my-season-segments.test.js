// test/my-season-segments.test.js
//
// EXECUTION test: boots index.html in jsdom and drives the My Season page's
// Journey | Stickers segmented control (switching, remembering the last segment
// per device, arrow keys, roving tabindex) and the Season Book iframe's height
// listener (same-origin only, clamped).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
const KEY = 'thwapSeasonSeg';

async function boot(saved) {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://thwaphockey.com/',
    beforeParse(window) {
      window.scrollTo = () => {};
      window.HTMLMediaElement.prototype.play = () => Promise.resolve();
      window.fetch = () => Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) });
      if (saved !== undefined) window.localStorage.setItem(KEY, saved);
    },
  });
  await new Promise((r) => setTimeout(r, 90));
  return dom.window;
}

function state(w) {
  const d = w.document;
  const j = d.getElementById('seasonTabJourney');
  const s = d.getElementById('seasonTabStickers');
  return {
    journeyShown: !d.getElementById('seasonJourney').hidden,
    stickersShown: !d.getElementById('stickerBook').hidden,
    selected: [j, s].filter((b) => b.getAttribute('aria-selected') === 'true').map((b) => b.dataset.seg),
    on: [j, s].filter((b) => b.classList.contains('on')).map((b) => b.dataset.seg),
    tabIndex: [j.tabIndex, s.tabIndex],
  };
}
const click = (w, id) => w.document.getElementById(id).dispatchEvent(new w.Event('click', { bubbles: true }));
const key = (w, k) => {
  const e = new w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
  w.document.getElementById('seasonSeg').dispatchEvent(e);
  return e;
};

describe('My Season segments', () => {
  it('a first visit opens on Journey and saves nothing', async () => {
    const w = await boot();
    expect(state(w)).toEqual({ journeyShown: true, stickersShown: false, selected: ['journey'], on: ['journey'], tabIndex: [0, -1] });
    expect(w.localStorage.getItem(KEY)).toBeNull();
  });

  it('tapping Stickers shows the card and stickers, hides the journey, and remembers it', async () => {
    const w = await boot();
    click(w, 'seasonTabStickers');
    expect(state(w)).toEqual({ journeyShown: false, stickersShown: true, selected: ['stickers'], on: ['stickers'], tabIndex: [-1, 0] });
    expect(w.localStorage.getItem(KEY)).toBe('stickers');
    click(w, 'seasonTabJourney');
    expect(state(w).journeyShown).toBe(true);
    expect(w.localStorage.getItem(KEY)).toBe('journey');
  });

  it('opens on the segment the kid used last', async () => {
    expect(state(await boot('stickers')).stickersShown).toBe(true);
    expect(state(await boot('journey')).journeyShown).toBe(true);
  });

  it('a junk saved value falls back to Journey', async () => {
    expect(state(await boot('nonsense')).journeyShown).toBe(true);
  });

  it('the player card sits in the Stickers panel with the sticker grid', async () => {
    const w = await boot();
    const sb = w.document.getElementById('stickerBook');
    expect(sb.querySelector('.stickerbook-card')).not.toBeNull();
    expect(w.document.getElementById('seasonJourney').querySelector('.stickerbook-card')).toBeNull();
  });

  it('arrow keys switch segments, move focus, and remember the choice', async () => {
    const w = await boot();
    const e = key(w, 'ArrowRight');
    expect(e.defaultPrevented).toBe(true);
    expect(state(w).stickersShown).toBe(true);
    expect(w.document.activeElement.id).toBe('seasonTabStickers');
    expect(w.localStorage.getItem(KEY)).toBe('stickers');
    key(w, 'ArrowLeft');
    expect(state(w).journeyShown).toBe(true);
    expect(w.document.activeElement.id).toBe('seasonTabJourney');
  });

  it('other keys do nothing', async () => {
    const w = await boot();
    const e = key(w, 'Enter');
    expect(e.defaultPrevented).toBe(false);
    expect(state(w).journeyShown).toBe(true);
  });

  it('the journey panel embeds the Season Book in embed mode', async () => {
    const w = await boot();
    expect(w.document.getElementById('jyFrame').getAttribute('src')).toBe('journey.html?embed=1');
  });
});

describe('Season Book iframe height', () => {
  const send = (w, data, origin = 'https://thwaphockey.com') =>
    w.dispatchEvent(new w.MessageEvent('message', { data, origin }));
  const height = (w) => w.document.getElementById('jyFrame').style.height;

  it('takes the height the book reports from our own origin', async () => {
    const w = await boot();
    send(w, { thwapJourneyHeight: 2400 });
    expect(height(w)).toBe('2400px');
  });

  it('clamps to between 200 and 8000 px', async () => {
    const w = await boot();
    send(w, { thwapJourneyHeight: 10 });
    expect(height(w)).toBe('200px');
    send(w, { thwapJourneyHeight: 99999 });
    expect(height(w)).toBe('8000px');
  });

  it('ignores other origins and malformed messages', async () => {
    const w = await boot();
    send(w, { thwapJourneyHeight: 2400 }, 'https://evil.example');
    send(w, { thwapJourneyHeight: '2400' });
    send(w, null);
    send(w, { somethingElse: 1 });
    expect(height(w)).toBe('');
  });
});
