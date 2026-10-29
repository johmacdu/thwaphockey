// lib/avatar_items.js
//
// The player character's item catalog and unlock rules. Pure logic: no store,
// no network, so the ladder can be unit-tested on its own and the client can
// mirror it for "Unlocks at 50" labels. The SERVER is the authority: api/look.js
// computes unlocks here from recorded completions and rejects any look that
// wears an item the player has not earned.
//
// Two currencies (docs/avatar-roadmap.md):
//   activities    : every recorded drill or quiz (sum of all-time discipline counts)
//   training days : distinct days with at least one completion (max one per day)
// plus a per-discipline track (25 completions in a discipline).

// Discipline count fields stored on player:<id> (mirrors lib/store DISCIPLINES).
export const COUNT_FIELDS = ['stick', 'shoot', 'dryland', 'netplay', 'iq', 'pass'];

// Slots a look can fill. Every slot has a free starting item so a fresh player
// always has a complete, valid character.
// 'hand' (handedness) and 'facing' (which way the character faces) are free
// preference slots -- always-owned, like skin and hair. They are not earned.
export const SLOTS = ['skin', 'hair', 'hairstyle', 'jersey', 'helmet', 'cage', 'stripe', 'gloves', 'stick', 'pose', 'celebration', 'hand', 'facing', 'tape', 'decal', 'socks'];

// Rule shapes:
//   { type: 'start' }                       owned from the start
//   { type: 'activities', n }               n recorded activities
//   { type: 'days', n }                     n training days
//   { type: 'disc', disc, n }               n completions in one discipline
//   { type: 'window', from, to, n }         n training days between two dates (inclusive)
//   { type: 'coach' }                       granted by the coach only (never earned)
//   { type: 'tournament', n }               n training days in one tournament week
//                                           (from the team schedule); once earned it
//                                           is saved to grants, so it is kept forever
//   { type: 'team', n }                     the TEAM has hit the weekly goal n times
//                                           (everyone on the roster gets it together)
// Names are Thwap's own: Rangers colors, Bigfoot, the THWAP sound, the
// app's discipline words and kid hockey slang. Never borrow a competitor's
// item names (docs/avatar-design.md, Naming).
const S = { type: 'start' };
const act = (n) => ({ type: 'activities', n });
const days = (n) => ({ type: 'days', n });
const disc = (d, n) => ({ type: 'disc', disc: d, n });
const windowDays = (from, to, n) => ({ type: 'window', from, to, n });
const team = (n) => ({ type: 'team', n });
const tournament = (n) => ({ type: 'tournament', n });

// Winter break 2026-27 (Vancouver local dates, inclusive).
export const WINTER_BREAK = { from: '2026-12-19', to: '2027-01-04', n: 5 };

