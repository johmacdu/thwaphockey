// test/drills-inline-drift.test.js
//
// index.html carries a generated copy of lib/drills.js (between the
// THWAP-DRILLS markers). Fails when someone edits one without the other.
// Fix: node scripts/gen-drills-inline.mjs

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { inlineDrillsBlock, currentDrillsBlock } from '../scripts/drills-inline-block.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');

describe('index.html drill block matches lib/drills.js', () => {
  it('has exactly one generated block', () => {
    expect(html.split('/* THWAP-DRILLS:BEGIN */').length).toBe(2);
    expect(html.split('/* THWAP-DRILLS:END */').length).toBe(2);
  });

  it('the inlined factory is lib/drills.js byte for byte', async () => {
    expect(currentDrillsBlock(html)).toBe(await inlineDrillsBlock());
  });

  it('loads before any script that reads the library', () => {
    const at = html.indexOf('/* THWAP-DRILLS:BEGIN */');
    for (const use of ['var TD=window.ThwapDrills;', 'var DRILLS=window.DRILLS;', 'var SHOOT_DAYS=window.SHOOT_DAYS;', 'var WORKOUTS=window.WORKOUTS;']) {
      expect(html.indexOf(use)).toBeGreaterThan(at);
    }
  });

  it('the drill data now lives only in the generated block', () => {
    const outside = html.replace(currentDrillsBlock(html), '');
    for (const decl of ['var DRILLS=window.DRILLS=[', 'var SHOOT_DAYS=window.SHOOT_DAYS=[', 'var WORKOUTS=window.WORKOUTS=[', 'window.NETPLAY_DAYS=[[', 'window.THWAP_DRILL_SCRIPT={', 'var MOVE={']) {
      expect(outside.includes(decl)).toBe(false);
    }
  });
});
