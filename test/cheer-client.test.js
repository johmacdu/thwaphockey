// test/cheer-client.test.js
//
// Client wiring guard for the teammate "Cheer" (high-five) feature in index.html.
// The frontend is one static HTML file with inline scripts, so (like
// frontend.smoke.test.js) this parses the markup + asserts the structural and
// wiring facts that matter, rather than executing the IIFEs:
//
//   - the Cheer button + count live in a card layer that is HIDDEN by default and
//     shown ONLY under body.viewing-teammate (so you can never cheer your own card)
//   - the tap posts to /api/board?action=cheer with { to } and credentials
//   - the satisfied state flips to "Cheered!" and disables the button
//   - a coach/deploy off-switch (CHEERS_ENABLED) gates the render
//   - no banned punctuation crept in with the feature
//
// @vitest-environment jsdom

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');

let doc;
beforeAll(() => {
  doc = new DOMParser().parseFromString(html, 'text/html');
});

describe('Cheer button markup', () => {
  it('has the cheer row, count, and button BELOW the card (not on the spinning face)', () => {
    // The Cheer control lives in a row under the card (like the own-card theme/photo
    // controls), always visible front or back -- NOT on the card's back face.
    expect(doc.getElementById('cardCtlCheer')).toBeTruthy();
    expect(doc.getElementById('cbCheer')).toBeTruthy();
    expect(doc.getElementById('cbCheerCount')).toBeTruthy();
    // the old spinning back-face layer is gone
    expect(doc.getElementById('cbCheerLayer')).toBeNull();
    // the cheer row sits inside the card control block, below the card
    const row = doc.getElementById('cardCtlCheer');
    expect(row.closest('#cardCtl')).toBeTruthy();
  });

  it('the button renders the clap + Cheer label', () => {
    const btn = doc.getElementById('cbCheer');
    expect((btn.textContent || '')).toContain('\u{1F44F}'); // clap emoji
    expect((btn.textContent || '')).toContain('Cheer');
  });
});

describe('Cheer only shows on a teammate card, never your own', () => {
  it('the cheer row is hidden by default (hidden attribute)', () => {
    const row = doc.getElementById('cardCtlCheer');
    expect(row.hasAttribute('hidden')).toBe(true);
  });

  it('the cheer row is never shown on your OWN card and shown ONLY under viewing-teammate', () => {
    // own card: hard-hidden
    expect(html).toMatch(/body:not\(\.viewing-teammate\) \.cardctl-cheer\{display:none !important\}/);
    // teammate card: shown (when not carrying the hidden attribute)
    expect(html).toMatch(/body\.viewing-teammate \.cardctl-cheer:not\(\[hidden\]\)\{display:flex\}/);
  });

  it('the client code guards the render to a valid teammate that is not yourself', () => {
    // thwapRenderCheer hides the row unless there is a real teammate target
    // whose id differs from the signed-in player's id.
    expect(html).toMatch(/to!==from/);
    expect(html).toMatch(/window\.thwapRenderCheer *= *function/);
    // the render toggles the below-card row via its hidden attribute
    expect(html).toMatch(/row\.hidden *= *!ok/);
    // openTeammateCard triggers the cheer render.
    expect(html).toMatch(/if\(window\.thwapRenderCheer\) window\.thwapRenderCheer\(\);/);
  });
});

