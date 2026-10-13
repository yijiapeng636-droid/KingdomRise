/**
 * 创建并推进单位移动命令。
 *
 * A* 只提供离散网格候选路径；本模块将其裁剪为带单位半径净空的连续世界坐标
 * 航点，并在每个 Tick 实际写入 Position 前再次验证移动线段。这里不负责选择状态、
 * 输入翻译或动态地图变化后的重新寻路。
 */
import { addComponent, hasComponent, removeComponent, type EntityId } from 'bitecs';
import { GAME_CONFIG } from '../config/gameConfig';
import type { GameWorld, MoveOrderSource } from '../ecs/world';
import type { GridMap, WorldPosition } from '../map/GridMap';
import { findPath } from '../map/findPath';
import { noAvoidanceSystem, type AvoidanceSystem } from '../simulation/AvoidanceSystem';

/**
 * 尝试为实体创建或替换移动命令。
 *
 * 目标不可站立或不存在满足单位净空的路径时返回 `false`，并保留原有移动命令；
 * 目标与当前位置相同时会取消原命令并返回 `true`。成功路径始终以精确目标点结束。
 */
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

/**
 * 按 `deltaSeconds`（秒）推进实体至当前航点，最多消费一个航点。
 *
 * 避让策略可以调整期望速度；若调整后的线段不可通行，会回退到原始期望速度，
 * 原始线段仍不可通行时取消命令。到达最后一个航点后移除 MoveOrder 组件。
 */
export function stepMovement(
  world: GameWorld,
  map: GridMap,
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
  const start = { x: Position.x[entity]!, y: Position.y[entity]! };
  let movement = calculateMovement(start, target, velocity, deltaSeconds);

  if (!map.isSegmentWalkable(start, movement.position, GAME_CONFIG.unitRadius)) {
    movement = calculateMovement(start, target, desiredVelocity, deltaSeconds);
    if (!map.isSegmentWalkable(start, movement.position, GAME_CONFIG.unitRadius)) {
      cancelMoveCommand(world, entity);
      return;
    }
  }

  Position.x[entity] = movement.position.x;
  Position.y[entity] = movement.position.y;
  if (movement.reachedTarget) {
    order.nextIndex += 1;
    if (order.nextIndex >= order.path.length) cancelMoveCommand(world, entity);
  }
}

/** 清除实体的移动数据和 MoveOrder 组件；实体当前 Position 保持不变。 */
export function cancelMoveCommand(world: GameWorld, entity: EntityId): void {
  const { MoveOrder } = world.components;
  MoveOrder[entity] = undefined;
  if (hasComponent(world, entity, MoveOrder)) removeComponent(world, entity, MoveOrder);
}

function findDetour(map: GridMap, start: WorldPosition, target: WorldPosition): WorldPosition[] | null {
  const gridPath = findPath(map, map.worldToGrid(start), map.worldToGrid(target));
  if (!gridPath) return null;

  // A* 返回格子中心且包含起点。单位可能位于起始格内的任意连续坐标，
  // 因此仅当两者确实重合时才删掉首节点，随后补回玩家指定的精确终点。
  const [gridStart] = gridPath;
  const candidates: WorldPosition[] = gridStart?.x === start.x && gridStart.y === start.y
    ? gridPath.slice(1)
    : gridPath;
  const last = candidates.at(-1);
  if (!last || last.x !== target.x || last.y !== target.y) candidates.push(target);

  const path: WorldPosition[] = [];
  let anchor = start;
  let index = 0;

  // 从后向前寻找当前锚点可直达的最远候选点。这样得到的实际移动轨迹通常比
  // A* 原始逐格路径更少折线，同时仍以单位半径逐段验证净空。
  while (index < candidates.length) {
    let nextIndex = -1;
    for (let probe = candidates.length - 1; probe >= index; probe -= 1) {
      if (map.isSegmentWalkable(anchor, candidates[probe]!, GAME_CONFIG.unitRadius)) {
        nextIndex = probe;
        break;
      }
    }
    if (nextIndex < 0) return null;
    anchor = candidates[nextIndex]!;
    path.push(anchor);
    index = nextIndex + 1;
  }

  return path;
}

function calculateMovement(
  start: WorldPosition,
  target: WorldPosition,
  velocity: WorldPosition,
  deltaSeconds: number,
): { position: WorldPosition; reachedTarget: boolean } {
  const position = {
    x: start.x + velocity.x * deltaSeconds,
    y: start.y + velocity.y * deltaSeconds,
  };
  // 点积不大于零表示本 Tick 已到达或越过目标所在的垂线，此时钳制到精确航点。
  const reachedTarget = (target.x - start.x) * (target.x - position.x)
    + (target.y - start.y) * (target.y - position.y) <= 0;
  return { position: reachedTarget ? target : position, reachedTarget };
}
