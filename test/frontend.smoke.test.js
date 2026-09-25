// test/frontend.smoke.test.js
//
// Frontend smoke test for index.html. The frontend is a single static HTML file
// with inline scripts, so this is a smoke test (parse + structural + content
// assertions) rather than deep unit tests: it catches real regressions (broken
// markup, missing key elements, banned punctuation creeping back, the streak
// banner flashing on) without a risky refactor of the inline IIFEs.
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
  // Parse the markup into a real DOM. We do NOT execute the inline scripts here
  // (jsdom would need runScripts + network for fonts); parsing + querying the
  // structure is what catches markup regressions.
  doc = new DOMParser().parseFromString(html, 'text/html');
});

describe('index.html structure', () => {
  it('parses as an HTML document with a title', () => {
    expect(doc.querySelector('title')?.textContent).toContain('Thwap Hockey');
  });

  it('has balanced <section> tags (open === close === 11)', () => {
    const open = (html.match(/<section id=/g) || []).length;
    const close = (html.match(/<\/section>/g) || []).length;
    expect(open).toBe(close);
    expect(open).toBe(11); // #addplayer is now a .sheet side panel, not a page section
  });

  it('#home is the last section (required for :target hash nav)', () => {
    const sections = [...doc.querySelectorAll('section[id]')];
    expect(sections[sections.length - 1].id).toBe('home');
  });

  it('has the three discipline drill sections', () => {
    for (const id of ['stick', 'shoot', 'dryland']) {
      expect(doc.getElementById(id), `#${id} exists`).toBeTruthy();
    }
  });

  it('has the leaderboard board + timeframe controls', () => {
    expect(doc.getElementById('board')).toBeTruthy();
    expect(doc.querySelectorAll('#timeframe .segbtn').length).toBeGreaterThanOrEqual(2);
  });
});

describe('inline scripts', () => {
  it('contains multiple inline <script> blocks that are non-empty', () => {
    const blocks = html.match(/<script>[\s\S]*?<\/script>/g) || [];
    expect(blocks.length).toBeGreaterThanOrEqual(10);
    expect(blocks.every((b) => b.replace(/<\/?script>/g, '').trim().length > 0)).toBe(true);
  });

  it('every inline script is syntactically valid JS', () => {
    const blocks = html.match(/<script>([\s\S]*?)<\/script>/g) || [];
    for (const b of blocks) {
      const code = b.replace(/<\/?script>/g, '');
      // Throws on a syntax error; the test fails with the offending message.
      // eslint-disable-next-line no-new, no-new-func
      expect(() => new Function(code)).not.toThrow();
    }
  });
});

describe('content rules', () => {
  it('has no em-dash, en-dash, or middle-dot in the source', () => {
    expect(html.includes('\u2014'), 'em-dash present').toBe(false);
    expect(html.includes('\u2013'), 'en-dash present').toBe(false);
    expect(html.includes('\u00b7'), 'middle-dot present').toBe(false);
  });

  it('hides the team streak banner by default (no fake streak flash)', () => {
    const banner = doc.getElementById('lbStreak');
    expect(banner).toBeTruthy();
    expect(banner.getAttribute('style') || '').toContain('display:none');
  });
});

describe('coach view navigation', () => {
  it('coach/shared close buttons use the js-home-close hook (not href=".")', () => {
    expect(doc.getElementById('rosterClose')?.classList.contains('js-home-close')).toBe(true);
    const closers = [...doc.querySelectorAll('a.js-home-close')];
    expect(closers.length).toBeGreaterThanOrEqual(3);
    closers.forEach((a) => expect(a.getAttribute('href')).toBe('#home'));
    expect(html).toMatch(/is-coach'\)\s*\?\s*'#coachhome'\s*:\s*'#home'/);
  });

  it('roster player cards link to the player page, not the coach-hidden home', () => {
    const cards = [...doc.querySelectorAll('#roster-grid .pcard[data-name]')];
    expect(cards.length).toBeGreaterThan(0);
    cards.forEach((c) => expect(c.getAttribute('href')).toBe('#player'));
  });

  it('coach roster tap opens the player page with Back to Team', () => {
    expect(html).toMatch(/openPlayerPage\(name,\s*'team'\)/);
  });

  it('the "View as player" toggle and "Back to coach" bar are removed', () => {
    expect(doc.getElementById('viewAsPlayer')).toBeNull();
    expect(doc.getElementById('viewAsBack')).toBeNull();
    expect(html.includes('Back to coach')).toBe(false);
    expect(html.includes('viewas-active')).toBe(false);
  });

  it('the Players-header edit control is an icon button with an aria-label', () => {
    const edit = doc.getElementById('rosterEdit');
    expect(edit).toBeTruthy();
    expect(edit.getAttribute('aria-label')).toBeTruthy();
    expect((edit.textContent || '').trim()).not.toBe('Edit');
  });

  it('the active coach team is deterministic (prefers the 10U team)', () => {
    // Guards the "different coaching experiences" bug: teams[0] varied between
    // seeded accounts, so the landing team must prefer RANGERS72 explicitly.
    expect(html).toMatch(/indexOf\('RANGERS72'\)!==-1\)\s*return\s*'RANGERS72'/);
  });

  it('the +Player add card uses the dark themed card front, not solid white', () => {
    const m = html.match(/\.pcard-add\{([^}]*)\}/);
    expect(m).not.toBeNull();
    expect(m[1]).not.toMatch(/background:\s*#fff/i);
    expect(m[1]).toMatch(/linear-gradient/);
  });
});

