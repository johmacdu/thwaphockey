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
export const SLOTS = ['skin', 'hair', 'jersey', 'helmet', 'stripe', 'gloves', 'stick', 'pose', 'celebration'];

// Rule shapes:
//   { type: 'start' }                       owned from the start
//   { type: 'activities', n }               n recorded activities
//   { type: 'days', n }                     n training days
//   { type: 'disc', disc, n }               n completions in one discipline
//   { type: 'coach' }                       granted by the coach only (never earned)
// Labels are placeholders until the art kit names the real items.
const S = { type: 'start' };
const act = (n) => ({ type: 'activities', n });
const days = (n) => ({ type: 'days', n });
const disc = (d, n) => ({ type: 'disc', disc: d, n });

export const ITEMS = [
  // Base look: all free.
  ...['s1', 's2', 's3', 's4', 's5', 's6'].map((id) => ({ id: `skin-${id}`, slot: 'skin', label: 'Skin tone', tier: 'common', rule: S })),
  ...['black', 'brown', 'auburn', 'blonde', 'red', 'grey'].map((id) => ({ id: `hair-${id}`, slot: 'hair', label: 'Hair', tier: 'common', rule: S })),
  { id: 'jersey-red', slot: 'jersey', label: 'Red', tier: 'common', rule: S },
  { id: 'jersey-black', slot: 'jersey', label: 'Black', tier: 'common', rule: S },
  { id: 'jersey-white', slot: 'jersey', label: 'White', tier: 'common', rule: S },
  { id: 'helmet-team', slot: 'helmet', label: 'Team helmet', tier: 'common', rule: S },
  { id: 'stripe-none', slot: 'stripe', label: 'No stripe', tier: 'common', rule: S },
  { id: 'gloves-black', slot: 'gloves', label: 'Black gloves', tier: 'common', rule: S },
  { id: 'stick-classic', slot: 'stick', label: 'Classic stick', tier: 'common', rule: S },
  { id: 'pose-ready', slot: 'pose', label: 'Ready stance', tier: 'common', rule: S },
  { id: 'celebration-none', slot: 'celebration', label: 'No celebration', tier: 'common', rule: S },

  // Quick early wins (activities).
  { id: 'gloves-red', slot: 'gloves', label: 'Red gloves', tier: 'common', rule: act(5) },
  { id: 'stripe-centre', slot: 'stripe', label: 'Centre stripe', tier: 'common', rule: act(10) },
  { id: 'celebration-fistpump', slot: 'celebration', label: 'Fist pump', tier: 'common', rule: act(25) },

  // Training-day ladder.
  { id: 'jersey-forest', slot: 'jersey', label: 'Forest green', tier: 'common', rule: days(10) },
  { id: 'stripe-twin', slot: 'stripe', label: 'Twin stripes', tier: 'common', rule: days(20) },
  { id: 'pose-dangle', slot: 'pose', label: 'Dangle', tier: 'rare', rule: days(35) },
  { id: 'helmet-chrome', slot: 'helmet', label: 'Chrome helmet', tier: 'rare', rule: days(50) },
  { id: 'celebration-kneeslide', slot: 'celebration', label: 'Knee slide', tier: 'rare', rule: days(75) },
  { id: 'stick-gold', slot: 'stick', label: 'Gold stick', tier: 'epic', rule: days(100) },
  { id: 'gloves-ice', slot: 'gloves', label: 'Ice gloves', tier: 'legendary', rule: days(130) },
  { id: 'jersey-legend', slot: 'jersey', label: 'Season legend', tier: 'legendary', rule: days(160) },

  // Discipline track: the reward matches the work.
  { id: 'pose-shooting', slot: 'pose', label: 'Shooting', tier: 'rare', rule: disc('shoot', 25) },
  { id: 'pose-passing', slot: 'pose', label: 'Passing', tier: 'rare', rule: disc('pass', 25) },
  { id: 'pose-reading', slot: 'pose', label: 'Reading the play', tier: 'rare', rule: disc('iq', 25) },
  { id: 'pose-stickhandling', slot: 'pose', label: 'Stickhandling', tier: 'rare', rule: disc('stick', 25) },
  { id: 'pose-power', slot: 'pose', label: 'Power', tier: 'rare', rule: disc('dryland', 25) },
  { id: 'pose-butterfly', slot: 'pose', label: 'Butterfly', tier: 'rare', rule: disc('netplay', 25) },
];

const BY_ID = new Map(ITEMS.map((it) => [it.id, it]));
export function itemById(id) { return BY_ID.get(String(id || '')) || null; }

// The free starting look every player gets.
export const DEFAULT_LOOK = {
  skin: 'skin-s3', hair: 'hair-brown', jersey: 'jersey-red', helmet: 'helmet-team',
  stripe: 'stripe-none', gloves: 'gloves-black', stick: 'stick-classic',
  pose: 'pose-ready', celebration: 'celebration-none',
};

// Progress from the stored player record (all-time counts) and active-day count.
export function progressFrom(counts, trainingDays) {
  const c = counts || {};
  const disciplines = {};
  let activities = 0;
  for (const f of COUNT_FIELDS) {
    const n = Math.max(0, Math.floor(Number(c[f]) || 0));
    disciplines[f] = n;
    activities += n;
  }
  return { activities, trainingDays: Math.max(0, Math.floor(Number(trainingDays) || 0)), disciplines };
}

// Current value and target for a rule, for "You're at 62 of 100" lines.
export function ruleProgress(rule, progress) {
  if (!rule || rule.type === 'start') return { have: 1, need: 1 };
  if (rule.type === 'coach') return { have: 0, need: 1 };
  if (rule.type === 'activities') return { have: progress.activities, need: rule.n };
  if (rule.type === 'days') return { have: progress.trainingDays, need: rule.n };
  if (rule.type === 'disc') return { have: progress.disciplines[rule.disc] || 0, need: rule.n };
  return { have: 0, need: 1 };
}

export function isUnlocked(item, progress, grants = []) {
  if (!item) return false;
  if (item.rule.type === 'coach') return grants.includes(item.id);
  const { have, need } = ruleProgress(item.rule, progress);
  return have >= need;
}

export function unlockedIds(progress, grants = []) {
  return ITEMS.filter((it) => isUnlocked(it, progress, grants)).map((it) => it.id);
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
  return { ok: true, look };
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
  return look;
}
