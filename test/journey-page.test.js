// test/journey-page.test.js
//
// EXECUTION test: boots journey.html (the Season Book) in jsdom and checks what
// the page does with the journey API answer: cover, tier path, pips, months,
// badges and their tap note, the finale's season gating, sample tags, and the
// art slots. The API, the clock and image loading are all faked.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { journeyFor, badgesFor } from '../lib/journey.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../journey.html'), 'utf8');

// A real API answer, built with the same functions the server uses.
function book({ days = [], events = [], cheersSent = 0, goalie = false, today = '2026-10-28', player } = {}) {
  return {
    id: 'lewie',
    player: player === undefined ? { name: 'Lewie M.', number: 81, position: 'forward', team: 'Jr. Rangers 10U' } : player,
    ...journeyFor(days, today),
    ...badgesFor({ events, days, cheersSent, goalie }, today),
  };
}
const range = (from, n) => Array.from({ length: n }, (_, i) => {
  const d = new Date(`${from}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + i); return d.toISOString().slice(0, 10);
});
const ev = (date, disc, n) => Array.from({ length: n }, () => ({ date, disc }));

// api: an object (200 JSON), a number (that status), or 'throw' (network error).
// missingArt: art file names whose image load fails.
async function boot({ api = 401, now = '2026-10-28T19:00:00Z', query = '', missingArt = [] } = {}) {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: `https://thwaphockey.com/journey.html${query}`,
    beforeParse(window) {
      window.scrollTo = () => {};
      const RealDate = window.Date;
      const fixed = new RealDate(now).getTime();
      class FakeDate extends RealDate {
        constructor(...a) { super(...(a.length ? a : [fixed])); }
        static now() { return fixed; }
      }
      window.Date = FakeDate;
      // A real <img> element whose load succeeds or fails on our say-so.
      window.Image = function FakeImage() {
        const img = window.document.createElement('img');
        let src = '';
        Object.defineProperty(img, 'src', {
          get: () => src,
          set: (v) => {
            src = v;
            const bad = missingArt.some((f) => v.endsWith(f));
            setTimeout(() => (bad ? img.onerror && img.onerror() : img.onload && img.onload()), 0);
          },
        });
        return img;
      };
      window.fetch = (u) => {
        if (String(u).indexOf('/api/board?action=journey') < 0) return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
        if (api === 'throw') return Promise.reject(new Error('offline'));
        if (typeof api === 'number') return Promise.resolve({ ok: false, status: api, json: () => Promise.resolve({}) });
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(api) });
      };
    },
  });
  await new Promise((r) => setTimeout(r, 40));
  return dom.window;
}
const $ = (w, id) => w.document.getElementById(id);
const visibleSamples = (w) => Array.from(w.document.querySelectorAll('[data-sample]')).filter((e) => !e.hidden).length;
const badgeBtns = (w) => Array.from(w.document.querySelectorAll('#jBadges .badge'));
const tap = (w, el) => el.dispatchEvent(new w.Event('click', { bubbles: true }));

describe('signed out', () => {
  it('keeps the sample book with its Sample tags showing', async () => {
    const w = await boot({ api: 401 });
    expect(visibleSamples(w)).toBeGreaterThan(0);
    expect($(w, 'jName').textContent).toBe('Lewie M.');
    expect(badgeBtns(w).map((b) => b.querySelector('b').textContent)).toEqual(
      ['Dangler', 'Sniper', 'Engine', 'Tape to Tape', 'Hockey Brain', 'On a Heater', 'Full Week', 'Hype Squad']);
  });

  it('a network error also leaves the sample in place', async () => {
    const w = await boot({ api: 'throw' });
    expect(visibleSamples(w)).toBeGreaterThan(0);
  });

  it('an answer without months is ignored, not half-rendered', async () => {
    const w = await boot({ api: { season: { label: '2026-27' } } });
    expect(visibleSamples(w)).toBeGreaterThan(0);
  });

  it('tapping a badge asks the kid to sign in', async () => {
    const w = await boot({ api: 401 });
    tap(w, badgeBtns(w)[0]);
    expect($(w, 'jBadgeNote').textContent).toBe('Dangler: sign in to see your count.');
  });
});

