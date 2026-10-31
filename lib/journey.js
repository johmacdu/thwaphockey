// lib/journey.js
//
// Season Book ("My Journey") math. Pure logic, no store, so it is unit
// tested on its own and shared by the API and anything else that needs it.
//
// A TRAINING DAY is any local date with at least one drill done: exactly the
// unique dates already stored in days:<id> (see lib/store.js). Counting days,
// not drills, rewards the habit and stops a kid grinding 20 drills in one day.
//
// The book covers the Fall/Winter season, Sep 1 to Mar 31 (lib/seasons.js),
// in America/Vancouver dates. Jan to Mar belongs to the season that began the
// previous September. From Apr to Aug the book shows the season just finished.
//
// Pacing: 4 tiers x 3 steps = 12 steps. The first step takes 3 training days
// (a win in week one); every later step takes 8 more. A kid training 4 days a
// week reaches the top step near the end of the season. Steps never go back.

export const TIERS = ['Locker Room', 'Practice Ice', 'Game Ready', 'Legend'];
export const STEPS_PER_TIER = 3;
export const FIRST_STEP_DAYS = 3;
export const STEP_DAYS = 8;
export const TOTAL_STEPS = TIERS.length * STEPS_PER_TIER;

// Cumulative training days needed to complete each step: [3, 11, 19, ... 91].
export const STEP_THRESHOLDS = Array.from({ length: TOTAL_STEPS }, (_, i) => FIRST_STEP_DAYS + i * STEP_DAYS);

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// The season a local date ('YYYY-MM-DD') belongs to, as its start and end dates.
// Sep-Dec -> that year's season; Jan-Aug -> the season that began the prior Sep.
export function seasonWindow(today) {
  const m = DATE_RE.exec(String(today || ''));
  if (!m) throw new Error('seasonWindow needs a YYYY-MM-DD date');
  const y = Number(m[1]);
  const mon = Number(m[2]);
  const startYear = mon >= 9 ? y : y - 1;
  return {
    key: `fw-${startYear}`,
    label: `${startYear}-${String(startYear + 1).slice(2)}`,
    start: `${startYear}-09-01`,
    end: `${startYear + 1}-03-31`,
  };
}

// Where a player is, given their total training days this season.
export function progressFor(trainingDays) {
  const days = Math.max(0, Math.floor(Number(trainingDays) || 0));
  const stepsDone = STEP_THRESHOLDS.filter((t) => days >= t).length;
  const complete = stepsDone >= TOTAL_STEPS;
  const tierIndex = complete ? TIERS.length - 1 : Math.floor(stepsDone / STEPS_PER_TIER);
  return {
    trainingDays: days,
    stepsDone,
    totalSteps: TOTAL_STEPS,
    complete,
    tierIndex,
    tier: TIERS[tierIndex],
    // The step being worked on inside the current tier (1-3); 3 once complete.
    step: complete ? STEPS_PER_TIER : (stepsDone % STEPS_PER_TIER) + 1,
    daysToNextStep: complete ? 0 : STEP_THRESHOLDS[stepsDone] - days,
  };
}

// The full book for one player: season, progress, and training days per month.
// `days` is the raw days:<id> list; anything outside the season, malformed, or
// after `today` is ignored, and duplicates count once.
// --- The path: one dot per training day --------------------------------------
//
// The season path has TOTAL_DOTS dots across four scenes (Locker Room, Practice
// Ice, Game Ready, Legend). Each training day moves the kid one dot.
// Freeze: missing FREEZE_GAP or more days in a row ("more than 4 days") turns
// the kid's latest dot icy. Nothing is ever taken away: every training day
// keeps its dot, and the next training day thaws the freeze.
export const TIER_STARTS = [0, 19, 43, 67];
export const TOTAL_DOTS = 91;
export const FREEZE_GAP = 5;

