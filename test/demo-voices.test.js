// test/demo-voices.test.js
//
// Demo team: ALL accents are selectable (none locked) in the drill-narration
// voice picker; a real team keeps the unlock ladder (Canadian + Minnesotan free,
// the rest locked). Root cause guarded: voicePickerHTML must route its unlock
// check through window.thwapVoiceUnlocked (which demo-mode wraps to unlock-all),
// not the bare local, and on-page pickers are re-rendered on demo boot.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const html = readFileSync(resolve(root, 'index.html'), 'utf8');
const data = readFileSync(resolve(root, 'demo/demo-data.js'), 'utf8');
const mode = readFileSync(resolve(root, 'demo/demo-mode.js'), 'utf8');

function boot(demo) {
  const store = { bfPlayer: 'Connor McDavid' };
  if (demo) store.thwapDemo = '1';
  const inlined = html
    .replace("<script src='demo/demo-data.js'></script>", '<script>' + data + '</script>')
    .replace("<script src='demo/demo-mode.js'></script>", '<script>' + mode + '</script>');
  return new JSDOM(inlined, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://x/#stick',
    beforeParse(w) {
      w.HTMLMediaElement.prototype.play = () => Promise.resolve();
      w.HTMLMediaElement.prototype.pause = () => {};
      w.scrollTo = () => {};
      w.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: false }) });
      const ls = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; }, clear: () => {} };
      Object.defineProperty(w, 'localStorage', { value: ls, configurable: true });
    },
  }).window;
}

describe('Voice picker: demo unlocks all accents; real team keeps the ladder', () => {
  it('voicePickerHTML routes its unlock check through window.thwapVoiceUnlocked', () => {
    expect(html).toContain('var isUnlocked=window.thwapVoiceUnlocked||thwapVoiceUnlocked;');
  });

  it('DEMO team: the on-page picker shows every accent unlocked (none locked)', async () => {
    const w = boot(true);
    await new Promise((r) => setTimeout(r, 300));
    const sheet = w.document.querySelector('.vpick .vsheet');
    expect(sheet).toBeTruthy();
    expect(sheet.querySelectorAll('.vopt.locked').length).toBe(0);
    expect(sheet.querySelectorAll('.vopt[data-voice]').length).toBe(w.THWAP_VOICES.length);
  });

  it('REAL team: the picker keeps the ladder (only Canadian + Minnesotan unlocked)', async () => {
    const w = boot(false);
    await new Promise((r) => setTimeout(r, 300));
    const sheet = w.document.querySelector('.vpick .vsheet');
    expect(sheet).toBeTruthy();
    expect(sheet.querySelectorAll('.vopt[data-voice]').length).toBe(2);
    expect(sheet.querySelectorAll('.vopt.locked').length).toBeGreaterThan(0);
  });
});