export const ITEMS = [
  // Base look: all free.
  ...['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10', 's11'].map((id) => ({ id: `skin-${id}`, slot: 'skin', label: 'Skin tone', tier: 'common', rule: S })),
  ...['black', 'brown', 'auburn', 'blonde', 'red', 'grey', 'cocoa', 'chestnut', 'sandy', 'platinum', 'white'].map((id) => ({ id: `hair-${id}`, slot: 'hair', label: 'Hair', tier: 'common', rule: S })),
  // Hair styles: Minnesota hockey hair. ALL free from day one. Hair is part of
  // who a kid is (like skin tone), never a reward to earn.
  ...[
    ['buzz', 'Buzz'], ['short', 'Short'], ['flow', 'Flow'], ['lettuce', 'Lettuce'],
    ['mullet', 'Mullet'], ['wings', 'Wings'], ['curls', 'Curls'],
    ['ponytail', 'Ponytail'], ['braids', 'Braids'], ['locs', 'Locs'],
    ['afro', 'Afro'], ['bun', 'Bun'], ['pigtails', 'Pigtails'],
  ].map(([id, label]) => ({ id: `hairstyle-${id}`, slot: 'hairstyle', label, tier: 'common', rule: S })),
  { id: 'jersey-red', slot: 'jersey', label: 'Rangers Red', tier: 'common', rule: S },
  { id: 'jersey-black', slot: 'jersey', label: 'Rink Black', tier: 'common', rule: S },
  { id: 'jersey-white', slot: 'jersey', label: 'Ice White', tier: 'common', rule: S },
  { id: 'helmet-team', slot: 'helmet', label: 'Game helmet', tier: 'common', rule: S },
  { id: 'cage-steel', slot: 'cage', label: 'Game cage', tier: 'common', rule: S },
  { id: 'stripe-none', slot: 'stripe', label: 'Plain', tier: 'common', rule: S },
  { id: 'gloves-black', slot: 'gloves', label: 'Game gloves', tier: 'common', rule: S },
  { id: 'stick-classic', slot: 'stick', label: 'Game stick', tier: 'common', rule: S },
  { id: 'pose-ready', slot: 'pose', label: 'Ready', tier: 'common', rule: S },
  // Free starting items for the team-set slots (Phase 4).
  { id: 'tape-white', slot: 'tape', label: 'White tape', tier: 'common', rule: S },
  { id: 'decal-none', slot: 'decal', label: 'No decal', tier: 'common', rule: S },
  { id: 'socks-match', slot: 'socks', label: 'Match my jersey', tier: 'common', rule: S },
  { id: 'celebration-none', slot: 'celebration', label: 'None yet', tier: 'common', rule: S },
  // Handedness + facing: free preferences, always owned (like skin / hair).
  { id: 'hand-right', slot: 'hand', label: 'Righty', tier: 'common', rule: S },
  { id: 'hand-left', slot: 'hand', label: 'Lefty', tier: 'common', rule: S },
  { id: 'facing-left', slot: 'facing', label: 'Left', tier: 'common', rule: S },
  { id: 'facing-right', slot: 'facing', label: 'Right', tier: 'common', rule: S },
  { id: 'facing-center', slot: 'facing', label: 'Center', tier: 'common', rule: S },

  // Quick early wins (activities).
  { id: 'gloves-red', slot: 'gloves', label: 'Rangers Red gloves', tier: 'common', rule: act(5) },
  { id: 'stripe-centre', slot: 'stripe', label: 'Bolt stripe', tier: 'common', rule: act(10) },
  { id: 'stick-wood', slot: 'stick', label: 'Old School stick', tier: 'common', rule: act(25) },

  // Training-day ladder.
  { id: 'jersey-forest', slot: 'jersey', label: 'Thwap Green', tier: 'common', rule: days(10) },
  { id: 'celebration-fistpump', slot: 'celebration', label: 'THWAP!', tier: 'common', rule: days(15) },
  { id: 'stripe-twin', slot: 'stripe', label: 'Double Bolt', tier: 'common', rule: days(20) },
  { id: 'helmet-red', slot: 'helmet', label: 'Rangers Red helmet', tier: 'common', rule: days(25) },
  { id: 'gloves-white', slot: 'gloves', label: 'Ice White gloves', tier: 'common', rule: days(30) },
  { id: 'pose-dangle', slot: 'pose', label: 'Toe drag', tier: 'rare', rule: days(35) },
  { id: 'cage-black', slot: 'cage', label: 'Blackout cage', tier: 'rare', rule: days(40) },
  { id: 'helmet-chrome', slot: 'helmet', label: 'Glacier helmet', tier: 'rare', rule: days(50) },
  { id: 'stick-red', slot: 'stick', label: 'Rangers Red stick', tier: 'rare', rule: days(60) },
  { id: 'celebration-kneeslide', slot: 'celebration', label: 'Knee slide', tier: 'rare', rule: days(75) },
  { id: 'stick-gold', slot: 'stick', label: 'Golden Stick', tier: 'epic', rule: days(100) },
  { id: 'gloves-ice', slot: 'gloves', label: 'Bigfoot gloves', tier: 'legendary', rule: days(130) },
  { id: 'jersey-legend', slot: 'jersey', label: 'Bigfoot Legend', tier: 'legendary', rule: days(160) },

  // Winter break: training over the holidays, when kids usually drop off.
  // Counts training days inside the window, so once earned it stays earned.
  { id: 'jersey-pond', slot: 'jersey', label: 'Frozen Pond', tier: 'rare', rule: windowDays(WINTER_BREAK.from, WINTER_BREAK.to, WINTER_BREAK.n) },

  // Discipline track: the reward matches the work.
  { id: 'pose-shooting', slot: 'pose', label: 'Snipe', tier: 'rare', rule: disc('shoot', 25) },
  { id: 'pose-passing', slot: 'pose', label: 'Tape to tape', tier: 'rare', rule: disc('pass', 25) },
  { id: 'pose-reading', slot: 'pose', label: 'Head up', tier: 'rare', rule: disc('iq', 25) },
  { id: 'pose-stickhandling', slot: 'pose', label: 'Dangle', tier: 'rare', rule: disc('stick', 25) },
  { id: 'pose-power', slot: 'pose', label: 'Power', tier: 'rare', rule: disc('dryland', 25) },
  { id: 'pose-butterfly', slot: 'pose', label: 'Big save', tier: 'rare', rule: disc('netplay', 25) },
  // Team set (Phase 4, decided Oct 28 2026): each week the TEAM hits the weekly
  // goal unlocks the next one, in this fixed order, for everyone on the roster,
  // kept forever. Rangers-themed so they read as "we did it". Names are
  // placeholders to check against the brand doc.
  // Tournament jersey (Phase 4): train 2 days in a week the team has a
  // tournament on its schedule. Kept forever once earned.
  { id: 'jersey-tournament', slot: 'jersey', label: 'Tournament jersey', tier: 'rare', rule: tournament(2) },
  { id: 'tape-rangers', slot: 'tape', label: 'Rangers tape', tier: 'team', rule: team(1) },
  { id: 'decal-rangers', slot: 'decal', label: 'Rangers decal', tier: 'team', rule: team(2) },
  { id: 'socks-rangers', slot: 'socks', label: 'Team socks', tier: 'team', rule: team(3) },
  { id: 'gloves-rangers', slot: 'gloves', label: 'Rangers gloves', tier: 'team', rule: team(4) },
  { id: 'jersey-warmup', slot: 'jersey', label: 'Warm-up jersey', tier: 'team', rule: team(5) },
  { id: 'celebration-sticktap', slot: 'celebration', label: 'Stick tap', tier: 'team', rule: team(6) },
];