const dayGap = (a, b) => Math.round((utcDay(b) - utcDay(a)) / DAY_MS); // b - a in days
const tierAt = (pos) => {
  let t = 0;
  for (let i = 0; i < TIER_STARTS.length; i++) if (pos >= TIER_STARTS[i]) t = i;
  return t;
};

// sortedDays: unique in-season training days, ascending, none after today.
export function pathFor(sortedDays, today) {
  const pos = Math.min(sortedDays.length, TOTAL_DOTS);
  const complete = pos >= TOTAL_DOTS;
  const tierDates = [null, null, null, null];
  for (let t = 0; t < TIER_STARTS.length; t++) {
    const d = sortedDays[TIER_STARTS[t] === 0 ? 0 : TIER_STARTS[t] - 1];
    if (d) tierDates[t] = d;
  }
  // The run of missed days up to today (today itself is still open, so it does
  // not count as missed yet).
  const last = sortedDays[sortedDays.length - 1];
  const missedInARow = last ? Math.max(0, dayGap(last, today) - 1) : 0;
  const frozen = !!last && !complete && missedInARow >= FREEZE_GAP;
  const tierIndex = complete ? TIER_STARTS.length - 1 : tierAt(pos);
  const nextStart = TIER_STARTS[tierIndex + 1];
  return {
    dots: pos,
    totalDots: TOTAL_DOTS,
    tierStarts: TIER_STARTS,
    bestDot: pos,
    highestTier: tierIndex,
    tierDates,
    frozen,
    missedInARow,
    // Missed days left before the latest dot freezes (null = frozen or no dots).
    daysUntilFreeze: last && !frozen && !complete ? FREEZE_GAP - missedInARow : null,
    complete,
    tierIndex,
    tier: TIERS[tierIndex],
    dotsToNextTier: complete || nextStart == null ? 0 : nextStart - pos,
    dotsToFinish: complete ? 0 : TOTAL_DOTS - pos,
  };
}

// The full book for one player: season, progress, and training days per month.
// `days` is the raw days:<id> list; anything outside the season, malformed, or
// after `today` is ignored, and duplicates count once.
export function journeyFor(days, today) {
  const season = seasonWindow(today);
  const last = today < season.end ? today : season.end;
  const inSeason = Array.from(new Set((Array.isArray(days) ? days : []).filter(
    (d) => typeof d === 'string' && DATE_RE.test(d) && d >= season.start && d <= last,
  )));

  // One row per season month up to today's month (Sep..Mar), oldest first.
  const months = [];
  const startYear = Number(season.start.slice(0, 4));
  for (let i = 0; i < 7; i++) {
    const mon = ((8 + i) % 12) + 1; // 9,10,11,12,1,2,3
    const y = mon >= 9 ? startYear : startYear + 1;
    const ym = `${y}-${String(mon).padStart(2, '0')}`;
    if (`${ym}-01` > last) break;
    months.push({ month: ym, days: inSeason.filter((d) => d.startsWith(ym)).length });
  }

  // The date each step was reached (the Nth training day), null if not yet,
  // so a finished tier can say when the kid got there.
  const sorted = [...inSeason].sort();
  const stepDates = STEP_THRESHOLDS.map((t) => sorted[t - 1] || null);

  return {
    season,
    seasonOver: today > season.end,
    stepThresholds: STEP_THRESHOLDS,
    stepDates,
    // Weeks of hockey: Mon-Sun weeks with at least one training day.
    weeksTrained: weeksWith([...inSeason].sort(), 1),
    ...progressFor(inSeason.length),
    // The dot path supplies tier, tierIndex and complete. After the season ends
    // nothing freezes: the path is judged up to the last training day.
    ...pathFor(sorted, today > season.end ? (sorted[sorted.length - 1] || season.end) : today),
    months,
  };
}

