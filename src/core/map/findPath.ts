/**
 * 将 PathFinding.js 的 A* 实现封装为项目使用的窄接口。
 *
 * 该层只处理整数网格与阻塞格，不考虑单位半径或连续移动轨迹；调用方需要把
 * 网格路径转换为世界坐标，并在实际移动时再次校验净空和线段通行性。
 */
import Pathfinding from 'pathfinding';
import type { GridMap, GridPosition } from './GridMap';

const finder = new Pathfinding.AStarFinder({
  // 允许斜向移动，但仅在相邻的两个正交格都可通行时通过格角，避免切角。
  diagonalMovement: Pathfinding.DiagonalMovement.OnlyWhenNoObstacles,
  heuristic: Pathfinding.Heuristic.octile,
});

/**
 * 查找从 `start` 到 `goal` 的 A* 网格路径。
 *
 * 成功结果包含起点和终点；任一端点不可行走或目标不可达时返回 `null`。
 * 每次调用都复制地图阻塞状态到独立网格，寻路过程不会修改 `GridMap`。
 */
export function findPath(map: GridMap, start: GridPosition, goal: GridPosition): GridPosition[] | null {
  if (!map.isWalkable(start) || !map.isWalkable(goal)) return null;

  const grid = new Pathfinding.Grid(map.width, map.height);
  for (const { x, y } of map.getBlocked()) grid.setWalkableAt(x, y, false);

  const path = finder.findPath(start.x, start.y, goal.x, goal.y, grid);
  return path.length > 0 ? path.map(([x, y]) => ({ x: x!, y: y! })) : null;
}
