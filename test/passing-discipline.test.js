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

