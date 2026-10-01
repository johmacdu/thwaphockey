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
  it('has the cheer layer, count, and button elements in the card overlay', () => {
    expect(doc.getElementById('cbCheerLayer')).toBeTruthy();
    expect(doc.getElementById('cbCheer')).toBeTruthy();
    expect(doc.getElementById('cbCheerCount')).toBeTruthy();
  });

  it('the button renders the clap + Cheer label', () => {
    const btn = doc.getElementById('cbCheer');
    expect((btn.textContent || '')).toContain('\u{1F44F}'); // clap emoji
    expect((btn.textContent || '')).toContain('Cheer');
  });
});

describe('Cheer only shows on a teammate card, never your own', () => {
  it('the cheer layer is display:none by default', () => {
    const m = html.match(/\.cb-cheer-layer\{([^}]*)\}/);
    expect(m, '.cb-cheer-layer rule exists').not.toBeNull();
    expect(m[1]).toContain('display:none');
  });

  it('the cheer layer is shown ONLY under body.viewing-teammate', () => {
    expect(html).toMatch(/body\.viewing-teammate \.cb-cheer-layer\{display:block\}/);
  });

  it('the client code guards the render to a valid teammate that is not yourself', () => {
    // thwapRenderCheer hides the layer unless there is a real teammate target
    // whose id differs from the signed-in player's id.
    expect(html).toMatch(/to!==from/);
    expect(html).toMatch(/window\.thwapRenderCheer *= *function/);
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
