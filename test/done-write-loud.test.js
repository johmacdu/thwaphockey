// test/done-write-loud.test.js
//
// Behavioral test for the CLIENT mark-done write path in index.html
// (window.thwapMarkDone + window.thwapDoneNotSaved).
//
// Background (the Lewie bug): a real drill completion never reached the shared
// board because the client swallowed EVERY failure of /api/done. The server path
// itself works (see api done.test.js / board.test.js) -- the loss was on the
// client, and it was invisible. The fix makes the write path:
//   1. keep the working happy path unchanged (a 200 stays silent, no notice),
//   2. self-heal a missing session on 401 (mint + retry once) and stay silent
//      when the retry succeeds,
//   3. ALSO retry once on a first-tap network error,
//   4. surface a QUIET, non-blocking "not saved" notice when the write still
//      fails after the retry, instead of silently losing the completion
//      (mirrors the photo-upload "fail loud, never swallow" lesson).
//
// This test executes the ACTUAL shipped source extracted from index.html (not a
// copy) so it cannot drift from what ships, with fetch / PLAYER / thwapEnsureSession
// stubbed. It asserts the resolved { ok, status } and whether the notice fired.
//
// @vitest-environment jsdom

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');

// Pull the two shipped functions verbatim out of index.html so the test runs the
// real code. We grab from the thwapDoneNotSaved definition through the end of the
// thwapMarkDone definition.
function extractSource() {
  const start = html.indexOf('window.thwapDoneNotSaved=function');
  expect(start, 'thwapDoneNotSaved present in index.html').toBeGreaterThan(-1);
  // thwapMarkDone ends at the "return attempt;\n};" that closes it.
  const mdIdx = html.indexOf('window.thwapMarkDone=function', start);
  expect(mdIdx, 'thwapMarkDone present in index.html').toBeGreaterThan(-1);
  const endMarker = 'return attempt;\n};';
  const end = html.indexOf(endMarker, mdIdx);
  expect(end, 'thwapMarkDone closes with "return attempt; };"').toBeGreaterThan(-1);
  return html.slice(start, end + endMarker.length);
}

// Load the extracted source into this test's scope, defining PLAYER + the two
// window functions. Returns nothing; reads window.thwapMarkDone afterwards.
function loadInto(win) {
  const src = extractSource();
  // PLAYER is defined earlier in index.html; the extracted block references it.
  const wrapped = `var PLAYER='Lewie';\n${src}\nwindow.__PLAYER=PLAYER;`;
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', 'document', 'setTimeout', 'clearTimeout', 'Promise', 'fetch', wrapped);
  fn(win, win.document, win.setTimeout.bind(win), win.clearTimeout.bind(win), Promise, win.fetch);
}

let win;
beforeAll(() => {
  win = globalThis.window;
});

beforeEach(() => {
  // Clean any prior notice + heal stub.
  const n = document.getElementById('thwapSaveNote');
  if (n) n.remove();
  delete window.thwapEnsureSession;
  delete window.thwapMarkDone;
  delete window.thwapDoneNotSaved;
});

function noticeShown() {
  const n = document.getElementById('thwapSaveNote');
  return !!(n && /\bshow\b/.test(n.className));
}
const resp = (status) => ({ ok: status >= 200 && status < 300, status });

describe('thwapMarkDone: happy path stays silent', () => {
  it('a 200 resolves ok and shows NO notice', async () => {
    window.fetch = vi.fn().mockResolvedValue(resp(200));
    loadInto(window);
    const out = await window.thwapMarkDone('shoot');
    expect(window.fetch).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ ok: true, status: 200 });
    expect(noticeShown()).toBe(false);
  });
});

describe('thwapMarkDone: 401 self-heals via ensureSession + one retry', () => {
  it('401 then a minted session -> retry 200, silent, no notice', async () => {
    // First call 401, second (post-heal) call 200.
    window.fetch = vi.fn()
      .mockResolvedValueOnce(resp(401))
      .mockResolvedValueOnce(resp(200));
    const heal = vi.fn().mockResolvedValue();
    window.thwapEnsureSession = heal;
    loadInto(window);
    const out = await window.thwapMarkDone('shoot');
    expect(heal).toHaveBeenCalledTimes(1);
    expect(window.fetch).toHaveBeenCalledTimes(2);
    expect(out).toEqual({ ok: true, status: 200 });
    expect(noticeShown()).toBe(false);
  });

  it('401 then the retry STILL 401s -> loud notice, ok:false (the Lewie loss, now visible)', async () => {
    window.fetch = vi.fn()
      .mockResolvedValueOnce(resp(401))
      .mockResolvedValueOnce(resp(401));
    window.thwapEnsureSession = vi.fn().mockResolvedValue();
    loadInto(window);
    const out = await window.thwapMarkDone('shoot');
    expect(out.ok).toBe(false);
    expect(noticeShown()).toBe(true);
  });
});

describe('thwapMarkDone: first-tap network error retries once, then fails loud', () => {
  it('network error then a healed 200 -> silent success', async () => {
    window.fetch = vi.fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(resp(200));
    window.thwapEnsureSession = vi.fn().mockResolvedValue();
    loadInto(window);
    const out = await window.thwapMarkDone('shoot');
    expect(window.fetch).toHaveBeenCalledTimes(2);
    expect(out).toEqual({ ok: true, status: 200 });
    expect(noticeShown()).toBe(false);
  });

  it('network error then the retry also errors -> loud notice, ok:false', async () => {
    window.fetch = vi.fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockRejectedValueOnce(new Error('still offline'));
    window.thwapEnsureSession = vi.fn().mockResolvedValue();
    loadInto(window);
    const out = await window.thwapMarkDone('shoot');
    expect(out.ok).toBe(false);
    expect(noticeShown()).toBe(true);
  });
});

describe('thwapMarkDone: a non-401 server error fails loud (does not retry blindly)', () => {
  it('a 500 shows the notice and does NOT attempt a heal/retry', async () => {
    window.fetch = vi.fn().mockResolvedValue(resp(500));
    const heal = vi.fn().mockResolvedValue();
    window.thwapEnsureSession = heal;
    loadInto(window);
    const out = await window.thwapMarkDone('shoot');
    expect(window.fetch).toHaveBeenCalledTimes(1); // no blind retry on a server 500
    expect(heal).not.toHaveBeenCalled();
    expect(out).toEqual({ ok: false, status: 500 });
    expect(noticeShown()).toBe(true);
  });
});

describe('thwapDoneNotSaved: the notice itself', () => {
  it('creates a polite status region with warm, non-alarming copy and no banned punctuation', () => {
    window.fetch = vi.fn().mockResolvedValue(resp(200));
    loadInto(window);
    window.thwapDoneNotSaved();
    const n = document.getElementById('thwapSaveNote');
    expect(n).toBeTruthy();
    expect(n.getAttribute('role')).toBe('status');
    expect(n.getAttribute('aria-live')).toBe('polite');
    expect(n.textContent).toMatch(/signed in/i);
    // Banned punctuation must never appear in the surfaced copy.
    expect(n.textContent.includes('\u2014')).toBe(false); // em-dash
    expect(n.textContent.includes('\u2013')).toBe(false); // en-dash
    expect(n.textContent.includes('\u00b7')).toBe(false); // middle-dot
  });
});
