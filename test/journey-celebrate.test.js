// test/journey-celebrate.test.js
//
// Season Book celebrations: a new badge star stamps onto its badge (with a New
// chip until the kid taps it), new dots glide the skater forward from the dot
// this device last saw, and a new scene gets a THWAP burst. Both play once, are remembered per device in
// localStorage (thwapBookSeen), and the first visit only records.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { journeyFor, badgesFor } from '../lib/journey.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../journey.html'), 'utf8');
const KEY = 'thwapBookSeen';
const TODAY = '2026-10-28';

const range = (from, n) => Array.from({ length: n }, (_, i) => {
  const d = new Date(`${from}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + i); return d.toISOString().slice(0, 10);
});
const ev = (date, disc, n) => Array.from({ length: n }, () => ({ date, disc }));
function book({ days = [], events = [] } = {}) {
  return { id: 'lewie', player: { name: 'Lewie M.', number: 81, position: 'forward', team: 'Jr. Rangers 10U' },
    ...journeyFor(days, TODAY), ...badgesFor({ events, days }, TODAY) };
}
function seenFrom(b, extra = {}) {
  const stars = {}; b.badges.forEach((g) => { stars[g.id] = g.stars; });
  return { season: b.season.key, tierIndex: b.tierIndex, dots: b.dots, stars, pending: [], ...extra };
}

async function boot(api, seen) {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://thwaphockey.com/journey.html',
    beforeParse(window) {
      window.scrollTo = () => {};
      const RealDate = window.Date; const fixed = new RealDate('2026-10-28T19:00:00Z').getTime();
      window.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
      if (seen !== undefined) window.localStorage.setItem(KEY, JSON.stringify(seen));
      window.fetch = (u) => (String(u).includes('action=journey')
        ? (typeof api === 'number' ? Promise.resolve({ ok: false, status: api, json: () => Promise.resolve({}) })
          : Promise.resolve({ ok: true, json: () => Promise.resolve(api) }))
        : Promise.resolve({ ok: false, json: () => Promise.resolve({}) }));
    },
  });
  await new Promise((r) => setTimeout(r, 40));
  return dom.window;
}
const badge = (w, i) => w.document.querySelectorAll('#jBadges .badge')[i];
const seenOf = (w) => JSON.parse(w.localStorage.getItem(KEY));
const tap = (w, el) => el.dispatchEvent(new w.Event('click', { bubbles: true }));

// 10 Hands drills = Dangler star 1. 30 = star 2.
const before = book({ days: range('2026-09-01', 10), events: ev('2026-10-01', 'stick', 10) });
const after = book({ days: range('2026-09-01', 10), events: ev('2026-10-01', 'stick', 30) });

describe('first visit', () => {
  it('records what the kid has, celebrates nothing', async () => {
    const w = await boot(after);
    expect(w.document.querySelectorAll('.badge.stamp, .newchip')).toHaveLength(0);
    expect(w.document.querySelectorAll('#jPath .scene.tierup')).toHaveLength(0);
    expect(w.document.getElementById('jSkater').classList.contains('move')).toBe(false);
    expect(seenOf(w)).toMatchObject({ season: 'fw-2026', tierIndex: after.tierIndex, pending: [] });
    expect(seenOf(w).stars.dangler).toBe(2);
  });

  it('signed out never celebrates or records', async () => {
    const w = await boot(401);
    expect(w.localStorage.getItem(KEY)).toBeNull();
    expect(w.document.querySelectorAll('.newchip')).toHaveLength(0);
  });
});

describe('new star (stamp)', () => {
  it('stamps the newest star onto its badge with a New chip and announces it', async () => {
    const w = await boot(after, seenFrom(before));
    const d = badge(w, 0);
    expect(d.classList.contains('stamp')).toBe(true);
    expect(d.querySelector('.stars .new').textContent).toBe('\u2605');
    expect(d.querySelector('.stars').textContent).toBe('\u2605\u2605\u2606');
    expect(d.querySelector('.newchip').textContent).toBe('New');
    expect(w.document.getElementById('jCheer').textContent).toBe('New star: Dangler, 2 of 3.');
    expect(seenOf(w).stars.dangler).toBe(2);
    expect(seenOf(w).pending).toEqual(['dangler']);
    // Badges that did not change are left alone.
    expect(badge(w, 1).classList.contains('stamp')).toBe(false);
    expect(badge(w, 1).querySelector('.newchip')).toBeNull();
  });

  it('plays once: the next visit shows the New chip but no stamp', async () => {
    const w1 = await boot(after, seenFrom(before));
    const w2 = await boot(after, seenOf(w1));
    expect(badge(w2, 0).classList.contains('stamp')).toBe(false);
    expect(badge(w2, 0).querySelector('.newchip')).not.toBeNull();
  });

  it('tapping the badge clears its New chip for good', async () => {
    const w1 = await boot(after, seenFrom(before));
    tap(w1, badge(w1, 0));
    expect(badge(w1, 0).querySelector('.newchip')).toBeNull();
    expect(seenOf(w1).pending).toEqual([]);
    const w2 = await boot(after, seenOf(w1));
    expect(badge(w2, 0).querySelector('.newchip')).toBeNull();
  });
});

describe('new scene and new dots', () => {
  // Practice Ice starts at dot 19. 12 days = Locker Room; 20 days = Practice Ice.
  const lockerRoom = book({ days: range('2026-09-01', 12) });
  const practiceIce = book({ days: range('2026-09-01', 20) });

  it('a new scene bursts THWAP, fades in its name and names the gear it unlocked', async () => {
    const w = await boot(practiceIce, seenFrom(lockerRoom));
    expect(w.document.querySelector('#jPath .scene.s1').classList.contains('tierup')).toBe(true);
    expect(w.document.querySelector('#jPath .scene.s1 .jburst').textContent).toBe('THWAP!');
    expect(w.document.getElementById('jTier').classList.contains('swap')).toBe(true);
    expect(w.document.getElementById('jTier').textContent).toBe('Practice Ice');
    // 20 days in a row also earns On a Heater stars, so both are announced, scene first.
    expect(w.document.getElementById('jCheer').textContent).toMatch(/^New scene: Practice Ice\. You unlocked Practice Ice tape\. New star: On a Heater/);
    expect(seenOf(w).tierIndex).toBe(1);
    expect(seenOf(w).dots).toBe(practiceIce.dots);
  });

  it('new dots inside the same scene glide the skater, no burst', async () => {
    const w = await boot(lockerRoom, seenFrom(book({ days: range('2026-09-01', 4) })));
    expect(w.document.querySelectorAll('#jPath .scene.tierup')).toHaveLength(0);
    await new Promise((r) => setTimeout(r, 60));
    expect(w.document.getElementById('jSkater').classList.contains('move')).toBe(true);
    expect(w.document.getElementById('jCheer').textContent).toMatch(/^You moved to dot \d+\./);
  });

  it('plays once', async () => {
    const w1 = await boot(practiceIce, seenFrom(lockerRoom));
    const w2 = await boot(practiceIce, seenOf(w1));
    expect(w2.document.querySelectorAll('#jPath .scene.tierup')).toHaveLength(0);
  });
});

describe('new season', () => {
  it('a record from last season is replaced without celebrating', async () => {
    const w = await boot(after, { ...seenFrom(before), season: 'fw-2025', tierIndex: 3, stars: {} });
    expect(w.document.querySelectorAll('.badge.stamp, .newchip')).toHaveLength(0);
    expect(w.document.querySelectorAll('#jPath .scene.tierup')).toHaveLength(0);
    expect(seenOf(w).season).toBe('fw-2026');
  });
});

describe('reduced motion', () => {
  it('turns every celebration animation off and hides the burst', () => {
    const rm = /@media \(prefers-reduced-motion:reduce\)\{([^@]*)\}\}/.exec(html)[1];
    for (const sel of ['.badge.stamp .stars .new', '.badge.stamp::after', '.badge.stamp .newchip', '.scene.tierup .scenehead .ic', '#jTier.swap', '.skater.move{transition:none}']) {
      expect(rm).toContain(sel);
    }
    expect(rm).toContain('.jburst{display:none}');
  });
});