// --- Badges ------------------------------------------------------------------
//
// Eight badges, 3 stars each, all earned by doing (never by how well), counted
// for the current season only. The art order matches journey/art/badge-01..32.
// Each badge counts one thing; `count` names which:
//   'disc'       -> drills of one discipline this season (def.disc)
//   'days'       -> training days this season
//   'drills'     -> total drills this season, any discipline
//   'balance'    -> fewest drills across the core disciplines (well-rounded)
//   'streak'     -> longest run of consecutive training days
//   'weeks'      -> Monday-based weeks with def.min+ training days (default 4)
//   'months'     -> calendar months with a training day
//   'weekend'    -> training days that fall on Sat/Sun
//   'winterdays' -> training days in Dec/Jan/Feb
//   'bigweek'    -> most drills in a single Monday-based week
//   'comeback'   -> training days that follow a gap of FREEZE_GAP+ days
//   'cheers'     -> cheers this player SENT to teammates
//   'tier'       -> reached tier def.tier (one-and-done milestone)
//   'complete'   -> finished the whole season path (milestone)
//   'opening'    -> trained in the season's first two weeks (milestone)
// `short` is the word the pop-up uses ("5 more drills"). Milestones have a
// single star and a `hint`. Goalies get Net Boss / Brick Wall (Net play) in
// place of the Sniper / Bar Down shooting badges, the same swap the app makes.
export const FULL_WEEK_DAYS = 4;
// Core disciplines for the well-rounded badge (goalies trade shooting for net).
export const CORE_DISC = ['stick', 'shoot', 'pass', 'dryland', 'iq'];
export const OPENING_DAYS = 14;
export const BADGES = [
  { id: 'dangler', name: 'Dangler', art: 'badge-01.webp', count: 'disc', disc: 'stick', unit: 'Hands drills', short: 'drills', stars: [10, 30, 60] },
  { id: 'sniper', name: 'Sniper', art: 'badge-02.webp', count: 'disc', disc: 'shoot', unit: 'Shooting drills', short: 'drills', stars: [10, 30, 60],
    goalie: { id: 'netboss', name: 'Net Boss', disc: 'netplay', unit: 'Net play drills' } },
  { id: 'engine', name: 'Engine', art: 'badge-03.webp', count: 'disc', disc: 'dryland', unit: 'Dryland workouts', short: 'workouts', stars: [8, 24, 48] },
  { id: 'tapetotape', name: 'Tape to Tape', art: 'badge-04.webp', count: 'disc', disc: 'pass', unit: 'Passing drills', short: 'drills', stars: [8, 24, 48] },
  { id: 'hockeybrain', name: 'Hockey Brain', art: 'badge-05.webp', count: 'disc', disc: 'iq', unit: 'Hockey IQ sessions', short: 'sessions', stars: [5, 15, 30] },
  { id: 'onaheater', name: 'On a Heater', art: 'badge-06.webp', count: 'streak', unit: 'best days in a row', short: 'days', stars: [3, 7, 14] },
  { id: 'fullweek', name: 'Full Week', art: 'badge-07.webp', count: 'weeks', min: 4, unit: 'weeks with 4+ training days', short: 'weeks', stars: [2, 6, 12] },
  { id: 'hypesquad', name: 'Hype Squad', art: 'badge-08.webp', count: 'cheers', unit: 'cheers sent', short: 'cheers', stars: [5, 20, 50] },
  // Batch 2 (badge-09..32).
  { id: 'firstshift', name: 'First Shift', art: 'badge-09.webp', count: 'days', unit: 'training days', short: 'days', stars: [1, 5, 10] },
  { id: 'rinkrat', name: 'Rink Rat', art: 'badge-10.webp', count: 'days', unit: 'training days', short: 'days', stars: [30, 60, 100] },
  { id: 'grinder', name: 'Grinder', art: 'badge-11.webp', count: 'drills', unit: 'drills done', short: 'drills', stars: [75, 200, 400] },
  { id: 'completeplayer', name: 'Complete Player', art: 'badge-12.webp', count: 'balance', unit: 'drills in every skill', short: 'in every skill', stars: [5, 15, 30] },
  { id: 'bardown', name: 'Bar Down', art: 'badge-13.webp', count: 'disc', disc: 'shoot', unit: 'Shooting drills', short: 'drills', stars: [100, 175, 250],
    goalie: { id: 'brickwall', name: 'Brick Wall', disc: 'netplay', unit: 'Net play drills' } },
  { id: 'magician', name: 'Magician', art: 'badge-14.webp', count: 'disc', disc: 'stick', unit: 'Hands drills', short: 'drills', stars: [100, 175, 250] },
  { id: 'playmaker', name: 'Playmaker', art: 'badge-15.webp', count: 'disc', disc: 'pass', unit: 'Passing drills', short: 'drills', stars: [80, 150, 220] },
  { id: 'motor', name: 'Motor', art: 'badge-16.webp', count: 'disc', disc: 'dryland', unit: 'Dryland workouts', short: 'workouts', stars: [72, 120, 180] },
  { id: 'bigbrain', name: 'Big Brain', art: 'badge-17.webp', count: 'disc', disc: 'iq', unit: 'Hockey IQ sessions', short: 'sessions', stars: [45, 75, 120] },
  { id: 'clockwork', name: 'Clockwork', art: 'badge-18.webp', count: 'weeks', min: 1, unit: 'weeks you trained', short: 'weeks', stars: [4, 10, 20] },
  { id: 'lockedin', name: 'Locked In', art: 'badge-19.webp', count: 'weeks', min: 4, unit: 'weeks with 4+ training days', short: 'weeks', stars: [4, 10, 18] },
  { id: 'hattrickweek', name: 'Hat Trick Week', art: 'badge-20.webp', count: 'weeks', min: 3, unit: 'weeks with 3+ training days', short: 'weeks', stars: [3, 9, 18] },
  { id: 'nodaysoff', name: 'No Days Off', art: 'badge-21.webp', count: 'streak', unit: 'best days in a row', short: 'days', stars: [21, 35, 50] },
  { id: 'monthmaker', name: 'Month Maker', art: 'badge-22.webp', count: 'months', unit: 'months you trained', short: 'months', stars: [2, 4, 6] },
  { id: 'weekendwarrior', name: 'Weekend Warrior', art: 'badge-23.webp', count: 'weekend', unit: 'weekend training days', short: 'weekend days', stars: [6, 16, 30] },
  { id: 'micdup', name: "Mic'd Up", art: 'badge-24.webp', count: 'cheers', unit: 'cheers sent', short: 'cheers', stars: [75, 150, 300] },
  { id: 'winterwarrior', name: 'Winter Warrior', art: 'badge-25.webp', count: 'winterdays', unit: 'winter training days', short: 'winter days', stars: [5, 15, 30] },
  { id: 'bigweek', name: 'Big Week', art: 'badge-26.webp', count: 'bigweek', unit: 'drills in your best week', short: 'in a week', stars: [8, 15, 25] },
  { id: 'comebackkid', name: 'Comeback Kid', art: 'badge-27.webp', count: 'comeback', unit: 'comebacks after a break', short: 'comebacks', stars: [1, 3, 6] },
  { id: 'calledup', name: 'Called Up', art: 'badge-28.webp', count: 'tier', tier: 1, unit: 'reach Practice Ice', stars: [1], hint: 'Reach Practice Ice to earn this.' },
  { id: 'gametime', name: 'Game Time', art: 'badge-29.webp', count: 'tier', tier: 2, unit: 'reach Game Ready', stars: [1], hint: 'Reach Game Ready to earn this.' },
  { id: 'topshelf', name: 'Top Shelf', art: 'badge-30.webp', count: 'tier', tier: 3, unit: 'reach Legend', stars: [1], hint: 'Reach Legend to earn this.' },
  { id: 'seasonsweep', name: 'Season Sweep', art: 'badge-31.webp', count: 'complete', unit: 'finish the whole path', stars: [1], hint: 'Finish the whole season path to earn this.' },
  { id: 'openingnight', name: 'Opening Night', art: 'badge-32.webp', count: 'opening', unit: 'train in the first two weeks', stars: [1], hint: 'Train in the first two weeks of the season to earn this.' },
];

