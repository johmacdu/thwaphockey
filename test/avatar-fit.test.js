// Card fit: the kid makes their player bigger or smaller on the card front
// (pinch, wheel or - / + in My Player). Older looks may also carry a move. Server clamps the three numbers;
// only the card front (.cf2) applies them.
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import * as A from '../lib/avatar_items.js';

const SRC = fs.readFileSync(path.join(__dirname, '..', 'avatar.js'), 'utf8');
const tick = () => new Promise((r) => setTimeout(r, 0));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

describe('card fit on the server', () => {
  it('clamps, rounds and drops defaults', () => {
    expect(A.cleanFit({ fitSize: 999, fitX: -80, fitY: 12.4 })).toEqual({ fitSize: 150, fitX: -30, fitY: 12 });
    expect(A.cleanFit({ fitSize: 100, fitX: 0, fitY: 0 })).toEqual({});
    expect(A.cleanFit({ fitSize: 'big', fitX: null })).toEqual({});
    expect(A.cleanFit(null)).toEqual({});
  });
  it('validateLook and sanitizeStoredLook keep the fit', () => {
    const p = A.progressFrom({}, 0);
    const ok = A.validateLook({ jersey: 'jersey-red', fitSize: 130, fitX: 10 }, p);
    expect(ok.ok).toBe(true);
    expect(ok.look.fitSize).toBe(130);
    expect(ok.look.fitX).toBe(10);
    expect(ok.look).not.toHaveProperty('fitY');
    expect(A.sanitizeStoredLook({ fitSize: 70, fitY: 40 }, p)).toMatchObject({ fitSize: 80, fitY: 30 });
    expect(A.validateLook({}, p).look).toEqual(A.DEFAULT_LOOK); // no fit = the default look, unchanged
  });
});

function load() {
  const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", { url: 'https://thwaphockey.com/?avatar=1', runScripts: 'outside-only' });
  const w = dom.window;
  w.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ looks: {} }) });
  w.eval(SRC);
  return w;
}

describe('card fit in the renderer', () => {
  it('a default look carries no transform', () => {
    const w = load();
    expect(w.thwapAvatar.html({ jersey: 'red' })).not.toContain('--av-fit');
  });
  it('a fit look moves and scales the character', () => {
    const w = load();
    const h = w.thwapAvatar.html({ jersey: 'red', fitSize: 130, fitX: 10, fitY: 5 });
    expect(h).toContain('--av-fit:translate(10%,-5%) scale(1.3)');
  });
  it('only card fronts apply it', () => {
    const w = load();
    const css = w.document.getElementById('av-css').textContent;
    expect(css).toContain('.cf2 .av-wrap{transform:var(--av-fit,none)');
    expect(css).not.toMatch(/(^|\})\.av-wrap\{[^}]*--av-fit/);
  });
});

async function openLocker(extra = {}) {
  const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", { url: 'https://thwaphockey.com/?avatar=1', runScripts: 'outside-only' });
  const w = dom.window;
  const posts = [];
  const progress = A.progressFrom({}, 1);
  const data = { id: 'lewie', look: { ...A.DEFAULT_LOOK, ...extra }, saved: true, items: A.ITEMS, progress, unlocked: A.unlockedIds(progress), next: [] };
  w.fetch = (url, opts) => {
    if (opts && opts.method === 'POST') {
      const body = JSON.parse(opts.body); posts.push(body);
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ look: body.look }) });
    }
    if (String(url).includes('action=looks')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ looks: {} }) });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data) });
  };
  w.localStorage.setItem('thwapBuilderOffered', '1');
  w.eval(SRC);
  w.thwapAvatar.openLocker({ tab: 'fit' });
  for (let i = 0; i < 5; i++) await tick();
  return { w, posts };
}

// Size and turn live on the card itself (no Size or View tab): pinch, the wheel
// or the - / + buttons size the player; a drag turns them and the card keeps
// the nearest side.
function ptr(w, el, type, id, x, y = 100) {
  const e = new w.Event(type, { bubbles: true });
  Object.assign(e, { pointerId: id, clientX: x, clientY: y });
  el.dispatchEvent(e);
}
const zb = (w, l) => w.document.querySelector(".lk-zbtn[aria-label='" + l + "']");

