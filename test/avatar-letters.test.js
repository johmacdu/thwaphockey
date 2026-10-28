// Phase 4 letters on the client (avatar.js): the coach-granted C or A is drawn
// high on the chest, comes from the team letters (never the saved look), and a
// player who just got one sees "Coach gave you the C!" once on this device.
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import * as A from '../lib/avatar_items.js';

const SRC = fs.readFileSync(path.join(__dirname, '..', 'avatar.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function boot({ letters, letter, before } = {}) {
  const w = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://thwaphockey.com/', runScripts: 'outside-only' }).window;
  const progress = A.progressFrom({}, 2);
  w.fetch = (url) => {
    if (String(url).includes('action=looks')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ looks: {}, letters: letters || {} }) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'lewie', look: { ...A.DEFAULT_LOOK }, saved: true, items: A.ITEMS, progress, unlocked: A.unlockedIds(progress), next: [], letter: letter || null }) });
  };
  if (before) before(w);
  w.eval(SRC);
  return w;
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('letters on the jersey', () => {
  it('draws a C or an A on the chest, and nothing for no letter', () => {
    const w = boot();
    expect(w.thwapAvatar.html({ letter: 'C', num: '72' })).toMatch(/class='av-letter'[^>]*>C</);
    expect(w.thwapAvatar.html({ letter: 'A', num: '72' })).toMatch(/class='av-letter'[^>]*>A</);
    expect(w.thwapAvatar.html({ num: '72' })).not.toContain('av-letter');
    expect(w.thwapAvatar.html({ letter: 'Z', num: '72' })).not.toContain('av-letter');
  });

  it('cards take the letter from the team letters, never from a saved look', async () => {
    const w = boot({ letters: { lewie: 'C' }, before: (win) => win.localStorage.setItem('thwapLooks', JSON.stringify({ alder: { letter: 'C' } })) });
    for (let i = 0; i < 5; i++) await tick();
    expect(w.thwapAvatar.lookFor({ num: '72' }, 'Lewie').letter).toBe('C');
    expect(w.thwapAvatar.lookFor({ num: '9' }, 'Alder').letter).toBe(null);
    expect(JSON.parse(w.localStorage.getItem('thwapLettersCache'))).toEqual({ lewie: 'C' });
  });

  it('a player without a built look still shows their letter (starter look)', async () => {
    const w = boot({ letters: { joziah: 'A' } });
    for (let i = 0; i < 5; i++) await tick();
    expect(w.thwapAvatar.html(w.thwapAvatar.lookFor({ num: '59' }, 'Joziah'))).toMatch(/av-letter[^>]*>A</);
  });
});

describe('the kid hears about it', () => {
  it('shows "Coach gave you the C!" once, then not again', async () => {
    const w = boot({ letter: 'C' });
    await w.thwapAvatar.checkUnlocks();
    const toast = w.document.querySelector('.lk-toast');
    expect(toast.textContent).toMatch(/Coach gave you the C!/);
    expect(toast.textContent).toMatch(/You.re the captain\./);
    toast.remove();
    await w.thwapAvatar.checkUnlocks();
    expect(w.document.querySelector('.lk-toast')).toBeNull();
  });

  it('says nothing when the letter is taken off', async () => {
    const w = boot({ letter: null, before: (win) => win.localStorage.setItem('thwapLetterSeen', 'A') });
    await w.thwapAvatar.checkUnlocks();
    expect(w.document.querySelector('.lk-toast')).toBeNull();
    expect(w.localStorage.getItem('thwapLetterSeen')).toBe('');
  });
});

describe('coach edit sheet', () => {
  it('has a Letter choice (None, C, A) and saves it through set-letter only when it changed', () => {
    expect(INDEX).toMatch(/id='peLetter'/);
    expect(INDEX).toMatch(/<option value=''>None<\/option>\s*<option value='C'>C \(captain\)<\/option>\s*<option value='A'>A \(assistant captain\)<\/option>/);
    expect(INDEX).toMatch(/if\(letterNow===peLetterWas\) return res;/);
    expect(INDEX).toMatch(/postJSON\('set-letter'/);
  });
});
