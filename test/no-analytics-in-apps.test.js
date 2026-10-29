// test/no-analytics-in-apps.test.js
//
// Third-party analytics (Vercel Web Analytics) must load on the plain website
// but must NEVER load inside the iPhone or Android app. Apple rules for apps
// aimed at kids forbid third-party analytics, even outside the Kids category.
// "Never load" means the <script src="/_vercel/insights/script.js"> tag is never
// put in the page, so the file is never fetched, not just that it stays quiet.
//
// 1. Every HTML entry point: no third-party analytics tag in the static markup.
// 2. Full page boot (index.html, hockey_game_goals.html): web adds the tag,
//    the iOS and Android Capacitor shells do not.
// 3. The gate on its own: each app signal (Capacitor bridge objects, the
//    ThwapApp user agent suffix from capacitor.config.json, a bare WebView user
//    agent) blocks the tag; normal mobile and desktop browsers get it.
//
// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const read = (f) => readFileSync(resolve(root, f), 'utf8');

const ANALYTICS_SRC = /_vercel\/insights|va\.vercel-scripts|_vercel\/speed-insights|googletagmanager|google-analytics|gtag\/js|plausible\.io|posthog|mixpanel|cdn\.segment|amplitude/i;
const ENTRY_POINTS = readdirSync(root).filter((f) => f.endsWith('.html'));
const GATED_PAGES = ['index.html', 'hockey_game_goals.html'];

const UA = {
  iosSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iosChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  winChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  iosWebView: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  iosApp: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 ThwapApp/ios',
  androidWebView: 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0 Mobile Safari/537.36',
  androidApp: 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0 Mobile Safari/537.36 ThwapApp/android',
};

function capacitor(platform) {
  return {
    isNativePlatform: () => platform !== 'web',
    getPlatform: () => platform,
    Plugins: {},
  };
}

function setUserAgent(window, ua) {
  Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });
}

function analyticsTags(document) {
  return [...document.querySelectorAll('script[src]')].filter((s) => ANALYTICS_SRC.test(s.getAttribute('src')));
}

// The gate script, pulled out of a page so it can be run on its own.
function gateSource(file) {
  const m = read(file).match(/<script data-thwap-analytics-gate>([\s\S]*?)<\/script>/);
  return m ? m[1] : '';
}

function runGate(file, { ua = UA.winChrome, setup } = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    runScripts: 'outside-only',
    url: 'https://thwaphockey.com/',
  });
  setUserAgent(dom.window, ua);
  if (setup) setup(dom.window);
  const src = gateSource(file);
  expect(src, `${file} has an analytics gate`).not.toBe('');
  dom.window.eval(src);
  return analyticsTags(dom.window.document).length;
}

function bootPage(file, { ua = UA.winChrome, platform } = {}) {
  const dom = new JSDOM(read(file), {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://thwaphockey.com/',
    beforeParse(window) {
      setUserAgent(window, ua);
      window.scrollTo = () => {};
      window.HTMLMediaElement.prototype.play = () => Promise.resolve();
      window.fetch = () => Promise.resolve(new window.Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
      window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
      if (platform) window.Capacitor = capacitor(platform);
    },
  });
  const tags = analyticsTags(dom.window.document).map((s) => s.getAttribute('src'));
  dom.window.close();
  return tags;
}

describe('no third-party analytics in static markup', () => {
  it.each(ENTRY_POINTS)('%s has no hard-coded analytics script tag', (file) => {
    const html = read(file);
    const tags = [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
    expect(tags.filter((s) => ANALYTICS_SRC.test(s))).toEqual([]);
  });
});

describe.each(GATED_PAGES)('full page boot: %s', (file) => {
  it('website loads Vercel Analytics', () => {
    expect(bootPage(file, { ua: UA.winChrome })).toEqual(['/_vercel/insights/script.js']);
  });
  it('iPhone app does not load analytics', () => {
    expect(bootPage(file, { ua: UA.iosApp, platform: 'ios' })).toEqual([]);
  });
  it('Android app does not load analytics', () => {
    expect(bootPage(file, { ua: UA.androidApp, platform: 'android' })).toEqual([]);
  });
});

describe.each(GATED_PAGES)('analytics gate: %s', (file) => {
  it.each([
    ['desktop Chrome', UA.winChrome],
    ['Mac Safari', UA.macSafari],
    ['iPhone Safari', UA.iosSafari],
    ['iPhone Chrome', UA.iosChrome],
    ['Android Chrome', UA.androidChrome],
  ])('loads in a normal browser (%s)', (_, ua) => {
    expect(runGate(file, { ua })).toBe(1);
  });

  it('loads when Capacitor web shim says platform is web', () => {
    expect(runGate(file, { setup: (w) => { w.Capacitor = capacitor('web'); } })).toBe(1);
  });

  it.each([
    ['Capacitor iOS', (w) => { w.Capacitor = capacitor('ios'); }],
    ['Capacitor Android', (w) => { w.Capacitor = capacitor('android'); }],
    ['Capacitor getPlatform only', (w) => { w.Capacitor = { getPlatform: () => 'ios' }; }],
    ['Capacitor that throws', (w) => { w.Capacitor = { isNativePlatform() { throw new Error('x'); } }; }],
    ['Android bridge interface', (w) => { w.androidBridge = { postMessage() {} }; }],
    ['iOS WebKit bridge handler', (w) => { w.webkit = { messageHandlers: { bridge: { postMessage() {} } } }; }],
  ])('does not load inside the app: %s', (_, setup) => {
    expect(runGate(file, { setup })).toBe(0);
  });

  it.each([
    ['iPhone app user agent', UA.iosApp],
    ['Android app user agent', UA.androidApp],
    ['bare iOS WebView', UA.iosWebView],
    ['bare Android WebView', UA.androidWebView],
  ])('does not load inside the app before the bridge is ready: %s', (_, ua) => {
    expect(runGate(file, { ua })).toBe(0);
  });
});

describe('app user agent marker', () => {
  it('capacitor.config.json tags both app user agents with ThwapApp', () => {
    const cfg = JSON.parse(read('capacitor.config.json'));
    expect(cfg.ios.appendUserAgent).toMatch(/ThwapApp/);
    expect(cfg.android.appendUserAgent).toMatch(/ThwapApp/);
  });
});
