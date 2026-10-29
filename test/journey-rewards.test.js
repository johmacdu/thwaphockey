// Reaching a new scene on the season path unlocks gear in My Player, kept
// forever (the path restarts each fall, the gear does not).
import { describe, it, expect } from 'vitest';
import * as A from '../lib/avatar_items.js';

describe('season path gear', () => {
  it('one item per scene after Locker Room', () => {
    const items = A.ITEMS.filter((it) => it.rule.type === 'journey').map((it) => [it.id, it.rule.n]);
    expect(items).toEqual([['tape-ice', 1], ['helmet-arena', 2], ['gloves-gold', 3]]);
  });
  it('unlocks by the furthest scene reached', () => {
    const p = { ...A.progressFrom({}, 0), journeyTier: 2 };
    expect(A.isUnlocked(A.itemById('tape-ice'), p)).toBe(true);
    expect(A.isUnlocked(A.itemById('helmet-arena'), p)).toBe(true);
    expect(A.isUnlocked(A.itemById('gloves-gold'), p)).toBe(false);
  });
  it('stays unlocked from grants after the path restarts', () => {
    const fresh = { ...A.progressFrom({}, 0), journeyTier: 0 };
    expect(A.isUnlocked(A.itemById('helmet-arena'), fresh)).toBe(false);
    expect(A.isUnlocked(A.itemById('helmet-arena'), fresh, ['helmet-arena'])).toBe(true);
  });
});