const DAY_MS = 86400000;
const utcDay = (d) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));

// Unique in-season training days up to today, sorted ascending.
function seasonDays(days, season, last) {
  return Array.from(new Set((Array.isArray(days) ? days : []).filter(
    (d) => typeof d === 'string' && DATE_RE.test(d) && d >= season.start && d <= last,
  ))).sort();
}

// Longest run of consecutive calendar days.
export function bestStreak(sortedDays) {
  let best = 0;
  let run = 0;
  for (let i = 0; i < sortedDays.length; i++) {
    run = i > 0 && utcDay(sortedDays[i]) - utcDay(sortedDays[i - 1]) === DAY_MS ? run + 1 : 1;
    if (run > best) best = run;
  }
  return best;
}

// Monday-based weeks holding at least FULL_WEEK_DAYS training days.
// Monday-based weeks holding at least `min` training days.
export function weeksWith(sortedDays, min) {
  const perWeek = new Map();
  for (const d of sortedDays) {
    const t = utcDay(d);
    const monday = t - ((new Date(t).getUTCDay() + 6) % 7) * DAY_MS;
    perWeek.set(monday, (perWeek.get(monday) || 0) + 1);
  }
  let n = 0;
  for (const c of perWeek.values()) if (c >= min) n++;
  return n;
}

