// My Player (avatar.js): owned items save to the server, locked items are
// try-on only and never POSTed, and a signed-out player gets a plain message.
// The entry point is the card's My Player button (#cardImageBtn); there is no
// floating button.
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import * as A from '../lib/avatar_items.js';

const SRC = fs.readFileSync(path.join(__dirname, '..', 'avatar.js'), 'utf8');
const tick = () => new Promise((r) => setTimeout(r, 0));

async function open({ status = 200, progress = A.progressFrom({ stick: 6 }, 2), saved = true, before } = {}) {
  const dom = new JSDOM("<!doctype html><html><head></head><body><button id='homePlayer'>Lewie</button><button id='cardImageBtn'>My Player</button></body></html>", { url: 'https://thwaphockey.com/?avatar=1', runScripts: 'outside-only' });
  const w = dom.window;
  const posts = [];
  const data = { id: 'lewie', look: { ...A.DEFAULT_LOOK }, saved, items: A.ITEMS, progress, unlocked: A.unlockedIds(progress), next: [] };
  w.fetch = (url, opts) => {
    if (opts && opts.method === 'POST') {
      const body = JSON.parse(opts.body);
      posts.push(body);
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ look: body.look }) });
    }
    if (String(url).includes('action=looks')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ looks: {} }) });
    return Promise.resolve({ ok: status === 200, status, json: () => Promise.resolve(data) });
  };
  w.__data = data;
  w.localStorage.setItem('thwapBuilderOffered', '1');
  if (before) before(w);
  w.eval(SRC);
  w.thwapAvatar.openLocker();
  for (let i = 0; i < 5; i++) await tick();
  return { w, posts, data };
}

