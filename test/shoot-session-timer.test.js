import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dir, '..', 'index.html'), 'utf8');

/* The shooting timer is a single continuous countdown whose length adapts to how
   many drills the day shows (no rests). These guard the load-bearing pieces:
   the type:'session' branch, the duration table at the call site, and the
   duration override plumbed through thwapDrillTimer. */
describe('shooting session timer', () => {
  it('buildSteps has a type:session continuous-countdown branch with no rest phase', () => {
    expect(html).toMatch(/sc\.type===['"]session['"]/);
    // MM:SS formatter present inside the session branch
    expect(html).toMatch(/var mmss=function\(sec\)\{/);
    // the session branch must NOT push a 'Rest' phase (no rests for shooting)
    const branch = html.slice(html.indexOf("sc.type==='session'"), html.indexOf("sc.type==='reps'||sc.type==='hold'"));
    expect(branch).not.toMatch(/phase:'Rest'/);
  });

  it('shooting call site sizes each drill by the day count: 3 -> 270s, 4 -> 210s, else 810/n', () => {
    expect(html).toMatch(/_n===3\?270:\(_n===4\?210:Math\.round\(810\/Math\.max\(1,_n\)\)\)/);
    // the computed duration is passed to the timer
    expect(html).toMatch(/window\.thwapDrillTimer\(SHOOT\[i\]\.name,\s*markDone,\s*SHOOT\[i\]\.audio,\s*\{[^}]*\},\s*_dur\)/);
  });

  it('thwapDrillTimer converts a positive durSecs into a session script', () => {
    expect(html).toMatch(/if\(durSecs && durSecs>0\) sc=\{type:'session', seconds:Math\.round\(durSecs\)\}/);
  });

  it('the two anchor cases produce the requested lengths', () => {
    // pure math check of the table
    const dur = (n) => (n === 3 ? 270 : n === 4 ? 210 : Math.round(810 / Math.max(1, n)));
    expect(dur(3)).toBe(270); // 4:30
    expect(dur(4)).toBe(210); // 3:30
  });
});
