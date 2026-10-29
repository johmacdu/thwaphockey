// test/signout-server-logout.test.js
//
// Bug (Oct 29 2026): the footer kebab "Sign out" cleared local state but never
// called POST /api/login?action=logout, so the HTTP-only thwapSession cookie
// (which page JS cannot clear) stayed on the device and the server session
// stayed valid. Fix: every sign-out goes through window.thwapSignOut, which
// POSTs the logout with credentials:'include' FIRST, then clears local state.
// The local clear must still happen when the network call fails or hangs.
//
// The footer script is extracted from index.html and run in a vm sandbox with
// stub DOM/storage/fetch, so we can see the order of calls and the fail path.

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');

function footerScript() {
  const marker = html.indexOf("getElementById('menuSignout')");
  expect(marker).toBeGreaterThan(0);
  const start = html.lastIndexOf('<script>', marker) + '<script>'.length;
  const end = html.indexOf('</script>', marker);
  return html.slice(start, end);
}

function profileSignoutBlock() {
  const i = html.indexOf("getElementById('profSignout')");
  expect(i).toBeGreaterThan(0);
  return html.slice(i, html.indexOf('});', i));
}

function sandbox(fetchImpl) {
  const log = [];
  const store = new Map([['bfPlayer', 'Lewie'], ['thwapAuth', '1'], ['thwapCoach', 'tok']]);
  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => { log.push('clear:' + k); store.delete(k); },
  };
  const els = {};
  const el = (id) => (els[id] ||= {
    id,
    listeners: {},
    addEventListener(t, fn) { this.listeners[t] = fn; },
  });
  const timers = [];
  const win = {
    localStorage: storage,
    sessionStorage: { removeItem() {} },
    document: { getElementById: el, cookie: '' },
    location: { hash: '#x', reload: () => log.push('reload') },
    fetch: (url, opts) => { log.push('fetch'); return fetchImpl(url, opts); },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    registerThwapMenu: () => ({ add() {}, open() {}, close() {} }),
  };
  win.window = win;
  vm.createContext(win);
  vm.runInContext(footerScript(), win);
  return { win, log, store, els, timers };
}

const click = (els, id) => els[id].listeners.click({ preventDefault() {} });
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('footer Sign out ends the server session', () => {
  it('POSTs /api/login?action=logout with credentials before clearing local state', async () => {
    const fetchSpy = vi.fn(() => Promise.resolve({ ok: true, status: 200 }));
    const { log, store, els } = sandbox(fetchSpy);
    click(els, 'menuSignout');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/login?action=logout');
    expect(opts.method).toBe('POST');
    expect(opts.credentials).toBe('include');
    // Nothing cleared until the logout call settles.
    expect(store.get('bfPlayer')).toBe('Lewie');
    await flush();
    expect(log[0]).toBe('fetch');
    expect(store.has('bfPlayer')).toBe(false);
    expect(store.has('thwapAuth')).toBe(false);
    expect(store.has('thwapCoach')).toBe(false);
    expect(log.at(-1)).toBe('reload');
  });

  it('still signs out locally when the logout call fails', async () => {
    const { log, store, els } = sandbox(() => Promise.reject(new TypeError('offline')));
    click(els, 'menuSignout');
    await flush();
    expect(store.has('bfPlayer')).toBe(false);
    expect(log.filter((x) => x === 'reload')).toHaveLength(1);
  });

  it('still signs out locally when fetch throws synchronously', () => {
    const { store, els } = sandbox(() => { throw new Error('no fetch'); });
    click(els, 'menuSignout');
    expect(store.has('bfPlayer')).toBe(false);
  });

  it('still signs out locally when the logout call hangs (3s cap)', () => {
    const { store, els, timers, log } = sandbox(() => new Promise(() => {}));
    click(els, 'menuSignout');
    expect(store.get('bfPlayer')).toBe('Lewie');
    const cap = timers.find((t) => t.ms === 3000);
    expect(cap).toBeTruthy();
    cap.fn();
    expect(store.has('bfPlayer')).toBe(false);
    expect(log.filter((x) => x === 'reload')).toHaveLength(1);
  });

  it('the profile page Sign out uses the same server-logout path', () => {
    expect(profileSignoutBlock()).toContain('window.thwapSignOut()');
  });
});