// Letters (Phase 4): the C and A are granted by the coach, never earned or
// picked, so they are not wearable catalog items. They live in the player's
// coach grants as 'letter-c' / 'letter-a'. One C per team, at most two A's.
export const LETTERS = { C: 'letter-c', A: 'letter-a' };
export const MAX_A = 2;
export function letterFromGrants(grants = []) {
  if (grants.includes(LETTERS.C)) return 'C';
  if (grants.includes(LETTERS.A)) return 'A';
  return null;
}
// The grants list with the letter replaced (letter: 'C' | 'A' | '' for none).
export function withLetter(grants = [], letter) {
  const rest = grants.filter((g) => g !== LETTERS.C && g !== LETTERS.A);
  return LETTERS[letter] ? rest.concat([LETTERS[letter]]) : rest;
}

const BY_ID = new Map(ITEMS.map((it) => [it.id, it]));
export function itemById(id) { return BY_ID.get(String(id || '')) || null; }

// The free starting look every player gets.
export const DEFAULT_LOOK = {
  skin: 'skin-s3', hair: 'hair-brown', hairstyle: 'hairstyle-flow', jersey: 'jersey-red', helmet: 'helmet-team',
  cage: 'cage-steel', stripe: 'stripe-none', gloves: 'gloves-black', stick: 'stick-classic',
  pose: 'pose-ready', celebration: 'celebration-none',
  hand: 'hand-right', facing: 'facing-left',
  tape: 'tape-white', decal: 'decal-none', socks: 'socks-match',
};

// Progress from the stored player record (all-time counts) and training days.
// The second argument is either the list of 'YYYY-MM-DD' training days (needed
// for window rules) or, for older callers, just the count.
// teamHits: finished weeks the team hit the weekly goal (lib/store.js
// currentTeamGoal). Same number for everyone on the roster.
export function progressFrom(counts, trainingDays, teamHits = 0) {
  const c = counts || {};
  const disciplines = {};
  let activities = 0;
  for (const f of COUNT_FIELDS) {
    const n = Math.max(0, Math.floor(Number(c[f]) || 0));
    disciplines[f] = n;
    activities += n;
  }
  const dayList = Array.isArray(trainingDays) ? [...new Set(trainingDays.filter((d) => typeof d === 'string'))] : null;
  const dayCount = dayList ? dayList.length : Math.max(0, Math.floor(Number(trainingDays) || 0));
  const out = { activities, trainingDays: dayCount, disciplines, teamHits: Math.max(0, Math.floor(Number(teamHits) || 0)) };
  if (dayList) {
    // Days inside each window rule, precomputed so the client can show progress
    // without receiving the full day list.
    out.windows = {};
    for (const it of ITEMS) {
      if (it.rule.type !== 'window') continue;
      out.windows[it.id] = dayList.filter((d) => d >= it.rule.from && d <= it.rule.to).length;
    }
  }
  return out;
}