describe('My Player', () => {
  it('opens with tabs and a character preview, and adds no floating button', async () => {
    const { w } = await open();
    expect(w.document.querySelector('.lk[role=dialog]')).toBeTruthy();
    expect(w.document.querySelector('.lk h2').textContent).toBe('My Player');
    expect(w.document.querySelectorAll('.lk-tab').length).toBe(13);
    expect(w.document.querySelector('.lk-stage .av-wrap')).toBeTruthy();
    expect(w.document.querySelector('.lk-btn')).toBeNull();
  });

  it('Moves tab: 8 stances, each tile drawn in its stance, Ready worn to start', async () => {
    const { w } = await open();
    w.document.querySelector('[data-tab=pose]').click();
    expect(w.document.querySelector('[data-tab=pose]').textContent).toBe('Moves');
    const tiles = w.document.querySelectorAll('.lk-item');
    expect(tiles.length).toBe(8);
    for (const t of tiles) expect(t.querySelector('.lk-mini.pose .av-wrap')).toBeTruthy();
    expect(w.document.querySelector('[data-id=pose-ready]').getAttribute('aria-pressed')).toBe('true');
    expect(w.document.querySelector('[data-id=pose-shooting]').classList.contains('locked')).toBe(true);
    expect(w.document.querySelector('[data-id=pose-shooting] .lk-sub').textContent).toBe('Finish 25 Shooting drills');
  });

  it('Moves tab: an earned stance saves; a locked one is try-on only', async () => {
    const { w, posts } = await open({ progress: A.progressFrom({ shoot: 25 }, 2) });
    w.document.querySelector('[data-tab=pose]').click();
    w.document.querySelector('[data-id=pose-dangle]').click(); // Toe drag: 35 days, locked
    for (let i = 0; i < 3; i++) await tick();
    expect(posts.length).toBe(0);
    expect(w.document.querySelector('.lk-note').textContent).toMatch(/Toe drag\. Train 35 days to unlock\./);
    expect(w.document.querySelector('.lk-stage').innerHTML).toContain('rotateZ(-14deg)'); // Toe drag's sideways lean is on the stage
    w.document.querySelector('[data-id=pose-shooting]').click(); // Snipe: earned
    for (let i = 0; i < 5; i++) await tick();
    expect(posts.length).toBe(1);
    expect(posts[0].look.pose).toBe('pose-shooting');
  });

  it('opened from the card, a saved change calls onClose instead of reloading', async () => {
    const { w } = await open();
    w.document.querySelector('.lk-x').click();
    let closed = 0;
    w.thwapAvatar.openLocker({ onClose: () => { closed++; } });
    for (let i = 0; i < 5; i++) await tick();
    w.document.querySelector('[data-tab=gloves]').click();
    w.document.querySelector('[data-id=gloves-red]').click();
    for (let i = 0; i < 5; i++) await tick();
    w.document.querySelector('.lk-x').click();
    expect(closed).toBe(1);
    expect(w.__thwapLookChanged).toBe(true);
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
    expect(w.document.querySelector('.lk-note').textContent).toMatch(/Golden Stick\. Train 100 days to unlock\. You.re at 2\./);
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

describe('first-run builder', () => {
  it('a player with no saved look gets six steps (skin, hair, hair color, jersey, shot, facing), and Done saves once', async () => {
    const { w, posts } = await open({ saved: false });
    const d = w.document;
    expect(d.querySelector('.lk-step').textContent).toMatch(/Step 1 of 6/);
    d.querySelector('[data-id=skin-s5]').click();
    expect(posts.length).toBe(0); // no save mid-build
    d.querySelector('[data-build=next]').click();
    expect(d.querySelector('.lk-step').textContent).toMatch(/Step 2 of 6.*hockey hair/i);
    d.querySelector('[data-id=hairstyle-mullet]').click();
    d.querySelector('[data-build=next]').click();
    expect(d.querySelector('.lk-step').textContent).toMatch(/Step 3 of 6.*hair color/i);
    d.querySelector('[data-build=next]').click(); // -> step 4: jersey
    expect(d.querySelector('.lk-step').textContent).toMatch(/Step 4 of 6.*jersey/i);
    d.querySelector('[data-build=next]').click(); // -> step 5: shot (handedness)
    expect(d.querySelector('.lk-step').textContent).toMatch(/Step 5 of 6.*shoot/i);
    d.querySelector('[data-build=next]').click(); // -> step 6: facing
    const done = d.querySelector('[data-build=next]');
    expect(done.textContent).toBe('Done');
    done.click();
    for (let i = 0; i < 6; i++) await tick();
    expect(posts.length).toBe(1);
    expect(posts[0].look.skin).toBe('skin-s5');
    expect(posts[0].look.hairstyle).toBe('hairstyle-mullet');
    expect(w.sessionStorage.getItem('thwapReveal')).toBe('1');
  });
  it('Back returns to the previous step', async () => {
    const { w } = await open({ saved: false });
    const d = w.document;
    d.querySelector('[data-build=next]').click();
    d.querySelector('[data-build=back]').click();
    expect(d.querySelector('.lk-step').textContent).toMatch(/Step 1 of 6/);
  });
});

describe('hair styles', () => {
  const STYLES = ['buzz', 'short', 'flow', 'lettuce', 'mullet', 'wings', 'curls', 'ponytail', 'braids', 'locs', 'afro', 'bun', 'pigtails'];
  it('every style is free from day one, even for a brand-new player', () => {
    const owned = A.unlockedIds(A.progressFrom(null, 0));
    for (const s of STYLES) expect(owned).toContain(`hairstyle-${s}`);
  });
  it('each style renders its own boxes, and an unknown style falls back to the default', async () => {
    const { w } = await open();
    const seen = new Set();
    for (const s of STYLES) {
      const h = w.thwapAvatar.html({ hairstyle: s, hair: 'blonde' });
      expect(h).toContain('#D9B163'); // the hair color is used
      seen.add(h);
    }
    expect(seen.size).toBe(STYLES.length); // no two styles draw the same thing
    expect(w.thwapAvatar.html({ hairstyle: 'nope' })).toBe(w.thwapAvatar.html({ hairstyle: 'flow' }));
  });
  it('hair style tiles show a small back view of the player', async () => {
    const { w } = await open();
    w.document.querySelector('[data-tab=hairstyle]').click();
    const tiles = w.document.querySelectorAll('.lk-item');
    expect(tiles.length).toBe(STYLES.length);
    expect(tiles[0].querySelector('.lk-mini .av-wrap')).toBeTruthy();
  });
});

describe('unlock moment', () => {
  it('shows New gear once for an item not seen on this device', async () => {
    const { w, data } = await open({ before: (win) => win.localStorage.setItem('thwapUnlockSeen', JSON.stringify(A.unlockedIds(A.progressFrom({ stick: 4 }, 1)))) });
    w.document.querySelector('.lk-x').click(); // close the Locker Room
    w.localStorage.setItem('thwapUnlockSeen', JSON.stringify(A.unlockedIds(A.progressFrom({ stick: 4 }, 1))));
    await w.thwapAvatar.checkUnlocks();
    const toast = w.document.querySelector('.lk-toast');
    expect(toast).toBeTruthy();
    expect(toast.textContent).toMatch(/New gear! Rangers Red gloves/);
    expect(w.document.querySelector('#cardImageBtn .lk-dot')).toBeTruthy();
    expect(w.document.querySelector('#homePlayer .lk-dot')).toBeNull();
    toast.remove();
    await w.thwapAvatar.checkUnlocks();
    expect(w.document.querySelector('.lk-toast')).toBeNull(); // only once
    expect(data).toBeTruthy();
  });
  it('releases moves and celebrations held back before their tabs existed', async () => {
    // 15 training days unlocks THWAP! (celebration); 25 Shooting unlocks Snipe (pose).
    // A device that saw only gear (the #447 hold) now announces both.
    const prog = A.progressFrom({ shoot: 25 }, 15);
    const { w } = await open({ progress: prog });
    w.document.querySelector('.lk-x').click();
    const gearOnly = A.unlockedIds(prog).filter((id) => !/^(pose|celebration)-/.test(id));
    w.localStorage.setItem('thwapUnlockSeen', JSON.stringify(gearOnly));
    await w.thwapAvatar.checkUnlocks();
    const toast = w.document.querySelector('.lk-toast');
    expect(toast).toBeTruthy();
    expect(toast.textContent).toMatch(/New (celly! THWAP!|move! Snipe) and 1 more/);
    const seen = JSON.parse(w.localStorage.getItem('thwapUnlockSeen'));
    expect(seen).toContain('pose-shooting');
    expect(seen).toContain('celebration-fistpump');
    const fresh = JSON.parse(w.localStorage.getItem('thwapUnlockNew'));
    expect(fresh).toContain('pose-shooting');
    expect(fresh).toContain('celebration-fistpump');
  });
  it('the first check seeds silently (past training is the builder\'s job)', async () => {
    const { w } = await open();
    w.document.querySelector('.lk-x').click();
    w.localStorage.removeItem('thwapUnlockSeen');
    await w.thwapAvatar.checkUnlocks();
    expect(w.document.querySelector('.lk-toast')).toBeNull();
    expect(JSON.parse(w.localStorage.getItem('thwapUnlockSeen'))).toContain('gloves-red');
  });
  it('wraps thwapMarkDone and checks unlocks after a completion', async () => {
    const { w } = await open();
    w.document.querySelector('.lk-x').click();
    let called = 0;
    w.thwapMarkDone = () => { called++; return Promise.resolve({ ok: true }); };
    w.eval(SRC); // re-boot hooks the new function
    expect(w.thwapMarkDone.__avHooked).toBe(true);
    await w.thwapMarkDone('stick', 'stick:0');
    expect(called).toBe(1);
  });
});

describe('card entry point (index.html)', () => {
  const INDEX = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  it('the player card image button becomes Edit player when the character is on', () => {
    expect(INDEX).toMatch(/imageBtn\.innerHTML=avOn\?'\\u270F\\uFE0F Edit player'/);
    expect(INDEX).toMatch(/if\(window\.thwapAvatar && window\.thwapAvatar\.on\(\)\)\{ window\.thwapAvatar\.openLocker\(\{onClose:function\(\)\{ buildFaces\(\); paint\(\); \}\}\); return; \}/);
  });
  it('closing the card after a look change reloads once so every card updates', () => {
    expect(INDEX).toMatch(/if\(window\.__thwapLookChanged\)\{ window\.__thwapLookChanged=false; location\.reload\(\); return; \}/);
  });
  it('exposes thwapOpenMyPlayer for the toast and the builder', () => {
    expect(INDEX).toContain('window.thwapOpenMyPlayer=function(opts){');
  });
});

describe('launch switch', () => {
  const INDEX = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  it('is ON: LIVE is true, every player sees the character', async () => {
    expect(SRC).toMatch(/\n  var LIVE=true;\n/);
    const { w } = await open();
    expect(w.thwapAvatar.live).toBe(true);
  });
  it('LIVE=true turns the character on with no preview flag', () => {
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://thwaphockey.com/', runScripts: 'outside-only' });
    dom.window.fetch = () => Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) });
    dom.window.eval(SRC.replace('var LIVE=false;', 'var LIVE=true;'));
    expect(dom.window.thwapAvatar.on()).toBe(true);
  });
  it('character on: no player photo is fetched, photo upload opens Edit player, stats photo hides', () => {
    expect(INDEX).toMatch(/window\.thwapPhotoResolve=function\(playerId, cb\)\{\n  \/\*[^\n]*\*\/\n  try\{ if\(window\.thwapAvatar && window\.thwapAvatar\.on\(\)\)\{ cb\(null\); return; \} \}catch\(_\)\{\}/);
    expect(INDEX).toMatch(/window\.thwapPhotoEdit=function\(playerId, hasPhoto, onDone\)\{\n  \/\*[^\n]*\*\/\n  try\{ if\(window\.thwapAvatar && window\.thwapAvatar\.on\(\)\)\{ window\.thwapAvatar\.openLocker\(\{onClose:onDone\}\); return; \} \}catch\(_\)\{\}/);
    expect(INDEX).toContain("if(avOn){ photo.removeAttribute('src'); photo.alt=''; photo.style.display='none'; }");
  });
});
