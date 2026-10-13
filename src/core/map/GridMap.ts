/**
 * 提供离散网格、连续世界坐标及通行性判断。
 *
 * 整数网格坐标表示格子中心；对应世界坐标中的格子范围为
 * `[x - 0.5, x + 0.5) × [y - 0.5, y + 0.5)`。本模块拥有阻塞格状态，
 * 但不负责实体占地同步、寻路策略或 Phaser 像素坐标读取。
 */
export interface GridPosition {
  readonly x: number;
  readonly y: number;
}

export interface WorldPosition {
  readonly x: number;
  readonly y: number;
}

/** 将 Phaser 像素坐标换算为以格子中心为整数点的连续世界坐标。 */
export function worldPixelsToPosition(x: number, y: number, tileSize: number): WorldPosition {
  return { x: x / tileSize - 0.5, y: y / tileSize - 0.5 };
}

/** 保存矩形地图的尺寸与阻塞格，并提供点、线段的几何通行性判断。 */
export class GridMap {
  readonly width: number;
  readonly height: number;
  readonly #blocked = new Set<string>();

  constructor(width: number, height: number, blocked: readonly GridPosition[] = []) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new RangeError('Map dimensions must be positive integers.');
    }

    this.width = width;
    this.height = height;
    blocked.forEach((position) => this.setBlocked(position, true));
  }

  isInside({ x, y }: GridPosition): boolean {
    return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  isWalkable(position: GridPosition): boolean {
    return this.isInside(position) && !this.#blocked.has(this.#key(position));
  }

  /**
   * 将连续世界坐标归入最近的整数格中心。
   * 恰好位于两个格子边界上的点归入坐标较大的格子。
   */
  worldToGrid({ x, y }: WorldPosition): GridPosition {
    return { x: Math.floor(x + 0.5), y: Math.floor(y + 0.5) };
  }

  /**
   * 判断带可选净空半径的世界坐标是否可站立。
   * `clearance` 使用世界坐标单位，仅用于外扩阻塞格；地图外沿仍按点坐标判界。
   */
  isPointWalkable(position: WorldPosition, clearance = 0): boolean {
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return false;
    if (position.x < -0.5 || position.y < -0.5 || position.x >= this.width - 0.5 || position.y >= this.height - 0.5) {
      return false;
    }
    if (!this.isWalkable(this.worldToGrid(position))) return false;

    return this.getBlocked().every(({ x, y }) => (
      position.x < x - 0.5 - clearance
      || position.x > x + 0.5 + clearance
      || position.y < y - 0.5 - clearance
      || position.y > y + 0.5 + clearance
    ));
  }

  /**
   * 判断整条闭合线段是否保持可通行，而不只是检查两个端点。
   * 阻塞格会按 `clearance` 向四周扩张，因此可用于单位半径的保守碰撞检查。
   */
  isSegmentWalkable(start: WorldPosition, end: WorldPosition, clearance = 0): boolean {
    if (!this.isPointWalkable(start, clearance) || !this.isPointWalkable(end, clearance)) return false;

    return this.getBlocked().every(({ x, y }) => !segmentIntersectsRectangle(
      start,
      end,
      x - 0.5 - clearance,
      y - 0.5 - clearance,
      x + 0.5 + clearance,
      y + 0.5 + clearance,
    ));
  }

  /** 更新单个有效网格的阻塞状态；越界坐标会抛出 `RangeError`。 */
  setBlocked(position: GridPosition, blocked: boolean): void {
    if (!this.isInside(position)) {
      throw new RangeError(`Grid position (${position.x}, ${position.y}) is outside the map.`);
    }

    const key = this.#key(position);
    if (blocked) this.#blocked.add(key);
    else this.#blocked.delete(key);
  }

  /** 返回阻塞格快照；修改返回数组不会改变地图。 */
  getBlocked(): GridPosition[] {
    return [...this.#blocked].map((key) => {
      const [x, y] = key.split(',').map(Number);
      return { x: x!, y: y! };
    });
  }

  /** 返回可行走的四向相邻格，不包含斜向邻居。 */
  getNeighbors(position: GridPosition): GridPosition[] {
    const candidates = [
      { x: position.x, y: position.y - 1 },
      { x: position.x + 1, y: position.y },
      { x: position.x, y: position.y + 1 },
      { x: position.x - 1, y: position.y },
    ];

    return candidates.filter((candidate) => this.isWalkable(candidate));
  }

  #key({ x, y }: GridPosition): string {
    return `${x},${y}`;
  }
}

function segmentIntersectsRectangle(
  start: WorldPosition,
  end: WorldPosition,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): boolean {
  // 使用参数区间裁剪线段；`near <= far` 表示线段与闭合矩形存在公共点。
  // 将边界接触视为相交，可避免单位贴着障碍外扩边缘穿过。
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  let near = 0;
  let far = 1;

  for (const [direction, distance] of [
    [-dx, start.x - minX],
    [dx, maxX - start.x],
    [-dy, start.y - minY],
    [dy, maxY - start.y],
  ] as const) {
    if (direction === 0) {
      if (distance < 0) return false;
      continue;
    }

    const ratio = distance / direction;
    if (direction < 0) near = Math.max(near, ratio);
    else far = Math.min(far, ratio);
    if (near > far) return false;
  }

  return true;
}