// Current value and target for a rule, for "You're at 62 of 100" lines.
export function ruleProgress(rule, progress, itemId) {
  if (!rule || rule.type === 'start') return { have: 1, need: 1 };
  if (rule.type === 'coach') return { have: 0, need: 1 };
  if (rule.type === 'activities') return { have: progress.activities, need: rule.n };
  if (rule.type === 'days') return { have: progress.trainingDays, need: rule.n };
  if (rule.type === 'disc') return { have: progress.disciplines[rule.disc] || 0, need: rule.n };
  if (rule.type === 'window') return { have: (progress.windows && progress.windows[itemId]) || 0, need: rule.n };
  if (rule.type === 'team') return { have: progress.teamHits || 0, need: rule.n };
  if (rule.type === 'tournament') return { have: progress.tournament || 0, need: rule.n };
  return { have: 0, need: 1 };
}

export function isUnlocked(item, progress, grants = []) {
  if (!item) return false;
  if (item.rule.type === 'coach') return grants.includes(item.id);
  if (item.rule.type === 'tournament' && grants.includes(item.id)) return true; // earned once, kept
  const { have, need } = ruleProgress(item.rule, progress, item.id);
  return have >= need;
}

export function unlockedIds(progress, grants = []) {
  return ITEMS.filter((it) => isUnlocked(it, progress, grants)).map((it) => it.id);
}

// Card fit: how big the character is on the card front and where it stands.
// Plain numbers the kid picks, not unlockable items. fitSize is a percent of
// the normal size; fitX / fitY move it by a percent of the card (right and up
// are positive). Anything missing, not a number, or out of range is clamped,
// and a value equal to the default is left off so stored looks stay small.
export const FIT = {
  fitSize: { min: 80, max: 150, def: 100 },
  fitX: { min: -30, max: 30, def: 0 },
  fitY: { min: -20, max: 30, def: 0 },
};
export function cleanFit(src) {
  const out = {};
  const s = src && typeof src === 'object' ? src : {};
  for (const [k, r] of Object.entries(FIT)) {
    const n = Number(s[k]);
    if (s[k] == null || s[k] === '' || !Number.isFinite(n)) continue;
    const v = Math.round(Math.min(r.max, Math.max(r.min, n)));
    if (v !== r.def) out[k] = v;
  }
  return out;
}

// Validate a requested look. Unknown slots are dropped, a missing slot falls back
// to the default, and an item that is unknown, in the wrong slot, or not yet
// earned is an error (the client should never send one).
export function validateLook(input, progress, grants = []) {
  const look = { ...DEFAULT_LOOK };
  const src = input && typeof input === 'object' ? input : {};
  for (const slot of SLOTS) {
    if (src[slot] == null) continue;
    const item = itemById(src[slot]);
    if (!item || item.slot !== slot) return { ok: false, error: `bad item for ${slot}` };
    if (!isUnlocked(item, progress, grants)) return { ok: false, error: `${item.id} not unlocked` };
    look[slot] = item.id;
  }
  return { ok: true, look: { ...look, ...cleanFit(src) } };
}

// Keep a stored look valid if the catalog changes: any slot whose item no longer
// exists or is no longer owned reverts to the default for that slot.
export function sanitizeStoredLook(stored, progress, grants = []) {
  const look = { ...DEFAULT_LOOK };
  const src = stored && typeof stored === 'object' ? stored : {};
  for (const slot of SLOTS) {
    const item = itemById(src[slot]);
    if (item && item.slot === slot && isUnlocked(item, progress, grants)) look[slot] = item.id;
  }
  return { ...look, ...cleanFit(src) };
}
