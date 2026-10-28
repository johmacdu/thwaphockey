// Journey is one page (#stickers): the player card on top, the season journey,
// then the Sticker Book. The app never opens My Player on its own.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const INDEX = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const JOURNEY = fs.readFileSync(path.join(__dirname, '..', 'journey.html'), 'utf8');
const AVATAR = fs.readFileSync(path.join(__dirname, '..', 'avatar.js'), 'utf8');

describe('Journey nav', () => {
  it('says Journey, never Stickers, and home has no separate journey card', () => {
    expect(INDEX).not.toMatch(/>Stickers</);
    expect(INDEX).toContain("<a href='#stickers'>Journey</a>");
    expect(INDEX).not.toContain("class='nav nav-journey'");
  });
});

describe('Journey page order', () => {
  it('player card, then the season journey, then the Sticker Book', () => {
    const sec = INDEX.slice(INDEX.indexOf("<section id='stickers'"), INDEX.indexOf("<section id='player'"));
    const card = sec.indexOf("id='cardThumb'");
    const jy = sec.indexOf("id='jyFrame'");
    const book = sec.indexOf('Sticker Book');
    const grid = sec.indexOf("id='stickGrid'");
    expect(card).toBeGreaterThan(-1);
    expect(card).toBeLessThan(jy);
    expect(jy).toBeLessThan(book);
    expect(book).toBeLessThan(grid);
    expect(sec).toContain("src='journey.html?embed=1'");
  });
  it('only accepts height messages from its own origin', () => {
    expect(INDEX).toContain('e.origin!==location.origin');
  });
});

describe('journey.html', () => {
  it('has no developer preview note', () => {
    expect(JOURNEY).not.toContain('Gray boxes are art slots');
  });
  it('embed mode hides its close button', () => {
    expect(JOURNEY).toContain('html.embed .glassclose{display:none}');
  });
});

describe('landing', () => {
  it('never opens My Player or the builder on load', () => {
    expect(AVATAR).not.toContain('thwapBuilderOffered');
    expect(AVATAR).not.toMatch(/openLocker\(\{builder:true\}\)/);
  });
});

describe('Team page player screen', () => {
  it('shows the character, not a photo', () => {
    expect(INDEX).toContain("<div class='pl-av' id='plAv' hidden></div>");
    expect(INDEX).toMatch(/plAv\.innerHTML=lk\?window\.thwapAvatar\.html\(lk\):''/);
  });
});
