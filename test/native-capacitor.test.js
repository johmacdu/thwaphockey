// test/native-capacitor.test.js
//
// Guards the Capacitor native-adaptation pass (feat/capacitor-native, v1):
// a role-aware bottom tab bar, a Profile tab, safe areas, native gesture
// suppression, and Android hardware-back. The single hard rule is that EVERY
// native behaviour is gated on body.is-native, which is set ONLY inside the
// Capacitor shell, so the plain website at thwaphockey.com is untouched. These
// are structural + source assertions (the app is one static HTML with inline
// IIFEs), mirroring the existing frontend.smoke / coach-view style.
//
// @vitest-environment jsdom

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
let doc;
beforeAll(() => { doc = new DOMParser().parseFromString(html, 'text/html'); });

const nativeCss = () => html.match(/<style id='native-css'>([\s\S]*?)<\/style>/)[1];

describe('Native flag is set only inside Capacitor', () => {
  it('body.is-native is gated on window.Capacitor.isNativePlatform()', () => {
    expect(html).toMatch(/C\.isNativePlatform\(\)\)\{document\.documentElement\.classList\.add\('is-native'\)/);
    expect(html).toMatch(/document\.body\.classList\.add\('is-native'\)/);
  });

  it('the tab bar is hidden by default and only shown under body.is-native', () => {
    const css = nativeCss();
    expect(css).toMatch(/\.tabbar\{display:none\}/);
    expect(css).toMatch(/body\.is-native\.is-authed:not\(\.login-locked\) \.tabbar\{/);
    expect(/(^|\})\s*\.tabbar\{[^}]*position:fixed/.test(css)).toBe(false);
  });
});

