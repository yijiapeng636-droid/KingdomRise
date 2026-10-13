import { describe, expect, it } from 'vitest';
import { issueMoveCommand, stepMovement } from '../src/core/commands/movement';
import { createGameWorld } from '../src/core/ecs/world';
import { GridMap, worldPixelsToPosition } from '../src/core/map/GridMap';
import type { AvoidanceSystem } from '../src/core/simulation/AvoidanceSystem';

describe('continuous movement', () => {
  it('moves diagonally toward an unobstructed 3-4 offset', () => {
    const world = createGameWorld();
    const map = new GridMap(20, 20);

    expect(issueMoveCommand(world, map, world.leader, { x: 8, y: 9 })).toBe(true);
    stepMovement(world, world.leader, 0.25);

    expect(world.components.Position.x[world.leader]).toBeCloseTo(5.6);
    expect(world.components.Position.y[world.leader]).toBeCloseTo(5.8);
  });

  it('arrives at the exact fractional pointer position', () => {
    const world = createGameWorld();
    const map = new GridMap(20, 20);
    const target = { x: 8.25, y: 9.1 };

    expect(issueMoveCommand(world, map, world.leader, target)).toBe(true);
    for (let step = 0; step < 100; step += 1) stepMovement(world, world.leader, 0.05);

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
    for (let step = 0; step < 100; step += 1) stepMovement(world, world.leader, 0.05);

    expect(world.components.Position.x[world.leader]).toBeCloseTo(7);
    expect(world.components.Position.y[world.leader]).toBeCloseTo(5);
  });

  it('allows an avoidance adapter to adjust movement independently', () => {
    const world = createGameWorld();
    const map = new GridMap(20, 20);
    const stopMovement: AvoidanceSystem = {
      adjustVelocity: () => ({ x: 0, y: 0 }),
    };

    issueMoveCommand(world, map, world.leader, { x: 8, y: 5 });
    stepMovement(world, world.leader, 0.25, stopMovement);

    expect(world.components.Position.x[world.leader]).toBe(5);
    expect(world.components.Position.y[world.leader]).toBe(5);
  });
});