describe('accessibility', () => {
  it('has a keyboard focus-visible ring rule', () => {
    expect(html).toMatch(/:focus-visible/);
  });

  it('gives the timeframe tabs at least a 44px tap target', () => {
    const m = html.match(/\.segbtn\{[^}]*min-height:(\d+)px/);
    expect(m, 'segbtn has a min-height').not.toBeNull();
    expect(Number(m[1])).toBeGreaterThanOrEqual(44);
  });

  it('labels the icon-only controls (kebab + theme toggle)', () => {
    expect(doc.getElementById('kebab')?.getAttribute('aria-label')).toBeTruthy();
    expect(doc.getElementById('themeToggle')?.getAttribute('aria-label')).toBeTruthy();
  });
});

describe('Team page: scaled roster card keeps the Jr Rangers / Vancouver WA block inside', () => {
  it('the association/location fix is scoped to #roster only', () => {
    expect(html).toMatch(/#roster \.pcard \.cf2-foot\{padding-right:22px\}/);
    expect(html).toMatch(/#roster \.pcard \.cf2-team\{letter-spacing:\.04em\}/);
  });
  it('the base card foot rule is unchanged, so other surfaces render as before', () => {
    expect(html).toMatch(/\.cf2-foot\{position:absolute;left:0;right:0;bottom:0;z-index:4;padding:12px 16px 16px/);
  });
});

describe('Cross-tab identity guard', () => {
  it('listens for storage changes on the identity keys and reloads', () => {
    expect(html).toMatch(/addEventListener\('storage'/);
    expect(html).toMatch(/IDENTITY_KEYS *= *\['bfPlayer', 'thwapAuth', 'thwapCoach'\]/);
  });
});

describe('Drill videos on all three disciplines', () => {
  it('the Watch-how video link is removed from all drills (videoBlock/ytEmbed are no-ops)', () => {
    // The linked clips were not accurate to the drill, so the "Watch how" expander
    // was removed. The render call sites stay (videoBlock(dr) is still called in the
    // three tile strings), but videoBlock/ytEmbed now return "" so no link renders.
    const callSites = (html.match(/\+(?:window\.)?videoBlock\(dr\)(?:\+(?:window\.)?audioBlock\(dr\))?\+steps/g) || []).length;
    expect(callSites).toBe(3);
    expect(html).toMatch(/window\.ytid=ytid; window\.videoBlock=videoBlock;/);
    // No "Watch how" button is produced by either video renderer.
    expect(/function videoBlock\(dr\)\{[\s\S]{0,320}?return "";[\s\S]{0,10}?\}/.test(html)).toBe(true);
    expect(html).not.toMatch(/if\(id\)\{\s*return "<button[^"]*exvid-link/);
  });
  it('each discipline launches the full-screen guided runner from its Start button', () => {
    // three thwapDrillTimer launch sites (dryland, stick, shoot), each with a Start label
    const launches = (html.match(/window\.thwapDrillTimer\(/g) || []).length;
    expect(launches).toBeGreaterThanOrEqual(3);
    const startLabels = (html.match(/doneLabel=prog\[i\]\?'Done \u2713':'Start'/g) || []).length;
    expect(startLabels).toBeGreaterThanOrEqual(3);
  });
});

describe('Sass logo easter egg: no mobile long-press image callout', () => {
  it('#sassLogo suppresses the iOS long-press callout/selection/drag (CSS half of the fix)', () => {
    // pairs with the existing JS contextmenu preventDefault; the CSS half was missing.
    expect(html).toMatch(/#sassLogo\{[^}]*-webkit-touch-callout:none/);
    expect(html).toMatch(/#sassLogo\{[^}]*user-select:none/);
    expect(html).toMatch(/#sassLogo\{[^}]*-webkit-user-drag:none/);
    // and the JS contextmenu guard is still present
    expect(html).toMatch(/logo\.addEventListener\('contextmenu',function\(e\)\{ e\.preventDefault\(\); \}\)/);
  });
});

describe('Splash THWAP! impact sound', () => {
  it('plays the hit sound at the impact step, guarded by mute/reduced-motion', () => {
    // wired right where the burst fires
    expect(html).toMatch(/setStep\('impact'\);\s*thwapPlaySplashHit\(\);/);
    // guards: reduced motion + mute + autoplay-block safe
    expect(html).toMatch(/function thwapPlaySplashHit\(\)\{[\s\S]*reduceMotion\(\)/);
    expect(html).toMatch(/new Audio\('login\/thwap-hit\.mp3'\)/);
    expect(html).toMatch(/p\.catch\(function\(\)\{\}\)/);
  });
  it('ships the thwap-hit.mp3 asset', () => {
    const p = resolve(__dirname, '../login/thwap-hit.mp3');
    expect(readFileSync(p).length).toBeGreaterThan(1000);
  });
});
