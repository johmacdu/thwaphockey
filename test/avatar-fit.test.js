// Card fit (the Size tab in My Player): the kid makes their player bigger or
// smaller and moves it on the card front. Server clamps the three numbers;
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

async function openLocker() {
  const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", { url: 'https://thwaphockey.com/?avatar=1', runScripts: 'outside-only' });
  const w = dom.window;
  const posts = [];
  const progress = A.progressFrom({}, 1);
  const data = { id: 'lewie', look: { ...A.DEFAULT_LOOK }, saved: true, items: A.ITEMS, progress, unlocked: A.unlockedIds(progress), next: [] };
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

describe('Size tab', () => {
  it('shows the controls and the player on a card front', async () => {
    const { w } = await openLocker();
    expect(w.document.querySelector('[data-tab=fit]').textContent).toBe('Size');
    const labels = [...w.document.querySelectorAll('.lk-fitbtn')].map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual(['Smaller', 'Bigger', 'Left', 'Up', 'Down', 'Right']);
    expect(w.document.querySelector('.lk-stage .lk-fitcard .cf2 .av-wrap')).toBeTruthy();
  });
  it('taps change the card and save once, after the kid stops', async () => {
    const { w, posts } = await openLocker();
    const btn = (l) => w.document.querySelector(".lk-fitbtn[aria-label='" + l + "']");
    btn('Bigger').click(); btn('Bigger').click(); btn('Up').click();
    expect(w.document.querySelector('.lk-fitsize b').textContent).toBe('120%');
    expect(w.document.querySelector('.lk-stage').innerHTML).toContain('translate(0%,-5%) scale(1.2)');
    expect(posts.length).toBe(0);
    await wait(700);
    expect(posts.length).toBe(1);
    expect(posts[0].look).toMatchObject({ fitSize: 120, fitY: 5 });
    w.document.querySelector('.lk-fitreset').click();
    await wait(700);
    expect(posts[1].look).not.toHaveProperty('fitSize');
  });
  it('stops at the limits', async () => {
    const { w } = await openLocker();
    const big = w.document.querySelector(".lk-fitbtn[aria-label='Bigger']");
    for (let i = 0; i < 10; i++) w.document.querySelector(".lk-fitbtn[aria-label='Bigger']").click();
    expect(w.document.querySelector('.lk-fitsize b').textContent).toBe('150%');
    expect(big).toBeTruthy();
  });
  it('closing with a change still waiting saves it first', async () => {
    const { w, posts } = await openLocker();
    w.document.querySelector(".lk-fitbtn[aria-label='Right']").click();
    w.document.querySelector('.lk-x').click();
    for (let i = 0; i < 5; i++) await tick();
    expect(posts.length).toBe(1);
    expect(posts[0].look.fitX).toBe(5);
  });
});