describe('size and turn on the card', () => {
  it('the stage is the card front, with - and + buttons and no Size tab', async () => {
    const { w } = await openLocker();
    expect(w.document.querySelector('[data-tab=fit]')).toBeNull();
    expect(w.document.querySelector('.lk-stage .lk-fitcard .cf2 .av-wrap')).toBeTruthy();
    expect([...w.document.querySelectorAll('.lk-zbtn')].map((b) => b.getAttribute('aria-label'))).toEqual(['Smaller', 'Bigger']);
    expect(w.document.querySelector('.lk-fitbtn')).toBeNull(); // no up/down/left/right
  });
  it('+ taps change the card and save once, after the kid stops', async () => {
    const { w, posts } = await openLocker();
    zb(w, 'Bigger').click(); zb(w, 'Bigger').click();
    expect(w.document.querySelector('.lk-stage').innerHTML).toContain('scale(1.2)');
    expect(posts.length).toBe(0);
    await wait(700);
    expect(posts.length).toBe(1);
    expect(posts[0].look).toMatchObject({ fitSize: 120 });
  });
  it('sizing re-centers a player that was moved before', async () => {
    const { w, posts } = await openLocker({ fitX: 10, fitY: 5 });
    zb(w, 'Smaller').click();
    await wait(700);
    expect(posts[0].look.fitSize).toBe(90);
    expect(posts[0].look).not.toHaveProperty('fitX');
    expect(posts[0].look).not.toHaveProperty('fitY');
  });
  it('stops at the limits', async () => {
    const { w, posts } = await openLocker();
    for (let i = 0; i < 10; i++) zb(w, 'Bigger').click();
    await wait(700);
    expect(posts[0].look.fitSize).toBe(150);
  });
  it('closing with a change still waiting saves it first', async () => {
    const { w, posts } = await openLocker();
    zb(w, 'Bigger').click();
    w.document.querySelector('.lk-x').click();
    for (let i = 0; i < 5; i++) await tick();
    expect(posts.length).toBe(1);
    expect(posts[0].look.fitSize).toBe(110);
  });
  it('a two-finger pinch sizes the player', async () => {
    const { w, posts } = await openLocker();
    const st = w.document.querySelector('.lk-stage');
    ptr(w, st, 'pointerdown', 1, 100); ptr(w, st, 'pointerdown', 2, 200);
    ptr(w, st, 'pointermove', 2, 230); // 100px apart -> 130px: 130%
    ptr(w, st, 'pointerup', 2, 230); ptr(w, st, 'pointerup', 1, 100);
    await wait(700);
    expect(posts.length).toBe(1);
    expect(posts[0].look.fitSize).toBe(130);
    expect(posts[0].look.facing).toBe('facing-left'); // a pinch never turns the player
  });
  it('the scroll wheel (or a trackpad pinch) sizes the player on desktop', async () => {
    const { w, posts } = await openLocker();
    const st = w.document.querySelector('.lk-stage');
    const e = new w.Event('wheel', { bubbles: true, cancelable: true }); Object.assign(e, { deltaY: -50, ctrlKey: false });
    st.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    await wait(700);
    expect(posts[0].look.fitSize).toBe(110);
  });
  it('a drag turns the player, and the card keeps the nearest side', async () => {
    const { w, posts } = await openLocker();
    const st = w.document.querySelector('.lk-stage');
    ptr(w, st, 'pointerdown', 1, 100); ptr(w, st, 'pointermove', 1, 160); // -25deg + 48deg = 23deg: right
    expect(st.querySelector('.av-scene').style.getPropertyValue('--av-face')).toBe('23deg');
    ptr(w, st, 'pointerup', 1, 160);
    for (let i = 0; i < 5; i++) await tick();
    expect(posts.length).toBe(1);
    expect(posts[0].look.facing).toBe('facing-right');
    expect(st.querySelector('.av-scene').style.getPropertyValue('--av-face')).toBe('25deg');
  });
  it('a tap (no drag) on the card saves nothing', async () => {
    const { w, posts } = await openLocker();
    const st = w.document.querySelector('.lk-stage');
    ptr(w, st, 'pointerdown', 1, 100); ptr(w, st, 'pointerup', 1, 102);
    for (let i = 0; i < 5; i++) await tick();
    expect(posts.length).toBe(0);
  });
});
