// Guard: the mobile footer layout (splash/home via index.html, and about.html).
// Requested Oct 2026: on mobile the slogan "Compete. Improve. Have fun." wraps to
// TWO rows, the footer controls (sound/theme/kebab) sit on the SAME row as the
// slogan's FIRST line (top-aligned, not vertically centered, not a centered column),
// and the Thwap Hockey TM wordmark is centered BELOW. Mobile form factors only.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const files = {
  'index.html': readFileSync(resolve(__dirname, '..', 'index.html'), 'utf8'),
  'about.html': readFileSync(resolve(__dirname, '..', 'about.html'), 'utf8'),
};

for (const [name, html] of Object.entries(files)) {
  describe(`Mobile footer layout (${name})`, () => {
    it('forces the slogan to two rows via a mobile-only <br class="sl-br">', () => {
      expect(html).toContain("Compete. Improve.<br class='sl-br'> Have fun.");
      expect(html).toMatch(/\.sl-br\{display:none\}/);
      expect(html).toContain(".footer .slogan .sl-br{display:inline}");
    });

    it('top-aligns the controls to the slogan first line on mobile (flex-start), not a centered column', () => {
      const mq = html.match(/@media\(max-width:620px\)\{\.footer\{[^}]*\}/)[0];
      expect(mq).toContain('align-items:flex-start');
      expect(mq).not.toContain('flex-direction:column');
    });

    it('lets the slogan size to its content so it is not compressed to 3 lines (flex:0 0 auto)', () => {
      expect(html).toContain(".footer .slogan{flex:0 0 auto}");
      expect(html).toContain(".footer-actions{flex-shrink:0}");
    });

    it('keeps the TM wordmark in a centered .trademark block BELOW the footer row', () => {
      expect(html).toMatch(/\.trademark\{[^}]*text-align:center/);
      expect(html).toMatch(/trademark-mark[^>]*src='wordmark-tm-(light|dark)\.svg'/);
    });
  });
}
