// Phase 4: coach home shows the roster's characters. Coach home is capped at
// three blocks (docs/jtbd.md), so the characters go INSIDE the participation
// block: each "Top this week" row shows the kid's own character (starter looks
// included) in a small circle before the name, without changing the row grid.
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';

const INDEX = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'avatar.js'), 'utf8');

describe('coach home Top this week rows', () => {
  it('draws each kid\'s character inside the name cell', () => {
    expect(INDEX).toMatch(/av\.className='ch-av'/);
    expect(INDEX).toMatch(/window\.thwapAvatar\.html\(window\.thwapAvatar\.lookFor\(\{num:''\}, x\.m\.playerId\|\|x\.m\.firstName\|\|''\)\)/);
    expect(INDEX).toMatch(/nm\.classList\.add\('ch-avname'\); nm\.appendChild\(av\); nm\.appendChild\(label\);/);
    // Without the avatar module it falls back to the plain name.
    expect(INDEX).toMatch(/\} else nm\.textContent=nameOf\(x\.m\);/);
  });

  it('is a small circle crop, and adds no new coach home block', () => {
    expect(INDEX).toMatch(/\.ch-av\{position:relative;flex:0 0 auto;width:32px;height:32px;border-radius:50%;overflow:hidden;/);
    const blocks = INDEX.match(/class='ch-block'/g) || [];
    expect(blocks.length).toBe(2);
  });

  it('a kid who never built a player still gets their own starter character, not a blank', () => {
    const w = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://thwaphockey.com/', runScripts: 'outside-only' }).window;
    w.fetch = () => Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
    w.eval(SRC);
    const a = w.thwapAvatar.html(w.thwapAvatar.lookFor({ num: '' }, 'alder'));
    const b = w.thwapAvatar.html(w.thwapAvatar.lookFor({ num: '' }, 'joziah'));
    expect(a).toContain('av-wrap');
    expect(a).not.toBe(b);
  });
});
