// test/journey-store.test.js
//
// Store reads behind the Season Book, and the Hype Squad counter's failure
// handling. Upstash can hand back JSON arrays or raw strings, and a write can
// fail mid-cheer; neither may break a kid's book or their cheer.

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
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('getTrainingDays / getDrillEvents', () => {
  it('return [] for a player with no history', async () => {
    expect(await store.getTrainingDays('lewie')).toEqual([]);
    expect(await store.getDrillEvents('lewie')).toEqual([]);
  });

  it('accept arrays stored as JSON strings', async () => {
    fake._seed('days:lewie', JSON.stringify(['2026-10-01']));
    fake._seed('events:lewie', JSON.stringify([{ date: '2026-10-01', disc: 'stick' }]));
    expect(await store.getTrainingDays('lewie')).toEqual(['2026-10-01']);
    expect(await store.getDrillEvents('lewie')).toEqual([{ date: '2026-10-01', disc: 'stick' }]);
  });

  it('treat corrupt values as empty instead of throwing', async () => {
    fake._seed('days:lewie', '{not json');
    fake._seed('events:lewie', 42);
    expect(await store.getTrainingDays('lewie')).toEqual([]);
    expect(await store.getDrillEvents('lewie')).toEqual([]);
  });

  it('are case-insensitive on the player id', async () => {
    fake._seed('days:lewie', ['2026-10-01']);
    expect(await store.getTrainingDays('LEWIE')).toEqual(['2026-10-01']);
  });

  it('a drill done today lands in both, with its type', async () => {
    await store.bumpPlayer('lewie', 'pass');
    expect(await store.getTrainingDays('lewie')).toEqual(['2026-10-27']);
    expect(await store.getDrillEvents('lewie')).toEqual([{ date: '2026-10-27', disc: 'pass' }]);
  });

  it('the history cap keeps the newest events', async () => {
    fake._seed('events:lewie', [
      { date: '2026-09-01', disc: 'shoot' },
      ...Array.from({ length: store.EVENTS_CAP - 1 }, () => ({ date: '2026-10-01', disc: 'stick' })),
    ]);
    await store.bumpPlayer('lewie', 'iq');
    const events = await store.getDrillEvents('lewie');
    expect(events).toHaveLength(store.EVENTS_CAP);
    expect(events[0].disc).toBe('stick'); // the oldest one went
    expect(events[events.length - 1]).toEqual({ date: '2026-10-27', disc: 'iq' });
  });
});

describe('getCheersSent', () => {
  it('reads a count stored as a string', async () => {
    fake._seed('cheersent:fw-2026:lewie', '7');
    expect(await store.getCheersSent('lewie')).toBe(7);
  });

  it('treats junk as 0', async () => {
    fake._seed('cheersent:fw-2026:lewie', 'lots');
    expect(await store.getCheersSent('lewie')).toBe(0);
  });

  it('a January cheer counts toward the season that began in September', async () => {
    vi.setSystemTime(new Date('2027-01-15T20:00:00.000Z'));
    await store.sendCheer('lewie', 'william');
    expect(fake.map.has('cheersent:fw-2026:lewie')).toBe(true);
  });
});

describe('sendCheer when the sent-count write fails', () => {
  it('still lands the cheer for the teammate', async () => {
    const realSet = fake.set.bind(fake);
    vi.spyOn(fake, 'set').mockImplementation((k, v, ...rest) => {
      if (String(k).startsWith('cheersent:')) return Promise.reject(new Error('down'));
      return realSet(k, v, ...rest);
    });
    const r = await store.sendCheer('lewie', 'william');
    expect(r).toEqual({ ok: true, count: 1 });
    expect(await store.getCheers('william')).toBe(1);
    expect(await store.getCheersSent('lewie')).toBe(0);
  });
});
