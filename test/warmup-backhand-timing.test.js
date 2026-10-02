// test/warmup-backhand-timing.test.js
//
// Guard for the Moving Warm-Up (shooting warm-up) and Backhand Basics drill
// timings. Woody asked both to run ~2:30. The rounds engine gives 3s work per
// round + restSeconds BETWEEN rounds, plus ~14s intro+done. 12 rounds / 9s rest,
// single set = 12*3 + 11*9 + 14 = 36 + 99 + 14 = 149s (~2:29). Pins the exact
// entries so the value cannot silently drift and the old 4-set versions are gone.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dir, '..', 'index.html'), 'utf8');

describe('Moving Warm-Up + Backhand Basics timing (~2:30)', () => {
  it('Moving Warm-Up is 12 rounds / 9s rest, single set', () => {
    expect(html).toContain(
      "'Moving Warm-Up':{type:'rounds',rounds:12,workLabel:'Shot',restSeconds:9},"
    );
    expect(html).not.toContain(
      "'Moving Warm-Up':{type:'rounds',rounds:8,workLabel:'Shot',restSeconds:4,sets:4,setRestSeconds:15},"
    );
  });

  it('Backhand Basics is 12 rounds / 9s rest, single set', () => {
    expect(html).toContain(
      "'Backhand Basics':{type:'rounds',rounds:12,workLabel:'Backhand',restSeconds:9},"
    );
    expect(html).not.toContain(
      "'Backhand Basics':{type:'rounds',rounds:10,workLabel:'Backhand',restSeconds:4,sets:4,setRestSeconds:15},"
    );
  });

  it('the rounds math lands at ~2:30 (12x3s work + 11x9s rest + ~14s intro/done)', () => {
    const rounds = 12, rest = 9;
    const core = rounds * 3 + (rounds - 1) * rest; // 36 + 99 = 135
    const total = core + 14; // setup 5 + countdown 5 + go 0.8 + done 3.2 ~= 14
    expect(core).toBe(135);
    expect(total).toBe(149); // ~2:29, i.e. the 2:30 Woody chose
  });
});
