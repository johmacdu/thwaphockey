// Locker Room (avatar.js): owned items save to the server, locked items are
// try-on only and never POSTed, and a signed-out player gets a plain message.
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import * as A from '../lib/avatar_items.js';

const SRC = fs.readFileSync(path.join(__dirname, '..', 'avatar.js'), 'utf8');
const tick = () => new Promise((r) => setTimeout(r, 0));

async function open({ status = 200, progress = A.progressFrom({ stick: 6 }, 2) } = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://thwaphockey.com/?avatar=1', runScripts: 'outside-only' });
  const w = dom.window;
  const posts = [];
  const data = { id: 'lewie', look: { ...A.DEFAULT_LOOK }, items: A.ITEMS, progress, unlocked: A.unlockedIds(progress), next: [] };
  w.fetch = (url, opts) => {
    if (opts && opts.method === 'POST') {
      const body = JSON.parse(opts.body);
      posts.push(body);
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ look: body.look }) });
    }
    if (String(url).includes('action=looks')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ looks: {} }) });
    return Promise.resolve({ ok: status === 200, status, json: () => Promise.resolve(data) });
  };
  w.eval(SRC);
  w.thwapAvatar.openLocker();
  for (let i = 0; i < 5; i++) await tick();
  return { w, posts };
}

describe('Locker Room', () => {
  it('opens with tabs and a character preview, plus a preview entry button', async () => {
    const { w } = await open();
    expect(w.document.querySelector('.lk[role=dialog]')).toBeTruthy();
    expect(w.document.querySelectorAll('.lk-tab').length).toBe(7);
    expect(w.document.querySelector('.lk-stage .av-wrap')).toBeTruthy();
    expect(w.document.querySelector('.lk-btn')).toBeTruthy();
  });

  it('tapping an owned item saves the new look', async () => {
    const { w, posts } = await open();
    w.document.querySelector('[data-tab=gloves]').click();
    w.document.querySelector('[data-id=gloves-red]').click(); // 5 activities, owned at 6
    for (let i = 0; i < 5; i++) await tick();
    expect(posts.length).toBe(1);
    expect(posts[0].look.gloves).toBe('gloves-red');
  });

  it('tapping a locked item is try-on only, with a progress line', async () => {
    const { w, posts } = await open();
    w.document.querySelector('[data-tab=stick]').click();
    w.document.querySelector('[data-id=stick-gold]').click();
    for (let i = 0; i < 3; i++) await tick();
    expect(posts.length).toBe(0);
    expect(w.document.querySelector('.lk-note').textContent).toMatch(/Unlocks at 100 training days\. You.re at 2\./);
  });

  it('tells a signed-out player to sign in', async () => {
    const { w } = await open({ status: 401 });
    expect(w.document.querySelector('.lk-grid').textContent).toMatch(/Sign in to build your player/);
  });

  it('Escape closes it', async () => {
    const { w } = await open();
    w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' }));
    expect(w.document.querySelector('.lk')).toBeNull();
  });
});
