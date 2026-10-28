// Phase 3 stances: a pose is joint data in avatar.js, so every catalog pose must
// render, Ready must stay the card's existing standing pose, and an unknown or
// missing pose must fall back to Ready.
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import { ITEMS } from '../lib/avatar_items.js';

const SRC = fs.readFileSync(path.join(__dirname, '..', 'avatar.js'), 'utf8');

function load() {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://thwaphockey.com/', runScripts: 'outside-only' });
  dom.window.eval(SRC);
  return dom.window.thwapAvatar;
}

describe('avatar stances', () => {
  const A = load();
  const catalogPoses = ITEMS.filter((it) => it.slot === 'pose').map((it) => it.id.slice('pose-'.length));

  it('has a stance for every pose in the catalog', () => {
    expect(catalogPoses.length).toBe(8);
    for (const p of catalogPoses) expect(A.POSES).toContain(p);
  });

  it('renders every stance, from the catalog id or the short key', () => {
    for (const p of catalogPoses) {
      const short = A.html({ pose: p, num: '72' });
      expect(short).toContain('av-upper');
      expect(A.html({ pose: 'pose-' + p, num: '72' })).toBe(short);
    }
  });

  it('keeps Ready identical to a look with no pose', () => {
    expect(A.html({ pose: 'pose-ready', num: '72' })).toBe(A.html({ num: '72' }));
  });

  it('falls back to Ready for an unknown pose', () => {
    expect(A.html({ pose: 'pose-moonwalk', num: '72' })).toBe(A.html({ num: '72' }));
  });

  it('gives each stance its own body position', () => {
    const seen = new Set(catalogPoses.map((p) => A.html({ pose: p })));
    expect(seen.size).toBe(8);
  });

  it('leans and sinks the upper body for a stance, not for Ready', () => {
    expect(A.html({ pose: 'butterfly' })).toMatch(/av-upper' style='transform:translate3d\(0,-9\.2em,0\) rotateZ\(0deg\) rotateX\(-4deg\)/);
    expect(A.html({})).toMatch(/av-upper' style='transform:translate3d\(0,-14\.6em,0\) rotateZ\(0deg\) rotateX\(0deg\)/);
  });

  it('tips Toe drag sideways, mirrored for a lefty', () => {
    expect(A.html({ pose: 'dangle' })).toContain('rotateZ(-14deg)');
    expect(A.html({ pose: 'dangle', hand: 'left' })).toContain('rotateZ(14deg)');
  });

  it('mirrors a stance for a lefty', () => {
    expect(A.html({ pose: 'shooting', hand: 'left' })).not.toBe(A.html({ pose: 'shooting', hand: 'right' }));
  });

  it('puts a puck on the puck stances only', () => {
    const puck = /background:#111111/;
    for (const p of ['stickhandling', 'dangle', 'reading', 'passing']) expect(A.html({ pose: p })).toMatch(puck);
    for (const p of ['shooting', 'power', 'butterfly']) expect(A.html({ pose: p })).not.toMatch(puck);
    expect(A.html({})).not.toMatch(puck);
  });

  it('shows the saved stance on cards through lookFor', () => {
    const w = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://thwaphockey.com/', runScripts: 'outside-only' }).window;
    w.localStorage.setItem('thwapLooks', JSON.stringify({ lewie: { pose: 'pose-shooting', jersey: 'red' } }));
    w.eval(SRC);
    const look = w.thwapAvatar.lookFor({ num: '72' }, 'Lewie');
    expect(w.thwapAvatar.html(look)).toBe(w.thwapAvatar.html({ pose: 'shooting', jersey: 'red', num: '72' }));
  });
});
