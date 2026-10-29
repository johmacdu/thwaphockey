// Phase 4 team set (decided Oct 28 2026): each week the TEAM hits the weekly
// goal unlocks the next Rangers item in a fixed order, for everyone on the
// roster, kept forever. Catalog + rules (lib/avatar_items.js), the server's
// team-hit count (lib/look_api.js via currentTeamGoal), drawing (avatar.js),
// tabs and the "The Rangers did it!" message.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import * as A from '../lib/avatar_items.js';
import { FakeRedis } from './fakeRedis.js';

const fake = new FakeRedis();
vi.mock('@upstash/redis', () => ({ Redis: class { constructor() { return fake; } } }));
process.env.KV_REST_API_URL = 'https://fake';
process.env.KV_REST_API_TOKEN = 'fake';
process.env.SESSION_TOKEN_SECRET = 'session-secret-please-change';

const SRC = fs.readFileSync(path.join(__dirname, '..', 'avatar.js'), 'utf8');
const ORDER = ['tape-rangers', 'decal-rangers', 'socks-rangers', 'gloves-rangers', 'jersey-warmup', 'celebration-sticktap'];

describe('catalog and rules', () => {
  it('six team items, unlocking at 1..6 team goal weeks, in the decided order', () => {
    const teamItems = A.ITEMS.filter((it) => it.rule.type === 'team').sort((a, b) => a.rule.n - b.rule.n);
    expect(teamItems.map((it) => it.id)).toEqual(ORDER);
    expect(teamItems.map((it) => it.rule.n)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(teamItems.every((it) => it.tier === 'team')).toBe(true);
  });

  it('the new slots start with a free item, so every look stays complete', () => {
    expect(A.DEFAULT_LOOK).toMatchObject({ tape: 'tape-white', decal: 'decal-none', socks: 'socks-match' });
    const fresh = A.unlockedIds(A.progressFrom({}, 0));
    for (const id of ['tape-white', 'decal-none', 'socks-match']) expect(fresh).toContain(id);
  });

  it('unlocks from team hits only: the same for a kid who trained and one who did not', () => {
    const busy = A.unlockedIds(A.progressFrom({ stick: 200 }, 50, 2));
    const quiet = A.unlockedIds(A.progressFrom({}, 0, 2));
    for (const ids of [busy, quiet]) {
      expect(ids).toContain('tape-rangers');
      expect(ids).toContain('decal-rangers');
      expect(ids).not.toContain('socks-rangers');
    }
    expect(A.unlockedIds(A.progressFrom({ stick: 999 }, 999, 0))).not.toContain('tape-rangers');
  });
});

describe('the server counts team hits for every player', () => {
  beforeEach(() => { fake.map.clear(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('a hit week unlocks Rangers tape for a kid with no drills, and says what they added', async () => {
    const { handleLookGet } = await import('../lib/look_api.js');
    const { mintSession, SESSION_COOKIE } = await import('../lib/session_store.js');
    const { ROSTER } = await import('../lib/store.js');
    const busy = ROSTER[0].id, quiet = ROSTER[1].id;
    fake.map.set(`events:${busy}`, JSON.stringify(Array.from({ length: 80 }, () => ({ date: '2026-10-27', disc: 'stick' }))));
    vi.setSystemTime(new Date('2026-11-04T19:00:00Z'));
    const ask = async (id) => {
      const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(p) { this.body = p; return this; }, setHeader() {} };
      await handleLookGet({ method: 'GET', query: {}, headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(mintSession(id, 'p@example.com'))}` } }, res);
      return res.body;
    };
    const q = await ask(quiet);
    expect(q.progress.teamHits).toBe(1);
    expect(q.unlocked).toContain('tape-rangers');
    expect(q.unlocked).not.toContain('decal-rangers');
    expect(q.teamWeek).toEqual({ weekStart: '2026-10-26', goal: 75, total: 80, mine: 0 });
    expect((await ask(busy)).teamWeek.mine).toBe(80);
  });
});

function boot({ look, progress, teamWeek, before } = {}) {
  const w = new JSDOM("<!doctype html><html><head></head><body><button id='cardImageBtn'>Edit player</button></body></html>", { url: 'https://thwaphockey.com/', runScripts: 'outside-only' }).window;
  const prog = progress || A.progressFrom({}, 2);
  const data = { id: 'lewie', look: { ...A.DEFAULT_LOOK, ...(look || {}) }, saved: true, items: A.ITEMS, progress: prog, unlocked: A.unlockedIds(prog), next: [], teamWeek: teamWeek || null };
  w.fetch = (url, opts) => {
    if (opts && opts.method === 'POST') { const b = JSON.parse(opts.body); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ look: b.look }) }); }
    if (String(url).includes('action=looks')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ looks: {}, letters: {} }) });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data) });
  };
  w.localStorage.setItem('thwapBuilderOffered', '1');
  if (before) before(w);
  w.eval(SRC);
  return w;
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('drawing the team items', () => {
  const w = boot();
  const H = (look) => w.thwapAvatar.html(look);
  it('Rangers tape, decal, socks, gloves and warm-up jersey each change the player', () => {
    const base = H({});
    expect(H({ tape: 'tape-rangers' })).toContain('repeating-linear-gradient(90deg,#C8102E 0 .35em,#111111 .35em .7em)');
    expect(H({ decal: 'decal-rangers' })).toContain("class='av-decal'>R<");
    expect(H({ decal: 'decal-none' })).not.toContain('av-decal');
    expect(H({ socks: 'socks-rangers' })).not.toBe(base);
    expect(H({ gloves: 'gloves-rangers' })).toContain('linear-gradient(0deg,#C8102E 0 34%,#141414 34% 100%)');
    expect(H({ jersey: 'jersey-warmup' })).toContain('#5B6670');
  });
  it('Stick tap is a real celebration', () => {
    expect(w.thwapAvatar.CELLYS).toContain('sticktap');
  });
});

describe('My Player', () => {
  it('tape sits in the Stick group, the decal in Helmet, socks in Jersey (five groups, no new ones)', async () => {
    const w = boot();
    w.thwapAvatar.openLocker({ tab: 'stick' });
    for (let i = 0; i < 5; i++) await tick();
    expect(w.document.querySelectorAll('.lk-tab').length).toBe(5);
    expect(w.document.querySelector('[data-id=tape-rangers]')).toBeTruthy();
    w.document.querySelector('[data-tab=helmet]').click();
    expect(w.document.querySelector('[data-id=decal-rangers]')).toBeTruthy();
    w.document.querySelector('[data-tab=jersey]').click();
    expect(w.document.querySelector('[data-id=socks-rangers]')).toBeTruthy();
    expect(w.document.querySelector('[data-id=jersey-warmup] .lk-sub').textContent).toBe('5 team goal weeks');
  });

  it('a locked team item explains the team goal', async () => {
    const w = boot();
    w.thwapAvatar.openLocker({ tab: 'stick' });
    for (let i = 0; i < 5; i++) await tick();
    w.document.querySelector('[data-id=tape-rangers]').click();
    expect(w.document.querySelector('.lk-note').textContent).toBe('Rangers tape. Unlocks when the Rangers hit the weekly team goal. So far: 0.');
  });
});

describe('The Rangers did it!', () => {
  async function unlockTape(mine) {
    const prog = A.progressFrom({}, 2, 1);
    const w = boot({ progress: prog, teamWeek: { weekStart: '2026-10-26', goal: 75, total: 80, mine },
      before: (win) => win.localStorage.setItem('thwapUnlockSeen', JSON.stringify(A.unlockedIds(A.progressFrom({}, 2, 0)))) });
    await w.thwapAvatar.checkUnlocks();
    return w;
  }
  it('names the team and what this kid added', async () => {
    const w = await unlockTape(12);
    const t = w.document.querySelector('.lk-toast').textContent;
    expect(t).toMatch(/^The Rangers did it!/);
    expect(t).toMatch(/New team item: Rangers tape\. You added 12 drills\./);
  });
  it('a kid who added nothing is invited, never told "0 drills"', async () => {
    const w = await unlockTape(0);
    const t = w.document.querySelector('.lk-toast').textContent;
    expect(t).toMatch(/Train this week to help the team get the next one\./);
    expect(t).not.toMatch(/0 drills/);
  });
  it('tapping it opens the tab the item lives in (Stick, for the tape)', async () => {
    const w = await unlockTape(3);
    let opened = null;
    w.thwapOpenMyPlayer = (o) => { opened = o; };
    w.document.querySelector('.lk-toast').click();
    expect(opened).toEqual({ tab: 'stick' });
  });
});
