// scripts/snapshot-drills.mjs
//
// Write test/fixtures/drill-rotation.snapshot.json: what index.html shows on
// every day of the equivalence grid (test/helpers/drill-snapshot.js), plus the
// guided-timer step lists for every drill it reaches.
//
// Run:  node scripts/snapshot-drills.mjs [path/to/index.html]
//
// The committed fixture was captured from index.html BEFORE the drill library
// moved into lib/drills.js. test/drills-equivalence.test.js requires today's
// page and the module to reproduce it byte for byte. Only re-run this when a
// drill, dose or rotation change is intended, and review the fixture diff.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { capturePage, compact, timerSteps, extractOriginalBuildSteps, GRID_START, GRID_DAYS, VARIANTS } from '../test/helpers/drill-snapshot.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const htmlPath = resolve(process.argv[2] || resolve(root, 'index.html'));
const html = readFileSync(htmlPath, 'utf8');

const snap = await capturePage(html);
if (snap.errors.length) {
  console.error('page errors:', snap.errors);
  process.exit(1);
}
// Pre-refactor pages carry buildSteps inline; post-refactor pages read it from
// the shared module, so fall back to that.
let buildSteps;
try {
  buildSteps = extractOriginalBuildSteps(html);
} catch {
  const lib = await import('../lib/drills.js');
  buildSteps = lib.buildSteps;
}
const timers = timerSteps(snap.grid, snap.library.THWAP_DRILL_SCRIPT, buildSteps);
const fixture = {
  grid: { start: GRID_START, days: GRID_DAYS, variants: VARIANTS.map((v) => v.key) },
  ...compact(snap, timers),
};
const out = resolve(root, 'test/fixtures/drill-rotation.snapshot.json');
mkdirSync(dirname(out), { recursive: true });
// One day per line keeps the fixture diff readable when a drill changes.
const lines = ['{', '"grid": ' + JSON.stringify(fixture.grid) + ',', '"days": ['];
fixture.days.forEach((d, i) => lines.push(JSON.stringify(d) + (i < fixture.days.length - 1 ? ',' : '')));
lines.push('],', '"library": ' + JSON.stringify(fixture.library) + ',', '"timers": ' + JSON.stringify(fixture.timers, null, 1), '}');
writeFileSync(out, lines.join('\n') + '\n');
if (process.env.FULL_OUT) writeFileSync(process.env.FULL_OUT, JSON.stringify({ grid: snap.grid, library: snap.library, timers }));
console.log('wrote', out, 'days:', snap.grid.length, 'timers:', Object.keys(timers).length);
