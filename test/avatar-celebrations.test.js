// Phase 3 celebrations: THWAP! and Knee slide are stance keyframes the rig
// blends between. They play from a Play button and when a celebration tile is
// tapped in My Player, and in the New gear message (milestone moment). Never
// from a card tap. Reduced motion draws only the final pose.
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import * as A from '../lib/avatar_items.js';

const SRC = fs.readFileSync(path.join(__dirname, '..', 'avatar.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const tick = () => new Promise((r) => setTimeout(r, 0));

function boot({ reduced = false } = {}) {
  const dom = new JSDOM("<!doctype html><html><head></head><body><button id='cardImageBtn'>Edit player</button></body></html>", { url: 'https://thwaphockey.com/', runScripts: 'outside-only' });
  const w = dom.window;
  w.matchMedia = (q) => ({ matches: reduced && /reduce/.test(q), addListener() {}, removeListener() {} });
  // A fake clock: every animation frame is 100ms later.
  let now = 0;
  w.requestAnimationFrame = (f) => setTimeout(() => { now += 100; f(now); }, 0);
  return w;
}
async function frames(n = 40) { for (let i = 0; i < n; i++) await tick(); }

async function openLocker(w, { progress, look } = {}) {
  const posts = [];
  const data = { id: 'lewie', look: { ...A.DEFAULT_LOOK, ...(look || {}) }, saved: true, items: A.ITEMS, progress, unlocked: A.unlockedIds(progress), next: [] };
  w.fetch = (url, opts) => {
    if (opts && opts.method === 'POST') { const b = JSON.parse(opts.body); posts.push(b); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ look: b.look }) }); }
    if (String(url).includes('action=looks')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ looks: {} }) });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data) });
  };
  w.localStorage.setItem('thwapBuilderOffered', '1');
  w.eval(SRC);
  w.thwapAvatar.openLocker({ tab: 'celebration' });
  await frames(5);
  return { posts, data };
}

describe('celebration player', () => {
  it('has THWAP! and Knee slide, matching the catalog', () => {
    const w = boot(); w.eval(SRC);
    const ids = A.ITEMS.filter((it) => it.slot === 'celebration' && it.id !== 'celebration-none').map((it) => it.id.slice('celebration-'.length));
    expect(w.thwapAvatar.CELLYS.sort()).toEqual(ids.sort());
  });

  it('animates through several frames, ends on the THWAP! pose, then calls done', async () => {
    const w = boot(); w.eval(SRC);
    const drawn = []; let done = 0;
    w.thwapAvatar.playCelly('celebration-fistpump', { num: '72' }, (m) => drawn.push(m), () => done++);
    await frames(30);
    await new Promise((r) => setTimeout(r, 750)); // the end pose holds, then done
    expect(drawn.length).toBeGreaterThan(5);
    expect(drawn[0]).not.toContain('av-word'); // the word comes in partway
    expect(drawn[drawn.length - 1]).toContain('THWAP!');
    expect(new Set(drawn).size).toBeGreaterThan(3); // the body actually moves
    expect(done).toBe(1);
  });

  it('Knee slide slides across the stage', async () => {
    const w = boot(); w.eval(SRC);
    const xs = [];
    w.thwapAvatar.playCelly('celebration-kneeslide', {}, (m, sx) => xs.push(sx));
    await frames(30);
    expect(xs[0]).toBeLessThan(0);
    expect(xs[xs.length - 1]).toBeGreaterThan(0);
  });

  it('reduced motion draws only the final pose, once', async () => {
    const w = boot({ reduced: true }); w.eval(SRC);
    const drawn = [];
    w.thwapAvatar.playCelly('celebration-fistpump', {}, (m) => drawn.push(m));
    await frames(30);
    expect(drawn.length).toBe(1);
    expect(drawn[0]).toContain('THWAP!');
  });

  it('is never wired to a card tap', () => {
    expect(INDEX).not.toMatch(/playCelly/);
  });
});