describe('signed in: cover', () => {
  it('shows the player name, number, position and team', async () => {
    const w = await boot({ api: book() });
    expect($(w, 'jSeason').textContent).toBe('2026-27 Jr. Rangers 10U');
    expect(w.document.querySelector('.cover h1, h1').textContent).toBe('My Journey');
    expect($(w, 'jName').textContent).toBe('Lewie M.');
    expect($(w, 'jNum').textContent).toBe('#81');
    expect($(w, 'jNum').hidden).toBe(false);
    expect($(w, 'jMeta').textContent).toBe('Forward'); // team moved up to the season line
  });

  it('hides the number and meta line when the roster has neither', async () => {
    const w = await boot({ api: book({ player: { name: 'Alder', number: null, position: null, team: null } }) });
    expect($(w, 'jName').textContent).toBe('Alder');
    expect($(w, 'jNum').hidden).toBe(true);
    expect($(w, 'jMeta').hidden).toBe(true);
    expect($(w, 'jSeason').textContent).toBe('2026-27 Season'); // no team on file
  });

  it('hides every Sample tag once real data loads', async () => {
    const w = await boot({ api: book() });
    expect(visibleSamples(w)).toBe(0);
  });
});

describe('signed in: tier path', () => {
  it('page 1 is headed Where I Am, under a plain Page 1 eyebrow', async () => {
    const w = await boot({ api: 401 });
    expect($(w, 'h-journey').textContent).toBe('Where I Am');
    expect($(w, 'h-journey').previousElementSibling.textContent.trim()).toBe('Page 1');
  });

  it('a new player is on step 1 of Locker Room, 3 days from the next step', async () => {
    const w = await boot({ api: book() });
    expect($(w, 'jTier').textContent).toBe('Locker Room');
    expect($(w, 'jStep').textContent).toBe('Step 1 of 3');
    expect($(w, 'jNext').textContent).toBe('3 more training days to the next step');
    const notes = Array.from($(w, 'jTiers').children).map((t) => t.lastChild.textContent);
    expect(notes).toEqual(['You are here', 'Next stop', 'Later', 'Later']);
  });

  it('marks tiers, pips and the progress bar for a player mid-season', async () => {
    // 20 days -> 3 steps done (thresholds 3, 11, 19): Practice Ice, step 1.
    const w = await boot({ api: book({ days: range('2026-09-01', 20) }) });
    expect($(w, 'jTier').textContent).toBe('Practice Ice');
    expect($(w, 'jStep').textContent).toBe('Step 1 of 3');
    expect($(w, 'jNext').textContent).toBe('7 more training days to the next step');
    const tiers = Array.from($(w, 'jTiers').children);
    expect(tiers.map((t) => t.className)).toEqual(['on', 'on', 'off', 'off']);
    expect(tiers.map((t) => t.lastChild.textContent)).toEqual(['Done', 'You are here', 'Next stop', 'Later']);
    const pips = Array.from($(w, 'jPips').children).map((p) => p.className);
    expect(pips.slice(0, 4)).toEqual(['on', 'on', 'on', 'now']);
    expect(pips.slice(4).every((c) => c === '')).toBe(true);
    expect($(w, 'jPips').getAttribute('aria-valuenow')).toBe('3');
    expect($(w, 'jPips').getAttribute('aria-label')).toBe('Step 3 of 12 this season');
    expect($(w, 'jRink').style.getPropertyValue('--x')).toBe('34%');
  });

  it('says "1 more training day" in the singular', async () => {
    const w = await boot({ api: book({ days: range('2026-09-01', 2) }) });
    expect($(w, 'jNext').textContent).toBe('1 more training day to the next step');
  });

  it('a finished book says so and marks every tier done', async () => {
    // 95 days by Jan 10 passes the last threshold (91).
    const w = await boot({ api: book({ days: range('2026-09-01', 95), today: '2027-01-10' }), now: '2027-01-10T19:00:00Z' });
    expect($(w, 'jTier').textContent).toBe('Legend');
    expect($(w, 'jStep').textContent).toBe('Top of the book');
    expect($(w, 'jNext').textContent).toBe('You finished the whole book. Legend.');
    expect(Array.from($(w, 'jTiers').children).map((t) => t.lastChild.textContent)).toEqual(['Done', 'Done', 'Done', 'Done']);
  });
});

