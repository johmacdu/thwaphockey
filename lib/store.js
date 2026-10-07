// lib/store.js
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

// All discipline counts that can be incremented via done.js. `netplay` is the
// GOALIE's third discipline, replacing `shoot` for goalies only. A player is
// measured only on the disciplines their position has (see disciplinesFor), so a
// goalie is never dinged for `shoot` and a skater is never dinged for `netplay`.
export const DISCIPLINES = ['stick', 'shoot', 'dryland', 'netplay', 'iq'];

// Positions whose third discipline is Net play instead of Shooting.
// ROSTER carries no position field, so the goalie set is named here explicitly.
export const GOALIE_IDS = ['johnny'];

// The three disciplines that apply to a player, by id. Everyone does stick +
// dryland; the third is netplay for goalies, shoot for everyone else. This is the
// single source of truth for "which disciplines count for this player" so no
// shared surface (radar, board, participation) penalizes a missing-by-position one.
export function disciplinesFor(id) {
  const goalie = GOALIE_IDS.includes(String(id || '').toLowerCase());
  return goalie ? ['stick', 'netplay', 'dryland'] : ['stick', 'shoot', 'dryland'];
}

// Cap the per-player events log so storage stays bounded.
const EVENTS_CAP = 400;

// Shape of a freshly-seeded player (all counts zeroed).
function zeroCounts() {
  return { stick: 0, shoot: 0, dryland: 0, netplay: 0, iq: 0, streak: 0, stickers: 0, updatedAt: null };
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
// en-CA formats as YYYY-MM-DD, which is exactly the shape we store. Exported so
// api/done.js can answer the per-drill GET with the same server-authoritative
// "today" the drill-done keys are stamped with (no client-sent day is trusted).
export function localDateStr(date = new Date()) {
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
  const out = { stick: 0, shoot: 0, dryland: 0, netplay: 0, iq: 0 };
  for (const ev of events) {
    if (!ev || !ev.date || !DISCIPLINES.includes(ev.disc)) continue;
    // In-week if start <= date <= today.
    if (dayDiff(ev.date, start) >= 0 && dayDiff(today, ev.date) >= 0) {
      out[ev.disc] += 1;
    }
  }
  return out;
}

// Per-week training totals for the last WEEKS Monday-based weeks (default 4),
// oldest-first. Each entry: { weekStart:'YYYY-MM-DD', stick, shoot, dryland, total }.
// Backs the coach IDP "development over the month" view.
export async function monthTrend(id, weeks = 4) {
  const events = await getEvents(id);
  const thisMon = dateFromStr(weekStartStr());
  // Build week buckets: index 0 is the OLDEST of the window, last is this week.
  const buckets = [];
  for (let i = weeks - 1; i >= 0; i -= 1) {
    const d = new Date(thisMon.getTime());
    d.setUTCDate(d.getUTCDate() - i * 7);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    buckets.push({ weekStart: `${y}-${m}-${dd}`, stick: 0, shoot: 0, dryland: 0, netplay: 0, iq: 0, total: 0 });
  }
  const windowStart = buckets[0].weekStart;
  for (const ev of events) {
    if (!ev || !ev.date || !DISCIPLINES.includes(ev.disc)) continue;
    if (dayDiff(ev.date, windowStart) < 0) continue; // older than the window
    // Which bucket? floor(days since windowStart / 7).
    const idx = Math.floor(dayDiff(ev.date, windowStart) / 7);
    if (idx < 0 || idx >= buckets.length) continue;
    buckets[idx][ev.disc] += 1;
    buckets[idx].total += 1;
  }
  return buckets;
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
    const out = { stick: 0, shoot: 0, dryland: 0, netplay: 0, iq: 0 };
    for (const ev of events) {
      if (!ev || !ev.date || !DISCIPLINES.includes(ev.disc)) continue;
      if (dayDiff(ev.date, start) >= 0 && dayDiff(today, ev.date) >= 0) {
        out[ev.disc] += 1;
      }
    }
    return { id: p.id, ...out };
  });
}

