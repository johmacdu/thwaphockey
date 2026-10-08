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

  it('render picks NETPLAY_DAYS for a goalie only when Net play is live, else SHOOT_DAYS', () => {
    expect(html).toMatch(/function thirdDays\(\)\{ return \(window\.thwapIsGoalie\(\) && netplayLive\(\)\) \? window\.NETPLAY_DAYS : SHOOT_DAYS; \}/);
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
    expect(html).toMatch(/var discs=\['Stickhandling',thirdDisc,'Dryland','HockeyIQ'\]/);
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

describe('goalie Net play server slot + board plumbing (regression: fairness rule)', () => {
  // Regression for the launch bug where a goalie's Net play completions were
  // posted to the `shoot` slot while the card-back/radar read from `netplay`,
  // so the goalie's Net play tile was permanently 0 and his work was recorded
  // as Shooting. The done-handler must post `netplay` for a goalie, and the
  // board plumbing (mapPlayers/stashBoard) must carry `netplay` through.
  it('the shoot-page done-handler posts netplay for a goalie, shoot otherwise', () => {
    expect(html).toMatch(/window\.thwapMarkDone\(goalie\?'netplay':'shoot','shoot:'\+i\)/);
  });

  it('mapPlayers carries netplay through to the board', () => {
    expect(html).toMatch(/mapPlayers[\s\S]{0,200}?netplay:p\.netplay\|\|0/);
  });

  it('stashBoard carries netplay into window.thwapBoard', () => {
    expect(html).toMatch(/stashBoard[\s\S]{0,300}?netplay:p\.netplay\|\|0/);
  });

  it('the card back reads the goalie third-discipline count from the netplay slot', () => {
    expect(html).toMatch(/cb2Stat\(slug, *isG\?'netplay':'shoot'\)/);
  });
});

describe('Standings: Net play folds while gated, becomes its own tile when enabled (P1)', () => {
  const fs2 = require('node:fs');
  const path2 = require('node:path');
  const src = fs2.readFileSync(path2.resolve(__dirname, '../index.html'), 'utf8');

  it('thirdOf folds netplay into shoot ONLY while Net play is gated', () => {
    // flag-aware: enabled -> shoot alone (netplay is its own tile); gated -> shoot+netplay
    expect(src).toMatch(/function thirdOf\(p\)\{ return netEnabled\(\) \? \(p\.shoot\|\|0\) : \(p\.shoot\|\|0\)\+\(p\.netplay\|\|0\); \}/);
  });

  it('scoreOf all-total counts every discipline (stick+shoot+netplay+dryland+pass)', () => {
    expect(src).toMatch(/\(p\.stick\|\|0\)\+\(p\.shoot\|\|0\)\+\(p\.netplay\|\|0\)\+\(p\.dryland\|\|0\)\+\(p\.pass\|\|0\)/);
  });

  it('the team all-total includes netplay only when Net play is enabled', () => {
    expect(src).toMatch(/t\.all=t\.stick\+\(t\.shoot\)\+t\.dryland\+t\.pass\+\(netEnabled\(\)\?t\.netplay:0\)/);
  });

  it('a Net play metric tile EXISTS but ships hidden (revealed only when enabled)', () => {
    // you decided Net play is its own tile on the team page; it must not show all-zeros before launch
    expect(src).toMatch(/data-disc='netplay' id='metricNetplay' hidden/);
    expect(src).toMatch(/\.metric\[hidden\]\{display:none\}/);
    expect(src).toMatch(/if\(mn && window\.NETPLAY_ENABLED\) mn\.hidden=false/);
  });

  it('a Passing metric tile EXISTS but ships hidden (revealed when PASS_DAYS has content)', () => {
    expect(src).toMatch(/data-disc='pass' id='metricPass' hidden/);
    expect(src).toMatch(/if\(mp && Array\.isArray\(window\.PASS_DAYS\) && window\.PASS_DAYS\.length\) mp\.hidden=false/);
  });

  it('the metric grid is auto-fit (balanced rows, no orphan tiles at 5 or 6)', () => {
    expect(src).toMatch(/\.metrics\{display:grid;grid-template-columns:repeat\(auto-fit,minmax\(96px,1fr\)\)/);
  });

  it('Net play uses a distinct glove emoji, not the net emoji Shoot uses', () => {
    expect(src).toMatch(/🧤 Net play/);   // glove, distinct from 🥅 Shoot
  });

  it('Passing coming-soon copy names Net play for a goalie', () => {
    expect(src).toMatch(/thwapIsGoalie\(\)\)\?'Net play':'Shooting'/);
  });
});

describe('Net play drills are gated coming-soon until real content lands (no invented content)', () => {
  const fsG = require('node:fs');
  const pathG = require('node:path');
  const src = fsG.readFileSync(pathG.resolve(__dirname, '../index.html'), 'utf8');

  it('NETPLAY_ENABLED ships false', () => {
    expect(src).toMatch(/var NETPLAY_ENABLED=window\.NETPLAY_ENABLED=false/);
  });

  it('netplayLive() requires the flag AND real days', () => {
    expect(src).toMatch(/function netplayLive\(\)\{ return window\.NETPLAY_ENABLED && Array\.isArray\(window\.NETPLAY_DAYS\) && window\.NETPLAY_DAYS\.length; \}/);
  });

  it('a goalie with Net play gated sees the coming-soon state, no markable drills', () => {
    expect(src).toMatch(/if\(goalie && !netplayLive\(\)\)\{/);
    expect(src).toMatch(/Net play drills are coming/);
  });
});

describe('all three thwapBoard writers carry netplay (stats page count survives)', () => {
  const fs3 = require('node:fs');
  const path3 = require('node:path');
  const s = fs3.readFileSync(path3.resolve(__dirname, '../index.html'), 'utf8');
  it('every thwapBoard row builder includes netplay:p.netplay||0', () => {
    // stashBoard, and statsFetch both build a row object into thwapBoard[which]
    const rowBuilders = s.match(/\{stick:p\.stick\|\|0[^}]*streak:p\.streak\|\|0\}/g) || [];
    expect(rowBuilders.length).toBeGreaterThanOrEqual(2);
    rowBuilders.forEach(function(rb){ expect(rb).toMatch(/netplay:p\.netplay\|\|0/); });
  });
});
