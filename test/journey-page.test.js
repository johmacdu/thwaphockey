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
    // Only earned badges show, so the sample shows its four earned ones.
    expect(badgeBtns(w).map((b) => b.querySelector('b').textContent)).toEqual(
      ['Dangler', 'Sniper', 'Engine', 'Tape to Tape']);
  });

  it('a network error also leaves the sample in place', async () => {
    const w = await boot({ api: 'throw' });
    expect($(w, 'jTier').textContent).toBe('Practice Ice');
    expect(badgeBtns(w).length).toBe(4);
  });

  it('an answer without months is ignored, not half-rendered', async () => {
    const w = await boot({ api: { season: { label: '2026-27' } } });
    expect($(w, 'jTier').textContent).toBe('Practice Ice'); // static stays, not half-rendered
  });

  it('tapping a badge asks the kid to sign in', async () => {
    const w = await boot({ api: 401 });
    tap(w, badgeBtns(w)[0]);
    expect($(w, 'jBadgeModal').hidden).toBe(false);
    expect($(w, 'jBpLine').textContent).toBe('Sign in to see your count.');
    expect($(w, 'jBpMeter').hidden).toBe(true); // no fake count on the bar
  });
});

describe('signed in: header', () => {
  it('shows the season label and title in the header', async () => {
    const w = await boot({ api: book() });
    expect($(w, 'jSeason').textContent).toBe('Season 2026-27');
    expect(w.document.querySelector('.jhead h1').textContent).toBe('My Journey');
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

  it('shows only the badges a kid has earned, with their stars', async () => {
    const w = await boot({ api: book({ events, cheersSent: 5 }) });
    const btns = badgeBtns(w);
    // 34 stick + 30 iq in one week also earns Big Week (most drills in a week).
    expect(btns.map((b) => b.getAttribute('data-id'))).toEqual(['dangler', 'hockeybrain', 'hypesquad', 'bigweek']);
    const label = (i) => btns[i].querySelector('.stars').getAttribute('aria-label');
    expect(label(0)).toBe('2 of 3 stars'); // Dangler 34
    expect(label(1)).toBe('3 of 3 stars'); // Hockey Brain 30
    expect(label(2)).toBe('1 of 3 stars'); // Hype Squad 5
    expect(label(3)).toBe('3 of 3 stars'); // Big Week: 64 drills in one week
    // Earned stars are filled, empty ones hollow: never color alone.
    expect(btns[0].querySelector('.stars').textContent).toBe('\u2605\u2605\u2606');
    expect(btns[0].querySelector('.stars .off').textContent).toBe('\u2606');
    expect($(w, 'jBadgeEmpty').hidden).toBe(true);
    expect($(w, 'jBadgeMore').hidden).toBe(true); // 3 is under the limit of 8
  });

  it('a kid with no badges yet gets one line, not an empty row', async () => {
    const w = await boot({ api: book({}) });
    expect(badgeBtns(w)).toHaveLength(0);
    expect($(w, 'jBadgeEmpty').hidden).toBe(false);
    expect($(w, 'jBadgeEmpty').textContent).toBe('Your first badge comes with your first drills.');
  });

  it('the pop-up: name, tagline, stars with their numbers, a power bar and one line', async () => {
    const w = await boot({ api: book({ events }) });
    tap(w, badgeBtns(w)[0]);
    expect($(w, 'jBadgeModal').hidden).toBe(false);
    expect($(w, 'jBpName').textContent).toBe('Dangler');
    expect($(w, 'jBpTag').textContent).toBe('Hands too quick to follow.');
    const stars = Array.from($(w, 'jBpStars').children);
    expect(stars.map((li) => li.className)).toEqual(['got', 'got', 'next']);
    expect(stars.map((li) => li.querySelector('em').textContent)).toEqual(['10', '30', '60']);
    expect(stars[2].getAttribute('aria-label')).toBe('Star 3, not yet, 60 Hands drills');
    const bar = $(w, 'jBpBar');
    expect($(w, 'jBpMeter').hidden).toBe(false);
    expect($(w, 'jBpCount').textContent).toMatch(/\/ 60$/);
    expect(bar.getAttribute('aria-valuenow')).toBe('34');
    expect(bar.getAttribute('aria-valuemax')).toBe('60');
    expect(bar.style.getPropertyValue('--p')).toBe('57%');
    expect($(w, 'jBpLine').textContent).toBe('26 more drills to star 3!');
    // The old spreadsheet ladder is gone: no checkbox-looking "Done" rows.
    expect($(w, 'jBadgePop').textContent).not.toMatch(/Done|to go/);
    expect(badgeBtns(w)[0].getAttribute('aria-expanded')).toBe('true');
  });

  it('a badge with all 3 stars is maxed out', async () => {
    const w = await boot({ api: book({ events }) });
    tap(w, badgeBtns(w)[1]); // Hockey Brain
    expect($(w, 'jBpLine').textContent).toBe('Maxed out! All 3 stars.');
    expect($(w, 'jBpBar').classList.contains('max')).toBe(true);
    expect($(w, 'jBpBar').style.getPropertyValue('--p')).toBe('100%');
  });

  it('tapping the star row inside a badge still opens it', async () => {
    const w = await boot({ api: book({ events }) });
    tap(w, badgeBtns(w)[0].querySelector('.stars'));
    expect($(w, 'jBpName').textContent).toBe('Dangler');
  });

  it('the goalie sees Net Boss', async () => {
    const w = await boot({ api: book({ goalie: true, events: ev('2026-10-01', 'netplay', 10) }) });
    const b = badgeBtns(w)[0];
    expect(b.querySelector('b').textContent).toBe('Net Boss');
    tap(w, b);
    expect($(w, 'jBpTag').textContent).toBe('Nothing gets past you.');
    expect($(w, 'jBpLine').textContent).toBe('20 more drills to star 2!');
  });

  it('streak and full-week lines read like a kid would say them', async () => {
    const days = [...range('2026-10-05', 4), ...range('2026-10-12', 4)];
    const w = await boot({ api: book({ days }) });
    const byId = (id) => badgeBtns(w).find((b) => b.getAttribute('data-id') === id);
    tap(w, byId('onaheater'));
    expect($(w, 'jBpLine').textContent).toBe('Train 7 days in a row for star 2!');
    tap(w, byId('fullweek'));
    expect($(w, 'jBpLine').textContent).toBe('4 more weeks with 4+ training days to star 2!');
  });

  it('the finale shows the real badge-star total', async () => {
    const w = await boot({ api: book({ events, cheersSent: 5 }) });
    // Dangler 2 + Hockey Brain 3 + Hype Squad 1 + Big Week 3 = 9.
    expect($(w, 'jFinStars').textContent).toBe('9');
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
    const practice = w.document.querySelector('#jStage.s1 .sceneart');
    expect(practice.querySelector('img.rot').src).toContain('rink-path.webp');
    // No fallback for the others: a plain tinted surface, never a gray box.
    w.document.querySelector('#jTiers .tierbtn[data-t="0"]').dispatchEvent(new w.Event('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 20));
    expect(w.document.querySelector('#jStage.s0 .sceneart img')).toBeNull();
    expect(w.document.querySelector('#jStage.s0 .sceneart').textContent).toBe('');
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

describe('badge modal: open and close', () => {
  const events = [...ev('2026-10-01', 'stick', 34), ...ev('2026-10-02', 'iq', 30)];
  it('is a centered modal over a dimmed backdrop that closes with x, Escape or a tap on the backdrop', async () => {
    const w = await boot({ api: book({ events }) });
    tap(w, badgeBtns(w)[0]);
    const modal = $(w, 'jBadgeModal');
    expect(modal.hidden).toBe(false);
    expect(modal.parentNode).toBe(w.document.body); // not inside the badge section
    expect($(w, 'jBadgePop').getAttribute('role')).toBe('dialog');
    expect($(w, 'jBadgePop').getAttribute('aria-modal')).toBe('true');
    expect(w.document.documentElement.style.overflow).toBe('hidden'); // the page behind doesn't scroll
    expect(w.document.activeElement).toBe($(w, 'jBpClose'));
    tap(w, $(w, 'jBpClose'));
    expect(modal.hidden).toBe(true);
    expect(w.document.documentElement.style.overflow).toBe('');
    expect(w.document.activeElement).toBe(badgeBtns(w)[0]); // focus goes back to the badge
    tap(w, badgeBtns(w)[0]);
    w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(modal.hidden).toBe(true);
    tap(w, badgeBtns(w)[0]);
    tap(w, $(w, 'jBpName')); // a tap on the card keeps it open
    expect(modal.hidden).toBe(false);
    tap(w, modal); // the backdrop
    expect(modal.hidden).toBe(true);
  });
  it('opening another badge shows that badge', async () => {
    const w = await boot({ api: book({ events }) });
    tap(w, badgeBtns(w)[0]); tap(w, $(w, 'jBpClose')); tap(w, badgeBtns(w)[1]);
    expect($(w, 'jBpName').textContent).toBe('Hockey Brain');
    const expanded = badgeBtns(w).map((b) => b.getAttribute('aria-expanded'));
    expect(expanded[1]).toBe('true'); // the second badge is now open
    expect(expanded.filter((x) => x === 'true')).toHaveLength(1); // and only it
  });
  it('embedded in My Season, the modal opens on the app page so it centers on the screen', async () => {
    const parent = new JSDOM('<!doctype html><html><head></head><body><iframe id="jyFrame"></iframe></body></html>', { url: 'https://thwaphockey.com/' });
    const dom = new JSDOM(html, {
      runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://thwaphockey.com/journey.html?embed=1',
      beforeParse(win) {
        win.scrollTo = () => {};
        Object.defineProperty(win, 'parent', { value: parent.window });
        Object.defineProperty(win, 'frameElement', { value: parent.window.document.getElementById('jyFrame') });
        win.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(book({ events })) });
      },
    });
    await new Promise((r) => setTimeout(r, 40));
    const w = dom.window;
    tap(w, badgeBtns(w)[0]);
    const pdoc = parent.window.document;
    expect(w.document.getElementById('jBadgeModal')).toBeNull();
    const modal = pdoc.getElementById('jBadgeModal');
    expect(modal.parentNode).toBe(pdoc.body);
    expect(modal.hidden).toBe(false);
    expect(pdoc.getElementById('jbmStyle')).not.toBeNull();
    expect(pdoc.getElementById('jBpName').textContent).toBe('Dangler');
    expect(pdoc.documentElement.style.overflow).toBe('hidden');
    pdoc.getElementById('jBpClose').dispatchEvent(new parent.window.Event('click', { bubbles: true }));
    expect(modal.hidden).toBe(true);
    expect(pdoc.documentElement.style.overflow).toBe('');
  });
});

describe('8 badges, then Show more', () => {
  it('shows the first 8 earned badges, and Show more reveals the rest', async () => {
    const b = book({});
    b.badges = Array.from({ length: 11 }, (_, i) => ({ id: 'b' + i, name: 'Badge ' + i, art: 'badge-01.webp', unit: 'drills', count: 12, stars: 1, thresholds: [10, 30, 60], next: 30 }));
    b.badges.push({ id: 'none', name: 'Not yet', art: 'badge-02.webp', unit: 'drills', count: 0, stars: 0, thresholds: [10, 30, 60], next: 10 });
    const w = await boot({ api: b });
    const shown = () => badgeBtns(w).filter((x) => !x.hidden).length;
    expect(badgeBtns(w)).toHaveLength(11); // the unearned one never renders
    expect(shown()).toBe(8);
    const more = $(w, 'jBadgeMore');
    expect(more.hidden).toBe(false);
    expect(more.textContent).toBe('Show more');
    tap(w, more);
    expect(shown()).toBe(11);
    expect($(w, 'jBadgeMore').textContent).toBe('Show less');
    expect($(w, 'jBadgeMore').getAttribute('aria-expanded')).toBe('true');
    tap(w, $(w, 'jBadgeMore'));
    expect(shown()).toBe(8);
  });
});

describe('season book is locked', () => {
  it('shows a padlock, and a tap shakes it instead of doing nothing', async () => {
    const w = await boot({ api: 401 });
    const book0 = w.document.querySelector('.spine.current');
    expect(book0.querySelector('.booklock svg')).not.toBeNull();
    expect(book0.getAttribute('aria-label')).toBe('2026-27 book, locked until the season ends');
    expect(book0.tagName).not.toBe('BUTTON');
    tap(w, book0);
    expect(book0.classList.contains('nope')).toBe(true);
    await new Promise((r) => setTimeout(r, 480));
    expect(book0.classList.contains('nope')).toBe(false);
  });
});

describe('breathing room', () => {
  it('drops the "book opens in the spring" line', async () => {
    const w = await boot({ api: 401 });
    expect(w.document.body.textContent).not.toContain('book opens when the season ends');
  });
});

describe('season path: one scene at a time', () => {
  const pips = (w) => Array.from(w.document.querySelectorAll('#jPips i'));
  const on = (w) => pips(w).filter((i) => i.classList.contains('on')).length;
  const tiers = (w) => Array.from(w.document.querySelectorAll('#jTiers .tierbtn'));
  const day20 = { days: range('2026-09-01', 20), today: '2026-09-21' };
  const at20 = () => boot({ api: book(day20), now: '2026-09-21T19:00:00Z' });

  it('shows the kid\'s own scene with one pip per training day in it', async () => {
    const w = await at20();
    expect($(w, 'jTier').textContent).toBe('Practice Ice');
    expect($(w, 'jStage').className).toBe('stage s1');
    expect($(w, 'jStage').querySelector('.sceneart').getAttribute('data-art')).toBe('scene-practice.webp');
    expect(pips(w)).toHaveLength(24); // Practice Ice runs from day 20 to 43
    expect(on(w)).toBe(1);
    expect(pips(w)[1].className).toBe('next');
    expect($(w, 'jPips').getAttribute('aria-label')).toBe('1 of 24 dots in Practice Ice');
    expect($(w, 'jNext').textContent).toBe('23 training days to Game Ready');
    expect($(w, 'jSub').textContent).toBe('Next up: Game Ready helmet.');
    expect($(w, 'jStage').querySelector('.stagetag')).toBeNull(); // the heading already names it
    expect($(w, 'jSkater')).toBeTruthy();
  });

  it('the simpler words: no dot count, no dot ranges, a one-line rule', async () => {
    const w = await at20();
    const txt = w.document.querySelector('section[aria-labelledby="h-journey"]').textContent;
    expect(txt).not.toMatch(/Dot \d+ of 91|Dots \d|never drop out/);
    expect(txt).not.toContain('Skip 5 days'); // the rule lives behind the i, not on the page
  });

  it('the rule is tucked behind an i next to the title', async () => {
    const w = await at20();
    const btn = $(w, 'jRuleBtn'), pop = $(w, 'jRule');
    expect(btn.getAttribute('aria-label')).toBe('How the dots work');
    expect(pop.hidden).toBe(true);
    tap(w, btn);
    expect(pop.hidden).toBe(false);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(pop.textContent).toBe('Every training day fills a dot. Skip 5 days in a row and you lose one.');
    tap(w, $(w, 'h-badges')); // a tap anywhere else closes it
    expect(pop.hidden).toBe(true);
    tap(w, btn);
    w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(pop.hidden).toBe(true);
  });

  it('Who skates sits on the same row as the scene name', async () => {
    const w = await at20();
    expect($(w, 'h-journey').closest('.scenerow').querySelector('.whoskates')).toBeTruthy();
  });

  it('the stage row: done, here, locked', async () => {
    const w = await at20();
    expect(tiers(w).map((t) => t.querySelector('b').textContent)).toEqual(['Locker Room', 'Practice Ice', 'Game Ready', 'Legend']);
    expect(tiers(w).map((t) => t.querySelector('.tnote').textContent)).toEqual(['Done', 'You\u2019re here', '\uD83D\uDD12 Locked', '\uD83D\uDD12 Locked']);
    expect(tiers(w).map((t) => t.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false', 'false']);
  });

  it('tap a locked stage: its scene, blurred, with the lock and the gear it unlocks', async () => {
    const w = await at20();
    tap(w, tiers(w)[2]);
    expect($(w, 'jStage').className).toBe('stage s2 locked');
    expect($(w, 'jStage').querySelector('.lock').textContent).toContain('Get here at 43 training days');
    expect($(w, 'jStage').querySelector('.stagetag').textContent).toContain('Game Ready');
    expect($(w, 'jSkater')).toBeNull();
    expect(on(w)).toBe(0);
    expect($(w, 'jNext').textContent).toBe('Unlocks Game Ready helmet.');
    expect($(w, 'jTier').textContent).toBe('Practice Ice'); // the heading stays where the kid is
    expect(tiers(w)[2].getAttribute('aria-pressed')).toBe('true');
  });

  it('tap a done stage: full, clear, and when it was cleared', async () => {
    const w = await at20();
    tap(w, tiers(w)[0]);
    expect($(w, 'jStage').classList.contains('locked')).toBe(false);
    expect(pips(w)).toHaveLength(19);
    expect(on(w)).toBe(19);
    expect($(w, 'jNext').textContent).toBe('Done! You cleared it on Sep 19.');
    tap(w, tiers(w)[1]); // back home
    expect($(w, 'jSkater')).toBeTruthy();
    expect($(w, 'jNext').textContent).toBe('23 training days to Game Ready');
  });

  it('a new player starts in the Locker Room, singular days', async () => {
    const w = await boot({ api: book() });
    expect($(w, 'jTier').textContent).toBe('Locker Room');
    expect(pips(w)).toHaveLength(19);
    expect(on(w)).toBe(0);
    expect($(w, 'jNext').textContent).toBe('19 training days to Practice Ice');
    const w2 = await boot({ api: book({ days: range('2026-09-01', 18), today: '2026-09-19' }), now: '2026-09-19T19:00:00Z' });
    expect($(w2, 'jNext').textContent).toBe('1 training day to Practice Ice');
  });

  it('a finished path says so', async () => {
    const w = await boot({ api: book({ days: range('2026-09-01', 95), today: '2027-01-10' }), now: '2027-01-10T19:00:00Z' });
    expect($(w, 'jTier').textContent).toBe('Legend');
    expect($(w, 'jNext').textContent).toBe('You finished the whole path. Legend!');
    expect(on(w)).toBe(24);
    expect($(w, 'jSkater')).toBeTruthy();
  });

  it('warns before a slip, and says so after one', async () => {
    const w = await boot({ api: book({ days: range('2026-09-01', 10), today: '2026-09-14' }), now: '2026-09-14T19:00:00Z' });
    expect($(w, 'jSlip').hidden).toBe(false);
    expect($(w, 'jSlip').textContent).toBe('You haven\u2019t trained in 3 days. Train in the next 2 days so you don\u2019t lose a dot.');
    const w2 = await boot({ api: book({ days: range('2026-09-01', 10), today: '2026-09-20' }), now: '2026-09-20T19:00:00Z' });
    expect(on(w2)).toBe(9);
    expect($(w2, 'jSlip').textContent).toBe('You slipped back a dot. Train today to start moving again.');
    const w3 = await boot({ api: book({ days: range('2026-09-01', 10), today: '2026-09-11' }), now: '2026-09-11T19:00:00Z' });
    expect($(w3, 'jSlip').hidden).toBe(true);
  });

  it('works signed out on the sample', async () => {
    const w = await boot({ api: 401 });
    expect($(w, 'jTier').textContent).toBe('Practice Ice');
    expect(on(w)).toBe(11);
    tap(w, tiers(w)[3]);
    expect($(w, 'jNext').textContent).toBe('Unlocks Legend gloves.');
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
