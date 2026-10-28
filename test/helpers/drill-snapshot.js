// test/helpers/drill-snapshot.js
//
// Equivalence harness for the shared drill library (lib/drills.js).
//
// capturePage(html) boots a copy of index.html in jsdom ONCE, then walks a grid
// of dates and player variants. For every (date, variant) it re-renders the
// Stickhandling, Shooting/Net play and Dryland lists through the page's own
// render code and reads back exactly what a kid sees on each row (name, the
// line under the name, cue, steps, the Start/Done button) plus what the Start
// button hands the guided timer (name, audio slug, setup, shooting duration).
// It also dumps the drill library arrays the rest of the page reads off window.
//
// captureModule(lib) produces the same shape straight from lib/drills.js, so a
// test can require page === module === committed fixture, byte for byte.
//
// The grid is deterministic: GRID_START plus GRID_DAYS days, which crosses week,
// month and year boundaries and every weekend, for a skater (with and without a
// coach dryland plan), a goalie, and a goalie with Net play switched on.

import { JSDOM } from 'jsdom';
import { createHash } from 'node:crypto';

export const GRID_START = '2026-08-24'; // a Monday
export const GRID_DAYS = 140; // through 2027-01-10

// A coach plan with dryland picks on some days, an unknown name, an empty list
// (category on, no names) and the legacy array shape, so the coach-pick branch
// of the dryland rotation is covered too.
export const COACH_PLAN = {
  mon: { dryland: ['Wall Sit', '20-Minute Run', 'Sit-ups', 'Box Jumps'] },
  tue: { dryland: ['Not A Real Drill', 'Skater Jumps'] },
  wed: { dryland: [] },
  thu: ['dryland', 'stick'],
  fri: { dryland: ['__all__', "McDavid's"], stick: ['Front-to-Back'] },
  sat: { dryland: ['Wall Sit'] },
};

export const VARIANTS = [
  { key: 'skater', player: 'Lewie', plan: null, netplay: false },
  { key: 'skater-coachplan', player: 'Lewie', plan: COACH_PLAN, netplay: false },
  { key: 'goalie', player: 'Johnny', plan: null, netplay: false },
  { key: 'goalie-netplay-on', player: 'Johnny', plan: null, netplay: true },
];

export function dayNumber(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}
export function dateOf(di) {
  return new Date(di * 86400000).toISOString().slice(0, 10);
}
export function gridDays() {
  const start = dayNumber(GRID_START);
  return Array.from({ length: GRID_DAYS }, (_, i) => start + i);
}

// Plain JSON copy (drops functions, keeps key order).
const plain = (x) => JSON.parse(JSON.stringify(x === undefined ? null : x));

function readRows(win, listId, timerLog) {
  const list = win.document.getElementById(listId);
  if (!list) return { state: 'missing' };
  if (list.querySelector('.restday')) return { state: 'rest' };
  if (list.querySelector('.soon-empty')) return { state: 'soon' };
  const rows = Array.from(list.querySelectorAll('.exrow'));
  if (!rows.length) return { state: 'empty', text: list.textContent.trim() };
  return {
    state: 'drills',
    rows: rows.map((row) => {
      const h3 = row.querySelector('h3');
      const badge = h3 && h3.querySelector('.exbadge');
      const name = h3 ? h3.textContent.slice(0, h3.textContent.length - (badge ? badge.textContent.length : 0)) : '';
      const sub = row.querySelector('.exdose');
      const p = row.querySelector('.exbody > p');
      const cue = p ? p.textContent.replace(/^Coach cue: /, '') : '';
      const steps = Array.from(row.querySelectorAll('.exbody li')).map((li) => li.textContent);
      const btn = row.querySelector('.exdone');
      const action = btn ? btn.textContent : '';
      let timer = null;
      if (btn && action === 'Start') {
        timerLog.length = 0;
        btn.click();
        timer = timerLog[0] || null;
      }
      return { i: Number(row.getAttribute('data-i')), name, sub: sub ? sub.textContent : '', cue, steps, action, timer };
    }),
  };
}

