export const GAME_CONFIG = {
  mapWidth: 20,
  mapHeight: 20,
  tileSize: 48,
  simulationHz: 20,
  movementSpeed: 4,
  unitRadius: 15 / 48,
  gathering: {
    resourcePosition: { x: 15, y: 5 },
    warehousePosition: { x: 2, y: 10 },
    resourceAmount: 60,
    carryCapacity: 10,
    gatherRate: 5,
    interactionRange: 1.1,
    warehouseCapacity: 30,
  },
} as const;
