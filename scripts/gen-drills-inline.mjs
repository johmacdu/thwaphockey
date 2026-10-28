// scripts/gen-drills-inline.mjs
//
// Copy the drill library factory from lib/drills.js into index.html, between
// the THWAP-DRILLS markers, so the web app and the server run the same code.
//
// Run after any edit to lib/drills.js:   node scripts/gen-drills-inline.mjs
// test/drills-inline-drift.test.js fails when index.html is out of date.
//
// Why an inline copy and not <script src="/lib/drills.js">: index.html is the
// whole app in one no-store page (vercel.json), every test boots it from disk
// in jsdom, and the site sends X-Content-Type-Options: nosniff. A separate file
// would be a second request that can be cached apart from the page (old page,
// new drills or the reverse), would need its own MIME type right for nosniff,
// and would not load in the jsdom tests. Inlining keeps one atomic page.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inlineDrillsBlock, replaceDrillsBlock } from './drills-inline-block.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const file = resolve(root, 'index.html');
const html = readFileSync(file, 'utf8');
const next = replaceDrillsBlock(html, await inlineDrillsBlock());
if (next === html) {
  console.log('index.html drills block already up to date');
} else {
  writeFileSync(file, next);
  console.log('updated index.html drills block');
}
