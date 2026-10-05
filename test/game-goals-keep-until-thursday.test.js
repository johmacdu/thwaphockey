// test/game-goals-keep-until-thursday.test.js
//
// Guards for the "keep a just-passed game's card until Thursday 06:00
// America/Vancouver, unless this player already set that game's goals" rule.
//
// index.html cannot boot under jsdom (its YouTube iframes crash it), so the pure
// date + pick helpers are exposed on window.ThwapGameDay. This test EXTRACTS that
// first IIFE from index.html and evaluates it against a stub window, then calls
// the real functions -- no string-matching for the logic under test. A second
// block string-asserts the integration wiring (per-game key read/write, ?game=
// targeting) that cannot be unit-run.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexHtml = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
const goalsHtml = readFileSync(resolve(__dirname, '../hockey_game_goals.html'), 'utf8');

// Pull the self-contained ThwapGameDay IIFE out of index.html and run it in a vm
// so the test exercises the shipped source, not a copy.
function loadGameDay() {
  const marker = 'window.ThwapGameDay={';
  const mi = indexHtml.indexOf(marker);
  if (mi === -1) throw new Error('ThwapGameDay export not found in index.html');
  const open = indexHtml.lastIndexOf('(function(){', mi);
  const close = indexHtml.indexOf('})();', mi);
  if (open === -1 || close === -1) throw new Error('could not bound the ThwapGameDay IIFE');
  const src = indexHtml.slice(open, close + '})();'.length);
  const sandbox = { window: {}, Intl, Date };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox.window.ThwapGameDay;
}

let GD;
beforeAll(() => { GD = loadGameDay(); });

describe('Vancouver Thursday 06:00 cutoff', () => {
  it('exposes the pure helpers on window.ThwapGameDay', () => {
    expect(typeof GD.thursday6amCutoffMs).toBe('function');
    expect(typeof GD.pickGameToShow).toBe('function');
    expect(typeof GD.mostRecentPastGame).toBe('function');
    expect(typeof GD.gameDoneKey).toBe('function');
  });

  it('cutoff lands on Thursday 06:00 Vancouver wall-clock', () => {
    // Sun Oct 4 2026 12:00 Vancouver -> cutoff should be Thu Oct 8 2026 06:00 Vancouver.
    const now = GD.vancouverWallMs(2026, 10, 4, 12, 0);
    const cut = GD.thursday6amCutoffMs(now);
    const p = GD.vancouverParts(cut);
    expect(p.dow).toBe(4);              // Thursday
    expect(`${p.y}-${p.m}-${p.d}`).toBe('2026-10-8');
    expect(cut).toBe(GD.vancouverWallMs(2026, 10, 8, 6, 0));
  });

  it('one minute BEFORE Thursday 6am is still in-window; one minute AFTER is past it', () => {
    const cut = GD.vancouverWallMs(2026, 10, 8, 6, 0);
    const before = cut - 60000;
    const after = cut + 60000;
    expect(before < GD.thursday6amCutoffMs(before)).toBe(true);
    expect(after < GD.thursday6amCutoffMs(after)).toBe(false);
  });
});

const EVENTS = [
  { id: 'g-1003', kind: 'game', date: '2026-10-03', time: '16:00', home: true, opponent: 'Spokane Chiefs' },
  { id: 'g-1004', kind: 'game', date: '2026-10-04', time: '12:00', home: true, opponent: 'Spokane Chiefs' },
  { id: 'g-1017', kind: 'game', date: '2026-10-17', time: '16:00', home: true, opponent: 'Tri-Cities Jr Americans' },
];
const NEXT = EVENTS[2]; // g-1017 is the upcoming nextGame as of Oct 5

