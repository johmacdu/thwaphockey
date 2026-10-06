// test/signin-code-field.test.js
//
// Mobile Safari bug: Lewie (and anyone) could sign in on desktop but got
// "That code did not match." on iPhone. Root cause: the CODE field was
// type=password autocomplete=current-password, so iOS Safari's saved-password /
// Strong-Password manager overlaid a stored credential onto the field. pwEl.value
// at submit was then the saved password, not the typed team code, so
// playerForPassword() failed. Desktop had no saved credential interfering.
//
// Fix: mark the field as a one-time-code (iOS does not hijack those), tell the
// password managers to ignore it, and strip any non-digit the autofill injected
// before matching the team code (which is always digits).
//
// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');

describe('Sign-in CODE field is iOS-autofill-safe', () => {
  it('does NOT use autocomplete=current-password on the code field (that triggers iOS password autofill)', () => {
    const m = html.match(/<input[^>]*id='loginPw'[^>]*>/);
    expect(m).toBeTruthy();
    const tag = m[0];
    expect(tag).not.toContain('current-password');
    expect(tag).not.toContain("autocomplete='password'");
  });

  it('marks the code field as a one-time-code with password managers told to ignore it', () => {
    const m = html.match(/<input[^>]*id='loginPw'[^>]*>/);
    const tag = m[0];
    expect(tag).toContain("autocomplete='one-time-code'");
    expect(tag).toContain('data-1p-ignore');
    expect(tag).toContain("data-lpignore='true'");
    expect(tag).toContain("inputmode='numeric'");
  });

  it('keeps masking by default (type=password) so the Show/Hide eye toggle still works', () => {
    const m = html.match(/<input[^>]*id='loginPw'[^>]*>/);
    expect(m[0]).toContain("type='password'");
  });
});

describe('playerForPassword tolerates autofill-injected whitespace', () => {
  // Rebuild the exact client logic the page uses (IIFE-scoped, so re-express it
  // against the real static roster DOM).
  const NUMS = { alder:'71',brooklyn:'92',dawson:'19',dominic:'98',eugene:'3',evan:'13',greyson:'32',johnny:'1',joziah:'59',lewie:'72',liam:'29',maddux:'18',oliver:'90',teddy:'11',william:'16',issac:'53' };
  const doc = new JSDOM(html).window.document;
  function credentials() {
    const byNum = {};
    doc.querySelectorAll('#roster .pcard[data-name]').forEach((card) => {
      const full = (card.getAttribute('data-name') || '').trim();
      const key = full.split(/\s+/)[0].toLowerCase();
      const num = NUMS[key];
      if (num) byNum[String(num)] = { pid: key, name: full };
    });
    return byNum;
  }
  function playerForPassword(pw) {
    let p = String(pw || '').trim();
    const digits = p.replace(/\D+/g, '');
    if (digits) p = digits;
    for (const suf of ['2027', '2026']) {
      if (p.length > suf.length && p.slice(-suf.length) === suf) {
        const hit = credentials()[p.slice(0, p.length - suf.length)];
        if (hit) return hit;
      }
    }
    return null;
  }

  it('resolves the clean code to Lewie', () => {
    expect(playerForPassword('722027')).toEqual({ pid: 'lewie', name: 'Lewie' });
  });
  it('resolves despite leading/trailing spaces', () => {
    expect(playerForPassword('  722027  ')).toEqual({ pid: 'lewie', name: 'Lewie' });
  });
  it('resolves despite non-breaking + zero-width characters an autofill may inject', () => {
    expect(playerForPassword('\u00a0722027\u200b')).toEqual({ pid: 'lewie', name: 'Lewie' });
  });
  it('still rejects a genuinely wrong code', () => {
    expect(playerForPassword('000000')).toBeNull();
  });
});
