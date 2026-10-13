/**
 * 定义核心 ECS 世界的组件存储与实体生命周期。
 *
 * 组件数组以 bitECS 的 EntityId 作为下标；`units` 仅维护参与单位模拟的实体顺序，
 * 资源点和仓库虽然属于同一世界，但不会进入该列表。本模块只管理核心状态，
 * 不负责输入、渲染或逐 Tick 推进规则。
 */
import { addComponent, addEntity, createWorld, removeEntity, type EntityId } from 'bitecs';
import { GAME_CONFIG } from '../config/gameConfig';
import type { WorldPosition } from '../map/GridMap';

/** 单位当前持有的移动路径；路径坐标为连续世界坐标。 */
export interface MoveOrderData {
  /** 按访问顺序保存航点，`nextIndex` 指向下一待到达节点。 */
  path: WorldPosition[];
  nextIndex: number;
  source: MoveOrderSource;
}

/** `manual` 来自玩家命令，`task` 由采集状态机创建。 */
export type MoveOrderSource = 'manual' | 'task';

/** 采集任务的阶段；末尾三项表示任务仍保留，但当前无法继续流转。 */
export type GatherTaskState =
  | 'moving-to-resource'
  | 'gathering'
  | 'moving-to-warehouse'
  | 'warehouse-full'
  | 'resource-empty'
  | 'blocked';

/** 采集任务引用的资源点与仓库实体，以及当前流转阶段。 */
export interface GatherTaskData {
  resource: EntityId;
  warehouse: EntityId;
  state: GatherTaskState;
}

/**
 * 创建一套彼此独立的游戏世界和组件存储，并按当前配置生成初始实体。
 *
 * 返回的世界同时保存 ECS 组件、单位遍历顺序，以及当前单一领袖、工人、
 * 资源点和仓库的便捷引用。这些特殊引用是现阶段初始化约定，不是通用实体分类。
 */
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

/**
 * 在连续世界坐标 `(x, y)` 创建单位，并将其追加到固定 Tick 使用的遍历顺序。
 * 新单位具有 Position、Health 和 Carrier 组件；不会自动获得移动或采集任务。
 */
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

/**
 * 销毁一个由 `world.units` 管理的单位。
 *
 * 成功时先移出单位遍历列表并清除引用对象的移动、采集数据，再交由 bitECS
 * 移除实体；传入非单位或已销毁的 EntityId 时不修改世界并返回 `false`。
 */
export function despawnUnit(world: GameWorld, unit: EntityId): boolean {
  const index = world.units.indexOf(unit);
  if (index < 0) return false;
  world.units.splice(index, 1);
  world.components.MoveOrder[unit] = undefined;
  world.components.GatherTask[unit] = undefined;
  removeEntity(world, unit);
  return true;
}

/** 浏览器运行时共享的默认世界；测试可调用 `createGameWorld` 获取隔离实例。 */
export const gameWorld = createGameWorld();
