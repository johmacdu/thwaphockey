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
  it('keeps the sample content showing when signed out', async () => {
    const w = await boot({ api: 401 });
    expect($(w, 'jTier').textContent).toBe('Practice Ice'); // static sample stays
    expect(badgeBtns(w).map((b) => b.querySelector('b').textContent)).toEqual(
      ['Dangler', 'Sniper', 'Engine', 'Tape to Tape', 'Hockey Brain', 'On a Heater', 'Full Week', 'Hype Squad']);
  });

  it('a network error also leaves the sample in place', async () => {
    const w = await boot({ api: 'throw' });
    expect($(w, 'jTier').textContent).toBe('Practice Ice');
    expect(badgeBtns(w).length).toBe(8);
  });

  it('an answer without months is ignored, not half-rendered', async () => {
    const w = await boot({ api: { season: { label: '2026-27' } } });
    expect($(w, 'jTier').textContent).toBe('Practice Ice'); // static stays, not half-rendered
  });

  it('tapping a badge asks the kid to sign in', async () => {
    const w = await boot({ api: 401 });
    tap(w, badgeBtns(w)[0]);
    expect($(w, 'jBadgeNote').textContent).toBe('Sign in to see your count.');
  });
});

describe('signed in: header', () => {
  it('shows the season label and title in the header', async () => {
    const w = await boot({ api: book() });
    expect($(w, 'jSeason').textContent).toBe('Season 2026-27');
    expect(w.document.querySelector('.jhead h1').textContent).toBe('My Season Journey');
  });

  it('hides every Sample tag once real data loads', async () => {
    const w = await boot({ api: book() });
    expect(visibleSamples(w)).toBe(0);
  });
});

describe('signed in: My Season So Far', () => {
  it('lists each month with its training days, then the months still ahead', async () => {
    const w = await boot({ api: book({ days: [...range('2026-09-01', 11), '2026-10-01'] }) });
    const rows = Array.from($(w, 'jMonths').children).map((li) => [li.querySelector('b').textContent, li.querySelector('p').textContent]);
    expect(rows).toEqual([
      ['Sep', '11 training days.'], ['Oct', '1 training day.'],
      ['Nov', 'Keep stacking training days.'], ['Dec', 'Winter break. A great time to train.'],
      ['Jan', 'New year, keep climbing.'], ['Feb', 'Push before the season ends.']]);
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
    expect($(w, 'jBadgeNote').textContent).toBe('34 Hands drills. 26 more for star 3.');
    expect(badgeBtns(w)[0].getAttribute('aria-pressed')).toBe('true');
    expect(badgeBtns(w)[1].getAttribute('aria-pressed')).toBe('false');
  });

  it('a badge with all 3 stars says so', async () => {
    const w = await boot({ api: book({ events }) });
    tap(w, badgeBtns(w)[4]);
    expect($(w, 'jBadgeNote').textContent).toBe('30 Hockey IQ sessions. All 3 stars!');
  });

  it('tapping the star row inside a badge still counts as tapping the badge', async () => {
    const w = await boot({ api: book({ events }) });
    tap(w, badgeBtns(w)[0].querySelector('.stars'));
    expect($(w, 'jBadgeNote').textContent).toBe('34 Hands drills. 26 more for star 3.');
  });

  it('the goalie sees Net Boss in the second slot', async () => {
    const w = await boot({ api: book({ goalie: true, events: ev('2026-10-01', 'netplay', 10) }) });
    const b = badgeBtns(w)[1];
    expect(b.querySelector('b').textContent).toBe('Net Boss');
    tap(w, b);
    expect($(w, 'jBadgeNote').textContent).toBe('10 Net play drills. 20 more for star 2.');
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
    expect($(signedIn, 'jSeason').textContent).toBe('Season 2027-28');
  });
});

