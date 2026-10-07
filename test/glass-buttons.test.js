// test/glass-buttons.test.js
//
// iOS-glass button consistency. Every nav/control pill-or-icon button across the
// Thwap site must share ONE frosted-glass material, matching the .glassclose
// reference: a translucent color-mix(--panel) background, a hairline
// color-mix(--text 12%) border, a saturate+blur backdrop-filter, a soft shadow,
// and a pill/round radius. The flagged offenders were the Explore button
// (.kebab) and the footer kebab (.footkebab) which used a flat/solid-card look
// with no backdrop blur and no pressed state. This suite locks the glass
// treatment + hover + pressed (:active) states so they cannot regress.
//
// @vitest-environment node

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const index = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
const about = readFileSync(resolve(__dirname, '../about.html'), 'utf8');

// Grab the single CSS declaration block `.selector{ ... }` for a selector.
function rule(css, selector) {
  const i = css.indexOf(selector + '{');
  expect(i, `selector ${selector} must exist`).toBeGreaterThan(-1);
  const start = i + selector.length + 1;
  const end = css.indexOf('}', start);
  return css.slice(start, end);
}

const GLASS_BG = 'color-mix(in srgb,var(--panel) 62%,transparent)';
const GLASS_HOVER = 'background:color-mix(in srgb,var(--panel) 78%,transparent)';
const GLASS_BORDER = 'border:1px solid color-mix(in srgb,var(--text) 12%,transparent)';
const BLUR = 'backdrop-filter:saturate(180%) blur(18px)';
const WEBKIT_BLUR = '-webkit-backdrop-filter:saturate(180%) blur(18px)';
const SHADOW = 'box-shadow:0 6px 20px var(--shadow)';

// The glass control base: these selectors must all carry the glass material.
const GLASS_CONTROLS = {
  index: ['.kebab', '.footkebab', '.sfxtoggle', '.themetoggle'],
  about: ['.footkebab', '.sfxtoggle', '.themetoggle'],
};

describe('iOS-glass buttons: shared frosted-glass material', () => {
  for (const [page, css] of [['index.html', index], ['about.html', about]]) {
    const sels = page === 'index.html' ? GLASS_CONTROLS.index : GLASS_CONTROLS.about;
    for (const sel of sels) {
      it(`${page} ${sel} uses the glass material (translucent panel + hairline border + blur + shadow)`, () => {
        const r = rule(css, sel);
        expect(r, `${sel} background`).toContain(GLASS_BG);
        expect(r, `${sel} hairline border`).toContain(GLASS_BORDER);
        expect(r, `${sel} backdrop blur`).toContain(BLUR);
        expect(r, `${sel} webkit blur`).toContain(WEBKIT_BLUR);
        expect(r, `${sel} soft shadow`).toContain(SHADOW);
        expect(r, `${sel} pill/round radius`).toContain('border-radius:999px');
      });
    }
  }
});

describe('iOS-glass buttons: hover + pressed (:active) states', () => {
  // .glassclose is the reference icon button; it must have hover AND a pressed state.
  it('index.html .glassclose has hover + pressed states', () => {
    expect(index).toContain('.glassclose:hover{');
    expect(index).toContain('.glassclose:active{');
    expect(index).toContain('transform:scale(.94)');
  });

  // Explore button: hover brightens, pressed/expanded scales down + brightens more.
  it('index.html .kebab (Explore) has glass hover + pressed states', () => {
    expect(index).toContain('.kebab:hover{' + GLASS_HOVER + '}');
    expect(index).toContain(".kebab:active,.kebab[aria-expanded='true']{");
    // pressed scales down
    const pressed = index.slice(index.indexOf(".kebab:active,.kebab[aria-expanded='true']{"));
    expect(pressed.slice(0, 120)).toContain('transform:scale(.96)');
  });

  it('index.html .footkebab has glass hover + pressed states', () => {
    expect(index).toContain('.footkebab:hover{' + GLASS_HOVER + '}');
    expect(index).toContain(".footkebab:active,.footkebab[aria-expanded='true']{");
  });

  it('about.html .footkebab has glass hover + pressed states', () => {
    expect(about).toContain('.footkebab:hover{' + GLASS_HOVER + '}');
    expect(about).toContain(".footkebab:active,.footkebab[aria-expanded='true']{");
  });

  it('both pages: sfxtoggle + themetoggle have glass hover states', () => {
    for (const css of [index, about]) {
      expect(css).toContain('.sfxtoggle:hover{' + GLASS_HOVER + '}');
      expect(css).toContain('.themetoggle:hover{' + GLASS_HOVER + '}');
    }
  });
});

describe('iOS-glass buttons: menus match the glass language', () => {
  const MENU_BG = 'color-mix(in srgb,var(--panel) 80%,transparent)';
  it('index.html .kebabmenu + .footmenu are translucent glass panels', () => {
    expect(rule(index, '.kebabmenu')).toContain(MENU_BG);
    expect(rule(index, '.kebabmenu')).toContain(BLUR);
    expect(rule(index, '.footmenu')).toContain(MENU_BG);
    expect(rule(index, '.footmenu')).toContain(BLUR);
  });
  it('about.html .footmenu is a translucent glass panel', () => {
    expect(rule(about, '.footmenu')).toContain(MENU_BG);
    expect(rule(about, '.footmenu')).toContain(BLUR);
  });
});

describe('iOS-glass buttons: no flat/solid-card leftovers on the controls', () => {
  // The old look was background:var(--card)/none + border:1px solid var(--line)
  // + border-color hover. Assert the glass controls no longer use those.
  it('index.html Explore button is not background:none / border:0 anymore', () => {
    const r = rule(index, '.kebab');
    expect(r).not.toContain('background:none');
    expect(r).not.toContain('border:0');
  });
  it('index.html footer control pills no longer use the solid var(--card) fill', () => {
    for (const sel of ['.footkebab', '.sfxtoggle', '.themetoggle']) {
      expect(rule(index, sel)).not.toContain('background:var(--card)');
    }
  });
});
