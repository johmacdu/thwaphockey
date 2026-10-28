// Player character looks: unlock ladder (lib/avatar_items.js) and the look
// endpoints routed through api/board.js (?action=look / ?action=looks).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FakeRedis } from './fakeRedis.js';

const fake = new FakeRedis();
vi.mock('@upstash/redis', () => ({ Redis: class { constructor() { return fake; } } }));

process.env.SESSION_TOKEN_SECRET = 'test-session-secret';
const { default: handler } = await import('../api/board.js');
const { mintSession } = await import('../lib/session_store.js');
const A = await import('../lib/avatar_items.js');

function makeRes() {
  return {
    statusCode: 200, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
}
function req(method, action, { player, body } = {}) {
  const headers = {};
  if (player) headers.cookie = `thwapSession=${mintSession(player, 'parent@example.com')}`;
  return { method, query: { action }, headers, body };
}
function days(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10));
  return out;
}

beforeEach(() => { fake.map.clear(); });

describe('unlock ladder', () => {
  it('a fresh player owns exactly the free starting items', () => {
    const p = A.progressFrom(null, 0);
    const owned = A.unlockedIds(p);
    expect(owned).toContain('jersey-red');
    expect(owned).not.toContain('gloves-red');
    for (const id of Object.values(A.DEFAULT_LOOK)) expect(owned).toContain(id);
  });
  it('activities unlock the early tiers, training days the big ones', () => {
    const grinder = A.progressFrom({ stick: 200 }, 3); // one huge weekend
    const owned = A.unlockedIds(grinder);
    expect(owned).toContain('stick-wood'); // 25 activities
    expect(owned).not.toContain('jersey-forest');    // needs 10 training days
    expect(owned).not.toContain('stick-gold');
    const steady = A.progressFrom({ stick: 60, shoot: 60 }, 100);
    expect(A.unlockedIds(steady)).toContain('stick-gold');
  });
  it('the discipline track counts only that discipline', () => {
    expect(A.unlockedIds(A.progressFrom({ shoot: 25 }, 1))).toContain('pose-shooting');
    expect(A.unlockedIds(A.progressFrom({ stick: 80 }, 1))).not.toContain('pose-shooting');
  });
  it('every non-start item rule has a positive target and a known slot', () => {
    for (const it of A.ITEMS) {
      expect(A.SLOTS).toContain(it.slot);
      if (it.rule.type !== 'start') expect(it.rule.n).toBeGreaterThan(0);
    }
    expect(new Set(A.ITEMS.map((i) => i.id)).size).toBe(A.ITEMS.length);
  });
  it('validateLook rejects locked, unknown and misplaced items', () => {
    const p = A.progressFrom({ stick: 4 }, 1);
    expect(A.validateLook({ gloves: 'gloves-red' }, p).ok).toBe(false);
    expect(A.validateLook({ gloves: 'nope' }, p).ok).toBe(false);
    expect(A.validateLook({ gloves: 'jersey-black' }, p).ok).toBe(false);
    const ok = A.validateLook({ jersey: 'jersey-black', bogusSlot: 'x' }, p);
    expect(ok.ok).toBe(true);
    expect(ok.look.jersey).toBe('jersey-black');
    expect(ok.look).not.toHaveProperty('bogusSlot');
  });
});

describe('look endpoints', () => {
  it('GET look needs a session', async () => {
    const res = makeRes();
    await handler(req('GET', 'look'), res);
    expect(res.statusCode).toBe(401);
  });

  it('GET look returns the default look, progress and next unlocks', async () => {
    await fake.set('player:lewie', { stick: 3, shoot: 1 });
    await fake.set('days:lewie', days(2));
    const res = makeRes();
    await handler(req('GET', 'look', { player: 'lewie' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.look).toEqual(A.DEFAULT_LOOK);
    expect(res.body.progress.activities).toBe(4);
    expect(res.body.progress.trainingDays).toBe(2);
    expect(res.body.next[0].id).toBe('gloves-red'); // 4 of 5
    expect(res.body.next[0].left).toBe(1);
  });

  it('POST look saves an owned look for the SESSION player only', async () => {
    await fake.set('player:lewie', { stick: 12 });
    const res = makeRes();
    await handler(req('POST', 'look', { player: 'lewie', body: { look: { jersey: 'jersey-white', gloves: 'gloves-red', stripe: 'stripe-centre' } } }), res);
    expect(res.statusCode).toBe(200);
    expect((await fake.get('look:lewie')).gloves).toBe('gloves-red');
    expect(await fake.get('look:teddy')).toBeFalsy();
  });

  it('POST look refuses an item the player has not earned', async () => {
    await fake.set('player:lewie', { stick: 12 });
    const res = makeRes();
    await handler(req('POST', 'look', { player: 'lewie', body: { look: { stick: 'stick-gold' } } }), res);
    expect(res.statusCode).toBe(400);
    expect(await fake.get('look:lewie')).toBeFalsy();
  });

  it('POST look needs a session', async () => {
    const res = makeRes();
    await handler(req('POST', 'look', { body: { look: {} } }), res);
    expect(res.statusCode).toBe(401);
  });

  it('GET looks is public and lists every roster player, null when unsaved', async () => {
    await fake.set('look:lewie', { ...A.DEFAULT_LOOK, jersey: 'jersey-black', junk: '<script>' });
    const res = makeRes();
    await handler(req('GET', 'looks'), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.looks.lewie.jersey).toBe('jersey-black');
    expect(res.body.looks.lewie).not.toHaveProperty('junk');
    expect(res.body.looks.teddy).toBeNull();
    expect(Object.keys(res.body.looks).length).toBe(16);
  });
});