describe('art slots', () => {
  it('fill in when the art file exists', async () => {
    const w = await boot({ api: 401 });
    const fin = w.document.querySelector('[data-art="finale.webp"]');
    expect(fin.classList.contains('has')).toBe(true);
    expect(fin.firstChild.tagName).toBe('IMG');
  });

  it('Practice Ice falls back to the rink art turned on its side until its scene exists', async () => {
    const w = await boot({ api: 401, missingArt: ['scene-practice.webp', 'scene-locker.webp'] });
    await new Promise((r) => setTimeout(r, 20));
    const practice = w.document.querySelector('.scene.s1 .sceneart');
    expect(practice.querySelector('img.rot').src).toContain('rink-path.webp');
    // No fallback for the others: a plain tinted surface, never a gray box.
    expect(w.document.querySelector('.scene.s0 .sceneart img')).toBeNull();
    expect(w.document.querySelector('.scene.s0 .sceneart').textContent).toBe('');
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
    // Scene art is still coming from Woody (docs/journey-scenes.md); those
    // names are allowed until the files land. Names built in code are skipped.
    const PENDING = ['scene-locker.webp', 'scene-practice.webp', 'scene-gameready.webp', 'scene-legend.webp'];
    const slots = Array.from(html.matchAll(/data-art="([^"']+)"/g)).map((m) => m[1]);
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.filter((f) => !files.has(f) && !PENDING.includes(f))).toEqual([]);
    expect(files.has('rink-path.webp')).toBe(true); // the Practice Ice fallback
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

describe('tap a badge to open it', () => {
  const events = ev('2026-10-01', 'stick', 34);
  it('opens under its row with the art, stars and each star\'s goal', async () => {
    const w = await boot({ api: book({ events }) });
    tap(w, badgeBtns(w)[1]);
    const panel = $(w, 'jBadgeInfo');
    expect(panel.hidden).toBe(false);
    expect(panel.previousElementSibling).toBe(badgeBtns(w)[3]); // after the first row of 4
    tap(w, badgeBtns(w)[0]);
    expect($(w, 'jBadgeName').textContent).toBe('Dangler');
    const rows = Array.from($(w, 'jBadgeLadder').children).map((li) => li.textContent);
    expect(rows).toEqual(['\u2605Star 1: 10 Hands drills\u2713 Done', '\u2605Star 2: 30 Hands drills\u2713 Done', '\u2606Star 3: 60 Hands drills26 to go']);
    tap(w, badgeBtns(w)[5]);
    expect(panel.previousElementSibling).toBe(badgeBtns(w)[7]); // second row
    tap(w, badgeBtns(w)[5]);
    expect(panel.hidden).toBe(true);
  });
});

describe('breathing room', () => {
  it('drops the "book opens in the spring" line', async () => {
    const w = await boot({ api: 401 });
    expect(w.document.body.textContent).not.toContain('book opens when the season ends');
  });
});

describe('season path', () => {
  const scenes = (w) => Array.from(w.document.querySelectorAll('#jPath .scene'));
  const dotsIn = (w, i) => Array.from(scenes(w)[i].querySelectorAll('.dot'));
  const head = (w, i) => w.document.querySelectorAll('#jPath .scenehead')[i];
  const info = (w, i) => Array.from($(w, 'jTierInfo' + i).querySelectorAll('h3,p')).map((e) => e.textContent);

  it('draws 91 dots across four scenes, one per training day', async () => {
    const w = await boot({ api: book({ days: range('2026-09-01', 20), today: '2026-09-21' }), now: '2026-09-21T19:00:00Z' });
    expect(scenes(w).map((s) => s.querySelector('.scenehead b').textContent)).toEqual(['Locker Room', 'Practice Ice', 'Game Ready', 'Legend']);
    expect(scenes(w).map((s, i) => dotsIn(w, i).length)).toEqual([19, 24, 24, 24]);
    expect(dotsIn(w, 3).at(-1).textContent).toBe('91');
    const on = Array.from(w.document.querySelectorAll('#jPath .dot.on')).map((d) => d.textContent);
    expect(on.length).toBe(20);
    expect(w.document.querySelector('#jPath .dot.next').textContent).toBe('21');
    expect($(w, 'jDotLine').textContent).toBe('Dot 20 of 91');
    expect($(w, 'jTier').textContent).toBe('Practice Ice');
    expect($(w, 'jNext').textContent).toBe('23 more training days to Game Ready');
  });

  it('marks scenes done, here and locked, and puts the skater in the current one', async () => {
    const w = await boot({ api: book({ days: range('2026-09-01', 20), today: '2026-09-21' }), now: '2026-09-21T19:00:00Z' });
    expect(scenes(w).map((s) => ['done', 'here', 'locked'].find((c) => s.classList.contains(c)))).toEqual(['done', 'here', 'locked', 'locked']);
    expect(scenes(w)[1].querySelector('#jSkater')).toBeTruthy();
    expect(scenes(w)[2].querySelector('.lock').textContent).toContain('Reach Game Ready at 43 training days');
    expect(Array.from(w.document.querySelectorAll('#jPath .tnote')).map((n) => n.textContent)).toEqual(['Done', 'You are here', 'Next stop', 'Later']);
  });

  it('a new player starts at the Locker Room entry, singular days', async () => {
    const w = await boot({ api: book() });
    expect($(w, 'jDotLine').textContent).toBe('Dot 0 of 91');
    expect($(w, 'jNext').textContent).toBe('19 more training days to Practice Ice');
    expect(scenes(w)[0].querySelector('#jSkater')).toBeTruthy();
    const w2 = await boot({ api: book({ days: range('2026-09-01', 18), today: '2026-09-19' }), now: '2026-09-19T19:00:00Z' });
    expect($(w2, 'jNext').textContent).toBe('1 more training day to Practice Ice');
  });

  it('rewards sit between scenes and show when unlocked', async () => {
    const w = await boot({ api: book({ days: range('2026-09-01', 20), today: '2026-09-21' }), now: '2026-09-21T19:00:00Z' });
    const r = Array.from(w.document.querySelectorAll('#jPath .reward'));
    expect(r.map((x) => x.querySelector('b').textContent)).toEqual([
      'Unlocked: Practice Ice tape', 'Reach Game Ready to unlock: Game Ready helmet', 'Reach Legend to unlock: Legend gloves']);
    expect(r[0].classList.contains('got')).toBe(true);
    expect(r[0].nextElementSibling.classList.contains('s1')).toBe(true);
  });

  it('a finished path says so', async () => {
    const w = await boot({ api: book({ days: range('2026-09-01', 95), today: '2027-01-10' }), now: '2027-01-10T19:00:00Z' });
    expect($(w, 'jTier').textContent).toBe('Legend');
    expect($(w, 'jNext').textContent).toBe('You finished the whole path. Legend.');
    expect(w.document.querySelectorAll('#jPath .dot.on').length).toBe(91);
  });

  it('warns before a slip, and says so after one', async () => {
    // Trained Sep 1-10, today Sep 14: 3 missed days, 2 left before a slip.
    const w = await boot({ api: book({ days: range('2026-09-01', 10), today: '2026-09-14' }), now: '2026-09-14T19:00:00Z' });
    expect($(w, 'jSlip').hidden).toBe(false);
    expect($(w, 'jSlip').textContent).toBe('You haven\u2019t trained in 3 days. Train in the next 2 days so you don\u2019t slip back a dot.');
    const w2 = await boot({ api: book({ days: range('2026-09-01', 10), today: '2026-09-20' }), now: '2026-09-20T19:00:00Z' });
    expect($(w2, 'jDotLine').textContent).toBe('Dot 9 of 91');
    expect($(w2, 'jSlip').textContent).toBe('You slipped back a dot. Train today to start moving again.');
    const w3 = await boot({ api: book({ days: range('2026-09-01', 10), today: '2026-09-11' }), now: '2026-09-11T19:00:00Z' });
    expect($(w3, 'jSlip').hidden).toBe(true);
  });

  it('tap a done scene: when the kid got there and cleared it', async () => {
    const w = await boot({ api: book({ days: range('2026-09-01', 20), today: '2026-09-21' }), now: '2026-09-21T19:00:00Z' });
    tap(w, head(w, 0));
    expect(info(w, 0)).toEqual(['Locker Room', 'Done!', 'You started here and cleared it on Sep 19.', '19 dots, one for every training day.']);
    expect(head(w, 0).getAttribute('aria-expanded')).toBe('true');
  });

  it('tap the current scene and a locked one', async () => {
    const w = await boot({ api: book({ days: range('2026-09-01', 20), today: '2026-09-21' }), now: '2026-09-21T19:00:00Z' });
    tap(w, head(w, 1));
    expect(info(w, 1)).toEqual(['Practice Ice', 'You are here, on dot 20.', 'You got here on Sep 19. 23 more training days to clear it.']);
    tap(w, head(w, 2));
    expect($(w, 'jTierInfo1').hidden).toBe(true);
    expect(info(w, 2)).toEqual(['Game Ready', 'Next stop.', 'You get here at dot 43. You\u2019re at 20, so 23 to go.', 'Reaching it unlocks Game Ready helmet for your player.']);
    tap(w, head(w, 2));
    expect($(w, 'jTierInfo2').hidden).toBe(true);
  });

  it('works signed out on the sample', async () => {
    const w = await boot({ api: 401 });
    expect($(w, 'jDotLine').textContent).toBe('Dot 30 of 91');
    tap(w, head(w, 3));
    expect(info(w, 3)[0]).toBe('Legend');
  });

  it('Who skates: Me or Sass, remembered on the device', async () => {
    const w = await boot({ api: 401 });
    const sass = w.document.querySelector('.whoskates [data-who=sass]');
    tap(w, sass);
    expect(sass.getAttribute('aria-pressed')).toBe('true');
    expect($(w, 'jSkater').querySelector('img').getAttribute('src')).toContain('sass');
    expect(w.localStorage.getItem('thwapJourneySkater')).toBe('sass');
  });
});
