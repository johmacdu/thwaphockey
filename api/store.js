// api/store.js
//
// Data-store abstraction for Thwap Hockey.
//
// SWAP SEAM: This is the ONLY file that talks to the backing store (Upstash Redis
// via @upstash/redis). Every store call lives here. To move to Supabase (or any
// other backend) later, reimplement getPlayer / setPlayer / listPlayers /
// bumpPlayer / computeStreak / weekCount / weekBoard in this file against the new
// client. No other file (board.js, done.js, seed.js) references the store
// directly, so nothing else needs to change.
//
// Data model:
//   Key:   player:<id>            (id = lowercase first name, e.g. "lewie")
//   Value: { stick, shoot, dryland, streak, stickers, updatedAt }
//
//   Key:   days:<id>              per-player list of active local dates
//   Value: JSON array of ISO date strings 'YYYY-MM-DD' (America/Vancouver local),
//          used to compute honest consecutive-day streaks.
//
//   Key:   events:<id>            per-player list of dated discipline events
//   Value: JSON array of { date:'YYYY-MM-DD', disc:'stick|shoot|dryland' },
//          appended on each bump, capped to the last EVENTS_CAP events. This is
//          what makes a TRUE weekly discipline split possible (the player:<id>
//          value only holds cumulative all-time counts, not per-day counts).

import { Redis } from '@upstash/redis';

// The Vercel Upstash integration injects either KV_REST_API_* or UPSTASH_REDIS_REST_*.
// Accept whichever is present so the same code works regardless of the integration's naming.
const kv = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});

// --- Roster: single source of truth (name + jersey number) -----------------
// id is the lowercase first name; number is used by done.js to derive the PIN.
export const ROSTER = [
  { id: 'alder',    name: 'Alder',    number: 71 },
  { id: 'brooklyn', name: 'Brooklyn', number: 92 },
  { id: 'dawson',   name: 'Dawson',   number: 19 },
  { id: 'dominic',  name: 'Dominic',  number: 98 },
  { id: 'eugene',   name: 'Eugene',   number: 3  },
  { id: 'evan',     name: 'Evan',     number: 13 },
  { id: 'greyson',  name: 'Greyson',  number: 32 },
  { id: 'johnny',   name: 'Johnny',   number: 1  },
  { id: 'joziah',   name: 'Joziah',   number: 59 },
  { id: 'lewie',    name: 'Lewie',    number: 72 },
  { id: 'liam',     name: 'Liam',     number: 29 },
  { id: 'maddux',   name: 'Maddux',   number: 18 },
  { id: 'oliver',   name: 'Oliver',   number: 90 },
  { id: 'teddy',    name: 'Teddy',    number: 11 },
  { id: 'william',  name: 'William',  number: 16 },
  { id: 'issac',    name: 'Issac',    number: 53 },
];

// Valid discipline counts that can be incremented via done.js.
export const DISCIPLINES = ['stick', 'shoot', 'dryland'];

// Cap the per-player events log so storage stays bounded.
const EVENTS_CAP = 400;

// Shape of a freshly-seeded player (all counts zeroed).
function zeroCounts() {
  return { stick: 0, shoot: 0, dryland: 0, streak: 0, stickers: 0, updatedAt: null };
}

const keyFor = (id) => `player:${String(id).toLowerCase()}`;
const daysKeyFor = (id) => `days:${String(id).toLowerCase()}`;
const eventsKeyFor = (id) => `events:${String(id).toLowerCase()}`;

// --- Local-date helpers (America/Vancouver) ---------------------------------
// The team is in Vancouver. Raw UTC would roll over at 4-5pm local, so an
// evening practice would get counted as the next day. We derive the local
// calendar date explicitly via Intl instead of trusting the server clock's zone.

const VANCOUVER_TZ = 'America/Vancouver';

// Return the 'YYYY-MM-DD' local date in Vancouver for the given Date (default now).
// en-CA formats as YYYY-MM-DD, which is exactly the shape we store.
function localDateStr(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: VANCOUVER_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(date);
}

