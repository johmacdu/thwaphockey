// test/countdown-plural.test.js
//
// 7. The home next-game countdown pill (and the other day/sticker counts in
//    index.html) read "1 DAY", not "1 DAYS".

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HTML = readFileSync(join(ROOT, 'index.html'), 'utf8');

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

// Run the exact pill statement from showGame() against stub elements.
function pillFor(days) {
  const m = HTML.match(/if\(cnt&&dn&&days>=0\)\{[^\n]*?cnt\.hidden=false; \}/);
  if (!m) throw new Error('pill statement not found');
  const span = { textContent: 'days' };
  const cnt = { hidden: true, querySelector: () => span };
  const dn = { textContent: '' };
  // eslint-disable-next-line no-new-func
  new Function('cnt', 'dn', 'days', m[0])(cnt, dn, days);
  return `${dn.textContent} ${span.textContent}`.trim();
}

describe('7. countdown and count labels are singular for 1', () => {
  it('next-game pill: today, 1 day, 2 days', () => {
    expect(pillFor(0)).toBe('today');
    expect(pillFor(1)).toBe('1 day');
    expect(pillFor(2)).toBe('2 days');
  });

  it('card-back discipline streak: 1 day, 3 days', () => {
    // eslint-disable-next-line no-new-func
    const disc = new Function(`${fnSource('disc')}; return disc;`)();
    expect(disc('x', 'Hands', 1, 'Drill')).toContain('> 1 day</span>');
    expect(disc('x', 'Hands', 3, 'Drill')).toContain('> 3 days</span>');
  });

  it('voice unlock and sticker milestone copy handle 1', () => {
    expect(HTML).toContain('thwapDaysToUnlock(v)===1?" day":" days"');
    expect(HTML).toContain("need===1?' sticker':' stickers'");
  });

  it('no hard-coded plural left on the pill', () => {
    expect(HTML).not.toContain("textContent=days===0?'':'days';");
  });
});
