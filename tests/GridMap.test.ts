import { describe, expect, it } from 'vitest';
import { GridMap } from '../src/core/map/GridMap';

describe('GridMap', () => {
  it('distinguishes map bounds and blocked cells', () => {
    const map = new GridMap(3, 2, [{ x: 1, y: 0 }]);

    expect(map.isWalkable({ x: 0, y: 0 })).toBe(true);
    expect(map.isWalkable({ x: 1, y: 0 })).toBe(false);
    expect(map.isWalkable({ x: 3, y: 0 })).toBe(false);
    expect(map.isWalkable({ x: -1, y: 0 })).toBe(false);
  });

  it('returns only walkable four-direction neighbors', () => {
    const map = new GridMap(3, 3, [{ x: 1, y: 0 }]);

    expect(map.getNeighbors({ x: 0, y: 0 })).toEqual([{ x: 0, y: 1 }]);
    expect(map.getNeighbors({ x: 1, y: 1 })).toEqual([
      { x: 2, y: 1 },
      { x: 1, y: 2 },
      { x: 0, y: 1 },
    ]);
  });

  it('rejects invalid dimensions and out-of-bounds edits', () => {
    expect(() => new GridMap(0, 2)).toThrow(RangeError);
    expect(() => new GridMap(2, 2).setBlocked({ x: 2, y: 0 }, true)).toThrow(RangeError);
  });
});
