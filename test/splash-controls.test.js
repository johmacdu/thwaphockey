// test/splash-controls.test.js
//
// The logged-out login SPLASH must surface a small controls cluster with a SOUND
// toggle and a THEME toggle, reachable before sign-in (the footer copies of these
// controls sit UNDER the splash overlay and are unreachable). The cluster must:
//   - exist with #splashSfx (sound) + #splashTheme (theme) buttons,
//   - be gated to the splash (body.login-locked) and sit above the overlay,
//   - reuse the SAME shared state (localStorage thwapTheme / thwapSfxOn) as the
//     footer buttons, so toggling one reflects live in the other.
//
// @vitest-environment jsdom

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');

describe('Splash controls: source structure', () => {
  it('mounts a splash cluster with a sound button and a theme button', () => {
    expect(html).toContain("class='splashctl' id='splashCtl'");
    expect(html).toContain("id='splashSfx'");
    expect(html).toContain("id='splashTheme'");
    // reuses the footer pill classes (visual language), not a new look
    expect(html).toMatch(/class='sfxtoggle' id='splashSfx'/);
    expect(html).toMatch(/class='themetoggle' id='splashTheme'/);
  });

  it('does NOT add the kebab menu (sign-out is meaningless logged out)', () => {
    // the only footmenu/kebab in source is the footer one, not inside the splash cluster
    const clusterStart = html.indexOf("id='splashCtl'");
    const clusterEnd = html.indexOf('</div>', clusterStart);
    const cluster = html.slice(clusterStart, clusterEnd);
    expect(cluster).not.toContain('footkebab');
    expect(cluster).not.toContain('menuSignout');
  });

  it('is gated to the splash only (body.login-locked) and sits ABOVE the overlay (z>130)', () => {
    expect(html).toContain('.splashctl{display:none}');
    expect(html).toMatch(/body\.login-locked \.splashctl\{display:inline-flex;position:fixed/);
    const m = html.match(/body\.login-locked \.splashctl\{[^}]*z-index:(\d+)/);
    expect(m).toBeTruthy();
    expect(Number(m[1])).toBeGreaterThan(130);
    // interactive layer must take pointer events
    expect(html).toMatch(/body\.login-locked \.splashctl\{[^}]*pointer-events:auto/);
  });

  it('keeps 44px+ tap targets on the splash controls', () => {
    expect(html).toContain('.splashctl .sfxtoggle{width:44px;height:44px}');
    expect(html).toContain('.splashctl .themetoggle{min-height:44px');
  });

  it('wires BOTH sound buttons through the one wireMute() on the shared thwapSfxOn key', () => {
    expect(html).toContain("[document.getElementById('sfxToggle'),document.getElementById('splashSfx')]");
    expect(html).toContain("localStorage.getItem('thwapSfxOn')");
    // splash sound button is in the universal-tap guard so it does not double-fire
    expect(html).toContain("t.closest('#sfxToggle')||t.closest('#splashSfx')");
  });

  it('wires BOTH theme buttons through the one apply() IIFE on the shared thwapTheme key', () => {
    expect(html).toContain("var sb=document.getElementById('splashTheme');if(sb)sb.addEventListener('click',toggle)");
    // the splash theme button updates its own icon/label from the SAME apply()
    expect(html).toContain("document.getElementById('splashTtico')");
    expect(html).toContain("document.getElementById('splashTtlabel')");
  });

  it('adds no banned punctuation (middot / em-dash / en-dash) on the splash lines', () => {
    const lines = html.split('\n').filter((l) => /splashctl|splashSfx|splashTheme|splashTtico|splashTtlabel|Splash controls/.test(l));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) {
      expect(/[\u00B7\u2014\u2013]/.test(l)).toBe(false);
    }
  });
});

describe('Splash controls: live behavior (jsdom)', () => {
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
    await new Promise((r) => setTimeout(r, 80));
  });

  it('renders both toggle buttons in the DOM', () => {
    expect(doc.getElementById('splashCtl')).toBeTruthy();
    expect(doc.getElementById('splashSfx')).toBeTruthy();
    expect(doc.getElementById('splashTheme')).toBeTruthy();
  });

  it('toggling the splash theme button flips <html data-theme> and the footer button label in sync', () => {
    const splashBtn = doc.getElementById('splashTheme');
    const footerIco = doc.getElementById('ttico');
    const splashIco = doc.getElementById('splashTtico');
    const before = doc.documentElement.getAttribute('data-theme');
    splashBtn.click();
    const after = doc.documentElement.getAttribute('data-theme');
    expect(after).not.toBe(before);
    // both icons reflect the SAME new state (dark => sun on both)
    expect(splashIco.textContent).toBe(footerIco.textContent);
    expect(win.localStorage.getItem('thwapTheme')).toBe(after);
    splashBtn.click(); // leave state clean
  });

  it('muting via the splash sound button updates the footer sound button live (shared thwapSfxOn)', () => {
    const splashSfx = doc.getElementById('splashSfx');
    const footerSfx = doc.getElementById('sfxToggle');
    // default ON
    expect(splashSfx.getAttribute('aria-pressed')).toBe('true');
    expect(footerSfx.getAttribute('aria-pressed')).toBe('true');
    splashSfx.click(); // mute
    expect(win.localStorage.getItem('thwapSfxOn')).toBe('0');
    expect(splashSfx.getAttribute('aria-pressed')).toBe('false');
    // the footer button repaints to the same muted state via the shared paint()
    expect(footerSfx.getAttribute('aria-pressed')).toBe('false');
    expect(footerSfx.classList.contains('off')).toBe(true);
    splashSfx.click(); // unmute, leave clean
    expect(footerSfx.getAttribute('aria-pressed')).toBe('true');
  });
});
