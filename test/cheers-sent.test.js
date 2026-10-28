// test/cheers-sent.test.js
//
// Hype Squad: sendCheer counts cheers SENT per season, only when a cheer lands.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FakeRedis } from './fakeRedis.js';

const fake = new FakeRedis();
vi.mock('@upstash/redis', () => ({ Redis: class { constructor() { return fake; } } }));

const store = await import('../lib/store.js');

beforeEach(() => {
  fake.map.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-27T20:00:00.000Z'));
});
afterEach(() => vi.useRealTimers());

describe('cheers sent', () => {
  it('counts each landed cheer for the sender this season', async () => {
    expect(await store.getCheersSent('lewie')).toBe(0);
    await store.sendCheer('lewie', 'william');
    await store.sendCheer('lewie', 'alder');
    expect(await store.getCheersSent('lewie')).toBe(2);
    expect(fake.map.has('cheersent:fw-2026:lewie')).toBe(true);
    expect(await store.getCheersSent('william')).toBe(0);
  });

  it('does not count a same-day repeat, a self-cheer, or a bad id', async () => {
    await store.sendCheer('lewie', 'william');
    await store.sendCheer('lewie', 'william');
    await store.sendCheer('lewie', 'lewie');
    await store.sendCheer('lewie', 'nobody');
    expect(await store.getCheersSent('lewie')).toBe(1);
  });

  it('a new season starts at zero', async () => {
    await store.sendCheer('lewie', 'william');
    vi.setSystemTime(new Date('2027-09-02T20:00:00.000Z'));
    expect(await store.getCheersSent('lewie')).toBe(0);
  });
});

describe('event history cap', () => {
  it('holds a full season of drills (2000)', async () => {
    expect(store.EVENTS_CAP).toBe(2000);
    fake._seed('events:lewie', Array.from({ length: 1999 }, () => ({ date: '2026-10-01', disc: 'stick' })));
    await store.bumpPlayer('lewie', 'stick');
    await store.bumpPlayer('lewie', 'stick');
    expect((await store.getDrillEvents('lewie')).length).toBe(2000);
  });
});
