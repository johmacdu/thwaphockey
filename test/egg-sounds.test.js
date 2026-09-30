import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

describe('Easter-egg sound layer', () => {
  it('exposes a mute-bypassing egg player (window.thwapSfxEgg)', () => {
    expect(HTML).toContain('window.thwapSfxEgg=playEgg');
  });

  it('playEgg IGNORES the mute toggle (never calls sfxOn) but respects reduced-motion', () => {
    // isolate the playEgg body
    const m = HTML.match(/function playEgg\(name\)\{([\s\S]*?)\n  \}/);
    expect(m).toBeTruthy();
    const body = m[1];
    // must NOT gate on the mute state
    expect(body).not.toContain('sfxOn()');
    // must bail under reduced-motion (egg visuals are disabled there)
    expect(body).toContain('if(reduce)return;');
  });

  it('defines a sound for every egg key', () => {
    for (const k of ['eggStick', 'eggShoot', 'eggDryland', 'eggPass', 'eggSkate', 'eggThwap']) {
      expect(HTML).toContain(k + ':{c:');
    }
  });

  it('hooks the four drill-icon tap eggs', () => {
    expect(HTML).toContain("thwapSfxEgg('eggStick')");   // stickhandling weave
    expect(HTML).toContain("thwapSfxEgg('eggShoot')");   // bar down
    expect(HTML).toContain("thwapSfxEgg('eggDryland')"); // zap
    expect(HTML).toContain("thwapSfxEgg('eggPass')");    // sauce
  });

  it('fires the bar-down at the shooting impact moment (440ms), not on press', () => {
    expect(HTML).toMatch(/egg-hit'\);\s*hole\.classList\.add\("punch"\);\s*try\{ if\(window\.thwapSfxEgg\)thwapSfxEgg\('eggShoot'\);/);
  });

  it('hooks the Sass skate egg and the wordmark THWAP hit', () => {
    expect(HTML).toContain("thwapSfxEgg('eggSkate')");
    // THWAP hit fires inside shatterWordmark (shared by skate-through + slapshot)
    expect(HTML).toMatch(/wm\.style\.visibility='hidden';\s*try\{ if\(window\.thwapSfxEgg\)thwapSfxEgg\('eggThwap'\);/);
  });
});
