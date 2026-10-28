// test/stickers-light-mode.test.js
//
// Light mode: sticker art is white die-cut on white tiles, so earned stickers
// carry an ink outline (stacked drop-shadows) that traces their shape. Dark mode
// gets none, and locked stickers keep their own grayscale filter.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');

describe('stickers in light mode', () => {
  it('earned stickers get an ink outline, scoped to the light theme only', () => {
    const rule = /html\[data-theme='light'\] \.stickcell:not\(\.locked\) img\{filter:([^}]*)\}/.exec(html);
    expect(rule).not.toBeNull();
    expect((rule[1].match(/drop-shadow/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(rule[1]).toMatch(/rgba\(21,34,27,\.9\d?\)/);
  });
  it('locked stickers keep their grayscale treatment', () => {
    expect(html).toContain('.stickcell.locked img{filter:grayscale(1)');
  });
});
