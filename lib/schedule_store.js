// lib/schedule_store.js
//
// Store seam for the TEAM SCHEDULE (games, tournaments, recurring practices).
// Kept OUTSIDE api/ so it does not count against Vercel's 12-function cap.
// Mirrors lib/teams_store.js: one Redis client, tolerant reads, Vancouver-local
// dates, never throws on a missing/malformed key.
//
// Data model (Upstash Redis):
//   teamSchedule:<code>  {
//     practices: [ { dow:0..6, start:'HH:MM', end:'HH:MM', place } ],  // recurring
//     events:    [ { id, kind:'game'|'tournament', date:'YYYY-MM-DD',
//                    endDate?:'YYYY-MM-DD', time?:'HH:MM', home:bool,
//                    opponent, place } ]
//   }
//
// The coach can later add events (manual) or sync from TeamSnap; both write here.

import { Redis } from '@upstash/redis';

const kv = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});

const codeNorm = (code) => String(code || '').trim().toUpperCase();
const scheduleKey = (code) => `teamSchedule:${codeNorm(code)}`;

const VANCOUVER_TZ = 'America/Vancouver';
export function localDateStr(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: VANCOUVER_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date); // YYYY-MM-DD
}

// The 2026-27 Jr Rangers 10U schedule as provided. Times in 24h local.
// Nov 21/22 had no listed time (TBD -> time omitted).
const SEED_2627 = {
  practices: [{ dow: 3, start: '18:15', end: '19:45', place: 'Home rink' }], // Wednesday
  events: [
    { id: 'g-0926', kind: 'game', date: '2026-09-26', time: '13:00', home: false, opponent: 'Everett', place: 'Everett, WA' },
    { id: 'g-0927', kind: 'game', date: '2026-09-27', time: '11:15', home: false, opponent: 'Everett', place: 'Everett, WA' },
    { id: 'g-1003', kind: 'game', date: '2026-10-03', time: '16:00', home: true, opponent: 'Spokane Chiefs', place: 'Home' },
    { id: 'g-1004', kind: 'game', date: '2026-10-04', time: '12:00', home: true, opponent: 'Spokane Chiefs', place: 'Home' },
    { id: 't-1010', kind: 'tournament', date: '2026-10-10', endDate: '2026-10-12', opponent: 'Richmond Icebreakers', place: 'Richmond' },
    { id: 'g-1017', kind: 'game', date: '2026-10-17', time: '16:00', home: true, opponent: 'Tri-Cities Jr Americans', place: 'Home' },
    { id: 'g-1018', kind: 'game', date: '2026-10-18', time: '12:00', home: true, opponent: 'Tri-Cities Jr Americans', place: 'Home' },
    { id: 'g-1031', kind: 'game', date: '2026-10-31', time: '16:00', home: true, opponent: 'Tacoma Rockets', place: 'Home' },
    { id: 'g-1101', kind: 'game', date: '2026-11-01', time: '12:00', home: true, opponent: 'Tacoma Rockets', place: 'Home' },
    { id: 't-1113', kind: 'tournament', date: '2026-11-13', endDate: '2026-11-15', opponent: 'Nuclear Meltdown', place: 'Tournament' },
    { id: 'g-1121', kind: 'game', date: '2026-11-21', home: false, opponent: 'Tri-Cities', place: 'Tri-Cities' },
    { id: 'g-1122', kind: 'game', date: '2026-11-22', home: false, opponent: 'Tri-Cities', place: 'Tri-Cities' },
    { id: 'g-1212', kind: 'game', date: '2026-12-12', time: '12:45', home: false, opponent: 'Jr Winterhawks', place: 'Jr Winterhawks' },
    { id: 'g-1213', kind: 'game', date: '2026-12-13', time: '11:10', home: false, opponent: 'Jr Winterhawks', place: 'Jr Winterhawks' },
  ],
};

export async function getSchedule(code) {
  const raw = await kv.get(scheduleKey(code));
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw === 'string') { try { const p = JSON.parse(raw); if (p && typeof p === 'object') return p; } catch { /* fall through */ } }
  return { practices: [], events: [] };
}

export async function setSchedule(code, schedule) {
  const s = {
    practices: Array.isArray(schedule && schedule.practices) ? schedule.practices : [],
    events: Array.isArray(schedule && schedule.events) ? schedule.events : [],
  };
  await kv.set(scheduleKey(code), s);
  return s;
}

// Seed the schedule once (idempotent): only writes if none exists yet.
export async function ensureSchedule(code) {
  const existing = await kv.get(scheduleKey(code));
  if (existing) return getSchedule(code);
  return setSchedule(code, SEED_2627);
}

// Add one event (manual add or TeamSnap sync). Returns the updated schedule.
export async function addEvent(code, event) {
  const s = await getSchedule(code);
  const id = event.id || ('g-' + Date.now());
  s.events = s.events.filter((e) => e.id !== id).concat([{ ...event, id }]);
  s.events.sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
  return setSchedule(code, s);
}

// The next upcoming game/tournament and the next practice, from today (Vancouver).
export function nextEvent(schedule, today = localDateStr()) {
  const events = (schedule.events || [])
    .filter((e) => (e.endDate || e.date) >= today)
    .sort((a, b) => (a.date + (a.time || '99:99')).localeCompare(b.date + (b.time || '99:99')));
  const nextGame = events[0] || null;
  // Next practice: soonest future date matching a recurring weekday.
  let nextPractice = null;
  const practices = schedule.practices || [];
  if (practices.length) {
    const base = new Date(today + 'T12:00:00');
    for (let i = 0; i < 14 && !nextPractice; i += 1) {
      const d = new Date(base.getTime() + i * 86400000);
      const dow = d.getDay();
      const p = practices.find((x) => x.dow === dow);
      if (p) nextPractice = { ...p, date: localDateStr(d) };
    }
  }
  return { nextGame, nextPractice };
}

export const _seed = { SEED_2627, scheduleKey };
