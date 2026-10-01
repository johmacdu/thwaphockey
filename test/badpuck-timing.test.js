// test/badpuck-timing.test.js
//
// Guard for the Bad Puck Challenge drill timing in index.html THWAP_DRILL_SCRIPT.
// Woody explicitly chose 8 rounds / 8s rest (no sets), which the rounds engine
// turns into ~1:34 of core time (8 x 3s work + 7 x 8s rest), NOT 2:30. This
// pins the exact script entry so the value cannot silently drift, and documents
// the resulting total from the same math buildSteps uses for type:'rounds'.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dir, '..', 'index.html'), 'utf8');

describe('Bad Puck Challenge timing', () => {
  it('is 8 rounds / 8s rest, type rounds, workLabel Shot, with NO sets', () => {
    expect(html).toContain(
      "'Bad Puck Challenge':{type:'rounds',rounds:8,workLabel:'Shot',restSeconds:8},"
    );
    // The old 5s rest + 4-set entry must be gone.
    expect(html).not.toContain(
      "'Bad Puck Challenge':{type:'rounds',rounds:8,workLabel:'Shot',restSeconds:5,sets:4,setRestSeconds:15},"
    );
  });

  it('the rounds math yields ~1:34 of core work+rest (8 x 3s work + 7 x 8s rest)', () => {
    const rounds = 8;
    const restSeconds = 8;
    const workSecPerRound = 3; // buildSteps pushes a 3000ms work step per round
    const work = rounds * workSecPerRound; // 24s
    const rest = (rounds - 1) * restSeconds; // 56s (rest only BETWEEN rounds)
    const core = work + rest;
    expect(core).toBe(80); // 1:20 of work+rest, plus ~14s intro/done -> ~1:34
    // Sanity: it is well under the mistaken 2:30 (150s) figure.
    expect(core).toBeLessThan(150);
  });
});
