import { describe, expect, it } from 'vitest';
import { issueMoveCommand, stepMovement } from '../src/core/commands/movement';
import { createGameWorld } from '../src/core/ecs/world';
import { GridMap } from '../src/core/map/GridMap';
import { findPath } from '../src/core/map/findPath';

describe('movement', () => {
  it('finds a four-direction path around obstacles', () => {
    const map = new GridMap(5, 3, [{ x: 2, y: 0 }, { x: 2, y: 1 }]);
    const path = findPath(map, { x: 0, y: 1 }, { x: 4, y: 1 });

    expect(path?.[0]).toEqual({ x: 0, y: 1 });
    expect(path?.at(-1)).toEqual({ x: 4, y: 1 });
    expect(path).not.toContainEqual({ x: 2, y: 1 });
  });

  it('returns no path when a wall separates the target', () => {
    const map = new GridMap(3, 3, [{ x: 1, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 2 }]);
    expect(findPath(map, { x: 0, y: 1 }, { x: 2, y: 1 })).toBeNull();
  });

  it('executes an accepted move command and becomes idle on arrival', () => {
    const world = createGameWorld();
    const map = new GridMap(7, 7);

    expect(issueMoveCommand(world, map, world.leader, { x: 4, y: 5 })).toBe(true);
    expect(world.components.MoveOrder[world.leader]?.source).toBe('manual');
    stepMovement(world, world.leader, 0.25);

    expect(world.components.Position.x[world.leader]).toBe(4);
    expect(world.components.Position.y[world.leader]).toBe(5);
    expect(world.components.MoveOrder[world.leader]).toBeUndefined();
  });
});