export async function capturePage(html, { days = gridDays(), variants = VARIANTS } = {}) {
  let curDay = days[0];
  const timerLog = [];
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://thwaphockey.com/',
    beforeParse(window) {
      window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: false }) });
      window.scrollTo = () => {};
      // The page's own date override hook: every dayIndex() reads it first.
      window.thwapDateOverride = () => curDay;
      window.localStorage.setItem('bfPlayer', 'Lewie');
    },
  });
  const win = dom.window;
  const errors = [];
  win.addEventListener('error', (e) => errors.push(String(e.message || e.error)));
  await new Promise((r) => setTimeout(r, 60));
  // Record what Start hands the guided timer, without opening the runner.
  win.thwapDrillTimer = (name, onDone, audio, setup, durSecs) => {
    timerLog.push(plain({ name, audio: audio === undefined ? null : audio, setup: setup || null, durSecs: durSecs === undefined ? null : durSecs }));
  };
  // Never record completions while walking the grid.
  win.thwapMarkDone = () => {};
  const coach = win.__thwapCoachPlan;

  const render = (hash) => {
    win.location.hash = hash;
    win.dispatchEvent(new win.HashChangeEvent('hashchange'));
  };

  const out = [];
  for (const v of variants) {
    win.localStorage.setItem('bfPlayer', v.player);
    win.NETPLAY_ENABLED = v.netplay;
    coach.loaded = true;
    coach.plan = v.plan ? plain(v.plan) : null;
    for (const di of days) {
      curDay = di;
      render('#stick');
      const stick = readRows(win, 'stickList', timerLog);
      render('#shoot');
      const third = readRows(win, 'shootList', timerLog);
      render('#dryland');
      const dryland = readRows(win, 'drylandList', timerLog);
      out.push({
        variant: v.key,
        date: dateOf(di),
        weekday: win.thwapWeekday(),
        restDay: !!win.thwapIsRestDay(),
        stick, third, dryland,
      });
    }
  }
  const library = {
    DRILLS: plain(win.DRILLS),
    SHOOT_DAYS: plain(win.SHOOT_DAYS),
    NETPLAY_DAYS: plain(win.NETPLAY_DAYS),
    WORKOUTS: plain(win.WORKOUTS),
    THWAP_DRILL_SCRIPT: plain(win.THWAP_DRILL_SCRIPT),
  };
  win.close();
  return { grid: out, library, errors };
}

// The same normalized rows, built from lib/drills.js instead of the page.
function moduleRows(lib, discipline, drills, goalie) {
  return {
    state: 'drills',
    rows: drills.map((dr, i) => {
      const action = dr.noTimer ? 'Done' : 'Start';
      const durSecs = discipline === 'shoot' ? lib.SHOOT_TIMER_SECONDS : null;
      return {
        i,
        name: dr.name,
        sub: lib.rowSubtitle(discipline, dr, goalie),
        cue: dr.cue || '',
        steps: (dr.steps || []).slice(),
        action,
        timer: action === 'Start'
          ? plain({ name: dr.name, audio: dr.audio === undefined ? null : dr.audio, setup: { cue: dr.cue, steps: dr.steps }, durSecs })
          : null,
      };
    }),
  };
}

