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

  return {
    season,
    seasonOver: today > season.end,
    ...progressFor(inSeason.length),
    months,
  };
}
