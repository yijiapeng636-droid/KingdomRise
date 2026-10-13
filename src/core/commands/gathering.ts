import { addComponent, hasComponent, removeComponent, type EntityId } from 'bitecs';
import { GAME_CONFIG } from '../config/gameConfig';
import type { GameWorld, GatherTaskData } from '../ecs/world';
import type { GridMap, WorldPosition } from '../map/GridMap';
import { cancelMoveCommand, issueMoveCommand } from './movement';

const EPSILON = 1e-6;

export function issueGatherCommand(
  world: GameWorld,
  map: GridMap,
  unit: EntityId,
  resource: EntityId,
  warehouse: EntityId,
): boolean {
  const { ResourceNode, Warehouse, GatherTask } = world.components;
  if ((ResourceNode.remaining[resource] ?? 0) <= EPSILON) return false;
  if ((Warehouse.stored[warehouse] ?? 0) >= (Warehouse.capacity[warehouse] ?? 0) - EPSILON) return false;

  cancelGatherCommand(world, unit);
  if (!hasComponent(world, unit, GatherTask)) addComponent(world, unit, GatherTask);

  const task: GatherTaskData = { resource, warehouse, state: 'moving-to-resource' };
  GatherTask[unit] = task;
  if (startResourceTrip(world, map, unit, task)) return true;

  task.state = 'blocked';
  return false;
}

export function cancelGatherCommand(world: GameWorld, unit: EntityId): void {
  const { GatherTask } = world.components;
  GatherTask[unit] = undefined;
  if (hasComponent(world, unit, GatherTask)) removeComponent(world, unit, GatherTask);
  cancelMoveCommand(world, unit);
}

export function stepGathering(world: GameWorld, map: GridMap, unit: EntityId, deltaSeconds: number): void {
  const { GatherTask, MoveOrder, ResourceNode, Warehouse, Carrier } = world.components;
  const task = GatherTask[unit];
  if (!task || deltaSeconds <= 0) return;

  if (Warehouse.stored[task.warehouse]! >= Warehouse.capacity[task.warehouse]! - EPSILON) {
    cancelMoveCommand(world, unit);
    task.state = 'warehouse-full';
    return;
  }

  if (task.state === 'moving-to-resource') {
    if (isInRange(world, unit, task.resource)) {
      cancelMoveCommand(world, unit);
      task.state = 'gathering';
    } else if (!MoveOrder[unit]) {
      task.state = 'blocked';
    }
    return;
  }

  if (task.state === 'gathering') {
    if (!isInRange(world, unit, task.resource)) {
      if (!startResourceTrip(world, map, unit, task)) task.state = 'blocked';
      return;
    }

    const remaining = ResourceNode.remaining[task.resource]!;
    const freeCarry = Carrier.capacity[unit]! - Carrier.amount[unit]!;
    const gathered = Math.min(GAME_CONFIG.gathering.gatherRate * deltaSeconds, remaining, freeCarry);
    ResourceNode.remaining[task.resource] = Math.max(0, remaining - gathered);
    Carrier.amount[unit]! += gathered;

    if (Carrier.amount[unit]! >= Carrier.capacity[unit]! - EPSILON || ResourceNode.remaining[task.resource]! <= EPSILON) {
      if (!startWarehouseTrip(world, map, unit, task)) task.state = 'blocked';
    }
    return;
  }

  if (task.state === 'moving-to-warehouse') {
    if (!isInRange(world, unit, task.warehouse)) {
      if (!MoveOrder[unit]) task.state = 'blocked';
      return;
    }

    cancelMoveCommand(world, unit);
    const freeStorage = Warehouse.capacity[task.warehouse]! - Warehouse.stored[task.warehouse]!;
    const delivered = Math.min(Carrier.amount[unit]!, freeStorage);
    Warehouse.stored[task.warehouse]! += delivered;
    Carrier.amount[unit]! -= delivered;

    if (Warehouse.stored[task.warehouse]! >= Warehouse.capacity[task.warehouse]! - EPSILON) {
      task.state = 'warehouse-full';
    } else if (ResourceNode.remaining[task.resource]! <= EPSILON) {
      task.state = 'resource-empty';
    } else if (!startResourceTrip(world, map, unit, task)) {
      task.state = 'blocked';
    }
  }
}

function startResourceTrip(world: GameWorld, map: GridMap, unit: EntityId, task: GatherTaskData): boolean {
  if (isInRange(world, unit, task.resource)) {
    cancelMoveCommand(world, unit);
    task.state = 'gathering';
    return true;
  }
  task.state = 'moving-to-resource';
  return moveBeside(world, map, unit, task.resource);
}

function startWarehouseTrip(world: GameWorld, map: GridMap, unit: EntityId, task: GatherTaskData): boolean {
  if (isInRange(world, unit, task.warehouse)) {
    task.state = 'moving-to-warehouse';
    return true;
  }
  task.state = 'moving-to-warehouse';
  return moveBeside(world, map, unit, task.warehouse);
}

function moveBeside(world: GameWorld, map: GridMap, unit: EntityId, target: EntityId): boolean {
  const { Position } = world.components;
  const targetPosition = { x: Position.x[target]!, y: Position.y[target]! };
  const unitPosition = { x: Position.x[unit]!, y: Position.y[unit]! };
  const candidates: WorldPosition[] = [
    { x: targetPosition.x, y: targetPosition.y - 1 },
    { x: targetPosition.x + 1, y: targetPosition.y },
    { x: targetPosition.x, y: targetPosition.y + 1 },
    { x: targetPosition.x - 1, y: targetPosition.y },
  ].sort((a, b) => distance(a, unitPosition) - distance(b, unitPosition));

  return candidates.some((candidate) => issueMoveCommand(world, map, unit, candidate, 'task'));
}

function isInRange(world: GameWorld, unit: EntityId, target: EntityId): boolean {
  const { Position } = world.components;
  return distance(
    { x: Position.x[unit]!, y: Position.y[unit]! },
    { x: Position.x[target]!, y: Position.y[target]! },
  ) <= GAME_CONFIG.gathering.interactionRange;
}

function distance(a: WorldPosition, b: WorldPosition): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
