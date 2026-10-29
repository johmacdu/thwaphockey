// lib/journey.js
//
// Season Book ("My Season Journey") math. Pure logic, no store, so it is unit
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
    months,
  };
}

// --- Badges ------------------------------------------------------------------
//
// Eight badges, 3 stars each, all earned by doing (never by how well), counted
// for the current season only. The art order matches journey/art/badge-01..08.
//   count: 'disc'   -> drills of one discipline this season (events:<id>)
//          'streak' -> longest run of consecutive training days this season
//          'weeks'  -> Monday-based weeks with FULL_WEEK_DAYS+ training days
//          'cheers' -> cheers this player SENT to teammates this season
// Goalies get Net Boss (Net play drills) in place of Sniper, the same swap the
// app already makes for their third discipline.
export const FULL_WEEK_DAYS = 4;
export const BADGES = [
  { id: 'dangler', name: 'Dangler', art: 'badge-01.webp', count: 'disc', disc: 'stick', unit: 'Hands drills', stars: [10, 30, 60] },
  { id: 'sniper', name: 'Sniper', art: 'badge-02.webp', count: 'disc', disc: 'shoot', unit: 'Shooting drills', stars: [10, 30, 60],
    goalie: { id: 'netboss', name: 'Net Boss', disc: 'netplay', unit: 'Net play drills' } },
  { id: 'engine', name: 'Engine', art: 'badge-03.webp', count: 'disc', disc: 'dryland', unit: 'Dryland workouts', stars: [8, 24, 48] },
  { id: 'tapetotape', name: 'Tape to Tape', art: 'badge-04.webp', count: 'disc', disc: 'pass', unit: 'Passing drills', stars: [8, 24, 48] },
  { id: 'hockeybrain', name: 'Hockey Brain', art: 'badge-05.webp', count: 'disc', disc: 'iq', unit: 'Hockey IQ sessions', stars: [5, 15, 30] },
  { id: 'onaheater', name: 'On a Heater', art: 'badge-06.webp', count: 'streak', unit: 'best days in a row', stars: [3, 7, 14] },
  { id: 'fullweek', name: 'Full Week', art: 'badge-07.webp', count: 'weeks', unit: 'weeks with 4+ training days', stars: [2, 6, 12] },
  { id: 'hypesquad', name: 'Hype Squad', art: 'badge-08.webp', count: 'cheers', unit: 'cheers sent', stars: [5, 20, 50] },
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
  for (const e of Array.isArray(events) ? events : []) {
    if (!e || typeof e.date !== 'string' || !DATE_RE.test(e.date)) continue;
    if (e.date < season.start || e.date > last) continue;
    perDisc[e.disc] = (perDisc[e.disc] || 0) + 1;
  }
  const streak = bestStreak(inDays);
  const weeks = fullWeeks(inDays);
  const cheers = Math.max(0, Math.floor(Number(cheersSent) || 0));

  const badges = BADGES.map((b) => {
    const def = goalie && b.goalie ? { ...b, ...b.goalie } : b;
    const count = def.count === 'disc' ? perDisc[def.disc] || 0
      : def.count === 'streak' ? streak
        : def.count === 'weeks' ? weeks
          : cheers;
    const stars = starsFor(count, def.stars);
    return {
      id: def.id, name: def.name, art: def.art, unit: def.unit,
      count, stars, thresholds: def.stars, next: stars < 3 ? def.stars[stars] : null,
    };
  });
  return { badges, badgeStars: badges.reduce((s, b) => s + b.stars, 0) };
}
