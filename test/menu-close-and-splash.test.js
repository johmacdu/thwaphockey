// test/menu-close-and-splash.test.js
//
// Bugs (Woody, Oct 8 2026):
//  A. The signed-out SPLASH footer kebab still showed "Report a bug" /
//     "Request a feature". Those are in-product actions and must be hidden on
//     the splash (body.login-locked). Fix: tag them .footmenu-inproduct and
//     hide under body.login-locked.
//  B. Opening one popover menu must close any other open one, and tapping
//     anywhere outside closes it. Previously each kebab called
//     stopPropagation(), so sibling menus' outside-click listeners never fired
//     and tapping "Explore" left the footer kebab open (and vice versa). Fix:
//     one shared menu manager, no stopPropagation.
//  C. The About Terms/Privacy close button used class='glassclose' but about.html
//     never defined the .glassclose rule, so it rendered unstyled instead of the
//     iOS glass circular icon button used everywhere. Fix: define .glassclose on
//     about.html matching index.html.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const index = readFileSync(resolve(root, 'index.html'), 'utf8');
const about = readFileSync(resolve(root, 'about.html'), 'utf8');

async function bootIndex() {
  const dom = new JSDOM(index, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://thwaphockey.com/',
    beforeParse(w) {
      w.scrollTo = () => {};
      w.HTMLMediaElement.prototype.play = () => Promise.resolve();
      w.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: false }) });
    },
  });
  await new Promise(r => setTimeout(r, 90));
  return dom.window;
}

describe('A: splash footer kebab hides in-product items', () => {
  it('Report a bug / Request a feature carry the in-product class', () => {
    const i = index.indexOf("id='footMenu'");
    const m = index.slice(i, index.indexOf('</div>', i));
    const bug = /Report a bug<\/a>/.exec(m) && /footmenu-inproduct[^>]*Thwap%20bug%20report|Thwap%20bug%20report[^<]*<\/a>/;
    expect(m).toMatch(/class='footmenu-item footmenu-inproduct'[^>]*Thwap%20bug%20report/);
    expect(m).toMatch(/class='footmenu-item footmenu-inproduct'[^>]*Thwap%20feature%20request/);
  });
  it('a CSS rule hides .footmenu-inproduct under body.login-locked', () => {
    expect(index).toMatch(/body\.login-locked \.footmenu-item\.footmenu-inproduct\{display:none\}/);
  });
  it('About Thwap and Sign out are NOT tagged in-product (stay on splash)', () => {
    const i = index.indexOf("id='footMenu'");
    const m = index.slice(i, index.indexOf('</div>', i));
    expect(m).toMatch(/class='footmenu-item'[^>]*>About Thwap<\/a>/);
    expect(m).toMatch(/id='menuSignout'/);
  });
});

describe('B: one menu open at a time; tap elsewhere closes', () => {
  it('opening the nav kebab closes the footer kebab, and vice versa', async () => {
    const w = await bootIndex();
    const kebab = w.document.getElementById('kebab');
    const kmenu = w.document.getElementById('kebabMenu');
    const fk = w.document.getElementById('footKebab');
    const fm = w.document.getElementById('footMenu');
    expect(kebab && kmenu && fk && fm).toBeTruthy();
    const vis = el => !el.hidden;

    fk.click();
    expect(vis(fm)).toBe(true);
    expect(vis(kmenu)).toBe(false);

    kebab.click();                 // tapping Explore closes footer, opens nav
    expect(vis(fm)).toBe(false);
    expect(vis(kmenu)).toBe(true);

    fk.click();                    // tapping footer closes nav, opens footer
    expect(vis(kmenu)).toBe(false);
    expect(vis(fm)).toBe(true);
  });

  it('tapping outside closes an open menu', async () => {
    const w = await bootIndex();
    const fk = w.document.getElementById('footKebab');
    const fm = w.document.getElementById('footMenu');
    fk.click();
    expect(fm.hidden).toBe(false);
    w.document.body.click();       // outside tap
    expect(fm.hidden).toBe(true);
  });

  it('no menu handler calls stopPropagation (that was the root cause)', () => {
    // Check only the shared manager factory and the two registrant blocks, not
    // unrelated scripts between them (drag/pointer handlers legitimately use it).
    const mgrStart = index.indexOf('function registerThwapMenu');
    const mgrEnd = index.indexOf('</script>', mgrStart);
    const managerBlock = index.slice(mgrStart, mgrEnd);

    const navStart = index.indexOf("[['kebab','kebabMenu']");
    const navEnd = index.indexOf('});', navStart) + 3;
    const navBlock = index.slice(navStart, navEnd);

    const footStart = index.indexOf("var kebab=document.getElementById('footKebab')");
    const footEnd = index.indexOf('reg.add(kebab,menu);', footStart) + 20;
    const footBlock = index.slice(footStart, footEnd);

    expect(managerBlock).not.toContain('stopPropagation');
    expect(navBlock).not.toContain('stopPropagation');
    expect(footBlock).not.toContain('stopPropagation');
  });
});

describe('C: About Terms/Privacy close is the iOS glass button', () => {
  it('about.html DEFINES the .glassclose rule (circular, backdrop blur)', () => {
    expect(about).toMatch(/\.glassclose\{[^}]*border-radius:50%/);
    expect(about).toMatch(/\.glassclose\{[^}]*backdrop-filter:saturate/);
    expect(about).toMatch(/\.glassclose\{[^}]*width:48px;height:48px/);
  });
  it('the close button uses the glassclose class', () => {
    expect(about).toMatch(/id='policyClose'[^>]*class='glassclose|class='glassclose[^']*'[^>]*id='policyClose'/);
  });
});
