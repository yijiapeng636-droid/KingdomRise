import { describe, expect, it } from 'vitest';
import { issueMoveCommand, stepMovement } from '../src/core/commands/movement';
import { GAME_CONFIG } from '../src/core/config/gameConfig';
import { createGameWorld } from '../src/core/ecs/world';
import { GridMap, worldPixelsToPosition } from '../src/core/map/GridMap';
import type { AvoidanceSystem } from '../src/core/simulation/AvoidanceSystem';

describe('continuous movement', () => {
  it('moves diagonally toward an unobstructed 3-4 offset', () => {
    const world = createGameWorld();
    const map = new GridMap(20, 20);

    expect(issueMoveCommand(world, map, world.leader, { x: 8, y: 9 })).toBe(true);
    stepMovement(world, map, world.leader, 0.25);

    expect(world.components.Position.x[world.leader]).toBeCloseTo(5.6);
    expect(world.components.Position.y[world.leader]).toBeCloseTo(5.8);
  });

  it('arrives at the exact fractional pointer position', () => {
    const world = createGameWorld();
    const map = new GridMap(20, 20);
    const target = { x: 8.25, y: 9.1 };

    expect(issueMoveCommand(world, map, world.leader, target)).toBe(true);
    for (let step = 0; step < 100; step += 1) stepMovement(world, map, world.leader, 0.05);

    expect(world.components.Position.x[world.leader]).toBeCloseTo(target.x);
    expect(world.components.Position.y[world.leader]).toBeCloseTo(target.y);
  });

  it('preserves a fractional pointer position during pixel conversion', () => {
    expect(worldPixelsToPosition(420, 460.8, 48)).toEqual({ x: 8.25, y: 9.1 });
  });

  it('detours around a blocked building cell', () => {
    const world = createGameWorld();
    const map = new GridMap(20, 20, [{ x: 6, y: 5 }]);

    expect(issueMoveCommand(world, map, world.leader, { x: 7, y: 5 })).toBe(true);
    expect(world.components.MoveOrder[world.leader]?.path.some(({ y }) => y !== 5)).toBe(true);
    for (let step = 0; step < 100 && world.components.MoveOrder[world.leader]; step += 1) {
      const previous = {
        x: world.components.Position.x[world.leader]!,
        y: world.components.Position.y[world.leader]!,
      };
      stepMovement(world, map, world.leader, 0.05);
      const current = {
        x: world.components.Position.x[world.leader]!,
        y: world.components.Position.y[world.leader]!,
      };
      expect(map.isSegmentWalkable(previous, current, GAME_CONFIG.unitRadius)).toBe(true);
    }

    expect(world.components.MoveOrder[world.leader]).toBeUndefined();
    expect(world.components.Position.x[world.leader]).toBeCloseTo(7);
    expect(world.components.Position.y[world.leader]).toBeCloseTo(5);
  });

  it('only accepts detour segments with enough clearance for the unit', () => {
    const world = createGameWorld();
    const map = new GridMap(6, 6, [{ x: 1, y: 1 }]);
    // 刻意从格内的非中心点出发，覆盖“A* 起始格中心不等于单位实际位置”的路径裁剪分支。
    const start = { x: 0.06417781463824213, y: 1.7572505841962993 };
    const target = { x: 3.708999209338799, y: 3.089264528825879 };
    world.components.Position.x[world.leader] = start.x;
    world.components.Position.y[world.leader] = start.y;

    expect(issueMoveCommand(world, map, world.leader, target)).toBe(true);
    const order = world.components.MoveOrder[world.leader]!;
    let anchor = start;
    for (const point of order.path) {
      expect(map.isSegmentWalkable(anchor, point, GAME_CONFIG.unitRadius)).toBe(true);
      anchor = point;
    }
  });

  it('allows an avoidance adapter to adjust movement independently', () => {
    const world = createGameWorld();
    const map = new GridMap(20, 20);
    const stopMovement: AvoidanceSystem = {
      adjustVelocity: () => ({ x: 0, y: 0 }),
    };

    issueMoveCommand(world, map, world.leader, { x: 8, y: 5 });
    stepMovement(world, map, world.leader, 0.25, stopMovement);

    expect(world.components.Position.x[world.leader]).toBe(5);
    expect(world.components.Position.y[world.leader]).toBe(5);
  });

  it('falls back to the planned velocity when avoidance would enter an obstacle', () => {
    const world = createGameWorld();
    const map = new GridMap(20, 20, [{ x: 6, y: 5 }]);
    const intoObstacle: AvoidanceSystem = {
      adjustVelocity: () => ({ x: 4, y: 0 }),
    };

    expect(issueMoveCommand(world, map, world.leader, { x: 5, y: 8 })).toBe(true);
    stepMovement(world, map, world.leader, 0.25, intoObstacle);

    expect(world.components.Position.x[world.leader]).toBe(5);
    expect(world.components.Position.y[world.leader]).toBe(6);
    expect(map.isPointWalkable({ x: 5, y: 6 }, GAME_CONFIG.unitRadius)).toBe(true);
  });
});
