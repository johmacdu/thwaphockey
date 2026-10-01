// test/per-drill-sync.test.js
//
// Guards for OPTION B: full per-drill cross-device completion sync.
//   - lib/store: addDrillDone / getDrillDone / removeDrillDone round-trip, set
//     semantics, no cross-contamination of the aggregate count.
//   - api/done POST: carries a drillId alongside the bump (backward-compatible
//     when omitted); undo removes the drill id WITHOUT changing the count.
//   - api/done GET: returns the SESSION player's drills, keyed off the session,
//     never a client-sent id (no spoofing).
//
// The store is faked (in-memory FakeRedis) so writes/reads actually persist.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FakeRedis } from './fakeRedis.js';

const fake = new FakeRedis();
vi.mock('@upstash/redis', () => ({
  Redis: class {
    constructor() {
      return fake;
    }
  },
}));

process.env.SESSION_TOKEN_SECRET = 'test-session-secret';
const store = await import('../lib/store.js');
const { default: handler } = await import('../api/done.js');
const { mintSession } = await import('../lib/session_store.js');

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
}
const postAs = (body, token) => ({ method: 'POST', body, headers: { cookie: `thwapSession=${token}` } });
const getAs = (token) => ({ method: 'GET', headers: { cookie: `thwapSession=${token}` } });

beforeEach(() => {
  fake.map.clear();
});

describe('lib/store per-drill done helpers', () => {
  const DATE = '2026-10-01';

  it('a fresh player has no completed drills for a day', async () => {
    expect(await store.getDrillDone('lewie', DATE)).toEqual([]);
  });

  it('addDrillDone stores and getDrillDone returns the drill id', async () => {
    await store.addDrillDone('lewie', 'stick:0', DATE);
    expect(await store.getDrillDone('lewie', DATE)).toEqual(['stick:0']);
  });

  it('adding the same drill id twice is a no-op (set semantics)', async () => {
    await store.addDrillDone('lewie', 'stick:0', DATE);
    await store.addDrillDone('lewie', 'stick:0', DATE);
    expect(await store.getDrillDone('lewie', DATE)).toEqual(['stick:0']);
  });

  it('removeDrillDone takes a drill id back out', async () => {
    await store.addDrillDone('lewie', 'stick:0', DATE);
    await store.addDrillDone('lewie', 'dryland:1', DATE);
    await store.removeDrillDone('lewie', 'stick:0', DATE);
    expect(await store.getDrillDone('lewie', DATE)).toEqual(['dryland:1']);
  });

  it('removing an id that was never there is a safe no-op', async () => {
    await store.addDrillDone('lewie', 'stick:0', DATE);
    await store.removeDrillDone('lewie', 'shoot:9', DATE);
    expect(await store.getDrillDone('lewie', DATE)).toEqual(['stick:0']);
  });

  it('one player drills never leak into another player set', async () => {
    await store.addDrillDone('lewie', 'stick:0', DATE);
    await store.addDrillDone('william', 'shoot:2', DATE);
    expect(await store.getDrillDone('lewie', DATE)).toEqual(['stick:0']);
    expect(await store.getDrillDone('william', DATE)).toEqual(['shoot:2']);
  });

  it('a blank drill id is ignored (never stored)', async () => {
    await store.addDrillDone('lewie', '', DATE);
    await store.addDrillDone('lewie', '   ', DATE);
    expect(await store.getDrillDone('lewie', DATE)).toEqual([]);
  });
});

describe('api/done POST carries a drill id (backward-compatible)', () => {
  it('a mark WITHOUT drillId still bumps the count (old clients)', async () => {
    const res = makeRes();
    const token = mintSession('lewie', 'p@e.com');
    await handler(postAs({ player: 'lewie', discipline: 'stick' }, token), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.player.stick).toBe(1);
    // no drill set written when no drillId is sent
    expect(res.body.drills).toBeNull();
  });

  it('a mark WITH drillId bumps the count AND records the drill id', async () => {
    const res = makeRes();
    const token = mintSession('lewie', 'p@e.com');
    await handler(postAs({ player: 'lewie', discipline: 'stick', drillId: 'stick:1' }, token), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.player.stick).toBe(1);
    expect(res.body.drills).toEqual(['stick:1']);
    expect(await store.getDrillDone('lewie')).toEqual(['stick:1']);
  });

  it('undo removes the drill id WITHOUT changing the aggregate count', async () => {
    const token = mintSession('lewie', 'p@e.com');
    // mark two drills
    await handler(postAs({ player: 'lewie', discipline: 'stick', drillId: 'stick:0' }, token), makeRes());
    await handler(postAs({ player: 'lewie', discipline: 'stick', drillId: 'stick:1' }, token), makeRes());
    const countBefore = fake.map.get('player:lewie').stick;
    expect(countBefore).toBe(2);
    // un-mark one
    const res = makeRes();
    await handler(postAs({ player: 'lewie', drillId: 'stick:0', undo: true }, token), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.undo).toBe(true);
    expect(res.body.drills).toEqual(['stick:1']);
    // the count is UNTOUCHED by an undo (earned work stays earned)
    expect(fake.map.get('player:lewie').stick).toBe(2);
  });

  it('undo without a drillId is a 400', async () => {
    const res = makeRes();
    const token = mintSession('lewie', 'p@e.com');
    await handler(postAs({ player: 'lewie', undo: true }, token), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('drillId required for undo');
  });

  it('a drill mark still obeys the position gate (goalie cannot bump shoot)', async () => {
    const res = makeRes();
    const token = mintSession('johnny', 'p@e.com');
    await handler(postAs({ player: 'johnny', discipline: 'shoot', drillId: 'shoot:0' }, token), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('discipline not for this position');
    // nothing recorded
    expect(await store.getDrillDone('johnny')).toEqual([]);
  });
});

describe('api/done GET is keyed off the SESSION, never a client id', () => {
  it('returns the signed-in player drills for today', async () => {
    const token = mintSession('lewie', 'p@e.com');
    await handler(postAs({ player: 'lewie', discipline: 'stick', drillId: 'stick:0' }, token), makeRes());
    await handler(postAs({ player: 'lewie', discipline: 'dryland', drillId: 'dryland:2' }, token), makeRes());
    const res = makeRes();
    await handler(getAs(token), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.player).toBe('lewie');
    expect(res.body.drills.sort()).toEqual(['dryland:2', 'stick:0']);
    // disciplines rollup names each discipline that has at least one drill
    expect(res.body.disciplines.stick).toBe(true);
    expect(res.body.disciplines.dryland).toBe(true);
  });

  it('a GET returns ONLY the session player drills, not another player', async () => {
    const lewieTok = mintSession('lewie', 'p@e.com');
    const williamTok = mintSession('william', 'p@e.com');
    await handler(postAs({ player: 'lewie', discipline: 'stick', drillId: 'stick:0' }, lewieTok), makeRes());
    await handler(postAs({ player: 'william', discipline: 'shoot', drillId: 'shoot:1' }, williamTok), makeRes());
    // William session must see only William drills, regardless of any client id
    const res = makeRes();
    await handler(getAs(williamTok), res);
    expect(res.body.player).toBe('william');
    expect(res.body.drills).toEqual(['shoot:1']);
  });

  it('a GET with no session is rejected (401)', async () => {
    const res = makeRes();
    await handler({ method: 'GET' }, res);
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe('session required');
  });
});
