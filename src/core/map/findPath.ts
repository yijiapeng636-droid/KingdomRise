import Pathfinding from 'pathfinding';
import type { GridMap, GridPosition } from './GridMap';

const finder = new Pathfinding.AStarFinder({
  diagonalMovement: Pathfinding.DiagonalMovement.OnlyWhenNoObstacles,
  heuristic: Pathfinding.Heuristic.octile,
});

export function findPath(map: GridMap, start: GridPosition, goal: GridPosition): GridPosition[] | null {
  if (!map.isWalkable(start) || !map.isWalkable(goal)) return null;

  const grid = new Pathfinding.Grid(map.width, map.height);
  for (const { x, y } of map.getBlocked()) grid.setWalkableAt(x, y, false);

  const path = finder.findPath(start.x, start.y, goal.x, goal.y, grid);
  return path.length > 0 ? path.map(([x, y]) => ({ x: x!, y: y! })) : null;
}
