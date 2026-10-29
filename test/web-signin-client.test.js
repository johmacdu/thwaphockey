// test/web-signin-client.test.js
//
// The sign-in sheet's new-device step (index.html). The server answers a correct
// player code on a new browser with { needsParentCode }; the sheet then asks for
// the parent's emailed 6-digit code and calls verify. The silent self-heal must
// never email a parent.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'index.html'), 'utf8');
const between = (a, b) => { const i = html.indexOf(a); const j = html.indexOf(b, i); return html.slice(i, j); };

describe('parent-code step markup', () => {
  const view = between("<div id='loginParentView'", '</form>');

  it('exists, hidden by default, inside the sign-in form', () => {
    expect(view).toMatch(/^<div id='loginParentView' hidden>/);
  });

  it('the code field is a one-time code, not a password', () => {
    const input = /<input[^>]*id='loginParentCode'[^>]*>/.exec(view)[0];
    expect(input).toContain("type='text'");
    expect(input).toContain("autocomplete='one-time-code'");
    expect(input).toContain("inputmode='numeric'");
    expect(input).toContain("maxlength='6'");
    expect(input).not.toContain('password');
  });

  it('has a resend link and a back button', () => {
    expect(view).toContain("id='loginParentResend'");
    expect(view).toContain('Send a new code');
    expect(view).toContain("id='loginParentBack'");
  });
});

describe('parent-code step behavior', () => {
  const js = between('function mintServerSession', '/* ---- Unified sign in');

  it('code-signin sends quiet, and signIn routes needsParentCode to the parent step', () => {
    expect(js).toContain('quiet:!!quiet');
    expect(js).toMatch(/needs-parent-code'\)\{ showParentStep/);
    expect(js).toContain('needs-parent-email');
  });

  it('the parent step verifies through /api/login?action=verify and resends via request-code', () => {
    expect(js).toContain("/api/login?action=verify");
    expect(js).toContain("/api/login?action=request-code");
  });

  it('the silent self-heal and the once-per-tab sync never email a parent (quiet=true)', () => {
    const heal = between('window.thwapEnsureSession=function', '/* After a sign-out');
    const calls = heal.match(/mintServerSession\([^;]*\)/g) || [];
    expect(calls.length).toBe(2);
    for (const c of calls) expect(c).toMatch(/true, true\)/);
  });

  it('kid copy has no em-dashes, en-dashes or middots', () => {
    const copy = view => view.replace(/<[^>]+>/g, ' ');
    const text = copy(between("<div id='loginParentView'", '</form>')) + js;
    expect(text).not.toMatch(/[\u2014\u2013\u00b7]|&mdash;|&middot;/);
  });
});
