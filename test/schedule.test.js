// test/schedule.test.js
//
// Unit tests for lib/schedule_store.js: tolerant reads, set/ensure idempotency,
// addEvent (id assignment, dedup, chronological sort), and the pure nextEvent
// date logic (next game/tournament + next recurring practice), which had no
// direct coverage before.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FakeRedis } from './fakeRedis.js';

const fake = new FakeRedis();
vi.mock('@upstash/redis', () => ({ Redis: class { constructor() { return fake; } } }));

process.env.KV_REST_API_URL = 'https://fake';
process.env.KV_REST_API_TOKEN = 'fake';

const {
  getSchedule, setSchedule, ensureSchedule, addEvent, nextEvent, localDateStr, _seed,
} = await import('../lib/schedule_store.js');

beforeEach(() => { fake.map.clear(); });

describe('getSchedule (tolerant reads)', () => {
  it('returns an empty shape when nothing is stored', async () => {
    const s = await getSchedule('RANGERS72');
    expect(s).toEqual({ practices: [], events: [] });
  });

  it('parses a JSON string value', async () => {
    fake._seed(_seed.scheduleKey('RANGERS72'), JSON.stringify({ practices: [], events: [{ id: 'x', date: '2026-01-01' }] }));
    const s = await getSchedule('RANGERS72');
    expect(s.events[0].id).toBe('x');
  });

  it('falls back to empty on a malformed string', async () => {
    fake._seed(_seed.scheduleKey('RANGERS72'), '{not json');
    const s = await getSchedule('RANGERS72');
    expect(s).toEqual({ practices: [], events: [] });
  });

  it('normalizes the team code (case/whitespace)', async () => {
    await setSchedule('rangers72', { practices: [], events: [{ id: 'a', date: '2026-01-01' }] });
    const s = await getSchedule('  RANGERS72 ');
    expect(s.events[0].id).toBe('a');
  });
});

describe('setSchedule', () => {
  it('coerces missing arrays to empty', async () => {
    const s = await setSchedule('T', {});
    expect(s).toEqual({ practices: [], events: [] });
  });
});

describe('ensureSchedule (idempotent seed)', () => {
  it('seeds the 2026-27 schedule when none exists', async () => {
    const s = await ensureSchedule('RANGERS72');
    expect(s.events.length).toBe(_seed.SEED_2627.events.length);
    expect(s.events[0].id).toBe('g-0926');
    expect(s.practices[0].dow).toBe(3);
  });

  it('does not overwrite an existing schedule', async () => {
    await setSchedule('RANGERS72', { practices: [], events: [{ id: 'keep', date: '2027-01-01' }] });
    const s = await ensureSchedule('RANGERS72');
    expect(s.events).toEqual([{ id: 'keep', date: '2027-01-01' }]);
  });
});

describe('addEvent', () => {
  it('assigns an id when missing and keeps events chronological', async () => {
    await setSchedule('T', { practices: [], events: [] });
    await addEvent('T', { kind: 'game', date: '2026-10-05', time: '10:00', opponent: 'B' });
    const s = await addEvent('T', { kind: 'game', date: '2026-10-01', time: '09:00', opponent: 'A' });
    expect(s.events.map((e) => e.opponent)).toEqual(['A', 'B']);
    expect(s.events[0].id).toBeTruthy();
  });

  it('replaces an event with the same id (dedup, not duplicate)', async () => {
    await setSchedule('T', { practices: [], events: [] });
    await addEvent('T', { id: 'g1', date: '2026-10-01', opponent: 'Old' });
    const s = await addEvent('T', { id: 'g1', date: '2026-10-01', opponent: 'New' });
    expect(s.events.length).toBe(1);
    expect(s.events[0].opponent).toBe('New');
  });
});

describe('nextEvent (pure date logic)', () => {
  const schedule = {
    practices: [{ dow: 3, start: '18:15', end: '19:45', place: 'Home rink' }], // Wednesday
    events: [
      { id: 'past', kind: 'game', date: '2026-09-01', opponent: 'Old' },
      { id: 'soon', kind: 'game', date: '2026-09-26', time: '13:00', opponent: 'Everett' },
      { id: 'later', kind: 'game', date: '2026-10-03', time: '16:00', opponent: 'Spokane' },
      { id: 'tourney', kind: 'tournament', date: '2026-10-10', endDate: '2026-10-12', opponent: 'Richmond' },
    ],
  };

  it('picks the soonest game on/after today, skipping past ones', () => {
    const { nextGame } = nextEvent(schedule, '2026-09-20');
    expect(nextGame.id).toBe('soon');
  });

  it('still counts a game happening today', () => {
    const { nextGame } = nextEvent(schedule, '2026-09-26');
    expect(nextGame.id).toBe('soon');
  });

  it('keeps a multi-day tournament until its endDate passes', () => {
    const { nextGame } = nextEvent(schedule, '2026-10-11'); // mid-tournament
    expect(nextGame.id).toBe('tourney');
  });

  it('returns null nextGame when all events are in the past', () => {
    const { nextGame } = nextEvent(schedule, '2027-01-01');
    expect(nextGame).toBeNull();
  });

  it('finds the next recurring Wednesday practice within two weeks', () => {
    // 2026-09-21 is a Monday; the next Wednesday is 2026-09-23.
    const { nextPractice } = nextEvent(schedule, '2026-09-21');
    expect(nextPractice).toBeTruthy();
    expect(nextPractice.date).toBe('2026-09-23');
    expect(nextPractice.place).toBe('Home rink');
  });

  it('returns null nextPractice when there are no recurring practices', () => {
    const { nextPractice } = nextEvent({ practices: [], events: [] }, '2026-09-21');
    expect(nextPractice).toBeNull();
  });
});

describe('localDateStr', () => {
  it('formats a date as YYYY-MM-DD', () => {
    expect(localDateStr(new Date('2026-09-26T20:00:00Z'))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
