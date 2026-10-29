// test/photo-client-followups.test.js
//
// Client side of the photo audit follow-ups (index.html):
//   2. The cached upload token expires when the server's 1-hour token does,
//      and a token that ran out asks a parent for a new code (remove path;
//      uploads were retired on 2026-10-29).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HTML = readFileSync(join(ROOT, 'index.html'), 'utf8');

// Pull one top-level `function name(...){...}` out of index.html by brace matching.
function fnSource(name) {
  const start = HTML.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`no function ${name}`);
  let i = HTML.indexOf('{', start), depth = 0;
  for (; i < HTML.length; i++) {
    if (HTML[i] === '{') depth++;
    else if (HTML[i] === '}' && --depth === 0) return HTML.slice(start, i + 1);
  }
  throw new Error(`unbalanced ${name}`);
}

function tokenHelpers(now) {
  const mem = new Map();
  const localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  };
  const DateStub = { now: () => now.t };
  const src = [fnSource('tokKey'), fnSource('getToken'), fnSource('saveToken'), fnSource('clearToken')].join('\n');
  // eslint-disable-next-line no-new-func
  return new Function('localStorage', 'Date', `${src}; return { getToken, saveToken, clearToken };`)(localStorage, DateStub);
}

describe('2. client token follows the 1-hour server token', () => {
  it('a cached token is used before its expiry and dropped after it', () => {
    const now = { t: 1_000_000 };
    const h = tokenHelpers(now);
    const exp = now.t + 60 * 60 * 1000;
    h.saveToken('lewie', `lewie.${exp}.sig`);
    now.t += 59 * 60 * 1000;
    expect(h.getToken('lewie')).toBe(`lewie.${exp}.sig`);
    now.t = exp + 1;
    expect(h.getToken('lewie')).toBeNull();
  });

  it('never caches a token for 30 days any more', () => {
    expect(HTML).not.toMatch(/exp:Date\.now\(\)\+30\*24\*60\*60\*1000/);
  });

  it('a 401 on remove clears the token and asks a parent for a new code with clear copy', () => {
    // Uploads are retired (2026-10-29); the remove path is the one that still
    // uses the token, so it is the one that must handle the 1-hour expiry.
    expect(HTML).not.toContain('function uploadToServer(');
    const start = HTML.indexOf('window.thwapPhotoRemove=function(');
    expect(start).toBeGreaterThan(-1);
    const rm = HTML.slice(start, HTML.indexOf('\n};', start));
    expect(rm).toMatch(/if\(r\.status!==401\)\{ clearToken\(slug\); done\(\); return; \}/);
    expect(rm).toMatch(/clearToken\(slug\);\s*parentGate\(playerId, slug, true\)/);
    expect(HTML).toContain("Your photo code ran out");
    expect(HTML).toContain('A code works for 1 hour. Enter a parent email to get a new one and finish.');
  });
});

describe('6. photo request-code copy does not promise a code was sent', () => {
  it('shows the on-file wording and drops "We emailed a 6-digit code"', () => {
    // Scoped to the photo parent gate, where the parent TYPES an email. The
    // new-device sign-in copy elsewhere sends to the email already on file, so
    // "We emailed" stays true there.
    const gate = fnSource('parentGate');
    expect(gate).toContain('If that email is on file with your coach, we sent a 6-digit code.');
    expect(gate).not.toContain('We emailed a 6-digit code');
  });
});
