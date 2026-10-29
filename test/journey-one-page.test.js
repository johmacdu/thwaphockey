// My Season (#myseason): a Journey | Stickers segmented control. The player
// card stays with the stickers, since stickers are dragged onto it. The app never opens My Player on its own.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const INDEX = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const JOURNEY = fs.readFileSync(path.join(__dirname, '..', 'journey.html'), 'utf8');
const AVATAR = fs.readFileSync(path.join(__dirname, '..', 'avatar.js'), 'utf8');

describe('My Season nav', () => {
  it('says My Season, never Stickers or Journey, and home has no separate journey card', () => {
    expect(INDEX).not.toContain("<span class='tabbar-lab'>Stickers</span>");
    expect(INDEX).not.toContain("<a href='#stickers'>Stickers</a>");
    expect(INDEX).toContain("<a href='#myseason'>My Season</a>");
    expect(INDEX).toContain("<span class='tabbar-lab'>My Season</span>");
    expect(INDEX).not.toContain("<a href='#stickers'>Journey</a>");
    expect(INDEX).not.toContain("class='nav nav-journey'");
  });
});

describe('My Season page', () => {
  const sec = INDEX.slice(INDEX.indexOf("<section id='myseason'"), INDEX.indexOf("<section id='player'"));
  it('has a Journey | Stickers segmented control like Standings', () => {
    expect(sec).toContain("<h1>My Season</h1>");
    expect(sec).toMatch(/<div class='seg' id='seasonSeg' role='tablist'/);
    expect(sec.indexOf("data-seg='journey'")).toBeLessThan(sec.indexOf("data-seg='stickers'"));
  });
  it('the journey sits in its own panel, apart from the card and stickers', () => {
    const jy = sec.indexOf("id='seasonJourney'");
    const book = sec.indexOf("id='stickerBook'");
    const card = sec.indexOf("id='cardThumb'");
    const grid = sec.indexOf("id='stickGrid'");
    expect(sec).toContain("src='journey.html?embed=1'");
    expect(jy).toBeGreaterThan(-1);
    expect(jy).toBeLessThan(book);
    // card and sticker grid live together inside the Stickers panel
    expect(book).toBeLessThan(card);
    expect(card).toBeLessThan(grid);
    expect(sec.slice(book)).not.toContain("id='jyFrame'");
  });
  it('opens on Journey the first time and remembers the last segment', () => {
    expect(sec).toContain("var KEY='thwapSeasonSeg'");
    expect(sec).toContain("pick(saved||'journey',false)");
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
    // The page close hides when embedded; the badge modal's close (in-dialog) never does.
    expect(JOURNEY).toContain('html.embed .glassclose:not(.in-dialog){display:none}');
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

describe('My Season address', () => {
  it('lives at #myseason, and an old #stickers link lands there', async () => {
    const { JSDOM } = await import('jsdom');
    expect(INDEX).toContain("<section id='myseason' class='page'>");
    expect(INDEX).toContain("href='#myseason' data-tab='myseason'");
    const head = INDEX.slice(0, INDEX.indexOf('</head>')) + '</head><body></body></html>';
    const dom = new JSDOM(head, { runScripts: 'dangerously', url: 'https://thwaphockey.com/#stickers' });
    expect(dom.window.location.hash).toBe('#myseason');
    dom.window.location.hash = '#stickers';
    dom.window.dispatchEvent(new dom.window.HashChangeEvent('hashchange'));
    expect(dom.window.location.hash).toBe('#myseason');
  });
});