describe('pickGameToShow -- passed, uncompleted game surfaces in-window', () => {
  const nowOct5 = () => GD.vancouverWallMs(2026, 10, 5, 9, 0); // Mon Oct 5 2026 09:00 Vancouver

  it('surfaces the just-passed g-1004 for a player who has NOT completed it', () => {
    const pick = GD.pickGameToShow({ events: EVENTS, nextGame: NEXT, nowMs: nowOct5(), isDone: () => false });
    expect(pick).not.toBeNull();
    expect(pick.passed).toBe(true);
    expect(pick.game.id).toBe('g-1004');
  });

  it('falls through to the upcoming nextGame once the player completed g-1004', () => {
    const pick = GD.pickGameToShow({ events: EVENTS, nextGame: NEXT, nowMs: nowOct5(), isDone: (id) => id === 'g-1004' });
    expect(pick.passed).toBe(false);
    expect(pick.game.id).toBe('g-1017');
  });

  it('is PER-PLAYER: sibling B (not done) still sees g-1004 after sibling A completed it', () => {
    const doneA = (id) => id === 'g-1004';
    const doneB = () => false;
    expect(GD.pickGameToShow({ events: EVENTS, nextGame: NEXT, nowMs: nowOct5(), isDone: doneA }).game.id).toBe('g-1017');
    expect(GD.pickGameToShow({ events: EVENTS, nextGame: NEXT, nowMs: nowOct5(), isDone: doneB }).game.id).toBe('g-1004');
  });

  it('after Thursday 6am the passed game is gone and nextGame returns', () => {
    const past = GD.vancouverWallMs(2026, 10, 8, 6, 1); // just after cutoff
    const pick = GD.pickGameToShow({ events: EVENTS, nextGame: NEXT, nowMs: past, isDone: () => false });
    expect(pick.passed).toBe(false);
    expect(pick.game.id).toBe('g-1017');
  });

  it('mostRecentPastGame picks the latest past game, not the first', () => {
    const g = GD.mostRecentPastGame(EVENTS, '2026-10-05');
    expect(g.id).toBe('g-1004');
  });

  it('gameDoneKey is per-player AND per-game', () => {
    expect(GD.gameDoneKey('lewie', 'g-1004')).toBe('thwapGameDone|lewie|g-1004');
    expect(GD.gameDoneKey('alder', 'g-1004')).not.toBe(GD.gameDoneKey('lewie', 'g-1004'));
  });
});

describe('home card integration wiring (index.html)', () => {
  it('reads completion from the per-player+per-game local key, not the old global one', () => {
    expect(indexHtml).toMatch(/function gameDone\(pid,gid\)\{[^}]*GD\.gameDoneKey\(pid,gid\)\)==='1'/);
    expect(indexHtml).toMatch(/GD\.pickGameToShow\(\{ events:sched\.events/);
    expect(indexHtml).toMatch(/isDone:function\(gid\)\{ return gameDone\(pid,gid\); \}/);
  });

  it('player id matches the shared bfPlayer-first-word-lowercased-a-z derivation', () => {
    expect(indexHtml).toMatch(/bfPlayer[^\n]*split\(\/\\s\+\/\)\[0\]\.toLowerCase\(\)\.replace\(\/\[\^a-z\]\/g,''\)/);
  });

  it('passes the chosen game id to the goals page as ?game=', () => {
    expect(indexHtml).toMatch(/hockey_game_goals\.html'\+\(gid\?\('\?game='\+encodeURIComponent\(gid\)\)/);
  });

  it('a passed game in its keep-window never shows the "next game in N days" tag', () => {
    expect(indexHtml).toMatch(/if\(!passed && hrs>48\)\{/);
  });
});

describe('goals page integration wiring (hockey_game_goals.html)', () => {
  it('reads ?game= and falls back to nextGame when absent', () => {
    expect(goalsHtml).toMatch(/URLSearchParams\(location\.search\)\.get\('game'\)/);
    expect(goalsHtml).toMatch(/function resolveTargetGame\(j\)\{[\s\S]*evs\[i\]\.id===targetGameId[\s\S]*return \(j&&j\.next&&j\.next\.nextGame\)/);
  });

  it('writes the per-player+per-game done key only when the plan is finalized', () => {
    expect(goalsHtml).toMatch(/function markGameDone\(\)\{ var pid=pgPlayerId\(\); if\(!pid\|\|!targetGameId\) return;[^}]*gameDoneKey\(pid,targetGameId\),'1'/);
    expect(goalsHtml).toMatch(/finalMode\.checked && checkedCount\(\) >= selfCap\)\{ markGameDone\(\); \}/);
  });

  it('clears the per-game key when goals are reset', () => {
    expect(goalsHtml).toMatch(/clearGameDone\(\);/);
  });

  it('goals-page player id matches the shared derivation', () => {
    expect(goalsHtml).toMatch(/function pgPlayerId\(\)\{[^}]*split\(\/\\s\+\/\)\[0\]\.toLowerCase\(\)\.replace\(\/\[\^a-z\]\/g,''\)/);
  });
});
