import { describe, expect, it } from 'vitest';
import { issueGatherCommand, stepGathering } from '../src/core/commands/gathering';
import { stepMovement } from '../src/core/commands/movement';
import { GAME_CONFIG } from '../src/core/config/gameConfig';
import { createGameWorld } from '../src/core/ecs/world';
import { GridMap } from '../src/core/map/GridMap';

const STATIC_OBSTACLES = [
  { x: 7, y: 4 }, { x: 7, y: 5 }, { x: 7, y: 6 }, { x: 7, y: 7 },
  { x: 8, y: 7 }, { x: 9, y: 7 },
];

describe('gathering', () => {
  it('gathers in range and loops through the warehouse until it is full', () => {
    const world = createGameWorld();
    const map = new GridMap(GAME_CONFIG.mapWidth, GAME_CONFIG.mapHeight, [
      ...STATIC_OBSTACLES,
      GAME_CONFIG.gathering.resourcePosition,
      GAME_CONFIG.gathering.warehousePosition,
    ]);
    const { Position, ResourceNode, Warehouse, Carrier, GatherTask } = world.components;
    let previousResource = ResourceNode.remaining[world.resourceNode]!;
    let previousStored = Warehouse.stored[world.warehouse]!;

    expect(issueGatherCommand(world, map, world.leader, world.resourceNode, world.warehouse)).toBe(true);
    expect(world.components.MoveOrder[world.leader]?.source).toBe('task');

    // 与 GameScene 保持相同的固定 Tick 顺序：先移动，随后让采集状态机观察到达结果。
    for (let tick = 0; tick < 2_000; tick += 1) {
      const deltaSeconds = 1 / GAME_CONFIG.simulationHz;
      stepMovement(world, map, world.leader, deltaSeconds);
      stepGathering(world, map, world.leader, deltaSeconds);

      const unitPosition = { x: Position.x[world.leader]!, y: Position.y[world.leader]! };
      expect(map.isPointWalkable(unitPosition, GAME_CONFIG.unitRadius)).toBe(true);

      const resourceRemaining = ResourceNode.remaining[world.resourceNode]!;
      if (resourceRemaining < previousResource) {
        expect(distance(world, world.leader, world.resourceNode)).toBeLessThanOrEqual(
          GAME_CONFIG.gathering.interactionRange,
        );
      }

      const warehouseStored = Warehouse.stored[world.warehouse]!;
      if (warehouseStored > previousStored) {
        expect(distance(world, world.leader, world.warehouse)).toBeLessThanOrEqual(
          GAME_CONFIG.gathering.interactionRange,
        );
      }

      previousResource = resourceRemaining;
      previousStored = warehouseStored;
      if (GatherTask[world.leader]?.state === 'warehouse-full') break;
    }

    expect(GatherTask[world.leader]?.state).toBe('warehouse-full');
    expect(Warehouse.stored[world.warehouse]).toBeCloseTo(GAME_CONFIG.gathering.warehouseCapacity);
    expect(ResourceNode.remaining[world.resourceNode]).toBeCloseTo(
      GAME_CONFIG.gathering.resourceAmount - GAME_CONFIG.gathering.warehouseCapacity,
    );
    expect(Carrier.amount[world.leader]).toBeCloseTo(0);
  });

  it('rejects a gather command when the warehouse is already full', () => {
    const world = createGameWorld();
    const map = new GridMap(GAME_CONFIG.mapWidth, GAME_CONFIG.mapHeight);
    world.components.Warehouse.stored[world.warehouse] = GAME_CONFIG.gathering.warehouseCapacity;

    expect(issueGatherCommand(world, map, world.leader, world.resourceNode, world.warehouse)).toBe(false);
    expect(world.components.GatherTask[world.leader]).toBeUndefined();
  });

  it('lets two units gather the same resource without exceeding shared limits', () => {
    const world = createGameWorld();
    const map = new GridMap(GAME_CONFIG.mapWidth, GAME_CONFIG.mapHeight, [
      ...STATIC_OBSTACLES,
      GAME_CONFIG.gathering.resourcePosition,
      GAME_CONFIG.gathering.warehousePosition,
    ]);
    const { Position, ResourceNode, Warehouse, GatherTask } = world.components;

    for (const unit of world.units) {
      expect(issueGatherCommand(world, map, unit, world.resourceNode, world.warehouse)).toBe(true);
    }

    // 单位按 world.units 顺序共享并修改资源与仓库，验证逐单位结算仍不会突破全局上下限。
    for (let tick = 0; tick < 2_000; tick += 1) {
      const deltaSeconds = 1 / GAME_CONFIG.simulationHz;
      for (const unit of world.units) {
        stepMovement(world, map, unit, deltaSeconds);
        stepGathering(world, map, unit, deltaSeconds);
        expect(map.isPointWalkable(
          { x: Position.x[unit]!, y: Position.y[unit]! },
          GAME_CONFIG.unitRadius,
        )).toBe(true);
      }
      if (world.units.every((unit) => GatherTask[unit]?.state === 'warehouse-full')) break;
    }

    expect(world.units).toHaveLength(2);
    expect(world.units.every((unit) => GatherTask[unit]?.state === 'warehouse-full')).toBe(true);
    expect(Warehouse.stored[world.warehouse]).toBeCloseTo(Warehouse.capacity[world.warehouse]!);
    expect(Warehouse.stored[world.warehouse]!).toBeLessThanOrEqual(Warehouse.capacity[world.warehouse]!);
    expect(ResourceNode.remaining[world.resourceNode]!).toBeGreaterThanOrEqual(0);
  });
});

function distance(world: ReturnType<typeof createGameWorld>, first: number, second: number): number {
  const { Position } = world.components;
  return Math.hypot(Position.x[first]! - Position.x[second]!, Position.y[first]! - Position.y[second]!);
}
