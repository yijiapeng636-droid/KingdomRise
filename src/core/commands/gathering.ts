/**
 * 管理“前往资源点—采集—前往仓库—交付”的循环采集任务。
 *
 * 资源余量、单位携带量和仓库存量都直接写入 ECS 组件；移动阶段复用 movement
 * 模块生成来源为 `task` 的命令。本模块不处理动画、UI，也不会自动重试 blocked 状态。
 */
import { addComponent, hasComponent, removeComponent, type EntityId } from 'bitecs';
import { GAME_CONFIG } from '../config/gameConfig';
import type { GameWorld, GatherTaskData } from '../ecs/world';
import type { GridMap, WorldPosition } from '../map/GridMap';
import { cancelMoveCommand, issueMoveCommand } from './movement';

/** 浮点资源量比较容差，避免微小舍入误差阻止状态切换。 */
const EPSILON = 1e-6;

/**
 * 尝试为单位创建采集任务并立即安排首段行程。
 *
 * 资源已空或仓库已满时直接拒绝且保留单位原任务；开始安排后若没有可达的相邻格，
 * 返回 `false`，但保留状态为 `blocked` 的 GatherTask 供调用方观察。
 */
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

/** 取消采集任务，并一并取消该单位当前的移动命令。 */
export function cancelGatherCommand(world: GameWorld, unit: EntityId): void {
  const { GatherTask } = world.components;
  GatherTask[unit] = undefined;
  if (hasComponent(world, unit, GatherTask)) removeComponent(world, unit, GatherTask);
  cancelMoveCommand(world, unit);
}

/**
 * 按 `deltaSeconds`（秒）推进一个单位的采集状态机。
 *
 * 调用方应先推进同一 Tick 的移动，使到达判定能够立即触发下一阶段。资源和仓库由
 * 多单位共享，因而单位调用顺序会影响同一 Tick 内谁先取得资源或容量。
 */
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

    // 实际采集量同时受 Tick 产量、资源余量和单位剩余携带容量限制。
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
    // 只交付仓库尚能容纳的部分；未交付数量继续留在单位 Carrier 中。
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
  // 移动目标固定为设施的正交相邻格；按与单位的直线距离依次尝试，
  // 直到 movement 模块接受一条满足净空的路径。
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
