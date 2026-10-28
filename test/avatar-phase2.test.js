// Phase 2 (docs/avatar-roadmap.md): gear tiers to 75 training days, the winter
// break item, the cage slot, the light edge, and the unlock sound.
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import { ITEMS, DEFAULT_LOOK, WINTER_BREAK, itemById, progressFrom, isUnlocked, unlockedIds, validateLook } from '../lib/avatar_items.js';

const SRC = fs.readFileSync(path.join(__dirname, '..', 'avatar.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function dayRange(from, n) {
  const out = []; const d = new Date(from + 'T00:00:00Z');
  for (let i = 0; i < n; i += 1) { out.push(new Date(d.getTime() + i * 86400000).toISOString().slice(0, 10)); }
  return out;
}

describe('gear ladder to 75 training days', () => {
  it('has helmet, cage, gloves and stick gear on the way to 75 days', () => {
    const gear = ITEMS.filter((it) => it.rule.type === 'days' && it.rule.n <= 75 && ['helmet', 'cage', 'stripe', 'gloves', 'stick'].includes(it.slot));
    const slots = new Set(gear.map((it) => it.slot));
    for (const s of ['helmet', 'cage', 'stripe', 'gloves', 'stick']) expect(slots.has(s)).toBe(true);
  });
  it('no two items share a training-day tier', () => {
    const tiers = ITEMS.filter((it) => it.rule.type === 'days').map((it) => it.rule.n);
    expect(new Set(tiers).size).toBe(tiers.length);
  });
  it('unlocks follow the day count', () => {
    const p = progressFrom({}, dayRange('2026-09-01', 40));
    expect(isUnlocked(itemById('cage-black'), p)).toBe(true);
    expect(isUnlocked(itemById('helmet-chrome'), p)).toBe(false);
  });
  it('the cage has a free default, so old looks stay valid', () => {
    expect(DEFAULT_LOOK.cage).toBe('cage-steel');
    expect(validateLook({ jersey: 'jersey-red' }, progressFrom({}, 0)).ok).toBe(true);
  });
});

describe('winter break item', () => {
  it('counts only training days inside the window', () => {
    const before = dayRange('2026-12-01', 10);
    expect(isUnlocked(itemById('jersey-pond'), progressFrom({}, before))).toBe(false);
    const inside = dayRange(WINTER_BREAK.from, WINTER_BREAK.n);
    const p = progressFrom({}, [...before, ...inside]);
    expect(p.windows['jersey-pond']).toBe(WINTER_BREAK.n);
    expect(unlockedIds(p)).toContain('jersey-pond');
  });
  it('a count-only caller never unlocks it', () => {
    expect(isUnlocked(itemById('jersey-pond'), progressFrom({}, 500))).toBe(false);
  });
});

describe('client rendering', () => {
  function load() {
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://thwaphockey.com/', runScripts: 'outside-only' });
    dom.window.fetch = () => Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    dom.window.eval(SRC);
    return dom.window;
  }
  it('draws the new gear colors', () => {
    const w = load();
    const h = w.thwapAvatar.html({ helmet: 'red', cage: 'black', gloves: 'white', stick: 'red', jersey: 'pond', num: '7' });
    expect(h).toContain('#1A1A1A');
    expect(h).toContain('#8CC8EA');
    expect(h).toContain('#EDEDED');
  });
  it('outlines the whole character with a light edge', () => {
    expect(SRC).toMatch(/\.av-wrap\{[^}]*filter:drop-shadow\(0 0 1px rgba\(255,255,255,/);
  });
  it('plays the unlock sound on New gear, and treats it as a celebration', () => {
    expect(SRC).toContain("window.thwapSfx('unlock')");
    expect(INDEX).toContain("unlock:{c:'__unlock__'}");
    expect(INDEX).toMatch(/var CELEBRATE=\{[^}]*unlock:1/);
  });
});
