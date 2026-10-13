import type { EntityId } from 'bitecs';
import type { GameWorld } from '../ecs/world';

export interface Velocity {
  readonly x: number;
  readonly y: number;
}

export interface AvoidanceSystem {
  adjustVelocity(
    world: GameWorld,
    entity: EntityId,
    desiredVelocity: Velocity,
    deltaSeconds: number,
  ): Velocity;
}

export const noAvoidanceSystem: AvoidanceSystem = {
  adjustVelocity: (_world, _entity, desiredVelocity) => desiredVelocity,
};