// Reset ONE player to a clean slate: zero their counts and clear their day and
// event history. Deletes days:<id> and events:<id> outright (so streak and the
// weekly split recompute to 0) and rewrites player:<id> to zeroed counts (kept,
// not deleted, so the player still exists on the board rather than vanishing).
// Returns the zeroed player object. Only touches this one player's keys.
export async function resetPlayer(id) {
  const zeroed = zeroCounts();
  await Promise.all([
    kv.set(keyFor(id), zeroed),
    kv.del(daysKeyFor(id)),
    kv.del(eventsKeyFor(id)),
  ]);
  return { id: String(id).toLowerCase(), ...zeroed };
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

// --- Cheers (teammate high-fives) ------------------------------------------
//
// A kid viewing a TEAMMATE's player card can send one "Cheer" to that teammate.
// Model, mirroring the player/days/events style above:
//
//   Key:   cheers:<id>                       integer count of cheers RECEIVED by
//                                             that player (all-time).
//   Key:   cheerday:<YYYY-MM-DD>:<from>:<to>  per-day dedup marker. Its presence
//                                             means <from> already cheered <to>
//                                             on that Vancouver-local date, so a
//                                             second same-day cheer is a no-op.
//
//   Key:   cheerfrom:<to>                     per-recipient list of who cheered
//                                             them, newest first, capped to the
//                                             last CHEER_GIVERS_CAP. Value: JSON
//                                             array of { from:'<id>', at:<ms> }.
//                                             Powers the home-screen "N teammates
//                                             cheered you" roll-up, which names
//                                             the givers since the player's last
//                                             visit (the diff is per-device, in
//                                             the client's localStorage).
//
// Both ids are lowercase first names (roster ids). The dedup key uses the same
// Vancouver localDateStr() helper the streak/week math uses, so "today" rolls
// over on the Vancouver calendar, not the server's UTC clock.

const cheersKeyFor = (id) => `cheers:${String(id).toLowerCase()}`;
const cheerDayKeyFor = (date, from, to) =>
  `cheerday:${date}:${String(from).toLowerCase()}:${String(to).toLowerCase()}`;
const cheerFromKeyFor = (id) => `cheerfrom:${String(id).toLowerCase()}`;

// How many recent givers to keep per recipient. The home-screen roll-up only
// ever needs the slice since the last visit, so a modest cap is plenty and keeps
// the stored value small.
const CHEER_GIVERS_CAP = 20;

// True when the id is a real roster player. Case-insensitive. The single
// membership check used by sendCheer to reject off-roster sender/target ids.
export function isRosterPlayer(id) {
  const wanted = String(id || '').toLowerCase();
  return ROSTER.some((p) => p.id === wanted);
}

// Normalize a stored cheer count to a non-negative integer (missing key -> 0).
function asCount(raw) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

// Read one player's all-time cheer count (cheers RECEIVED). 0 if never cheered.
export async function getCheers(id) {
  return asCount(await kv.get(cheersKeyFor(id)));
}

// Return every player's cheer count as [{ id, cheers }], mirroring the
// listPlayers mget pattern so the board can fold cheers into its response in one
// round trip. Players never cheered come back as 0 so the roster is complete.
export async function listCheers() {
  const ids = ROSTER.map((p) => p.id);
  const vals = await kv.mget(...ids.map(cheersKeyFor));
  return ROSTER.map((p, i) => ({ id: p.id, cheers: asCount(vals[i]) }));
}

// Read a player's recent cheer givers, newest first: [{ from, at }, ...].
// Empty array if never cheered. Only valid roster ids are returned, so a stale
// id (e.g. a renamed/removed player) is dropped rather than shown. The client
// diffs this against its own last-seen marker to build the home-screen roll-up.
export async function getRecentCheerers(id) {
  const raw = asArray(await kv.get(cheerFromKeyFor(id)));
  return raw
    .filter((e) => e && isRosterPlayer(e.from))
    .map((e) => ({ from: String(e.from).toLowerCase(), at: Number(e.at) || 0 }));
}

// Send one cheer from fromId to toId.
//
//   - rejects a self-cheer (from === to)                 -> { ok:false, error:'self' }
//   - rejects an id that is not on the roster            -> { ok:false, error:'bad id' }
//   - idempotent per Vancouver-local day via the dedup
//     key: if fromId already cheered toId today, returns
//     { ok:true, already:true } WITHOUT incrementing.
//   - otherwise sets the dedup key, increments cheers:<to>,
//     records the giver in cheerfrom:<to> (newest first, capped), and
//     returns { ok:true, count:<new count> }.
export async function sendCheer(fromId, toId) {
  const from = String(fromId || '').toLowerCase();
  const to = String(toId || '').toLowerCase();

  if (from && to && from === to) return { ok: false, error: 'self' };
  if (!isRosterPlayer(from) || !isRosterPlayer(to)) return { ok: false, error: 'bad id' };

  const today = localDateStr();
  const dayKey = cheerDayKeyFor(today, from, to);

  // Already cheered this teammate today? No double count.
  const already = await kv.get(dayKey);
  if (already) return { ok: true, already: true };

  // Mark the dedup key, then increment the recipient's all-time count.
  await kv.set(dayKey, 1);
  const count = (await getCheers(to)) + 1;
  await kv.set(cheersKeyFor(to), count);

  // Record who sent it so the recipient's home screen can name them. Newest
  // first, capped. A failure here must not fail the cheer (the count already
  // landed), so it is best-effort.
  try {
    const givers = asArray(await kv.get(cheerFromKeyFor(to)));
    givers.unshift({ from, at: Date.now() });
    const capped = givers.length > CHEER_GIVERS_CAP ? givers.slice(0, CHEER_GIVERS_CAP) : givers;
    await kv.set(cheerFromKeyFor(to), capped);
  } catch {
    /* best-effort: the cheer count is authoritative, the giver list is a nicety */
  }

  return { ok: true, count };
}

// --- Fire ("On fire" reactions) --------------------------------------------
//
// A second teammate reaction, independent of cheers. A kid viewing a TEAMMATE's
// player card can send one "On fire" to that teammate, deduped per Vancouver day
// per (from, to) pair just like cheers but under its OWN keys, so a sender can
// send both a cheer AND a fire to the same teammate the same day without one
// blocking the other.
//
//   Key:   fire:<id>                         integer count of fires RECEIVED by
//                                             that player (all-time).
//   Key:   fireday:<YYYY-MM-DD>:<from>:<to>   per-day dedup marker, separate from
//                                             the cheerday marker.

const fireKeyFor = (id) => `fire:${String(id).toLowerCase()}`;
const fireDayKeyFor = (date, from, to) =>
  `fireday:${date}:${String(from).toLowerCase()}:${String(to).toLowerCase()}`;
const fireFromKeyFor = (id) => `firefrom:${String(id).toLowerCase()}`;

// Read one player's all-time fire count (fires RECEIVED). 0 if never fired.
export async function getFires(id) {
  return asCount(await kv.get(fireKeyFor(id)));
}

// Return every player's fire count as [{ id, fires }], mirroring listCheers so
// the board can fold fires into its response in one round trip.
export async function listFires() {
  const ids = ROSTER.map((p) => p.id);
  const vals = await kv.mget(...ids.map(fireKeyFor));
  return ROSTER.map((p, i) => ({ id: p.id, fires: asCount(vals[i]) }));
}

// Read a player's recent fire givers, newest first: [{ from, at }, ...]. Mirrors
// getRecentCheerers exactly, under the fire keys. The client diffs this against its
// own last-seen marker to know a NEW "On fire" arrived (the names are not shown).
export async function getRecentFirers(id) {
  const raw = asArray(await kv.get(fireFromKeyFor(id)));
  return raw
    .filter((e) => e && isRosterPlayer(e.from))
    .map((e) => ({ from: String(e.from).toLowerCase(), at: Number(e.at) || 0 }));
}

// Send one fire from fromId to toId. Same contract as sendCheer, under the fire
// keys, so a self-fire and an off-roster id are rejected and a same-day repeat
// is an idempotent no-op.
export async function sendFire(fromId, toId) {
  const from = String(fromId || '').toLowerCase();
  const to = String(toId || '').toLowerCase();

  if (from && to && from === to) return { ok: false, error: 'self' };
  if (!isRosterPlayer(from) || !isRosterPlayer(to)) return { ok: false, error: 'bad id' };

  const today = localDateStr();
  const dayKey = fireDayKeyFor(today, from, to);

  // Already fired this teammate today? No double count.
  const already = await kv.get(dayKey);
  if (already) return { ok: true, already: true };

  // Mark the dedup key, then increment the recipient's all-time count.
  await kv.set(dayKey, 1);
  const count = (await getFires(to)) + 1;
  await kv.set(fireKeyFor(to), count);

  // Record who sent it so the recipient's home screen can detect a new fire.
  // Best-effort (the count is authoritative); mirrors sendCheer.
  try {
    const firers = asArray(await kv.get(fireFromKeyFor(to)));
    firers.unshift({ from, at: Date.now() });
    const capped = firers.length > CHEER_GIVERS_CAP ? firers.slice(0, CHEER_GIVERS_CAP) : firers;
    await kv.set(fireFromKeyFor(to), capped);
  } catch {
    /* best-effort: the fire count is authoritative, the giver list is a nicety */
  }

  return { ok: true, count };
}

// --- Per-drill cross-device completion sync --------------------------------
//
// bumpPlayer (above) records the AGGREGATE counts + dated events, which is all
// the leaderboard needs. It does NOT record WHICH individual drill a player
// checked, so a second device cannot re-draw the checkmarks. These helpers add
// exactly that: a per-player, per-day SET of completed drill ids.
//
//   Key:   done:<id>:<YYYY-MM-DD>   (date is the Vancouver local day, same as
//                                    the streak/week math, so "today" rolls over
//                                    on the team's calendar not the server's UTC)
//   Value: JSON array of stable drill ids, e.g. ['stick:0','dryland:2','shoot:1'].
//
// A drill id is '<discipline>:<index>' where index is the drill's position in
// that discipline's deterministic daily list. The daily list is derived from the
// weekday on both devices, so the same index names the same drill everywhere.
// The array is kept as a de-duplicated SET (adding the same id twice is a no-op),
// so this is independent of bumpPlayer's count: un-marking removes the id here
// without touching the all-time counts or stickers.

const DRILL_DONE_CAP = 64; // generous: a day never has anywhere near this many drills

const drillDoneKeyFor = (id, date) => `done:${String(id).toLowerCase()}:${date}`;

// Read the set of completed drill ids for a player on a given Vancouver-local
// date (default today). Always an array (empty for a fresh player/day), never throws.
export async function getDrillDone(id, date = localDateStr()) {
  return asArray(await kv.get(drillDoneKeyFor(id, date)));
}

// Add one drill id to a player's completed set for the given day (default today).
// Idempotent: adding an id already present is a no-op. Returns the resulting
// sorted id array. The set is capped so a malformed client cannot grow it without
// bound. A falsy/blank drillId is ignored (returns the unchanged set).
export async function addDrillDone(id, drillId, date = localDateStr()) {
  const did = String(drillId || '').trim();
  const current = await getDrillDone(id, date);
  if (!did) return current;
  if (current.includes(did)) return current;
  const next = current.concat([did]);
  const capped = next.length > DRILL_DONE_CAP ? next.slice(next.length - DRILL_DONE_CAP) : next;
  await kv.set(drillDoneKeyFor(id, date), capped);
  return capped;
}

// Remove one drill id from a player's completed set for the given day (default
// today). A no-op if the id is not present. Returns the resulting id array.
// Backs the un-mark path so un-checking a drill syncs to other devices too.
export async function removeDrillDone(id, drillId, date = localDateStr()) {
  const did = String(drillId || '').trim();
  const current = await getDrillDone(id, date);
  if (!did || !current.includes(did)) return current;
  const next = current.filter((x) => x !== did);
  await kv.set(drillDoneKeyFor(id, date), next);
  return next;
}

// Adjust (correct) a player's discipline counts by a signed delta per discipline,
// e.g. { stick: -3, shoot: -3, dryland: -1 } to undo double-counted completions.
// This is the honest reverse of bumpPlayer, intended for one-off data corrections
// made by an admin (never by a player). It:
//   1. clamps each aggregate count at 0 (never goes negative), and
//   2. removes the matching number of dated events from events:<id> so the weekly
//      split corrects too. For a negative delta of N on a discipline, it removes
//      up to N events for that discipline, most-recent-first, restricted to
//      `onDate` ('YYYY-MM-DD', default = today local) so a correction only undoes
//      today's duplicates and never touches an earlier real day.
// Positive deltas are supported (adds events dated onDate) for completeness, but
// the primary use is corrections (negative). Returns the updated player object.
export async function adjustPlayer(id, deltas, onDate = localDateStr()) {
  const current = (await getPlayer(id)) || zeroCounts();
  const next = {
    ...zeroCounts(),
    ...current,
    updatedAt: new Date().toISOString(),
  };

  for (const disc of DISCIPLINES) {
    const d = Number(deltas && deltas[disc]) || 0;
    if (d === 0) continue;
    next[disc] = Math.max(0, (Number(next[disc]) || 0) + d);
  }
  await setPlayer(id, next);

  // Correct the dated events log so the weekly split matches the new totals.
  let events = await getEvents(id);
  for (const disc of DISCIPLINES) {
    const d = Number(deltas && deltas[disc]) || 0;
    if (d < 0) {
      // Remove up to |d| events for this discipline on onDate, most-recent-first.
      let toRemove = -d;
      for (let i = events.length - 1; i >= 0 && toRemove > 0; i -= 1) {
        const ev = events[i];
        if (ev && ev.disc === disc && ev.date === onDate) {
          events.splice(i, 1);
          toRemove -= 1;
        }
      }
    } else if (d > 0) {
      // Add d events for this discipline dated onDate.
      for (let k = 0; k < d; k += 1) events.push({ date: onDate, disc });
    }
  }
  const capped = events.length > EVENTS_CAP ? events.slice(events.length - EVENTS_CAP) : events;
  await kv.set(eventsKeyFor(id), capped);

  return { id: String(id).toLowerCase(), ...next };
}