describe('Cellys tab in My Player', () => {
  it('shows No celly, THWAP! (free), Knee slide and the team Stick tap; Play is hidden while none is worn', async () => {
    const w = boot();
    await openLocker(w, { progress: A.progressFrom({}, 2) });
    expect(w.document.querySelector('[data-tab=moves]').textContent).toBe('Moves');
    expect(w.document.querySelector('[data-slot=celebration] .lk-sech').textContent).toBe('Cellys');
    expect(w.document.querySelectorAll('[data-slot=celebration] .lk-item').length).toBe(4);
    expect(w.document.querySelector('[data-id=celebration-fistpump]').classList.contains('locked')).toBe(false);
    expect(w.document.querySelector('[data-id=celebration-kneeslide]').classList.contains('locked')).toBe(true);
    expect(w.document.querySelector('.lk-play').hidden).toBe(true);
  });

  it('tapping an earned celebration wears it, saves it, plays it, and shows Play', async () => {
    const w = boot();
    const { posts } = await openLocker(w, { progress: A.progressFrom({}, 15) });
    w.document.querySelector('[data-id=celebration-fistpump]').click();
    await frames(40);
    expect(posts.length).toBe(1);
    expect(posts[0].look.celebration).toBe('celebration-fistpump');
    expect(w.document.querySelector('.lk-stage').innerHTML).toContain('THWAP!');
    expect(w.document.querySelector('.lk-play').hidden).toBe(false);
  });

  it('tapping a locked celebration plays it as a try-on, without saving', async () => {
    const w = boot({ reduced: true });
    const { posts } = await openLocker(w, { progress: A.progressFrom({}, 2) });
    w.document.querySelector('[data-id=celebration-kneeslide]').click();
    await frames(5);
    expect(posts.length).toBe(0);
    expect(w.document.querySelector('.lk-note').textContent).toMatch(/Knee slide\. Train 75 days to unlock\./);
    expect(w.document.querySelector('.lk-stage .av-scene').style.translate).toBe('2.5em 0'); // the slide's end
  });

  it('the Play button replays the worn celebration', async () => {
    const w = boot({ reduced: true });
    await openLocker(w, { progress: A.progressFrom({}, 15), look: { celebration: 'celebration-fistpump' } });
    expect(w.document.querySelector('.lk-play').hidden).toBe(false);
    expect(w.document.querySelector('.lk-stage').innerHTML).not.toContain('THWAP!');
    w.document.querySelector('.lk-play').click();
    expect(w.document.querySelector('.lk-stage').innerHTML).toContain('THWAP!');
  });
});

describe('milestone moment', () => {
  it('the New gear message shows the player doing their celebration, wearing the new item', async () => {
    const w = boot({ reduced: true });
    const prog = A.progressFrom({ stick: 6 }, 15);
    await openLocker(w, { progress: prog, look: { celebration: 'celebration-fistpump' } });
    w.document.querySelector('.lk-x').click();
    const unlocked = A.unlockedIds(prog);
    w.localStorage.setItem('thwapUnlockSeen', JSON.stringify(unlocked.filter((id) => id !== 'gloves-red')));
    await w.thwapAvatar.checkUnlocks();
    const toast = w.document.querySelector('.lk-toast');
    expect(toast.querySelector('.lk-tk').textContent).toBe('New gloves');
    expect(toast.querySelector('.lk-tt').textContent).toBe('Rangers Red gloves');
    const pic = toast.querySelector('.lk-tcelly');
    expect(pic).toBeTruthy();
    expect(pic.innerHTML).toContain(A.ITEMS && '#C8102E'); // wearing the red gloves
  });

  it('without a celebration worn, the message shows the player wearing the item, not a color dot', async () => {
    const w = boot();
    const prog = A.progressFrom({ stick: 6 }, 2);
    await openLocker(w, { progress: prog });
    w.document.querySelector('.lk-x').click();
    w.localStorage.setItem('thwapUnlockSeen', JSON.stringify(A.unlockedIds(prog).filter((id) => id !== 'gloves-red')));
    await w.thwapAvatar.checkUnlocks();
    const toast = w.document.querySelector('.lk-toast');
    expect(toast.querySelector('.lk-tcelly')).toBeNull();
    expect(toast.querySelector('.lk-sw')).toBeNull();
    expect(toast.querySelector('.lk-mini.pose .av-wrap')).toBeTruthy();
  });
});
