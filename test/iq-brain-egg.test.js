// test/iq-brain-egg.test.js
//
// EXECUTION test: boots index.html in jsdom and exercises the two Hockey IQ
// Easter eggs on the brain (#eggIq), matching the other category icons:
//   - TAP        -> vision-scan rings (.eggscan) + a fan of eyes (.eggeye)
//   - LONG-PRESS -> the Sass "BIG BRAIN!" cameo (window.thwapLongPress.iq)

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
    },
  });
  await new Promise((r) => setTimeout(r, 60));
  return dom.window;
}

describe('Hockey IQ brain Easter eggs', () => {
  it('tap on the brain fires the vision-scan rings and eyes', async () => {
    const win = await boot();
    const brain = win.document.getElementById('eggIq');
    expect(brain).toBeTruthy();
    // A quick tap: pointerdown then pointerup before the long-press timer (450ms).
    brain.dispatchEvent(new win.Event('pointerdown', { bubbles: true }));
    brain.dispatchEvent(new win.Event('pointerup', { bubbles: true }));
    expect(win.document.querySelectorAll('.eggscan').length).toBe(3);
    expect(win.document.querySelectorAll('.eggeye').length).toBe(6);
    expect(brain.classList.contains('egg-scan')).toBe(true);
  });

  it('long-press payoff shows the Sass "BIG BRAIN!" cameo', async () => {
    const win = await boot();
    expect(typeof win.thwapLongPress.iq).toBe('function');
    win.thwapLongPress.iq();
    const cameo = win.document.querySelector('.cf-cameo');
    expect(cameo).toBeTruthy();
    expect(cameo.getAttribute('src')).toBe('login/sass-celly.webp');
    const stamp = win.document.querySelector('.cf-stamp');
    expect(stamp && stamp.textContent).toBe('BIG BRAIN!');
  });
});
