// test/splash-controls.test.js
//
// The logged-out login SPLASH must let a player/parent reach the SOUND toggle and
// the THEME toggle before sign-in. PR #299 wrongly added a DUPLICATE cluster
// (#splashCtl / #splashSfx / #splashTheme) on top of the frost. The correct fix is
// to surface the EXISTING footer controls (#sfxToggle + #themeToggle) above the
// frost while body.login-locked is active, so there is exactly ONE set of controls.
//
// This suite asserts:
//   (a) NO #splashCtl / #splashSfx / #splashTheme / .splashctl exist anywhere,
//   (b) the REAL #sfxToggle + #themeToggle footer is lifted above the frost
//       (#loginBackdrop z-90) but kept BELOW the sheet (#loginOverlay z-130) on
//       body.login-locked by z-index ALONE, so the sheet always covers the footer
//       (no overlap with the Sign In button on tall mobile sheets). Kept in its
//       exact home-screen position (position:relative, nothing moved or hidden --
//       PR #304 reverted #300's relocate + slogan/kebab hide),
//   (c) those real controls still drive thwapTheme / thwapSfxOn as before.
//
// @vitest-environment jsdom

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');

describe('Splash controls: the #299 duplicate is fully removed', () => {
  it('has NO #splashCtl / #splashSfx / #splashTheme ids anywhere', () => {
    expect(html).not.toContain('splashCtl');
    expect(html).not.toContain('splashSfx');
    expect(html).not.toContain('splashTheme');
  });

  it('has NO .splashctl class, markup or CSS, and no splash ttico/ttlabel fork', () => {
    expect(html).not.toContain('splashctl');
    expect(html).not.toContain('splashTtico');
    expect(html).not.toContain('splashTtlabel');
  });

  it('leaves the sfx wiring unforked (only #sfxToggle in the btns array and guard)', () => {
    expect(html).toContain("var btns=[document.getElementById('sfxToggle')].filter(Boolean);");
    expect(html).toContain("if(t.closest('#sfxToggle'))return null;");
  });

  it('leaves the theme IIFE unforked (only #themeToggle listener)', () => {
    expect(html).toContain("var b=document.getElementById('themeToggle');if(b)b.addEventListener('click',toggle);})();");
  });
});

describe('Splash controls: the REAL footer controls are surfaced above the frost', () => {
  it('still ships the single real footer with #sfxToggle + #themeToggle', () => {
    expect(html).toMatch(/class='sfxtoggle' id='sfxToggle'/);
    expect(html).toMatch(/class='themetoggle' id='themeToggle'/);
    // exactly one of each id
    expect((html.match(/id='sfxToggle'/g) || []).length).toBe(1);
    expect((html.match(/id='themeToggle'/g) || []).length).toBe(1);
  });

  it('lifts the real .footer above the frost but BELOW the sheet (90 < z < 130) in place, pointer-reachable, on body.login-locked', () => {
    const m = html.match(/body\.login-locked \.footer\{([^}]*)\}/);
    expect(m).toBeTruthy();
    const rule = m[1];
    // Keep the footer in its EXACT home-screen position -- only raise its stacking.
    // position:relative (in flow), NOT fixed (relocated).
    expect(rule).toMatch(/position:relative/);
    expect(rule).not.toMatch(/position:fixed/);
    const z = rule.match(/z-index:(\d+)/);
    expect(z).toBeTruthy();
    // Must sit ABOVE the frost (#loginBackdrop z-90) so the toggles are tappable on
    // the bare splash, but BELOW the sign-in sheet (#loginOverlay z-130) so the sheet
    // always covers the footer -- otherwise the footer controls render ON TOP of the
    // Sign In button on tall mobile sheets (the overlap bug this guards against).
    expect(Number(z[1])).toBeGreaterThan(90);
    expect(Number(z[1])).toBeLessThan(130);
    expect(rule).toMatch(/pointer-events:auto/);
  });

  it('does NOT relocate or hide any footer part on the splash (whole footer stays, per PR #304)', () => {
    // The reverted #300 behaviour hid the slogan + kebab and moved the footer
    // bottom-center. PR #304 keeps the footer exactly as on the home screen and
    // only lifts z-index. Assert the old hide rule is gone.
    expect(html).not.toMatch(/body\.login-locked \.footer \.slogan,body\.login-locked \.footer \.footmenu-wrap\{display:none\}/);
    expect(html).not.toMatch(/body\.login-locked \.footer\{[^}]*position:fixed/);
  });

  it('adds no banned punctuation (middot / em-dash / en-dash) on the surfacing lines', () => {
    const lines = html.split('\n').filter((l) => /login-locked \.footer|login splash \(body\.login-locked\)/.test(l));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) {
      expect(/[\u00B7\u2014\u2013]/.test(l)).toBe(false);
    }
  });
});

describe('Splash controls: live behavior via the real footer controls (jsdom)', () => {
  let win, doc;
  beforeAll(async () => {
    const dom = new JSDOM(html, {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      url: 'http://localhost/',
      beforeParse(window) {
        window.fetch = () => Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)), json: () => Promise.resolve({ ok: false }) });
        window.scrollTo = () => {};
      },
    });
    win = dom.window; doc = win.document;
    await new Promise((r) => setTimeout(r, 120));
  });

  it('does NOT render any splash-duplicate nodes', () => {
    expect(doc.getElementById('splashCtl')).toBeNull();
    expect(doc.getElementById('splashSfx')).toBeNull();
    expect(doc.getElementById('splashTheme')).toBeNull();
  });

  it('renders the single real footer sound + theme toggles', () => {
    expect(doc.getElementById('sfxToggle')).toBeTruthy();
    expect(doc.getElementById('themeToggle')).toBeTruthy();
  });

  it('toggling the real theme button flips <html data-theme> and persists thwapTheme', () => {
    const btn = doc.getElementById('themeToggle');
    const before = doc.documentElement.getAttribute('data-theme');
    btn.click();
    const after = doc.documentElement.getAttribute('data-theme');
    expect(after).not.toBe(before);
    expect(win.localStorage.getItem('thwapTheme')).toBe(after);
    btn.click(); // leave state clean
    expect(doc.documentElement.getAttribute('data-theme')).toBe(before);
  });

  it('muting via the real sound button persists thwapSfxOn and repaints aria-pressed', () => {
    const sfx = doc.getElementById('sfxToggle');
    expect(sfx.getAttribute('aria-pressed')).toBe('true'); // default ON
    sfx.click(); // mute
    expect(win.localStorage.getItem('thwapSfxOn')).toBe('0');
    expect(sfx.getAttribute('aria-pressed')).toBe('false');
    expect(sfx.classList.contains('off')).toBe(true);
    sfx.click(); // unmute, leave clean
    expect(sfx.getAttribute('aria-pressed')).toBe('true');
  });
});
