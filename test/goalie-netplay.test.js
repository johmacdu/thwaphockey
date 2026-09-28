// test/goalie-netplay.test.js
//
// Source + execution guards for the goalie "Net play" third discipline.
// The goalie (Johnny) trains Net play instead of Shooting on the same #shoot
// page: the drill source, hero title, and nav label swap when the signed-in
// player is a goalie. Storage stays the `shoot`/`netplay` slots (see store.js).

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');

describe('goalie Net play wiring (source guards)', () => {
  it('inlines the NETPLAY_DAYS goalie drill rotation', () => {
    expect(html).toMatch(/window\.NETPLAY_DAYS=\[/);
    // real goalie fundamentals are present
    expect(html).toMatch(/Ready Stance/);
    expect(html).toMatch(/Butterfly|butterfly/);
    expect(html).toMatch(/T-Push|Glove Saves|Rebound/);
  });

  it('exposes a goalie check keyed to the signed-in player', () => {
    expect(html).toMatch(/window\.thwapIsGoalie *= *function/);
    expect(html).toMatch(/THWAP_GOALIE_NAMES/);
  });

  it('render picks NETPLAY_DAYS for a goalie, SHOOT_DAYS otherwise', () => {
    expect(html).toMatch(/function thirdDays\(\)\{ *return *\(window\.thwapIsGoalie\(\) *&& *Array\.isArray\(window\.NETPLAY_DAYS\)\) *\? *window\.NETPLAY_DAYS *: *SHOOT_DAYS/);
  });

  it('relabels the page to Net play for a goalie (hero, nav, blurb)', () => {
    expect(html).toMatch(/n\.nodeValue=' Net play'/);
    expect(html).toMatch(/navH\.textContent='Net play'/);
  });

  it('exposes a position-aware label triad helper (radar/tiles/card back)', () => {
    expect(html).toMatch(/window\.thwapDiscsFor *= *function/);
    // goalie third slot is netplay + "Net play"; skater is shoot + "Shoot"
    expect(html).toMatch(/\['netplay', want==='emoji'\?'🥅 Net play':'Net play'\]/);
  });

  it('the card back shows Net play for a goalie, pulling the netplay count', () => {
    expect(html).toMatch(/cb2Stat\(slug, isG\?'netplay':'shoot'\)/);
    expect(html).toMatch(/var thirdLabel=isG\?'Net play':'Shooting'/);
    expect(html).toMatch(/tile\('shoot',false,shoot,thirdLabel\)/);
  });

  it('the player radar third spoke is Net play for a goalie, wired to netplay data', () => {
    expect(html).toMatch(/var thirdDisc=goalieView\?'Net play':'Shooting'/);
    expect(html).toMatch(/var discs=\['Stickhandling',thirdDisc,'Dryland'\]/);
    // display name resolves to the netplay storage key + a catalog for the ring goal
    expect(html).toMatch(/'Net play':'netplay'/);
    expect(html).toMatch(/'Net play': uNet\.length\?uNet:\[\]/);
  });
});

describe('goalie Net play renders (execution)', () => {
  let win;
  beforeAll(async () => {
    const dom = new JSDOM(html, {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      url: 'https://thwaphockey.com/',
      beforeParse(window) {
        window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: false }) });
        window.scrollTo = () => {};
      },
    });
    win = dom.window;
    await new Promise((r) => setTimeout(r, 120));
  });

  it('NETPLAY_DAYS is loaded with 5 rotation days', () => {
    expect(Array.isArray(win.NETPLAY_DAYS)).toBe(true);
    expect(win.NETPLAY_DAYS.length).toBe(5);
  });

  it('thwapIsGoalie reflects the signed-in player (Johnny=goalie, Lewie=skater)', () => {
    expect(typeof win.thwapIsGoalie).toBe('function');
    win.localStorage.setItem('bfPlayer', 'Johnny');
    expect(win.thwapIsGoalie()).toBe(true);
    win.localStorage.setItem('bfPlayer', 'Lewie');
    expect(win.thwapIsGoalie()).toBe(false);
  });
});