describe('signed in: My Season So Far', () => {
  it('lists each month with its training days, then a Next row', async () => {
    const w = await boot({ api: book({ days: [...range('2026-09-01', 11), '2026-10-01'] }) });
    const rows = Array.from($(w, 'jMonths').children).map((li) => [li.querySelector('b').textContent, li.querySelector('p').textContent]);
    expect(rows).toEqual([['Sep', '11 training days.'], ['Oct', '1 training day.'], ['Next', 'Your next page.']]);
    expect($(w, 'jMonths').lastElementChild.className).toBe('future');
  });

  it('drops the Next row once the season is over', async () => {
    const w = await boot({ api: book({ days: ['2026-09-01'], today: '2027-04-15' }), now: '2027-04-15T19:00:00Z' });
    const months = Array.from($(w, 'jMonths').children).map((li) => li.querySelector('b').textContent);
    expect(months).toEqual(['Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar']);
  });
});

describe('signed in: badges', () => {
  const events = [...ev('2026-10-01', 'stick', 34), ...ev('2026-10-02', 'iq', 30)];

  it('shows each badge\'s real stars, and grays out badges with none', async () => {
    const w = await boot({ api: book({ events, cheersSent: 5 }) });
    const btns = badgeBtns(w);
    const label = (i) => btns[i].querySelector('.stars').getAttribute('aria-label');
    expect(label(0)).toBe('2 of 3 stars'); // Dangler 34
    expect(label(4)).toBe('3 of 3 stars'); // Hockey Brain 30
    expect(label(7)).toBe('1 of 3 stars'); // Hype Squad 5
    expect(label(1)).toBe('Not started');
    expect(btns[0].classList.contains('locked')).toBe(false);
    expect(btns[1].classList.contains('locked')).toBe(true);
    // Earned stars are filled, empty ones hollow: never color alone.
    expect(btns[0].querySelector('.stars').textContent).toBe('\u2605\u2605\u2606');
    expect(btns[0].querySelector('.stars .off').textContent).toBe('\u2606');
    expect(btns[1].querySelector('.stars').textContent).toBe('\u2606\u2606\u2606');
  });

  it('tapping a badge says the count and what the next star needs', async () => {
    const w = await boot({ api: book({ events }) });
    tap(w, badgeBtns(w)[0]);
    expect($(w, 'jBadgeNote').textContent).toBe('Dangler: 34 Hands drills. 26 more for star 3.');
    expect(badgeBtns(w)[0].getAttribute('aria-pressed')).toBe('true');
    expect(badgeBtns(w)[1].getAttribute('aria-pressed')).toBe('false');
  });

  it('a badge with all 3 stars says so', async () => {
    const w = await boot({ api: book({ events }) });
    tap(w, badgeBtns(w)[4]);
    expect($(w, 'jBadgeNote').textContent).toBe('Hockey Brain: 30 Hockey IQ sessions. All 3 stars!');
  });

  it('tapping the star row inside a badge still counts as tapping the badge', async () => {
    const w = await boot({ api: book({ events }) });
    tap(w, badgeBtns(w)[0].querySelector('.stars'));
    expect($(w, 'jBadgeNote').textContent).toMatch(/^Dangler:/);
  });

  it('the goalie sees Net Boss in the second slot', async () => {
    const w = await boot({ api: book({ goalie: true, events: ev('2026-10-01', 'netplay', 10) }) });
    const b = badgeBtns(w)[1];
    expect(b.querySelector('b').textContent).toBe('Net Boss');
    tap(w, b);
    expect($(w, 'jBadgeNote').textContent).toBe('Net Boss: 10 Net play drills. 20 more for star 2.');
  });

  it('the finale shows the real badge-star total', async () => {
    const w = await boot({ api: book({ events, cheersSent: 5 }) });
    expect($(w, 'jFinStars').textContent).toBe('6');
  });
});

