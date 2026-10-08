// test/iq-native-video.test.js
//
// EXECUTION test: the Hockey IQ video surface adapts to the native shell.
//
//  - Plain website (no Capacitor): renders the YouTube-nocookie <iframe> exactly
//    as before (regression guard -- the web experience must not change).
//  - Native app (body.is-native): renders a lightweight tap-to-play poster
//    (.iq-video-native button with a data-ytid and a YouTube thumbnail) INSTEAD
//    of a nested YouTube webview. Tapping it hands the clip to the OS player.
//
// Both booted on Thursday (?day=0) so iqToday() returns a real video.
//
// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');

async function boot({ native }) {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://thwaphockey.com/?day=0', // Thursday -> iqToday() has a video
    beforeParse(window) {
      window.scrollTo = () => {};
      window.HTMLMediaElement.prototype.play = () => Promise.resolve();
      if (native) {
        window.Capacitor = {
          isNativePlatform: () => true,
          getPlatform: () => 'ios',
          Plugins: {},
        };
      }
      window.document.cookie = 'thwapAuth=1';
      try { window.localStorage.setItem('bfPlayer', 'Teddy'); } catch (e) {}
      window.fetch = () =>
        Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: false }) });
    },
  });
  await new Promise((r) => setTimeout(r, 120));
  return dom.window;
}

// Drive iqRender so the #iqList is populated regardless of load timing.
function renderIq(win) {
  win.location.hash = '#iq';
  win.dispatchEvent(new win.Event('hashchange'));
  if (typeof win.iqRender === 'function') win.iqRender();
}

describe('Hockey IQ video surface adapts to native', () => {
  it('web mode renders the YouTube-nocookie iframe (unchanged)', async () => {
    const win = await boot({ native: false });
    renderIq(win);
    const list = win.document.getElementById('iqList');
    const iframe = list.querySelector('.iq-video iframe');
    expect(iframe).toBeTruthy();
    expect(iframe.getAttribute('src')).toMatch(
      /^https:\/\/www\.youtube-nocookie\.com\/embed\/[A-Za-z0-9_-]+/
    );
    // No native poster button on the web.
    expect(list.querySelector('.iq-video-native')).toBeFalsy();
  });

  it('native mode renders a tap-to-play poster, not an iframe', async () => {
    const win = await boot({ native: true });
    expect(win.document.body.classList.contains('is-native')).toBe(true);
    renderIq(win);
    const list = win.document.getElementById('iqList');
    const poster = list.querySelector('.iq-video-native');
    expect(poster).toBeTruthy();
    expect(poster.tagName).toBe('BUTTON'); // a real, focusable control
    // Carries the video id and a YouTube thumbnail.
    const id = poster.getAttribute('data-ytid');
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
    const img = poster.querySelector('.iq-video-poster');
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`);
    // The heavy nested webview is gone in native.
    expect(list.querySelector('.iq-video iframe')).toBeFalsy();
  });

  it('tapping the native poster opens the clip in the OS browser/player', async () => {
    const win = await boot({ native: true });
    // Stub the Capacitor Browser plugin to capture the open() call.
    let opened = null;
    win.Capacitor.Plugins.Browser = { open: (opts) => { opened = opts; return Promise.resolve(); } };
    renderIq(win);
    const poster = win.document.getElementById('iqList').querySelector('.iq-video-native');
    const id = poster.getAttribute('data-ytid');
    poster.dispatchEvent(new win.Event('click', { bubbles: true }));
    expect(opened).toBeTruthy();
    expect(opened.url).toBe(`https://www.youtube.com/watch?v=${id}`);
  });
});
