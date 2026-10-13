import { describe, expect, it } from 'vitest';
import { createGameWorld, despawnUnit, spawnUnit } from '../src/core/ecs/world';

describe('game world residents', () => {
  it('spawns and removes a resident while keeping ECS data in sync', () => {
    const world = createGameWorld();
    const resident = spawnUnit(world, 3, 4);

    expect(world.units).toContain(resident);
    expect(world.components.Position.x[resident]).toBe(3);
    expect(world.components.Position.y[resident]).toBe(4);
    expect(world.components.Carrier.capacity[resident]).toBeGreaterThan(0);

    expect(despawnUnit(world, resident)).toBe(true);
    expect(world.units).not.toContain(resident);
    expect(despawnUnit(world, resident)).toBe(false);
  });
});
