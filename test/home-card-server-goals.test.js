// test/home-card-server-goals.test.js
//
// The player Home next-game card reads Game Day Goals from the server
// (GET /api/coach?action=my-game-goals) when signed in, so picks saved on
// another device (or the watch) show on this one. localStorage stays the
// offline / signed-out fallback, and the merge never shows less than the
// browser already knows.
//
// index.html cannot boot under jsdom (its YouTube iframes crash it), so this
// test EXTRACTS the real ThwapGameDay helpers and the real card IIFE from
// index.html, plus the card's own markup, and runs them in a jsdom window with
// a stubbed fetch. Nothing under test is a copy.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');

function sliceIife(markerText) {
  const mi = html.indexOf(markerText);
  if (mi === -1) throw new Error('marker not found: ' + markerText);
  const open = html.lastIndexOf('(function(){', mi);
  return { open, mi };
}

// ThwapGameDay helpers: the IIFE that ends with the window.ThwapGameDay export.
function gameDaySrc() {
  const { open, mi } = sliceIife('window.ThwapGameDay={');
  const close = html.indexOf('})();', mi);
  return html.slice(open, close + '})();'.length);
}

// The card IIFE: starts at the pNextGame lookup, ends before the coach #home guard.
function cardSrc() {
  const { open } = sliceIife("var card=document.getElementById('pNextGame')");
  const stop = html.indexOf('/* A coach must never land on #home', open);
  const close = html.lastIndexOf('})();', stop);
  return html.slice(open, close + '})();'.length);
}

// The card's own markup (tag + card) straight from index.html.
function cardMarkup() {
  const t0 = html.indexOf("<div class='nextgame-tag' id='nextGameTag'");
  const c0 = html.indexOf("<a class='pnextgame' id='pNextGame'");
  const c1 = html.indexOf('</a>', c0) + '</a>'.length;
  const tagEnd = html.indexOf('</div>', html.indexOf("id='ngtText'", t0)) + '</div>'.length;
  return html.slice(t0, tagEnd) + html.slice(c0, c1);
}

function ymd(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function dayOffset(n) { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n); return ymd(d); }

const NEXT = () => ({ id: 'g-next', kind: 'game', date: dayOffset(1), time: '16:00', home: true, opponent: 'Tacoma Rockets', place: 'Rink 1' });
const PAST = () => ({ id: 'g-past', kind: 'game', date: dayOffset(-1), time: '12:00', home: false, opponent: 'Spokane Chiefs' });
const GOALS = [
  { id: 'g1', title: 'Win Puck Battles', emoji: '💪', cue: 'x' },
  { id: 'g2', title: 'Head Up on the Puck', emoji: '👀', cue: 'x' },
  { id: 'g3', title: 'Five Clean Passes', emoji: '🎯', cue: 'x' },
];
const serverBody = (game, goals, extra = {}) => ({
  ok: true, playerId: 'lewie', gameDay: false, game: { id: game.id }, goals,
  saved: goals.length > 0, savedAt: goals.length ? 1 : null, teamGoal: null, max: 3, ...extra,
});

// Boot the card. opts: { signedIn, local: {gameId:'1'}, events, nextGame,
// server: (gameId) => ({status, body}) }
async function boot(opts = {}) {
  const dom = new JSDOM('<!doctype html><body>' + cardMarkup() + '</body>', {
    url: 'https://thwaphockey.com/', runScripts: 'outside-only',
  });
  const w = dom.window;
  w.localStorage.setItem('bfPlayer', 'Lewie MacDuffie');
  for (const [gid, v] of Object.entries(opts.local || {})) w.localStorage.setItem('thwapGameDone|lewie|' + gid, v);
  if (opts.signedIn) w.document.cookie = 'thwapAuth=lewie%7C72; path=/';
  const calls = [];
  const next = opts.nextGame === undefined ? NEXT() : opts.nextGame;
  const events = opts.events || [next].filter(Boolean);
  const reply = (status, body) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });
  w.fetch = (url, init) => {
    calls.push({ url: String(url), init: init || {} });
    const u = new URL(String(url), 'https://thwaphockey.com/');
    const action = u.searchParams.get('action');
    if (action === 'schedule') return reply(200, { ok: true, schedule: { events }, next: { nextGame: next } });
    if (action === 'team-goal') return reply(200, { ok: true, teamGoal: null });
    if (action === 'my-game-goals') {
      if (!opts.server) return reply(401, { error: 'session required' });
      const r = opts.server(u.searchParams.get('gameId'));
      if (r === 'offline') return Promise.reject(new TypeError('Failed to fetch'));
      return reply(r.status || 200, r.body);
    }
    return reply(404, {});
  };
  w.eval(gameDaySrc());
  w.eval(cardSrc());
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
  const $ = (id) => w.document.getElementById(id);
  const picks = () => Array.from($('pngPicks') ? $('pngPicks').querySelectorAll('li') : []).map((li) => li.textContent);
  const goalCalls = calls.filter((c) => c.url.includes('action=my-game-goals'));
  return { w, $, picks, calls, goalCalls };
}

