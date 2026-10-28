// test/goalie-client-cache.test.js
//
// The web app learns "goalie" from the server (GET /api/done -> goalie, from
// the member store's roster position) and caches it per player, so a goalie
// on any team gets Net play, not just the names in THWAP_GOALIE_NAMES.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');

async function boot(player, serverGet) {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://thwaphockey.com/?d=10282026',
    beforeParse(window) {
      window.fetch = (u, o) => {
        if (String(u).indexOf('/api/done') === 0 && (!o || o.method === 'GET') && serverGet) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(serverGet) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: false }) });
      };
      window.scrollTo = () => {};
      window.localStorage.setItem('bfPlayer', player);
    },
  });
  await new Promise((r) => setTimeout(r, 50));
  return dom.window;
}

describe('goalie flag from the server', () => {
  it('without a server answer the name list decides (Johnny yes, Gus no)', async () => {
    expect((await boot('Johnny')).thwapIsGoalie()).toBe(true);
    expect((await boot('Gus')).thwapIsGoalie()).toBe(false);
  });

  it('hydrate caches the server flag and the Shooting page turns into Net play', async () => {
    const win = await boot('Gus', { ok: true, player: 'gus', date: '2026-10-28', goalie: true, drills: [], disciplines: {} });
    await win.thwapHydrateDone();
    expect(win.localStorage.getItem('thwapGoalie|gus')).toBe('1');
    expect(win.thwapIsGoalie()).toBe(true);
    // Net play is still "coming soon", so the third list shows that state
    expect(win.document.querySelector('#shootList .soon-empty')).toBeTruthy();
  });

  it('a server "not a goalie" overrides the name list', async () => {
    const win = await boot('Johnny', { ok: true, player: 'johnny', date: '2026-10-28', goalie: false, drills: [], disciplines: {} });
    await win.thwapHydrateDone();
    expect(win.thwapIsGoalie()).toBe(false);
  });
});
