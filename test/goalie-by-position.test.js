// test/goalie-by-position.test.js
//
// Bug (Oct 29 2026): teammate cards decided "goalie" by NAME (a hardcoded
// ['johnny'] list) while the player's own page used the roster position. A
// goalie named anything else got Shooting on their card back, and any player
// named Johnny on another team got Net play. Fix: every surface asks
// window.thwapIsGoalieFor(slug, pos), which reads the roster position (Johnny is
// pos:'G' in THWAP_ROSTER), never a list of names.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');

async function boot(player = 'Lewie') {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://thwaphockey.com/?d=10282026',
    beforeParse(window) {
      window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: false }) });
      window.scrollTo = () => {};
      window.localStorage.setItem('bfPlayer', player);
    },
  });
  await new Promise((r) => setTimeout(r, 50));
  return dom.window;
}

const third = (win, slug, pos) => win.thwapDiscsFor(slug, 'plain', pos)[1][0];

describe('teammate goalie status comes from roster position', () => {
  it('Johnny stays a goalie through his roster data (pos G)', async () => {
    const win = await boot();
    expect(win.THWAP_ROSTER.johnny.pos).toBe('G');
    expect(win.buildBack({ first: 'JOHNNY', pos: 'G' }, 'johnny')).toContain('Net play');
    expect(third(win, 'johnny')).toBe('netplay');
  });

  it('a goalie with a different name gets Net play on the card back', async () => {
    const win = await boot();
    expect(win.buildBack({ first: 'GUS', pos: 'G' }, 'gus')).toContain('Net play');
    expect(third(win, 'gus', 'G')).toBe('netplay');
  });

  it('a skater who happens to be named Johnny gets Shooting', async () => {
    const win = await boot();
    const back = win.buildBack({ first: 'JOHNNY', pos: 'F' }, 'johnny');
    expect(back).toContain('Shooting');
    expect(back).not.toContain('Net play');
    expect(third(win, 'johnny', 'F')).toBe('shoot');
  });

  it('a roster entry with pos G is a goalie with no position passed', async () => {
    const win = await boot();
    win.THWAP_ROSTER.zed = { num: '30', pos: 'G' };
    expect(third(win, 'zed')).toBe('netplay');
  });

  it('the signed-in player without a server answer uses roster position, not a name', async () => {
    const win = await boot('Zed');
    win.THWAP_ROSTER.zed = { num: '30', pos: 'G' };
    expect(win.thwapIsGoalie()).toBe(true);
  });

  it('no name-based goalie list is left in index.html', () => {
    expect(html).not.toMatch(/THWAP_GOALIE_NAMES/);
    expect(html).not.toMatch(/indexOf\([^)]*\)>=0[^;]*goalie|goalie[^;]*\['johnny'\]\.indexOf/i);
  });
});
