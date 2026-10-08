// test/about-demo-leak.test.js
//
// Bug (Woody, Oct 6 2026): splash -> About -> Back auto-logged the user into the
// Demo Team. The About page embeds the app as <iframe src='/?demo=1'>, and the
// demo auto-entry wrote a path=/ thwapAuth cookie (plus thwapDemo + bfPlayer) into
// the SHARED same-origin storage. Tapping Back booted the top-level tab, whose
// gate() saw that cookie, called hide(), and landed on the demo team instead of
// the splash.
//
// The fix:
//   1. demo-mode.js auto-enters ?demo=1 ONLY inside an iframe, and NEVER writes
//      the shared path=/ thwapAuth cookie.
//   2. index.html gate() skips the embed's own splash via window.__thwapDemoEmbed,
//      and when it DOES show the splash at top level it clears leaked demo state.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const html = readFileSync(resolve(root, 'index.html'), 'utf8');
const mode = readFileSync(resolve(root, 'demo/demo-mode.js'), 'utf8');
const about = readFileSync(resolve(root, 'about.html'), 'utf8');

describe('About demo embed does not leak demo auth to the top-level tab', () => {
  it('the About page still embeds the demo app in an iframe', () => {
    expect(about).toContain("src='/?demo=1'");
    expect(about).toMatch(/<iframe[^>]*class='phone-frame'/);
  });

  it('demo-mode auto-entry is iframe-gated (window.self !== window.top)', () => {
    expect(mode).toContain('window.self !== window.top');
    expect(mode).toMatch(/if \(inEmbed && \/\[\?&\]demo=1/);
  });

  it('demo-mode auto-entry does NOT write the shared path=/ thwapAuth cookie', () => {
    // The whole leak was this cookie write inside the ?demo=1 auto-entry block.
    const block = mode.slice(mode.indexOf('inEmbed && /[?&]demo=1'), mode.indexOf('installCoachFetchShim'));
    expect(block).not.toContain("thwapAuth=");
    expect(block).not.toContain(";path=/");
    expect(mode).toContain('window.__thwapDemoEmbed = true;');
  });

  it('gate() skips the embed splash via the frame flag, not a leaked cookie', () => {
    expect(html).toContain('window.__thwapDemoEmbed && window.THWAP_DEMO && window.THWAP_DEMO.isActive()');
    expect(html).toContain('if(isAuthed() || hasCoach || demoEmbed){ hide(); return; }');
  });

  it('gate() clears leaked demo state when showing the splash at top level', () => {
    expect(html).toMatch(/if\(!demoEmbed && window\.THWAP_DEMO && window\.THWAP_DEMO\.isActive\(\)\)\{ window\.THWAP_DEMO\.deactivate\(\);/);
  });

  // Bug (Woody, Oct 7 2026): the guest fix above did NOT cover a SIGNED-IN player.
  // The iframe still writes bfPlayer='Mario Lemieux' + thwapDemo=1 into shared
  // localStorage, and for an authed user gate() took the hide() path without
  // cleaning up, so Back landed on Mario (the demo team's player).
  it('gate() heals a leaked demo state for a SIGNED-IN user, restoring the real player', () => {
    // The heal runs when demo leaked AND a real session exists, BEFORE the hide() return.
    expect(html).toContain('if(!demoEmbed && window.THWAP_DEMO && window.THWAP_DEMO.isActive() && (isAuthed() || hasCoach)){');
    // It restores bfPlayer from the real auth record's name, never leaves it as Mario.
    expect(html).toContain("if(_ra && _ra.name){ try{ localStorage.setItem('bfPlayer', _ra.name); }catch(_){} }");
    // The heal must appear BEFORE the authed hide() return (so it runs for authed users).
    const healIdx = html.indexOf('window.THWAP_DEMO.isActive() && (isAuthed() || hasCoach))');
    const hideIdx = html.indexOf('if(isAuthed() || hasCoach || demoEmbed){ hide(); return; }');
    expect(healIdx).toBeGreaterThan(-1);
    expect(hideIdx).toBeGreaterThan(healIdx);
  });

  it('about.html restores the real identity on pagehide (belt-and-suspenders)', () => {
    expect(about).toContain("var KEYS=['bfPlayer','thwapDemo'];");
    expect(about).toContain("window.addEventListener('pagehide', restore);");
    // snapshot is taken (before the lazy iframe can overwrite it)
    expect(about).toMatch(/var real=\{\}; try\{ KEYS\.forEach/);
  });
});