export function fullWeeks(sortedDays) {
  return weeksWith(sortedDays, FULL_WEEK_DAYS);
}

export function starsFor(count, thresholds) {
  return thresholds.filter((t) => count >= t).length;
}

// Every badge for one player this season.
//   input: { events, days, cheersSent, goalie }
// Returns { badges: [{id,name,art,unit,count,stars,thresholds,next}], badgeStars }
// where `next` is the count needed for the next star (null at 3 stars).
export function badgesFor({ events = [], days = [], cheersSent = 0, goalie = false } = {}, today) {
  const season = seasonWindow(today);
  const last = today < season.end ? today : season.end;
  const inDays = seasonDays(days, season, last);
  const perDisc = {};
  const perWeekDrills = new Map(); // Monday -> drills that week (for Big Week)
  let drills = 0;
  for (const e of Array.isArray(events) ? events : []) {
    if (!e || typeof e.date !== 'string' || !DATE_RE.test(e.date)) continue;
    if (e.date < season.start || e.date > last) continue;
    perDisc[e.disc] = (perDisc[e.disc] || 0) + 1;
    drills += 1;
    const t = utcDay(e.date);
    const monday = t - ((new Date(t).getUTCDay() + 6) % 7) * DAY_MS;
    perWeekDrills.set(monday, (perWeekDrills.get(monday) || 0) + 1);
  }
  const cheers = Math.max(0, Math.floor(Number(cheersSent) || 0));
  const prog = progressFor(inDays.length);
  const months = new Set(inDays.map((d) => d.slice(0, 7))).size;
  const weekendDays = inDays.filter((d) => { const g = new Date(utcDay(d)).getUTCDay(); return g === 0 || g === 6; }).length;
  const winterDays = inDays.filter((d) => { const mo = Number(d.slice(5, 7)); return mo === 12 || mo === 1 || mo === 2; }).length;
  const bigWeek = perWeekDrills.size ? Math.max(...perWeekDrills.values()) : 0;
  let comebacks = 0;
  for (let i = 1; i < inDays.length; i++) if (dayGap(inDays[i - 1], inDays[i]) >= FREEZE_GAP) comebacks += 1;
  const core = goalie ? CORE_DISC.map((d) => (d === 'shoot' ? 'netplay' : d)) : CORE_DISC;
  const balance = Math.min(...core.map((d) => perDisc[d] || 0));
  const openEnd = utcDay(season.start) + (OPENING_DAYS - 1) * DAY_MS;
  const opening = inDays.some((d) => utcDay(d) <= openEnd) ? 1 : 0;

  const countFor = (def) => {
    switch (def.count) {
      case 'disc': return perDisc[def.disc] || 0;
      case 'days': return inDays.length;
      case 'drills': return drills;
      case 'balance': return balance;
      case 'streak': return bestStreak(inDays);
      case 'weeks': return weeksWith(inDays, def.min || FULL_WEEK_DAYS);
      case 'months': return months;
      case 'weekend': return weekendDays;
      case 'winterdays': return winterDays;
      case 'bigweek': return bigWeek;
      case 'comeback': return comebacks;
      case 'cheers': return cheers;
      case 'tier': return prog.tierIndex >= def.tier ? 1 : 0;
      case 'complete': return prog.complete ? 1 : 0;
      case 'opening': return opening;
      default: return 0;
    }
  };

  const badges = BADGES.map((b) => {
    const def = goalie && b.goalie ? { ...b, ...b.goalie } : b;
    const count = countFor(def);
    const stars = starsFor(count, def.stars);
    return {
      id: def.id, name: def.name, art: def.art, unit: def.unit,
      short: def.short, kind: def.count, min: def.min, hint: def.hint,
      count, stars, thresholds: def.stars, next: stars < def.stars.length ? def.stars[stars] : null,
    };
  });
  return { badges, badgeStars: badges.reduce((s, b) => s + b.stars, 0) };
}

