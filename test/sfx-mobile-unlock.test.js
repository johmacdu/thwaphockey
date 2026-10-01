import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

/* The mobile-silence bug: iOS Safari / mobile Chrome start the AudioContext
   'suspended' and only resume it inside a trusted user gesture. These guards
   assert the unlock primer + first-tap retry that fix it stay in place. */
describe('mobile audio unlock', () => {
  it('primes the AudioContext on the first real user gesture', () => {
    // a one-time gesture listener installed in capture phase on the document
    expect(html).toMatch(/addEventListener\(ev,\s*primeOnce\s*,\s*true\)/);
    // the canonical iOS unlock: resume + a silent buffer kick
    expect(html).toMatch(/AC\.resume\(\)/);
    expect(html).toMatch(/createBuffer\(1,\s*1,\s*22050\)/);
  });

  it('listens on touch gestures, not click alone (click stays suspended on iOS)', () => {
    expect(html).toContain("'pointerdown','touchend','click','keydown'");
  });

  it('re-resumes the context when the tab becomes visible again', () => {
    // iOS re-suspends a backgrounded context
    expect(html).toMatch(/visibilitychange/);
  });

  it('retries a sound when its buffer has not decoded yet (first-tap drop fix)', () => {
    // shot() re-schedules itself briefly instead of silently returning
    expect(html).toMatch(/shot\(clip,rate,gain,0,\(_retry\|\|0\)\+1\)/);
  });
});
