// component-library.md: there is exactly ONE close button in the product, the
// iOS glass .glassclose. Dialogs and overlays place it with .in-dialog, header
// rows with .in-row. Guards the badge modal regression (it shipped a bare X).
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

describe('every dialog close is the glass close', () => {
  it('badge modal close is .glassclose in the dialog corner, and never hidden when embedded', () => {
    const j = read('journey.html');
    expect(j).toContain('class="glassclose in-dialog bpop-x" id="jBpClose"');
    expect(j).not.toMatch(/\.bpop-x\{/);
    expect(j).toMatch(/\.jbm \.glassclose\.in-dialog\{position:absolute/);
    expect(j).toContain('html.embed .glassclose:not(.in-dialog){display:none}');
  });
  it('index.html: every aria-label=Close button in a dialog/overlay carries .glassclose', () => {
    const h = read('index.html');
    const btns = h.match(/<button[^>]*aria-label='Close[^']*'[^>]*>/g) || [];
    // .sugg-close is an inline dismiss on a coach card, not a dialog.
    const bad = btns.filter((b) => !/glassclose/.test(b) && !/sugg-close/.test(b));
    expect(bad).toEqual([]);
    expect(h).toMatch(/\.glassclose\.in-dialog\{position:absolute;top:12px;right:12px/);
    expect(h).not.toMatch(/\.pgate-x\{|\.login-x\{/);
  });
  it('My Player and the About lightbox use it too', () => {
    expect(read('avatar.js')).toContain("class='glassclose lk-x'"); // My Player is a page: the page close
    expect(read('about.html')).toContain("class='glassclose in-dialog lb-close'");
    expect(read('avatar-lab.html')).toMatch(/\.glassclose\{/);
  });
  it('the component library documents the placement modifiers', () => {
    const d = read('docs/component-library.md');
    expect(d).toMatch(/\.glassclose\.in-dialog/);
    expect(d).toMatch(/\.glassclose\.in-row/);
    expect(d).toMatch(/Badge modal/);
    expect(d).toMatch(/My Player page: `\.lk`/);
    expect(d).toMatch(/`\.lk-sech`/);
  });
});