export function captureModule(lib, { days = gridDays(), variants = VARIANTS } = {}) {
  const out = [];
  for (const v of variants) {
    const goalie = lib.GOALIE_FIRST_NAMES.includes(v.player.toLowerCase());
    for (const di of days) {
      const stick = moduleRows(lib, 'stick', lib.stickForDay(di), goalie);
      const set = lib.shootForDay(di, goalie, v.netplay);
      const third = set ? moduleRows(lib, 'shoot', set, goalie) : { state: 'soon' };
      const dryland = lib.isRestDay(di)
        ? { state: 'rest' }
        : moduleRows(lib, 'dryland', lib.drylandForDay(di, lib.coachDrillNames(v.plan, di, 'dryland')), goalie);
      out.push({ variant: v.key, date: dateOf(di), weekday: lib.weekday(di), restDay: lib.isRestDay(di), stick, third, dryland });
    }
  }
  const library = {
    DRILLS: plain(lib.DRILLS),
    SHOOT_DAYS: plain(lib.SHOOT_DAYS),
    NETPLAY_DAYS: plain(lib.NETPLAY_DAYS),
    WORKOUTS: plain(lib.WORKOUTS),
    THWAP_DRILL_SCRIPT: plain(lib.DRILL_SCRIPT),
  };
  return { grid: out, library, errors: [] };
}

// Every distinct timer the grid hands the runner, expanded into the runner's
// step list with a given buildSteps(sc, slug, rng) implementation and the
// page's scriptFor fallback. The rng is seeded so callout spots are stable.
export function timerSteps(grid, scriptTable, buildSteps) {
  const seen = new Map();
  for (const day of grid) {
    for (const k of ['stick', 'third', 'dryland']) {
      for (const row of (day[k].rows || [])) {
        if (!row.timer) continue;
        const key = JSON.stringify([row.timer.name, row.timer.audio, row.timer.durSecs]);
        if (seen.has(key)) continue;
        const sc = row.timer.durSecs && row.timer.durSecs > 0
          ? { type: 'session', seconds: Math.round(row.timer.durSecs) }
          : (scriptTable[row.timer.name] || { type: 'reps', reps: 10, perRep: 1.5, sides: 1 });
        seen.set(key, buildSteps(sc, row.timer.audio || '', seededRng(7)));
      }
    }
  }
  // Every script in the table too, including ones no grid day reaches (the
  // callout script, for example), so the whole timer engine is covered.
  for (const name of Object.keys(scriptTable)) {
    seen.set(JSON.stringify(['script', name]), buildSteps(scriptTable[name], 'slug', seededRng(11)));
  }
  return Object.fromEntries(seen);
}

export function seededRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Pull the ORIGINAL buildSteps (and its two constants) out of a pre-refactor
// index.html and compile it, with Math.random swapped for the passed rng.
export function extractOriginalBuildSteps(html) {
  const start = html.indexOf('function buildSteps(sc, slug){');
  const end = html.indexOf('function paint(st){', start);
  if (start < 0 || end < 0) throw new Error('buildSteps not found in original index.html');
  const src = html.slice(start, end).replace(/Math\.random\(\)/g, '__rng()');
  // eslint-disable-next-line no-new-func
  const make = new Function('SETUP_SECS', 'COUNTDOWN', `var __rng; ${src}; return function(sc, slug, rng){ __rng = rng || Math.random; return buildSteps(sc, slug); };`);
  return make(5, 5);
}

const h = (x) => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16);

// Compact, committable form of a capture: one line per day, one string per
// row ("index|name|line under the name|button|audio|shooting seconds|hash of the
// full row incl. cue, steps and timer setup"), the library hashed per array, and
// each timer step list hashed with its length. Any byte change in a row, the
// library or a timer changes a hash.
export function compact(snap, timers) {
  const rowStr = (r) => [r.i, r.name, r.sub, r.action, r.timer ? r.timer.audio : '-', r.timer ? r.timer.durSecs : '-', h(r)].join('|');
  const part = (p) => (p.state === 'drills' ? p.rows.map(rowStr) : p.state);
  return {
    days: snap.grid.map((d) => [d.variant, d.date, d.weekday, d.restDay ? 'rest' : 'train', part(d.stick), part(d.third), part(d.dryland)]),
    library: Object.fromEntries(Object.entries(snap.library).map(([k, v]) => [k, h(v)])),
    timers: Object.fromEntries(Object.entries(timers).map(([k, v]) => [k, v.length + ':' + h(v)])),
  };
}