describe('Season Complete', () => {
  it('is hidden during the season', async () => {
    expect((await boot({ api: 401 })).document.getElementById('finale').hidden).toBe(true);
    expect((await boot({ api: book() })).document.getElementById('finale').hidden).toBe(true);
  });

  it('?finale previews it any time', async () => {
    expect((await boot({ api: book(), query: '?finale' })).document.getElementById('finale').hidden).toBe(false);
  });

  it('appears after March for a signed-in player, with real totals', async () => {
    const w = await boot({ api: book({ days: range('2026-09-01', 45), today: '2027-04-02' }), now: '2027-04-02T19:00:00Z' });
    expect($(w, 'finale').hidden).toBe(false);
    expect($(w, 'jFinDays').textContent).toBe('45'); // 45 days: 6 steps, Game Ready starts at 43
    expect($(w, 'jFinTier').textContent).toBe('Game Ready');
    // 45 consecutive days from Tue Sep 1 touch 7 Mon-Sun weeks.
    expect($(w, 'jFinWeeks').textContent).toBe('7');
  });

  it('appears between seasons when signed out too', async () => {
    expect((await boot({ api: 401, now: '2027-05-15T19:00:00Z' })).document.getElementById('finale').hidden).toBe(false);
  });

  it('is hidden again once the next season starts', async () => {
    // Regression: the end date used to be hard-coded to 2027-04-01, so the
    // finale stayed open on top of the 2027-28 book.
    const signedOut = await boot({ api: 401, now: '2027-09-15T19:00:00Z' });
    expect($(signedOut, 'finale').hidden).toBe(true);
    const signedIn = await boot({ api: book({ today: '2027-09-15' }), now: '2027-09-15T19:00:00Z' });
    expect($(signedIn, 'finale').hidden).toBe(true);
    expect($(signedIn, 'jSeason').textContent).toBe('2027-28 Jr. Rangers 10U');
  });
});

describe('art slots', () => {
  it('fill in when the art file exists', async () => {
    const w = await boot({ api: 401 });
    const cover = w.document.querySelector('[data-art="cover.webp"]');
    expect(cover.classList.contains('has')).toBe(true);
    expect(cover.firstChild.tagName).toBe('IMG');
  });

  it('keep the gray placeholder when a file is missing', async () => {
    const w = await boot({ api: 401, missingArt: ['finale.webp'] });
    const fin = w.document.querySelector('[data-art="finale.webp"]');
    expect(fin.classList.contains('has')).toBe(false);
    expect(fin.querySelector('img')).toBeNull();
  });

  it('every art slot names a file that is in journey/art/', async () => {
    const { readdirSync } = await import('node:fs');
    const files = new Set(readdirSync(resolve(__dirname, '../journey/art')));
    const slots = Array.from(html.matchAll(/data-art="([^"]+)"/g)).map((m) => m[1]);
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.filter((f) => !files.has(f))).toEqual([]);
  });
});

describe('embedded in the app', () => {
  async function bootEmbedded() {
    const posted = [];
    const dom = new JSDOM(html, {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      url: 'https://thwaphockey.com/journey.html?embed=1',
      beforeParse(window) {
        window.fetch = () => Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) });
        const parent = { postMessage: (data, origin) => posted.push({ data, origin }) };
        Object.defineProperty(window, 'parent', { configurable: true, get: () => parent });
      },
    });
    await new Promise((r) => setTimeout(r, 40));
    return { w: dom.window, posted };
  }

  it('turns on embed mode, which hides its own close button', async () => {
    const { w } = await bootEmbedded();
    expect(w.document.documentElement.classList.contains('embed')).toBe(true);
  });

  it('tells the app its height, addressed to our own origin only', async () => {
    const { w, posted } = await bootEmbedded();
    w.dispatchEvent(new w.Event('load'));
    expect(posted.length).toBeGreaterThan(0);
    const last = posted[posted.length - 1];
    expect(typeof last.data.thwapJourneyHeight).toBe('number');
    expect(last.origin).toBe('https://thwaphockey.com');
  });

  it('is not in embed mode when opened on its own', async () => {
    const w = await boot({ api: 401 });
    expect(w.document.documentElement.classList.contains('embed')).toBe(false);
  });
});
