// test/own-card-vs-teammate.test.js
//
// A player tapping their OWN card on the Team page must open the own-card view
// (front + theme picker + "See my stats" -> stats page), NOT the read-only
// teammate viewer that hides the stats button. Tapping a teammate stays read-only.
// Regression guard: the roster tap routed EVERY player tap (own card included)
// through openTeammateCard, which set body.viewing-teammate and hid the
// "See my stats" button, so a player had no path from their card to the stats page.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');

function bootPlayer(name) {
  const store = { bfPlayer: name };
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://x/#roster',
    beforeParse(w) {
      w.HTMLMediaElement.prototype.play = () => Promise.resolve();
      w.HTMLMediaElement.prototype.pause = () => {};
      w.scrollTo = () => {};
      w.fetch = (u) => {
        const s = String(u); let b = { ok: true };
        if (s.includes('board')) b = { players: [{ id: 'lewie', stick: 12, shoot: 8, dryland: 5, streak: 3 }] };
        else b = { ok: false };
        return Promise.resolve({ ok: true, json: () => Promise.resolve(b) });
      };
      const ls = { getItem: (k) => (k in store ? store[k] : null), setItem: () => {}, removeItem: () => {}, clear: () => {} };
      Object.defineProperty(w, 'localStorage', { value: ls, configurable: true });
      Object.defineProperty(w.document, 'cookie', { get: () => 'thwapAuth=x', set: () => {}, configurable: true });
    },
  });
  return dom.window;
}

describe('Own card vs teammate card open', () => {
  it('exposes an own-card open path distinct from the teammate viewer', () => {
    expect(html).toContain('window.thwapOpenMyCard=function');
    expect(html).toContain('tapped===mine && window.thwapOpenMyCard');
  });

  it('tapping your OWN card opens the own-card view with the stats-page button', async () => {
    const w = bootPlayer('Lewie');
    await new Promise((r) => setTimeout(r, 200));
    w.document.body.classList.add('is-authed');
    const own = w.document.querySelector('#roster-grid .pcard[data-name="Lewie"]');
    own.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 120));
    // NOT read-only teammate mode, so the "See my stats" button shows
    expect(w.document.body.classList.contains('viewing-teammate')).toBe(false);
    expect(w.getComputedStyle(w.document.getElementById('cbStatsLayer')).display).not.toBe('none');
    // and the back is the coded stats card
    expect(w.document.getElementById('cardBack').querySelector('.cb2')).toBeTruthy();
  });

  it('tapping a TEAMMATE card stays read-only (no stats-page button)', async () => {
    const w = bootPlayer('Lewie');
    await new Promise((r) => setTimeout(r, 200));
    w.document.body.classList.add('is-authed');
    const other = w.document.querySelector('#roster-grid .pcard[data-name="Liam Delatorre"]');
    other.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 120));
    expect(w.document.body.classList.contains('viewing-teammate')).toBe(true);
    expect(w.getComputedStyle(w.document.getElementById('cbStatsLayer')).display).toBe('none');
  });
});
