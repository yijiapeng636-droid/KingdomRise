import { addComponent, hasComponent, removeComponent, type EntityId } from 'bitecs';
import { GAME_CONFIG } from '../config/gameConfig';
import type { GameWorld, MoveOrderSource } from '../ecs/world';
import type { GridMap, WorldPosition } from '../map/GridMap';
import { findPath } from '../map/findPath';
import { noAvoidanceSystem, type AvoidanceSystem } from '../simulation/AvoidanceSystem';

export function issueMoveCommand(
  world: GameWorld,
  map: GridMap,
  entity: EntityId,
  target: WorldPosition,
  source: MoveOrderSource = 'manual',
): boolean {
  const { Position, MoveOrder } = world.components;
  const start = { x: Position.x[entity]!, y: Position.y[entity]! };
  if (!map.isPointWalkable(target, GAME_CONFIG.unitRadius)) return false;

  if (Math.hypot(target.x - start.x, target.y - start.y) < Number.EPSILON) {
    cancelMoveCommand(world, entity);
    return true;
  }

  const path = map.isSegmentWalkable(start, target, GAME_CONFIG.unitRadius)
    ? [target]
    : findDetour(map, start, target);
  if (!path) return false;

  if (!hasComponent(world, entity, MoveOrder)) addComponent(world, entity, MoveOrder);
  MoveOrder[entity] = { path, nextIndex: 0, source };
  return true;
}

export function stepMovement(
  world: GameWorld,
  entity: EntityId,
  deltaSeconds: number,
  avoidanceSystem: AvoidanceSystem = noAvoidanceSystem,
): void {
  const { Position, MoveOrder } = world.components;
  const order = MoveOrder[entity];
  if (!order || deltaSeconds <= 0) return;

  const target = order.path[order.nextIndex];
  if (!target) {
    cancelMoveCommand(world, entity);
    return;
  }

  const dx = target.x - Position.x[entity]!;
  const dy = target.y - Position.y[entity]!;
  const remaining = Math.hypot(dx, dy);
  const desiredVelocity = {
    x: (dx / remaining) * GAME_CONFIG.movementSpeed,
    y: (dy / remaining) * GAME_CONFIG.movementSpeed,
  };
  const velocity = avoidanceSystem.adjustVelocity(world, entity, desiredVelocity, deltaSeconds);
  const nextX = Position.x[entity]! + velocity.x * deltaSeconds;
  const nextY = Position.y[entity]! + velocity.y * deltaSeconds;
  const crossedTarget = dx * (target.x - nextX) + dy * (target.y - nextY) <= 0;

  if (crossedTarget) {
    Position.x[entity] = target.x;
    Position.y[entity] = target.y;
    order.nextIndex += 1;
    if (order.nextIndex >= order.path.length) cancelMoveCommand(world, entity);
    return;
  }

  Position.x[entity] = nextX;
  Position.y[entity] = nextY;
}

export function cancelMoveCommand(world: GameWorld, entity: EntityId): void {
  const { MoveOrder } = world.components;
  MoveOrder[entity] = undefined;
  if (hasComponent(world, entity, MoveOrder)) removeComponent(world, entity, MoveOrder);
}

function findDetour(map: GridMap, start: WorldPosition, target: WorldPosition): WorldPosition[] | null {
  const gridPath = findPath(map, map.worldToGrid(start), map.worldToGrid(target));
  if (!gridPath) return null;

  const candidates: WorldPosition[] = gridPath.slice(1);
  const last = candidates.at(-1);
  if (!last || last.x !== target.x || last.y !== target.y) candidates.push(target);

  const path: WorldPosition[] = [];
  let anchor = start;
  let index = 0;

  while (index < candidates.length) {
    let nextIndex = index;
    for (let probe = candidates.length - 1; probe >= index; probe -= 1) {
      if (map.isSegmentWalkable(anchor, candidates[probe]!, GAME_CONFIG.unitRadius)) {
        nextIndex = probe;
        break;
      }
    }
    anchor = candidates[nextIndex]!;
    path.push(anchor);
    index = nextIndex + 1;
  }

  return path;
}