describe('Cheer tap wiring', () => {
  it('posts to /api/board?action=cheer with { to } and credentials', () => {
    expect(html).toMatch(/fetch\('\/api\/board\?action=cheer'/);
    expect(html).toMatch(/credentials:'include'/);
    expect(html).toMatch(/body:JSON\.stringify\(\{to:to\}\)/);
  });

  it('flips to the satisfied "Cheered!" disabled state on success', () => {
    expect(html).toMatch(/'\u{1F44F} Cheered!'/u);
    expect(html).toMatch(/cheerBtn\.disabled=true/);
  });

  it('surfaces the quiet not-saved notice on a hard failure (not silent)', () => {
    // fail() path reuses the same loud notice thwapMarkDone uses on a dropped write.
    expect(html).toMatch(/if\(window\.thwapDoneNotSaved\) window\.thwapDoneNotSaved\(\);/);
  });

  it('heals the session and retries once on a 401', () => {
    expect(html).toMatch(/status===401/);
    expect(html).toMatch(/window\.thwapEnsureSession/);
  });
});

describe('Cheer off-switch', () => {
  it('has a CHEERS_ENABLED flag defaulting ON that gates the render', () => {
    expect(html).toMatch(/CHEERS_ENABLED *= *\(window\.CHEERS_ENABLED!==undefined\)\?!!window\.CHEERS_ENABLED:true/);
    // the render + tap both bail when disabled
    const guards = (html.match(/CHEERS_ENABLED && /g) || []).length;
    expect(guards).toBeGreaterThanOrEqual(1);
  });
});

describe('Cheer copy respects the punctuation rules', () => {
  it('the cheer code block has no middot or em/en dash', () => {
    const start = html.indexOf('Cheer (teammate high-five)');
    expect(start).toBeGreaterThan(-1);
    const slice = html.slice(start, start + 4000);
    expect(slice.includes('\u00b7')).toBe(false);
    expect(slice.includes('\u2014')).toBe(false);
    expect(slice.includes('\u2013')).toBe(false);
  });
});

describe('On fire (second teammate reaction) markup', () => {
  it('has the fire button + count in the same below-card control row as Cheer', () => {
    expect(doc.getElementById('cbFire')).toBeTruthy();
    expect(doc.getElementById('cbFireCount')).toBeTruthy();
    // The fire button lives in the same cheer control row as the Cheer button.
    const fireBtn = doc.getElementById('cbFire');
    expect(fireBtn.closest('#cardCtlCheer')).toBeTruthy();
    expect(doc.getElementById('cbCheer').closest('#cardCtlCheer')).toBeTruthy();
  });

  it('the button renders the flame + On fire label', () => {
    const btn = doc.getElementById('cbFire');
    expect((btn.textContent || '')).toContain('\u{1F525}'); // fire emoji
    expect((btn.textContent || '')).toContain('On fire');
  });
});

describe('On fire tap wiring', () => {
  it('posts to /api/board?action=fire with { to } and credentials', () => {
    expect(html).toMatch(/fetch\('\/api\/board\?action=fire'/);
    // the fire send carries credentials and the { to } body
    const start = html.indexOf('Fire ("On fire")');
    expect(start).toBeGreaterThan(-1);
    const slice = html.slice(start, start + 4000);
    expect(slice).toMatch(/credentials:'include'/);
    expect(slice).toMatch(/body:JSON\.stringify\(\{to:to\}\)/);
  });

  it('flips to the satisfied "On fire!" disabled state on success', () => {
    expect(html).toMatch(/'\u{1F525} On fire!'/u);
    expect(html).toMatch(/fireBtn\.disabled=true/);
  });

  it('guards the render + tap to a valid teammate that is not yourself', () => {
    expect(html).toMatch(/window\.thwapRenderFire *= *function/);
    expect(html).toMatch(/FIRE_ENABLED && /);
    // openTeammateCard and the board repaint both trigger the fire render.
    expect(html).toMatch(/if\(window\.thwapRenderFire\) window\.thwapRenderFire\(\);/);
  });

  it('surfaces the quiet not-saved notice on a hard failure and heals a 401', () => {
    const start = html.indexOf('Fire ("On fire")');
    const slice = html.slice(start, start + 6000);
    expect(slice).toMatch(/if\(window\.thwapDoneNotSaved\) window\.thwapDoneNotSaved\(\);/);
    expect(slice).toMatch(/status===401/);
    expect(slice).toMatch(/window\.thwapEnsureSession/);
  });
});

describe('On fire off-switch', () => {
  it('has a FIRE_ENABLED flag defaulting ON that gates the render', () => {
    expect(html).toMatch(/FIRE_ENABLED *= *\(window\.FIRE_ENABLED!==undefined\)\?!!window\.FIRE_ENABLED:true/);
  });
});

describe('On fire copy respects the punctuation rules', () => {
  it('the fire code block has no middot or em/en dash', () => {
    const start = html.indexOf('Fire ("On fire")');
    expect(start).toBeGreaterThan(-1);
    const slice = html.slice(start, start + 4000);
    expect(slice.includes('\u00b7')).toBe(false);
    expect(slice.includes('\u2014')).toBe(false);
    expect(slice.includes('\u2013')).toBe(false);
  });
});

describe('Own-card received-cheer count (flat, not a card)', () => {
  it('has a read-only own-card line, shown only when NOT viewing a teammate', () => {
    expect(doc.getElementById('cardCtlMine')).toBeTruthy();
    expect(doc.getElementById('cbMineCount')).toBeTruthy();
    // hidden on a teammate card, shown on your own card
    expect(html).toMatch(/body\.viewing-teammate \.cardctl-mine\{display:none !important\}/);
    expect(html).toMatch(/body:not\(\.viewing-teammate\) \.cardctl-mine:not\(\[hidden\]\)\{display:flex/);
  });

  it('is flat (theme text color), never a card (no border/fill/elevation)', () => {
    const m = html.match(/\.cardctl-mine-count\{[^}]*\}/);
    expect(m).toBeTruthy();
    expect(m[0]).toMatch(/color:var\(--text\)/);
    expect(m[0]).not.toMatch(/border|box-shadow|background/);
  });

  it('thwapRenderCheer paints the own count when not viewing a teammate', () => {
    expect(html).toMatch(/cardCtlMine/);
    expect(html).toMatch(/You\\u2019ve got '\+n\+\(n===1\?' cheer':' cheers'\)/);
  });
});

describe('Home-screen Sass cheer notification', () => {
  it('has the Sass bubble mount with a speaker image and a close control', () => {
    const pop = doc.getElementById('cheerPop');
    expect(pop).toBeTruthy();
    expect(pop.hasAttribute('hidden')).toBe(true); // hidden until there is news
    expect(doc.getElementById('cheerPopSass')).toBeTruthy();
    expect(doc.getElementById('cheerPopLine')).toBeTruthy();
    expect(doc.getElementById('cheerPopX')).toBeTruthy();
  });

  it('reads the signed-in player\'s own givers from the session-gated endpoint', () => {
    expect(html).toMatch(/\/api\/board\?action=cheers-for/);
    expect(html).toMatch(/window\.thwapCheerNotify *= *function/);
    // players only, signed in, not a coach
    expect(html).toMatch(/if\(!authed \|\| isCoach \|\| !me\) return;/);
  });

  it('rotates between 10 distinct kid-voice lines for a single cheerer', () => {
    const m = html.match(/var LINES=\[([\s\S]*?)\];/);
    expect(m).toBeTruthy();
    const lines = m[1].match(/'[^']*'/g) || [];
    expect(lines.length).toBe(10);
    // every line carries the {name} slot so a giver is always named
    expect(lines.every((l) => l.includes('{name}'))).toBe(true);
    // picked at random so it is not stale
    expect(html).toMatch(/LINES\[Math\.floor\(Math\.random\(\)\*LINES\.length\)\]/);
  });

  it('rolls up multiple cheerers (2 named, 3+ counted with names below)', () => {
    expect(html).toMatch(/' and '\+names\[1\]\+' cheered you/);
    expect(html).toMatch(/count\+' teammates cheered you/);
  });

  it('diffs against a per-device last-seen marker and does not replay a backlog on first visit', () => {
    expect(html).toMatch(/thwapCheerSeen\|/);
    expect(html).toMatch(/if\(since===0\)\{ markSeen\(me,newest\); return; \}/);
  });

  it('runs on load and on tab refocus', () => {
    expect(html).toMatch(/visibilitychange/);
    expect(html).toMatch(/setTimeout\(window\.thwapCheerNotify/);
  });
});

describe('Cheer notification copy respects the punctuation rules', () => {
  it('the home cheer-notify block has no middot or em/en dash', () => {
    const start = html.indexOf('Home-screen cheer notification');
    expect(start).toBeGreaterThan(-1);
    const slice = html.slice(start, start + 4000);
    expect(slice.includes('\u00b7')).toBe(false);
    expect(slice.includes('\u2014')).toBe(false);
    expect(slice.includes('\u2013')).toBe(false);
  });
});

// The count tag must show NOTHING at zero (just the action button), and the
// count only once a teammate actually has one. Rather than assert text in the
// markup, pull the real paint functions out of index.html and run them against
// a jsdom span, so the zero-empty behavior is executed, not guessed.
describe('paintCheerCount / paintFireCount hide the zero-count tag', () => {
  function extractFn(name) {
    // match: function NAME(n){ ... } up to the matching close brace of the body.
    const re = new RegExp('function ' + name + '\\(n\\)\\{([\\s\\S]*?)\\}\\s*(?:function|$)');
    const m = html.match(re);
    expect(m).toBeTruthy();
    return m[1];
  }

  function makePaint(name) {
    const el = doc.createElement('span');
    const body = extractFn(name);
    // bind the module-local element variable the body references.
    const varName = name === 'paintCheerCount' ? 'cheerCountEl' : 'fireCountEl';
    // eslint-disable-next-line no-new-func
    const fn = new Function(varName, 'n', body);
    return { el, call: (n) => fn(el, n) };
  }

  it('paintCheerCount(0) leaves the span empty, (1) and (3) show the count', () => {
    const { el, call } = makePaint('paintCheerCount');
    call(0);
    expect(el.textContent).toBe('');
    call(1);
    expect(el.textContent).toBe('\u{1F44F} 1 cheer');
    call(3);
    expect(el.textContent).toBe('\u{1F44F} 3 cheers');
  });

  it('paintCheerCount with falsy/invalid input leaves the span empty', () => {
    const { el, call } = makePaint('paintCheerCount');
    el.textContent = 'stale';
    call(null);
    expect(el.textContent).toBe('');
    call(undefined);
    expect(el.textContent).toBe('');
    call('nope');
    expect(el.textContent).toBe('');
  });

  it('paintFireCount(0) leaves the span empty, (1) and (3) show the count', () => {
    const { el, call } = makePaint('paintFireCount');
    call(0);
    expect(el.textContent).toBe('');
    call(1);
    expect(el.textContent).toBe('\u{1F525} 1 fire');
    call(3);
    expect(el.textContent).toBe('\u{1F525} 3 fires');
  });

  it('paintFireCount with falsy/invalid input leaves the span empty', () => {
    const { el, call } = makePaint('paintFireCount');
    el.textContent = 'stale';
    call(null);
    expect(el.textContent).toBe('');
    call(undefined);
    expect(el.textContent).toBe('');
    call('nope');
    expect(el.textContent).toBe('');
  });
});
