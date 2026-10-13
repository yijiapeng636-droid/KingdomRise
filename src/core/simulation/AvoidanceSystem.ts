/**
 * 定义移动系统可调用的速度调整 seam。
 *
 * 当前生产实现仅原样返回期望速度，并未实现分离、群体避障或碰撞预测；该接口主要
 * 允许移动规则保持稳定，同时让测试注入可控策略。最终位移仍由 movement 模块校验。
 */
import type { EntityId } from 'bitecs';
import type { GameWorld } from '../ecs/world';

/** 二维世界坐标中的速度，单位为“格/秒”。 */
export interface Velocity {
  readonly x: number;
  readonly y: number;
}

/** 在单个固定 Tick 内为一个实体调整期望速度。 */
export interface AvoidanceSystem {
  adjustVelocity(
    world: GameWorld,
    entity: EntityId,
    desiredVelocity: Velocity,
    deltaSeconds: number,
  ): Velocity;
}

/** 不进行任何调整的直通实现，也是当前运行时默认策略。 */
export const noAvoidanceSystem: AvoidanceSystem = {
  adjustVelocity: (_world, _entity, desiredVelocity) => desiredVelocity,
};