// --- Next star (the watch's My Season screen) ---------------------------------
//
// The badge closest to its next star: smallest (next - count), ties broken by
// BADGES order. Skipped: badges already at 3 stars, and the one-star
// milestones (tier, complete, opening), which are not earned by counting one
// more of something. `unit` is the phrase that reads after "N more", already
// singular when N is 1, and short enough to fit two lines on a 42mm watch.
export const NEXT_STAR_SKIP = ['tier', 'complete', 'opening'];
const NEXT_STAR_UNITS = {
  days: ['training day', 'training days'],
  drills: ['drill', 'drills'],
  balance: ['drill in every skill', 'drills in every skill'],
  streak: ['day in a row', 'days in a row'],
  months: ['month of training', 'months of training'],
  weekend: ['weekend day', 'weekend days'],
  winterdays: ['winter day', 'winter days'],
  bigweek: ['drill in your best week', 'drills in your best week'],
  comeback: ['comeback', 'comebacks'],
  cheers: ['cheer for a teammate', 'cheers for teammates'],
};

export function nextStarUnit(badge, n) {
  const one = n === 1;
  if (badge.kind === 'disc') return one ? String(badge.unit).replace(/s$/, '') : badge.unit;
  if (badge.kind === 'weeks') {
    const min = badge.min || FULL_WEEK_DAYS;
    if (min <= 1) return one ? 'week of training' : 'weeks of training';
    return `${one ? 'week' : 'weeks'} with ${min} days`;
  }
  const pair = NEXT_STAR_UNITS[badge.kind];
  return pair ? pair[one ? 0 : 1] : badge.unit;
}

// badges: the `badges` array badgesFor returns. null when nothing is left.
export function nextStarFor(badges) {
  let best = null;
  for (const b of Array.isArray(badges) ? badges : []) {
    if (!b || b.next == null || NEXT_STAR_SKIP.includes(b.kind)) continue;
    const remaining = b.next - b.count;
    if (remaining <= 0) continue;
    if (!best || remaining < best.remaining) best = { id: b.id, name: b.name, remaining, badge: b };
  }
  if (!best) return null;
  return { id: best.id, name: best.name, remaining: best.remaining, unit: nextStarUnit(best.badge, best.remaining) };
}
