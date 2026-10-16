// test/passing-discipline.test.js
//
// EXECUTION test: boots index.html in jsdom and checks the Passing discipline is
// live -- PASS_DAYS holds the two real sessions, the #pass page renders the
// drills (name, theme, cue, steps), the nav card dropped "Coming soon", and
// finishing passing is accepted by the shared celebration (thwapCategoryDone).
//
// The weekday is forced via ?day= so a known session renders. day=4 -> Monday
// (weekday slot 0 -> PASS_DAYS[0], the first session).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');

async function boot(day) {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: `https://thwaphockey.com/?day=${day}#pass`,
    beforeParse(window) {
      window.scrollTo = () => {};
      window.HTMLMediaElement.prototype.play = () => Promise.resolve();
      window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: false }) });
    },
  });
  await new Promise((r) => setTimeout(r, 80));
  return dom.window;
}

describe('Passing discipline (live)', () => {
  it('PASS_DAYS holds two sessions of five drills each, fully formed', async () => {
    const win = await boot(4);
    const days = win.PASS_DAYS;
    expect(Array.isArray(days)).toBe(true);
    expect(days.length).toBe(2);
    const flat = days.flat();
    expect(flat.length).toBe(10);
    flat.forEach((dr) => {
      expect(typeof dr.name).toBe('string');
      expect(typeof dr.theme).toBe('string');
      expect(typeof dr.cue).toBe('string');
      expect(Array.isArray(dr.steps) && dr.steps.length).toBeTruthy();
    });
    // The coach's named drills are present.
    const names = flat.map((d) => d.name);
    expect(names).toContain('Target Net Passing');
    expect(names).toContain('Backhand Receiving');
    expect(names).toContain('Timed Accuracy Circuit');
  });

  it('renders at most 3 drills/day on the #pass page (names, theme, steps)', async () => {
    const win = await boot(4); // Monday -> session 1
    const rows = win.document.querySelectorAll('#passList .exrow');
    // Capped at 3/day, matching the same cap now applied to Dryland. The session
    // itself still holds 5 drills (see the data-integrity test above); only the
    // day's rendered checklist is capped.
    expect(rows.length).toBe(3);
    const text = win.document.getElementById('passList').textContent;
    expect(text).toContain('Target Net Passing');
    expect(text).toContain('Fundamental Accuracy'); // theme
    expect(text).toContain('follow-through at the target'); // a step
    // No stray "Coming soon" anywhere on the passing card.
    expect(win.document.querySelector('.nav-pass').textContent).not.toContain('Coming soon');
  });

  it('finishing passing is accepted by the shared celebration (pass is a real discipline)', async () => {
    const win = await boot(4);
    expect(typeof win.thwapCategoryDone).toBe('function');
    win.thwapCategoryDone('pass');
    const d = new Date();
    const dk = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    // The once-per-day guard is only set when the discipline is allowed (so this
    // proves 'pass' was NOT early-returned as an unknown discipline).
    expect(win.localStorage.getItem(`thwapCatCeleb|${dk}|pass`)).toBe('1');
  });
});


