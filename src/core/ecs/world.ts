import { addComponent, addEntity, createWorld, removeEntity, type EntityId } from 'bitecs';
import { GAME_CONFIG } from '../config/gameConfig';
import type { WorldPosition } from '../map/GridMap';

export interface MoveOrderData {
  path: WorldPosition[];
  nextIndex: number;
  source: MoveOrderSource;
}

export type MoveOrderSource = 'manual' | 'task';

export type GatherTaskState =
  | 'moving-to-resource'
  | 'gathering'
  | 'moving-to-warehouse'
  | 'warehouse-full'
  | 'resource-empty'
  | 'blocked';

export interface GatherTaskData {
  resource: EntityId;
  warehouse: EntityId;
  state: GatherTaskState;
}

export function createGameWorld() {
  const Position = { x: [] as number[], y: [] as number[] };
  const Health = { current: [] as number[], maximum: [] as number[] };
  const MoveOrder = [] as Array<MoveOrderData | undefined>;
  const ResourceNode = { remaining: [] as number[], initial: [] as number[] };
  const Warehouse = { stored: [] as number[], capacity: [] as number[] };
  const Carrier = { amount: [] as number[], capacity: [] as number[] };
  const GatherTask = [] as Array<GatherTaskData | undefined>;
  const world = createWorld({
    components: { Position, Health, MoveOrder, ResourceNode, Warehouse, Carrier, GatherTask },
    units: [] as EntityId[],
    leader: 0 as EntityId,
    worker: 0 as EntityId,
    resourceNode: 0 as EntityId,
    warehouse: 0 as EntityId,
  });

  world.leader = spawnUnit(world, 5, 5);
  world.worker = spawnUnit(world, 4, 6);

  world.resourceNode = addEntity(world);
  addComponent(world, world.resourceNode, Position);
  addComponent(world, world.resourceNode, ResourceNode);
  Position.x[world.resourceNode] = GAME_CONFIG.gathering.resourcePosition.x;
  Position.y[world.resourceNode] = GAME_CONFIG.gathering.resourcePosition.y;
  ResourceNode.remaining[world.resourceNode] = GAME_CONFIG.gathering.resourceAmount;
  ResourceNode.initial[world.resourceNode] = GAME_CONFIG.gathering.resourceAmount;

  world.warehouse = addEntity(world);
  addComponent(world, world.warehouse, Position);
  addComponent(world, world.warehouse, Warehouse);
  Position.x[world.warehouse] = GAME_CONFIG.gathering.warehousePosition.x;
  Position.y[world.warehouse] = GAME_CONFIG.gathering.warehousePosition.y;
  Warehouse.stored[world.warehouse] = 0;
  Warehouse.capacity[world.warehouse] = GAME_CONFIG.gathering.warehouseCapacity;

  return world;
}

export type GameWorld = ReturnType<typeof createGameWorld>;

export function spawnUnit(world: GameWorld, x: number, y: number): EntityId {
  const { Position, Health, Carrier } = world.components;
  const unit = addEntity(world);
  addComponent(world, unit, Position);
  addComponent(world, unit, Health);
  addComponent(world, unit, Carrier);
  Position.x[unit] = x;
  Position.y[unit] = y;
  Health.current[unit] = 100;
  Health.maximum[unit] = 100;
  Carrier.amount[unit] = 0;
  Carrier.capacity[unit] = GAME_CONFIG.gathering.carryCapacity;
  world.units.push(unit);
  return unit;
}

export function despawnUnit(world: GameWorld, unit: EntityId): boolean {
  const index = world.units.indexOf(unit);
  if (index < 0) return false;
  world.units.splice(index, 1);
  world.components.MoveOrder[unit] = undefined;
  world.components.GatherTask[unit] = undefined;
  removeEntity(world, unit);
  return true;
}

export const gameWorld = createGameWorld();
