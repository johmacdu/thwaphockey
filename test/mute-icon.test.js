// test/mute-icon.test.js
//
// The drill-runner mute button (#gdrAudio) must use a classic iOS-style SVG speaker
// icon, not an emoji, and must toggle to a speaker-with-slash when muted.
//
// @vitest-environment jsdom

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');

let win, doc;
beforeAll(async () => {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: false }) });
      window.scrollTo = () => {};
    },
  });
  win = dom.window; doc = win.document;
  await new Promise((r) => setTimeout(r, 50));
});

describe('Drill-runner mute icon is a classic iOS-style SVG, not emoji', () => {
  it('renders an SVG speaker (no emoji text)', () => {
    const btn = doc.getElementById('gdrAudio');
    expect(btn).toBeTruthy();
    expect(btn.querySelector('svg.gdr-audio-ic')).toBeTruthy();
    // no speaker emoji anywhere in the button
    expect(/[\u{1F507}-\u{1F50A}]/u.test(btn.textContent)).toBe(false);
  });

  it('the muted variant is a speaker-with-slash SVG (two crossing lines), defined in source', () => {
    // jsdom can't run the click (it touches the HTMLMediaElement API), so assert the
    // muted icon exists in source and is the slash form, and the unmuted form has waves.
    expect(html).toMatch(/var ICO_MUTE=[^;]*<line[^>]*><line/);   // muted = two crossing lines (slash)
    expect(html).toMatch(/var ICO_SPK=[^;]*a5 5 0 0 1 0 7/);      // unmuted = speaker + wave arcs
    // paintMute swaps between them and updates the label
    expect(html).toMatch(/elAudio\.innerHTML=m\?ICO_MUTE:ICO_SPK/);
    expect(html).toMatch(/aria-label', m\?'Unmute narration':'Mute narration'/);
    // and the emoji speaker toggle is gone
    expect(html).not.toMatch(/elAudio\.textContent=m\?'\u{1F507}'/u);
  });
});