// Passing must appear as a STAT on both the team Standings board and the
// individual player stat view (radar + totals), not just as a drill page.
describe('Passing as a stat (team + individual)', () => {
  it('reveals the Passing metric tile on the Standings board (not left hidden)', async () => {
    const win = await boot(4);
    const mp = win.document.getElementById('metricPass');
    expect(mp).toBeTruthy();
    // The reveal must run AFTER PASS_DAYS is defined; the tile ends up visible.
    expect(mp.hidden).toBe(false);
    expect(mp.getAttribute('data-disc')).toBe('pass');
    expect(mp.textContent).toContain('Passing');
    // its running total is wired to the pass board column
    expect(mp.querySelector("[data-total='pass']")).toBeTruthy();
  });

  it('the Standings score + team totals include the pass column', async () => {
    const win = await boot(4);
    // scoreOf('all') and the team-total aggregation both add p.pass
    expect(win.document.documentElement.innerHTML).toMatch(/scoreOf[\s\S]{0,120}\(p\.pass\|\|0\)/);
    expect(win.document.documentElement.innerHTML).toMatch(/t\.pass\+=\(p\.pass\|\|0\)/);
  });

  it('adds Passing as a 5th radar spoke with its own color, emoji and season target', async () => {
    const win = await boot(4);
    const h = win.document.documentElement.innerHTML;
    // discs array now carries 'Passing' (geometry is driven off discs.length = N)
    expect(h).toMatch(/var discs=\['Stickhandling',thirdDisc,'Dryland','HockeyIQ','Passing'\]/);
    // supporting maps all carry a Passing entry
    expect(h).toMatch(/DKEY=\{[^}]*Passing:'pass'/);
    expect(h).toMatch(/DCOL=\{[^}]*Passing:'#2E86FF'/);
    expect(h).toMatch(/DEMO=\{[^}]*Passing:'\ud83c\udfaf'/);
    expect(h).toMatch(/SEASON_TGTMAP=\{[^}]*Passing:48/);
  });

  // REGRESSION GUARD: mapPlayers() must carry the pass column from the live
  // /api/board into each board row. It previously dropped `pass`, so a player's
  // real passing count never reached the Standings metric (tile showed 0 despite
  // the server storing the count). Boot with a live board and assert the tile
  // reflects the real number, not zero.
  it('carries pass from the live board into the Standings metric total', async () => {
    const board = { players: [
      { id: 'lewie', stick: 22, shoot: 26, dryland: 12, pass: 3, iq: 5, netplay: 0, streak: 6, stickers: 0 },
      { id: 'anton', stick: 10, shoot: 8, dryland: 4, pass: 2, iq: 1, netplay: 0, streak: 2, stickers: 0 },
    ] };
    const dom = new JSDOM(html, {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      url: 'https://thwaphockey.com/#pass',
      beforeParse(window) {
        window.scrollTo = () => {};
        window.HTMLMediaElement.prototype.play = () => Promise.resolve();
        window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(board) });
      },
    });
    // Wait past the countUp animation so the tile shows its settled value.
    await new Promise((r) => setTimeout(r, 1500));
    const win = dom.window;
    const num = win.document.querySelector("#metrics .metric[data-disc='pass'] [data-total='pass']");
    expect(num).toBeTruthy();
    // Default timeframe is "This week"; both players' week pass (3 + 2) must reach
    // the team total. The mapPlayers drop bug left this at 0.
    expect(parseInt(num.textContent, 10)).toBe(5);
  });

  // REGRESSION GUARD: a completed passing drill must re-draw as done on the drill
  // page via cross-device hydration. This needs (a) markDone to send a 'pass:N'
  // drillId, (b) a registered __thwapDrillApply.pass applier, and (c) 'pass' in the
  // listIds map. Previously pass sent no drillId and had no applier, so the server
  // returned no pass ids and the drills never showed done on another device.
  it('re-draws completed passing drills as done from the server (hydration)', async () => {
    const dom = new JSDOM(html, {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      url: 'https://thwaphockey.com/#pass',
      beforeParse(window) {
        window.scrollTo = () => {};
        window.HTMLMediaElement.prototype.play = () => Promise.resolve();
        window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, drills: ['pass:0', 'pass:1', 'pass:2'] }) });
      },
    });
    await new Promise((r) => setTimeout(r, 150));
    const win = dom.window;
    // the pass applier must be registered
    expect(typeof win.__thwapDrillApply.pass).toBe('function');
    win.thwapApplyServerDone(['pass:0', 'pass:1', 'pass:2'], false);
    await new Promise((r) => setTimeout(r, 120));
    const list = win.document.getElementById('passList');
    const rows = list.querySelectorAll('.exrow');
    const done = list.querySelectorAll('.exrow.done');
    expect(rows.length).toBeGreaterThan(0);
    // every rendered pass row re-draws as done
    expect(done.length).toBe(rows.length);
  });

  // REGRESSION GUARD: statsFetch() builds its OWN per-player board map for the
  // individual stat view (radar/rings/totals), separate from mapPlayers. It
  // previously dropped `pass`, so Passing showed 0/2 on a player's stats even
  // though Standings showed the real count. Boot with a live board carrying
  // pass:3 for Lewie, open his stat page, and assert the Passing ring reads the
  // real value, not zero.
  // GUARD: the week stat view shows an "All" ring tile (first) + exactly 3 tiles
  // per row, and the Hockey IQ detail card expands with real content (its catalog
  // was empty, so the card expanded to nothing).
  it('shows an All tile and a non-empty Hockey IQ catalog in the stat view', async () => {
    const board = { players: [
      { id: 'lewie', stick: 23, shoot: 27, dryland: 14, pass: 3, iq: 3, netplay: 0, streak: 3, stickers: 0 },
    ] };
    const dom = new JSDOM(html, {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      url: 'https://thwaphockey.com/',
      beforeParse(window) {
        window.scrollTo = () => {};
        window.HTMLMediaElement.prototype.play = () => Promise.resolve();
        window.fetch = (u) => Promise.resolve({ ok: true, json: () => Promise.resolve(
          String(u).includes('/api/done') ? { ok: true, drills: [], disciplines: {} } : board) });
        try { window.localStorage.setItem('bfPlayer', 'lewie'); } catch (e) {}
        window.document.cookie = 'thwapAuth=1';
      },
    });
    const win = dom.window;
    await new Promise((r) => setTimeout(r, 300));
    win.openPlayerPage('Lewie');
    await new Promise((r) => setTimeout(r, 1600));
    // All tile present as a ring
    expect(win.document.querySelector("#plDisc .pl-ring[data-disc='all']")).toBeTruthy();
    // 3-column grid (jsdom reports the raw declared value, not an expanded track list)
    const grid = win.getComputedStyle(win.document.querySelector('#plDisc .pl-rings')).gridTemplateColumns;
    expect(grid.replace(/\s/g, '')).toBe('repeat(3,1fr)');
    // Hockey IQ catalog is non-empty (card would otherwise expand to nothing)
    const cat = win.buildCatalog ? win.buildCatalog() : null;
    // buildCatalog is module-local; assert via the rendered IQ card body having rows instead
    const iqCard = [...win.document.querySelectorAll('#plDisc .pl-exrow')].find(
      (c) => c.querySelector('h3') && c.querySelector('h3').textContent.trim() === 'Hockey IQ');
    expect(iqCard).toBeTruthy();
    expect(iqCard.querySelectorAll('.pl-ex').length).toBeGreaterThan(0);
  });

  // GUARD: tapping a category tile must auto-EXPAND that discipline's card so the
  // player sees what was done -- not leave it collapsed. Filtering already hid the
  // others; the filtered card must render with the `open` class.
  it('auto-expands the discipline card when a tile is tapped', async () => {
    const board = { players: [
      { id: 'lewie', stick: 23, shoot: 27, dryland: 14, pass: 3, iq: 3, netplay: 0, streak: 3, stickers: 0 },
    ] };
    const dom = new JSDOM(html, {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      url: 'https://thwaphockey.com/',
      beforeParse(window) {
        window.scrollTo = () => {};
        window.HTMLMediaElement.prototype.play = () => Promise.resolve();
        window.fetch = (u) => Promise.resolve({ ok: true, json: () => Promise.resolve(
          String(u).includes('/api/done') ? { ok: true, drills: [], disciplines: {} } : board) });
        try { window.localStorage.setItem('bfPlayer', 'lewie'); } catch (e) {}
        window.document.cookie = 'thwapAuth=1';
      },
    });
    const win = dom.window;
    await new Promise((r) => setTimeout(r, 300));
    win.openPlayerPage('Lewie');
    await new Promise((r) => setTimeout(r, 1600));
    // tap the Hands (Stickhandling) ring tile
    win.document.querySelector("#plDisc .pl-ring[data-disc='Stickhandling']").click();
    await new Promise((r) => setTimeout(r, 1500));
    const cards = [...win.document.querySelectorAll('#plDisc .pl-exrow')];
    // only the Hands card is shown...
    expect(cards.length).toBe(1);
    expect(cards[0].querySelector('h3').textContent.trim()).toBe('Hands');
    // ...and it is already expanded (open), with its drill rows visible
    expect(cards[0].classList.contains('open')).toBe(true);
    expect(cards[0].querySelectorAll('.pl-ex').length).toBeGreaterThan(0);
  });

  it('carries pass from the live board into the player stat view (not 0)', async () => {
    const board = { players: [
      { id: 'lewie', stick: 23, shoot: 27, dryland: 14, pass: 3, iq: 6, netplay: 0, streak: 3, stickers: 0 },
    ] };
    const dom = new JSDOM(html, {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      url: 'https://thwaphockey.com/',
      beforeParse(window) {
        window.scrollTo = () => {};
        window.HTMLMediaElement.prototype.play = () => Promise.resolve();
        window.fetch = (u) => Promise.resolve({ ok: true, json: () => Promise.resolve(
          String(u).includes('/api/done') ? { ok: true, drills: [], disciplines: {} } : board) });
        try { window.localStorage.setItem('bfPlayer', 'lewie'); } catch (e) {}
        window.document.cookie = 'thwapAuth=1';
      },
    });
    const win = dom.window;
    await new Promise((r) => setTimeout(r, 300));
    win.openPlayerPage('Lewie');
    await new Promise((r) => setTimeout(r, 1600));
    const ring = win.document.querySelector("#plDisc .pl-ring[data-disc='Passing'] .pl-ring-n");
    expect(ring).toBeTruthy();
    expect(ring.textContent.replace(/\s/g, '')).toBe('2/2');  // displayed count caps at the weekly goal
  });


  // GUARD: for the SELF view in WEEK mode, the detail checks the drills ACTUALLY
  // done (from GET /api/done?week=1 name-slug ids), not the first-N by position.
  // '20-Minute Run' sits deep in the dryland catalog (not in the first few), so a
  // position-based check would never mark it; the slug-set check must.
  it('week detail checks the real drills done (self view), not first-N by position', async () => {
    const board = { players: [
      { id: 'lewie', stick: 0, shoot: 0, dryland: 2, pass: 0, iq: 0, netplay: 0, streak: 0, stickers: 0 },
    ] };
    const dom = new JSDOM(html, {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      url: 'https://thwaphockey.com/',
      beforeParse(window) {
        window.scrollTo = () => {};
        window.HTMLMediaElement.prototype.play = () => Promise.resolve();
        window.fetch = (u) => {
          const url = String(u);
          if (url.includes('/api/done') && url.includes('week=1')) {
            // real week set: only the specific slug for 20-Minute Run
            return Promise.resolve({ ok: true, json: () => Promise.resolve(
              { ok: true, week: { start: '2026-10-12', end: '2026-10-16' }, drills: ['dryland#20-minute-run'], disciplines: { dryland: true } }) });
          }
          if (url.includes('/api/done')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, drills: [], disciplines: {} }) });
          return Promise.resolve({ ok: true, json: () => Promise.resolve(board) });
        };
        try { window.localStorage.setItem('bfPlayer', 'lewie'); } catch (e) {}
        window.document.cookie = 'thwapAuth=1';
      },
    });
    const win = dom.window;
    await new Promise((r) => setTimeout(r, 300));
    win.openPlayerPage('Lewie');
    // allow the self-week fetch + its re-render
    await new Promise((r) => setTimeout(r, 2200));
    // open the Dryland card
    win.document.querySelector("#plDisc .pl-ring[data-disc='Dryland']").click();
    await new Promise((r) => setTimeout(r, 1400));
    const dryCard = [...win.document.querySelectorAll('#plDisc .pl-exrow')].find(
      (c) => c.querySelector('h3') && c.querySelector('h3').textContent.trim() === 'Dryland');
    expect(dryCard).toBeTruthy();
    const rows = [...dryCard.querySelectorAll('.pl-ex')];
    const runRow = rows.find((r) => /20-Minute Run/i.test(r.textContent));
    expect(runRow).toBeTruthy();
    // the specific drill done is CHECKED...
    expect(runRow.classList.contains('done')).toBe(true);
    // ...and exactly one row is checked (the slug set has one entry), proving it is
    // not the position-based first-N check (which would check the first 2 rows).
    const checked = rows.filter((r) => r.classList.contains('done'));
    expect(checked.length).toBe(1);
  });

  it('renders a Passing spoke/total in the player stat view', async () => {
    const win = await boot(4);
    // open a known player's stat page and let build() run
    expect(typeof win.openPlayerPage).toBe('function');
    win.openPlayerPage('Lewie');
    await new Promise((r) => setTimeout(r, 60));
    const disc = win.document.getElementById('plDisc');
    expect(disc).toBeTruthy();
    // all-time view carries a totals tile per discipline; Passing must be one
    const tots = disc.querySelectorAll(".pl-tot[data-disc='Passing'], .pl-ring[data-disc='Passing']");
    expect(tots.length).toBeGreaterThan(0);
  });
});