describe('ThwapGameDay server merge helpers', () => {
  let GD;
  const load = () => {
    const dom = new JSDOM('', { runScripts: 'outside-only' });
    dom.window.eval(gameDaySrc());
    return dom.window.ThwapGameDay;
  };
  it('serverGameState reads picks and done for THIS game only', () => {
    GD = load();
    const st = GD.serverGameState(serverBody(NEXT(), GOALS), 'lewie', 'g-next');
    expect(st.done).toBe(true);
    expect(st.goals.map((g) => g.id)).toEqual(['g1', 'g2', 'g3']);
    expect(GD.serverGameState(serverBody(NEXT(), GOALS), 'lewie', 'other')).toBeNull();
    expect(GD.serverGameState(serverBody(NEXT(), GOALS), 'alder', 'g-next')).toBeNull();
    expect(GD.serverGameState(null, 'lewie', 'g-next')).toBeNull();
    expect(GD.serverGameState({ error: 'x' }, 'lewie', 'g-next')).toBeNull();
  });
  it('a partial plan is saved but not done', () => {
    GD = load();
    const st = GD.serverGameState(serverBody(NEXT(), GOALS.slice(0, 2)), 'lewie', 'g-next');
    expect(st.saved).toBe(true);
    expect(st.done).toBe(false);
  });
  it('mergeGameState never drops a local done mark', () => {
    GD = load();
    expect(GD.mergeGameState(true, { done: false, goals: [] }).done).toBe(true);
    expect(GD.mergeGameState(false, { done: true, goals: [] }).done).toBe(true);
    expect(GD.mergeGameState(true, null)).toEqual({ done: true, goals: [] });
  });
});

describe('Home next-game card reads Game Day Goals from the server', () => {
  it('signed in: shows the server picks and done state for the next game', async () => {
    const r = await boot({ signedIn: true, server: () => ({ body: serverBody(NEXT(), GOALS) }) });
    expect(r.$('pNextGame').hidden).toBe(false);
    expect(r.picks()).toEqual(['💪Win Puck Battles', '👀Head Up on the Puck', '🎯Five Clean Passes']);
    expect(r.$('pngPicks').hidden).toBe(false);
    expect(r.$('pngCta').textContent).toBe('Your game goals are set');
    expect(r.$('pngCta').classList.contains('png-cta-done')).toBe(true);
    expect(r.goalCalls).toHaveLength(1);
    expect(r.goalCalls[0].url).toContain('gameId=g-next');
    expect(r.goalCalls[0].init.credentials).toBe('include');
  });

  it('picks saved on another device appear here even with nothing in this browser', async () => {
    const r = await boot({ signedIn: true, server: () => ({ body: serverBody(NEXT(), GOALS.slice(0, 2)) }) });
    expect(r.w.localStorage.getItem('thwapGameDone|lewie|g-next')).toBeNull();
    expect(r.picks()).toEqual(['💪Win Puck Battles', '👀Head Up on the Puck']);
    // Two of three is not a full plan yet.
    expect(r.$('pngCta').textContent).toBe('Set your game goals');
  });

  it('401: falls back to localStorage exactly as before', async () => {
    const done = await boot({ signedIn: true, local: { 'g-next': '1' }, server: () => ({ status: 401, body: { error: 'session required' } }) });
    expect(done.$('pngCta').textContent).toBe('Your game goals are set');
    expect(done.$('pngPicks').hidden).toBe(true);
    const notDone = await boot({ signedIn: true, server: () => ({ status: 401, body: { error: 'session required' } }) });
    expect(notDone.$('pngCta').textContent).toBe('Set your game goals');
    expect(notDone.picks()).toEqual([]);
  });

  it('offline: falls back to localStorage', async () => {
    const r = await boot({ signedIn: true, local: { 'g-next': '1' }, server: () => 'offline' });
    expect(r.$('pngCta').textContent).toBe('Your game goals are set');
    expect(r.$('pngPicks').hidden).toBe(true);
  });

  it('merge keeps a local-only done mark when the server has no plan', async () => {
    const r = await boot({ signedIn: true, local: { 'g-next': '1' }, server: () => ({ body: serverBody(NEXT(), []) }) });
    expect(r.goalCalls).toHaveLength(1);
    expect(r.$('pngCta').textContent).toBe('Your game goals are set');
    expect(r.$('pngCta').classList.contains('png-cta-done')).toBe(true);
  });

  it('signed out: no my-game-goals request at all', async () => {
    const r = await boot({ signedIn: false, local: { 'g-next': '1' }, server: () => ({ body: serverBody(NEXT(), GOALS) }) });
    expect(r.goalCalls).toHaveLength(0);
    expect(r.$('pngCta').textContent).toBe('Your game goals are set');
    expect(r.picks()).toEqual([]);
  });

  it('ignores a server body for a different game', async () => {
    const r = await boot({ signedIn: true, server: () => ({ body: serverBody({ id: 'g-else' }, GOALS) }) });
    expect(r.picks()).toEqual([]);
    expect(r.$('pngCta').textContent).toBe('Set your game goals');
  });

  it('a just-passed game finished on another device moves on to the upcoming game', async () => {
    const past = PAST(), next = NEXT();
    const r = await boot({
      signedIn: true, events: [past, next], nextGame: next,
      server: (gid) => ({ body: gid === 'g-past' ? serverBody(past, GOALS) : serverBody(next, GOALS.slice(0, 1)) }),
    });
    expect(r.goalCalls.map((c) => new URL(c.url, 'https://x/').searchParams.get('gameId'))).toEqual(['g-past', 'g-next']);
    expect(r.$('pngOpp').textContent).toBe('Game vs Tacoma Rockets');
    expect(r.$('pNextGame').getAttribute('href')).toBe('hockey_game_goals.html?game=g-next');
    expect(r.picks()).toEqual(['💪Win Puck Battles']);
  });

  it('a game more than 48h out shows the tag and skips the server read', async () => {
    const far = { ...NEXT(), date: dayOffset(5) };
    const r = await boot({ signedIn: true, nextGame: far, server: () => ({ body: serverBody(far, GOALS) }) });
    expect(r.$('pNextGame').hidden).toBe(true);
    expect(r.$('nextGameTag').hidden).toBe(false);
    expect(r.goalCalls).toHaveLength(0);
  });
});