// Parse a 'YYYY-MM-DD' string into a UTC-midnight Date. We only ever diff two
// such values by whole days, so anchoring both at UTC midnight makes the day
// arithmetic exact and free of DST hour drift.
function dateFromStr(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

// Whole-day difference a - b (both 'YYYY-MM-DD'). Positive means a is later.
function dayDiff(a, b) {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round((dateFromStr(a).getTime() - dateFromStr(b).getTime()) / MS_PER_DAY);
}

// --- Internal read helpers for the auxiliary keys ---------------------------
// Both days:<id> and events:<id> are stored as JSON arrays. Upstash may hand
// back either a parsed array (auto-deserialize) or a raw string; normalize both,
// and never throw on a missing / malformed key (fresh player -> empty array).
function asArray(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function getDays(id) {
  return asArray(await kv.get(daysKeyFor(id)));
}

async function getEvents(id) {
  return asArray(await kv.get(eventsKeyFor(id)));
}

// --- Store API --------------------------------------------------------------

// Read one player's counts. Returns null if the player has never been stored.
export async function getPlayer(id) {
  const data = await kv.get(keyFor(id));
  return data || null;
}

// Overwrite one player's counts with the given object.
export async function setPlayer(id, obj) {
  await kv.set(keyFor(id), obj);
  return obj;
}

// Compute the current consecutive-day streak for a player.
// Rules: count back from the most recent active day only if that day is today
// or yesterday (a streak should not break just because today is not done yet).
// If the most recent active day is older than yesterday, the streak is 0.
// Consecutive means no gaps between local calendar days.
export async function computeStreak(id) {
  const days = await getDays(id);
  if (!days.length) return 0;

  // Unique, sorted ascending so we can walk backwards from the latest day.
  const sorted = Array.from(new Set(days)).sort();
  const today = localDateStr();
  const latest = sorted[sorted.length - 1];

  const gapToLatest = dayDiff(today, latest); // 0 = today, 1 = yesterday
  if (gapToLatest > 1 || gapToLatest < 0) return 0;

  let streak = 1;
  for (let i = sorted.length - 2; i >= 0; i -= 1) {
    if (dayDiff(sorted[i + 1], sorted[i]) === 1) {
      streak += 1;
    } else {
      break;
    }
  }
  return streak;
}

// --- Week definition --------------------------------------------------------
// Week is Monday-based (ISO): the current week runs from the most recent Monday
// (00:00 local) through today, inclusive. Chosen over a rolling last-7-days
// window so "this week" resets on Monday the way a hockey week is planned.

// Return the 'YYYY-MM-DD' of the Monday that starts the local week containing today.
function weekStartStr() {
  const today = localDateStr();
  const anchor = dateFromStr(today);
  // getUTCDay: 0 = Sunday .. 6 = Saturday. Convert to Monday-based offset.
  const dow = anchor.getUTCDay();
  const backToMonday = (dow + 6) % 7; // Mon->0, Tue->1, ... Sun->6
  anchor.setUTCDate(anchor.getUTCDate() - backToMonday);
  const y = anchor.getUTCFullYear();
  const m = String(anchor.getUTCMonth() + 1).padStart(2, '0');
  const d = String(anchor.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Sum a player's dated discipline events falling within the current Monday-based
// week. Returns { stick, shoot, dryland }, all zero for a fresh player.
export async function weekCount(id) {
  const events = await getEvents(id);
  const start = weekStartStr();
  const today = localDateStr();
  const out = { stick: 0, shoot: 0, dryland: 0 };
  for (const ev of events) {
    if (!ev || !ev.date || !DISCIPLINES.includes(ev.disc)) continue;
    // In-week if start <= date <= today.
    if (dayDiff(ev.date, start) >= 0 && dayDiff(today, ev.date) >= 0) {
      out[ev.disc] += 1;
    }
  }
  return out;
}

// Return every player as [{ id, stick, shoot, dryland, streak, stickers, updatedAt }].
// Players missing from the store are returned zeroed so the board is always complete.
// The `streak` field is REPLACED with the computed consecutive-day streak so the
// board/leaderboard show honest streaks (the stored streak field is ignored).
export async function listPlayers() {
  const ids = ROSTER.map((p) => p.id);
  const playerKeys = ids.map(keyFor);
  const daysKeys = ids.map(daysKeyFor);

  // mget returns values in the same order as the keys; missing keys come back null.
  // Read player and days keys together to keep this efficient (no per-player round trip).
  const [playerVals, daysVals] = await Promise.all([
    kv.mget(...playerKeys),
    kv.mget(...daysKeys),
  ]);

  const today = localDateStr();

  return ROSTER.map((p, i) => {
    const base = playerVals[i] || zeroCounts();
    const days = asArray(daysVals[i]);
    const streak = streakFromDays(days, today);
    return { id: p.id, ...base, streak };
  });
}

// Pure streak calculation over an already-fetched days array, so listPlayers can
// compute streaks from its mget results without a second read per player.
// Same rules as computeStreak.
function streakFromDays(days, today) {
  if (!days || !days.length) return 0;
  const sorted = Array.from(new Set(days)).sort();
  const latest = sorted[sorted.length - 1];
  const gapToLatest = dayDiff(today, latest);
  if (gapToLatest > 1 || gapToLatest < 0) return 0;
  let streak = 1;
  for (let i = sorted.length - 2; i >= 0; i -= 1) {
    if (dayDiff(sorted[i + 1], sorted[i]) === 1) {
      streak += 1;
    } else {
      break;
    }
  }
  return streak;
}

// Return the full roster with per-player current-week discipline counts:
// [{ id, stick, shoot, dryland }, ...]. Backs a future /api/board?tf=week.
// Zeroed for players with no in-week events.
export async function weekBoard() {
  const ids = ROSTER.map((p) => p.id);
  const eventsKeys = ids.map(eventsKeyFor);
  const eventsVals = await kv.mget(...eventsKeys);

  const start = weekStartStr();
  const today = localDateStr();

  return ROSTER.map((p, i) => {
    const events = asArray(eventsVals[i]);
    const out = { stick: 0, shoot: 0, dryland: 0 };
    for (const ev of events) {
      if (!ev || !ev.date || !DISCIPLINES.includes(ev.disc)) continue;
      if (dayDiff(ev.date, start) >= 0 && dayDiff(today, ev.date) >= 0) {
        out[ev.disc] += 1;
      }
    }
    return { id: p.id, ...out };
  });
}

// Increment one discipline count for a player and stamp updatedAt.
// Creates the player (zeroed) if they don't exist yet. Also records TODAY's local
// date in days:<id> (idempotent) and appends a dated event to events:<id> so
// streaks and the weekly split are real. Returns the updated player object.
export async function bumpPlayer(id, discipline) {
  const current = (await getPlayer(id)) || zeroCounts();
  const next = {
    ...zeroCounts(),          // guarantee all fields exist
    ...current,               // keep existing values
    updatedAt: new Date().toISOString(),
  };
  next[discipline] = (Number(next[discipline]) || 0) + 1;
  await setPlayer(id, next);

  const today = localDateStr();

  // Record today's active day, idempotently (recording the same day twice is a no-op).
  const days = await getDays(id);
  if (!days.includes(today)) {
    days.push(today);
    await kv.set(daysKeyFor(id), days);
  }

  // Append the dated discipline event, capped to the last EVENTS_CAP entries.
  if (DISCIPLINES.includes(discipline)) {
    const events = await getEvents(id);
    events.push({ date: today, disc: discipline });
    const capped = events.length > EVENTS_CAP ? events.slice(events.length - EVENTS_CAP) : events;
    await kv.set(eventsKeyFor(id), capped);
  }

  return { id: String(id).toLowerCase(), ...next };
}
