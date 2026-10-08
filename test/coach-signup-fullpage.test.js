// test/coach-signup-fullpage.test.js
//
// EXECUTION test (not a string guard): boots index.html in jsdom and verifies two
// product rules for the self-serve coach signup entry point:
//
//   1. The sign-in sheet's "Coaching a team? Create your team." line is HIDDEN for
//      now (it will later REPLACE "Join Waitlist"). The markup is kept so re-enabling
//      is a one-line flip, but it must not be visible today.
//
//   2. The coach signup (#coachSignupForm) opens as a FULL PAGE, not a centered
//      bottom sheet: it carries the .cs-page class (position:fixed; inset:0;
//      full width), its close control is the glass circular button (.glassclose),
//      and it wraps its fields in .cs-inner. Tapping the close button re-hides it.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');

async function boot() {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://thwaphockey.com/',
    beforeParse(window) {
      window.scrollTo = () => {};
      window.HTMLMediaElement.prototype.play = () => Promise.resolve();
      window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: false }) });
    },
  });
  await new Promise((r) => setTimeout(r, 80));
  return dom.window;
}

describe('self-serve coach signup entry point', () => {
  it('hides the sign-in "Create your team." line (reserved to replace Join Waitlist)', async () => {
    const w = await boot();
    const line = w.document.querySelector('#loginCoachLine')
      || w.document.querySelector('#loginCoach')?.closest('p');
    expect(line, 'the coach-signup line/paragraph should exist in markup').toBeTruthy();
    // Hidden via the hidden attribute so it is trivially re-enabled later.
    expect(line.hasAttribute('hidden')).toBe(true);
    // And not visible.
    expect(w.getComputedStyle(line).display).toBe('none');
  });

  it('coach signup form is marked up as a full page, not a sheet', async () => {
    const w = await boot();
    const f = w.document.querySelector('#coachSignupForm');
    expect(f, '#coachSignupForm should exist').toBeTruthy();
    // Full-page class, not just a centered modal.
    expect(f.classList.contains('cs-page')).toBe(true);
    // Content wrapper present.
    expect(f.querySelector('.cs-inner')).toBeTruthy();
    // Close control is the glass circular button, not the tiny .login-x.
    const x = w.document.querySelector('#csClose');
    expect(x, '#csClose should exist').toBeTruthy();
    expect(x.classList.contains('glassclose')).toBe(true);
    expect(x.classList.contains('login-x')).toBe(false);
  });

  it('opens full-screen via its trigger and closes via the glass X', async () => {
    const w = await boot();
    const f = w.document.querySelector('#coachSignupForm');
    const x = w.document.querySelector('#csClose');
    // The sign-in coach link still carries the open listener even though the
    // line is hidden; clicking it runs the real showCoachSignup() path.
    const trigger = w.document.querySelector('#loginCoach') || w.document.querySelector('#waitCoach');
    expect(trigger, 'a coach-signup trigger should exist').toBeTruthy();
    trigger.click();
    // Form is revealed (not hidden) after the real open path runs.
    expect(f.hidden).toBe(false);
    // Full-page CSS: fixed position (inset:0 fills the viewport in a real browser;
    // jsdom does not lay out, so we assert the authoritative computed position).
    expect(w.getComputedStyle(f).position).toBe('fixed');
    // The X re-hides it.
    x.click();
    expect(f.hidden).toBe(true);
  });
});
