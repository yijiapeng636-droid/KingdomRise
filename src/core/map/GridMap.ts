export interface GridPosition {
  readonly x: number;
  readonly y: number;
}

export interface WorldPosition {
  readonly x: number;
  readonly y: number;
}

export function worldPixelsToPosition(x: number, y: number, tileSize: number): WorldPosition {
  return { x: x / tileSize - 0.5, y: y / tileSize - 0.5 };
}

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

  worldToGrid({ x, y }: WorldPosition): GridPosition {
    return { x: Math.floor(x + 0.5), y: Math.floor(y + 0.5) };
  }

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

  setBlocked(position: GridPosition, blocked: boolean): void {
    if (!this.isInside(position)) {
      throw new RangeError(`Grid position (${position.x}, ${position.y}) is outside the map.`);
    }

    const key = this.#key(position);
    if (blocked) this.#blocked.add(key);
    else this.#blocked.delete(key);
  }

  getBlocked(): GridPosition[] {
    return [...this.#blocked].map((key) => {
      const [x, y] = key.split(',').map(Number);
      return { x: x!, y: y! };
    });
  }

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
