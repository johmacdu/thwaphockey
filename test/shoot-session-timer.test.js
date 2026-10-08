import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dir, '..', 'index.html'), 'utf8');

/* The shooting timer is a single continuous countdown (no rests). Each shooting
   drill is a FLAT 2:30 (150s), independent of how many drills the day shows
   (Woody's fixed per-drill length). These guard the load-bearing pieces:
   the type:'session' branch, the flat 150s at the call site, and the duration
   override plumbed through thwapDrillTimer. */
describe('shooting session timer', () => {
  it('buildSteps has a type:session continuous-countdown branch with no rest phase', () => {
    expect(html).toMatch(/sc\.type===['"]session['"]/);
    // MM:SS formatter present inside the session branch
    expect(html).toMatch(/var mmss=function\(sec\)\{/);
    // the session branch must NOT push a 'Rest' phase (no rests for shooting)
    const branch = html.slice(html.indexOf("sc.type==='session'"), html.indexOf("sc.type==='reps'||sc.type==='hold'"));
    expect(branch).not.toMatch(/phase:'Rest'/);
  });

  it('every shooting drill is a flat 150s (2:30), not scaled to the day count', () => {
    // flat duration constant at the call site
    expect(html).toMatch(/var _dur=150;/);
    // the flat duration is passed to the timer
    expect(html).toMatch(/window\.thwapDrillTimer\(SHOOT\[i\]\.name,\s*markDone,\s*SHOOT\[i\]\.audio,\s*\{[^}]*\},\s*_dur\)/);
    // the old session-budget scaling must be gone
    expect(html).not.toMatch(/_n===3\?270/);
    expect(html).not.toMatch(/810\/Math\.max/);
  });

  it('thwapDrillTimer converts a positive durSecs into a session script', () => {
    expect(html).toMatch(/if\(durSecs && durSecs>0\) sc=\{type:'session', seconds:Math\.round\(durSecs\)\}/);
  });

  it('150s is exactly two minutes thirty seconds', () => {
    expect(150).toBe(2 * 60 + 30);
  });
});