describe('Role-aware bottom tab bar', () => {
  it('ships a single #tabbar with a player group and a coach group', () => {
    const bar = doc.getElementById('tabbar');
    expect(bar).toBeTruthy();
    expect(bar.querySelector('.tab-player')).toBeTruthy();
    expect(bar.querySelector('.tab-coach')).toBeTruthy();
  });

  it('player tabs are Train / Stickers / Team / Standings / Profile, landing on Train', () => {
    const btns = [...doc.querySelectorAll('#tabbar .tab-player .tabbar-btn')];
    const labels = btns.map((b) => b.querySelector('.tabbar-lab').textContent);
    expect(labels).toEqual(['Train', 'Stickers', 'Team', 'Standings', 'Profile']);
    const hrefs = btns.map((b) => b.getAttribute('href'));
    expect(hrefs).toEqual(['#home', '#stickers', '#roster', '#progress', '#profile']);
  });

  it('coach tabs are Train / Team / Plan / Standings / Profile, landing on the dashboard', () => {
    const btns = [...doc.querySelectorAll('#tabbar .tab-coach .tabbar-btn')];
    const labels = btns.map((b) => b.querySelector('.tabbar-lab').textContent);
    expect(labels).toEqual(['Train', 'Team', 'Plan', 'Standings', 'Profile']);
    const hrefs = btns.map((b) => b.getAttribute('href'));
    expect(hrefs).toEqual(['#coachhome', '#roster', '#plan', '#progress', '#profile']);
  });

  it('both roles are symmetric: 5 tabs each, both ending on Profile', () => {
    const p = [...doc.querySelectorAll('#tabbar .tab-player .tabbar-btn')];
    const c = [...doc.querySelectorAll('#tabbar .tab-coach .tabbar-btn')];
    expect(p.length).toBe(5);
    expect(c.length).toBe(5);
    expect(p[p.length - 1].getAttribute('href')).toBe('#profile');
    expect(c[c.length - 1].getAttribute('href')).toBe('#profile');
  });

  it('the role split is driven by the existing is-coach body class', () => {
    const css = nativeCss();
    expect(css).toMatch(/body\.is-native:not\(\.is-coach\) \.tabbar \.tab-player\{display:contents\}/);
    expect(css).toMatch(/body\.is-native\.is-coach \.tabbar \.tab-coach\{display:contents\}/);
  });

  it('the active-tab mapping rolls drill sub-pages up to Train and gives #player no tab', () => {
    expect(html).toMatch(/if\(h==='stick'\|\|h==='shoot'\|\|h==='dryland'\|\|h==='drillpick'\|\|h==='pass'\)\{/);
    expect(html).toMatch(/if\(h==='profile'\) return 'profile';/);
    expect(html).toMatch(/return h==='coachhome' \? 'coachhome' : 'home';/);
  });

  it('content gets bottom padding so it never hides behind the bar', () => {
    expect(nativeCss()).toMatch(/body\.is-native\.is-authed:not\(\.login-locked\) \.app\{\s*padding-bottom:calc\(64px \+ env\(safe-area-inset-bottom/);
  });
});

describe('Safe areas (notch / Dynamic Island / home indicator)', () => {
  it('the top chrome clears the top inset and the tab bar clears the bottom inset', () => {
    const css = nativeCss();
    expect(css).toMatch(/body\.is-native \.topbar\{padding-top:calc\(6px \+ env\(safe-area-inset-top/);
    expect(css).toMatch(/\.tabbar\{[\s\S]*?padding-bottom:env\(safe-area-inset-bottom/);
  });
  it('the viewport opts into the safe-area via viewport-fit=cover', () => {
    expect(html).toMatch(/viewport-fit=cover/);
  });
});

describe('Native gesture suppression keeps the sticker drag working', () => {
  it('suppresses tap highlight, callout, overscroll bounce and chrome text-selection under is-native', () => {
    const css = nativeCss();
    expect(css).toMatch(/body\.is-native\{[\s\S]*?-webkit-tap-highlight-color:transparent/);
    expect(css).toMatch(/body\.is-native\{[\s\S]*?-webkit-touch-callout:none/);
    expect(css).toMatch(/body\.is-native\{[\s\S]*?overscroll-behavior:none/);
    expect(css).toMatch(/body\.is-native\{[\s\S]*?user-select:none/);
  });
  it('does NOT override touch-action on the sticker deck (.deck-3d keeps touch-action:none)', () => {
    expect(html).toMatch(/\.deck-3d\{[^}]*touch-action:none/);
    const css = nativeCss();
    expect(css).not.toMatch(/\.deck-3d/);
    expect(css).not.toMatch(/\.pl-ghost/);
    expect(css).toMatch(/body\.is-native input,body\.is-native textarea,body\.is-native \[contenteditable\][\s\S]*?user-select:text/);
  });
});

describe('Profile tab (native settings/account surface)', () => {
  it('adds a #profile page section and keeps #home as the LAST section', () => {
    const ids = [...doc.querySelectorAll('section[id]')].map((s) => s.id);
    expect(ids).toContain('profile');
    expect(ids[ids.length - 1]).toBe('home');
    expect(ids.indexOf('profile')).toBeLessThan(ids.indexOf('home'));
  });

  it('web users can never route to #profile (only reachable from the native tab bar)', () => {
    expect(nativeCss()).toMatch(/body:not\(\.is-native\) #profile\.page:target\{display:none\}/);
  });

  it('Profile holds the card entry, Sound + Appearance toggles, About/Bug/Feature, and Sign out', () => {
    const prof = doc.getElementById('profile');
    expect(prof).toBeTruthy();
    expect(doc.getElementById('profCardBtn')).toBeTruthy();
    expect(doc.getElementById('profSfxToggle')).toBeTruthy();
    expect(doc.getElementById('profThemeToggle')).toBeTruthy();
    expect(doc.getElementById('profSignout')).toBeTruthy();
    const links = [...prof.querySelectorAll('a.prof-row')].map((a) => a.getAttribute('href'));
    expect(links.some((h) => h === '/about')).toBe(true);
    expect(links.some((h) => /subject=Thwap%20bug%20report/.test(h))).toBe(true);
    expect(links.some((h) => /subject=Thwap%20feature%20request/.test(h))).toBe(true);
  });

  it('the Profile close uses the role-aware js-home-close hook', () => {
    const close = doc.querySelector('#profile a.glassclose');
    expect(close).toBeTruthy();
    expect(close.classList.contains('js-home-close')).toBe(true);
    expect(close.getAttribute('href')).toBe('#home');
  });

  it('the web footer action cluster is hidden in-app, untouched on the web', () => {
    expect(nativeCss()).toMatch(/body\.is-native \.footer-actions\{display:none\}/);
    expect((html.match(/id='sfxToggle'/g) || []).length).toBe(1);
    expect((html.match(/id='themeToggle'/g) || []).length).toBe(1);
    expect((html.match(/id='menuSignout'/g) || []).length).toBe(1);
  });

  it('the header top nav (toplinks + kebab) is hidden in-app, since the tab bar owns primary nav', () => {
    const css = nativeCss();
    expect(css).toMatch(/body\.is-native \.topbar \.toplinks,\s*body\.is-native \.topbar \.kebab\{display:none\}/);
    // the brand stays (no rule hides it)
    expect(css).not.toMatch(/body\.is-native \.topbar \.brand\{display:none\}/);
  });

  it('Profile sign out clears the SAME identity keys as the footer kebab', () => {
    const profBlock = html.slice(html.indexOf("getElementById('profSignout')"));
    expect(profBlock).toMatch(/removeItem\('thwapCoach'\)/);
    expect(profBlock).toMatch(/removeItem\('thwapAuth'\); sessionStorage\.removeItem\('thwapAuth'\)/);
    expect(profBlock).toMatch(/document\.cookie='thwapAuth=;path=\/;max-age=0'/);
    expect(profBlock).toMatch(/removeItem\('bfPlayer'\)/);
  });

  it('the Profile card button opens the signed-in player card via openPlayerPage', () => {
    expect(html).toMatch(/window\.openPlayerPage\(nm,'card'\)/);
  });

  it('Profile settings rows carry no card styling (flat rows, per the no-cards rule)', () => {
    const css = nativeCss();
    const rowRule = css.match(/#profile \.prof-row\{([^}]*)\}/);
    expect(rowRule).toBeTruthy();
    expect(rowRule[1]).not.toMatch(/border-radius/);
    expect(rowRule[1]).toMatch(/border-bottom:1px solid var\(--line\)/);
    // the only carded element is the interactive card button, which navigates
    expect(css).toMatch(/#profile \.prof-card-btn\{[^}]*border-radius:var\(--r-card\)/);
  });
});

describe('Android hardware back navigates in-app (does not instantly close)', () => {
  it('listens on the Capacitor App backButton and minimizes instead of exiting from home', () => {
    expect(html).toMatch(/window\.Capacitor && window\.Capacitor\.Plugins && window\.Capacitor\.Plugins\.App/);
    expect(html).toMatch(/App\.addListener\('backButton'/);
    expect(html).toMatch(/if\(ov && closeTopOverlay\(ov\)\) return;/);
    expect(html).toMatch(/App\.minimizeApp && App\.minimizeApp\(\)/);
    expect(html).toMatch(/function roleHome\(\)\{ return document\.body\.classList\.contains\('is-coach'\) \? '#coachhome' : '#home'; \}/);
  });
  it('the back wiring is native-gated (returns early when not is-native)', () => {
    const idx = html.indexOf("if(!isNative) return; /* ---- below here is native-only ---- */");
    const back = html.indexOf("App.addListener('backButton'");
    expect(idx).toBeGreaterThan(-1);
    expect(back).toBeGreaterThan(idx);
  });
});

describe('Profile tab: Player info editor + Privacy/Terms rows', () => {
  it('adds a Player info row in the Your card group, a Privacy Policy row and a Terms of Use row', () => {
    const prof = doc.getElementById('profile');
    expect(doc.getElementById('profInfo')).toBeTruthy();
    expect(doc.getElementById('profPrivacy')).toBeTruthy();
    expect(doc.getElementById('profTerms')).toBeTruthy();
    expect(doc.getElementById('profInfo').textContent).toMatch(/Player info/);
    expect(doc.getElementById('profPrivacy').textContent).toMatch(/Privacy Policy/);
    expect(doc.getElementById('profTerms').textContent).toMatch(/Terms of Use/);
  });

  it('exposes openSelfEdit globally so the Profile row can call it across script blocks', () => {
    expect(html).toMatch(/window\.openSelfEdit\s*=\s*openSelfEdit;/);
  });

  it('openSelfEdit no longer early-returns when the roster-grid card is absent (Profile-tab entry)', () => {
    // The old guard `if(!card) return;` blocked opening from Profile; the roster
    // fetch is the authoritative fill, so a missing card must not abort.
    const fn = html.slice(html.indexOf('function openSelfEdit()'), html.indexOf('function openSelfEdit()') + 500);
    expect(fn).not.toMatch(/var card=myCard\(\); if\(!card\) return;/);
    expect(fn).toMatch(/var card=myCard\(\);/);
    expect(fn).toMatch(/var num=card\?cardNum\(card\):''/);
  });

  it('the Player info row is wired to window.openSelfEdit, Privacy/Terms to the policy sheet', () => {
    const block = html.slice(html.indexOf('function wireProfile()'));
    const body = block.slice(0, block.indexOf('wireProfile);'));
    expect(body).toMatch(/getElementById\('profInfo'\)[\s\S]*window\.openSelfEdit\(\)/);
    expect(body).toMatch(/getElementById\('profPrivacy'\)[\s\S]*thwapOpenPolicy\('privacy'\)/);
    expect(body).toMatch(/getElementById\('profTerms'\)[\s\S]*thwapOpenPolicy\('terms'\)/);
  });

  it('the self-edit roster fetch is a relative /api path (same-origin on web AND in the native shell via server.url)', () => {
    const fn = html.slice(html.indexOf('function openSelfEdit()'), html.indexOf('function openSelfEdit()') + 1400);
    expect(fn).toMatch(/fetch\('\/api\/coach\?action=roster/);
  });
});

describe('No banned punctuation in the native additions', () => {
  it('the native-css and native-features blocks have no middot / em-dash / en-dash', () => {
    const css = nativeCss();
    expect(/[\u00B7\u2014\u2013]/.test(css)).toBe(false);
    const feat = html.slice(html.indexOf('NATIVE FEATURES WIRING'));
    const featBlock = feat.slice(0, feat.indexOf('</script>'));
    expect(/[\u00B7\u2014\u2013]/.test(featBlock)).toBe(false);
  });
});
