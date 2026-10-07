// test/signin-sheet-mobile.test.js
//
// Four mobile splash/sign-in fixes (Woody, Oct 6 2026):
//   1. The splash header (.topbar while body.login-locked) must STAY visible on
//      mobile scroll -> position:sticky; top:0 (was position:relative).
//   2. Both the Sign In and Join Waitlist sheets have a close (X) button in the
//      top-right (#loginClose / #waitClose), wired to dismiss the overlay.
//   3a. The "New to <wordmark>?" wordmark uses the PLAIN wordmark (no TM) and is
//       smaller (height:44px, was 56px).
//   3b. "Forgot your code?" sits closer to the Sign In button: smaller top
//       margin, DOUBLE the bottom padding.
//   + The waitlist blurb is concise.
//
// @vitest-environment jsdom

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');

describe('Sign-in sheet mobile fixes', () => {
  it('1. splash header is pinned (fixed) AND transparent so it stays visible with no white band', () => {
    expect(html).toMatch(/body\.login-locked \.topbar\{position:fixed;top:0;[^}]*background:transparent/);
    // the old sticky rule painted a solid near-white band over the frost -- must be gone
    expect(html).not.toContain('body.login-locked .topbar{position:sticky;top:0;z-index:120;background:var(--bg)}');
    expect(html).not.toContain('body.login-locked .topbar{position:relative');
    // header sits above the frost (z-90) but BELOW the sheet (z-130) so the sheet covers it
    expect(html).toMatch(/body\.login-locked \.topbar\{position:fixed;[^}]*z-index:95/);
  });

  it('2. both sheets carry a glass circular close, wired to return to the splash (NOT unlock the app)', () => {
    expect(html).toContain("id='loginClose'");
    expect(html).toContain("id='waitClose'");
    // iOS-style glass circular button: round + backdrop blur, not a rounded square with a solid fill
    expect(html).toMatch(/\.login-x\{position:absolute;[^}]*border-radius:50%/);
    expect(html).toMatch(/\.login-x\{[^}]*backdrop-filter:saturate\(180%\) blur\(18px\)/);
    expect(html).not.toMatch(/\.login-x\{position:absolute;top:12px;right:12px;z-index:3;[^}]*border-radius:10px/);
    // the X returns to the frozen splash: it hides the sheet but keeps the frost + login-locked
    expect(html).toContain('function backToSplash()');
    expect(html).not.toContain('function closeOverlay()');
    // backToSplash must NOT call hide() (which strips login-locked and dumps the user on the home screen)
    const bts = html.match(/function backToSplash\(\)\{[^}]*\}/)[0];
    expect(bts).not.toContain('hide()');
    expect(bts).not.toContain("classList.remove('login-locked')");
    expect(html).toContain("backToSplash();");
  });

  it('2. the waitlist blurb is the concise version', () => {
    expect(html).toContain('Tell us where you play and we will reach out when THWAP opens.');
    expect(html).not.toContain('when THWAP opens for your team');
  });

  it('3a. the "New to" wordmark is the plain (no-TM) mark and is smaller', () => {
    expect(html).toContain(".login-wordmark{height:44px");
    expect(html).not.toContain(".login-wordmark{height:56px");
    expect(html).toContain("id='loginMark' src='wordmark-light.svg'");
    expect(html).not.toContain("id='loginMark' src='wordmark-tm-light.svg'");
    expect(html).toContain("lm.setAttribute('src',dark?'wordmark-dark.svg':'wordmark-light.svg')");
  });

  it('3b. "Forgot your code?" has reduced top margin and doubled bottom padding', () => {
    expect(html).toMatch(/\.login-otp-toggle\{display:block;width:100%;margin:2px 0 0;background:none;border:0;padding:2px 4px 8px;/);
    expect(html).not.toMatch(/\.login-otp-toggle\{[^}]*margin:10px 0 0;[^}]*padding:4px;/);
  });

  describe('rendered DOM', () => {
    let doc;
    beforeAll(() => { doc = new JSDOM(html).window.document; });

    it('close buttons exist inside their respective sheets', () => {
      const signin = doc.getElementById('loginForm');
      const wait = doc.getElementById('waitForm');
      expect(signin.querySelector('#loginClose')).toBeTruthy();
      expect(wait.querySelector('#waitClose')).toBeTruthy();
      expect(doc.getElementById('loginClose').getAttribute('aria-label')).toBe('Close');
      expect(doc.getElementById('waitClose').getAttribute('aria-label')).toBe('Close');
    });
  });
});
