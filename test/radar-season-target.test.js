import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// The all-time power triangle must scale each spoke to a FIXED per-discipline
// season target (the outer ring), NOT to the player's own highest value. The old
// bug divided by Math.max(...val) so the biggest discipline always pinned to the
// ring automatically, regardless of how much the kid had actually trained.
describe('radar season-target scaling (no auto-max bug)', () => {
  it('defines per-discipline season targets [120,120,72] (24wk: 5/5/3 per week)', () => {
    expect(html).toMatch(/SEASON_TGTMAP=\{[^}]*Stickhandling:120[^}]*Shooting:120[^}]*Dryland:72/);
  });

  it('scales each spoke by its own target, clamped to 1', () => {
    expect(html).toMatch(/var frac=function\(a\)\{var t=SEASON_TGTMAP\[discs\[a\]\]\|\|120;return Math\.min\(1,val\[a\]\/t\)/);
  });

  it('no longer divides the triangle by a self-relative max', () => {
    // the removed bug line was: R*(val[a]/maxv)
    expect(html).not.toMatch(/val\[a\]\/maxv/);
    expect(html).not.toMatch(/var maxv\s*=\s*Math\.max\(1,val\[0\]/);
  });

  // Behavioural check of the exact formula shipped in index.html.
  it('a beginner is near center and only a full season touches the ring', () => {
    const SEASON_TGT = [120, 120, 72, 48];
    const frac = (val, a) => Math.min(1, val[a] / SEASON_TGT[a]);
    // beginner: tiny, not pinned
    expect(frac([3, 2, 1], 0)).toBeCloseTo(0.025, 3);
    // old bug case: biggest spoke used to hit 100%; now it does not
    expect(frac([5, 1, 1], 0)).toBeLessThan(0.05);
    // full season hits the ring exactly
    expect(frac([120, 120, 72], 0)).toBe(1);
    expect(frac([120, 120, 72], 2)).toBe(1);
    // overshoot clamps at the ring
    expect(frac([300, 300, 300], 1)).toBe(1);
  });
});
