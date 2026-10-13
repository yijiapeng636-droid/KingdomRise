/**
 * 摄像机交互使用的纯几何计算，不依赖 Phaser 或 DOM，便于独立验证。
 * `scroll` 与世界边界使用世界像素，视口与锚点使用屏幕像素。
 */
export interface Point {
  x: number;
  y: number;
}

export interface CameraGeometry {
  viewportWidth: number;
  viewportHeight: number;
  scrollX: number;
  scrollY: number;
  zoom: number;
}

export interface WorldBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 计算缩放后的 scroll，使锚点前后对应同一个世界位置。
 * `anchor` 必须是相对于 Camera 视口左上角的屏幕坐标。
 */
export function zoomAroundPoint(camera: CameraGeometry, nextZoom: number, anchor: Point): Point {
  const offsetX = anchor.x - camera.viewportWidth / 2;
  const offsetY = anchor.y - camera.viewportHeight / 2;
  const worldX = camera.scrollX + camera.viewportWidth / 2 + offsetX / camera.zoom;
  const worldY = camera.scrollY + camera.viewportHeight / 2 + offsetY / camera.zoom;

  return {
    x: worldX - camera.viewportWidth / 2 - offsetX / nextZoom,
    y: worldY - camera.viewportHeight / 2 - offsetY / nextZoom,
  };
}

/**
 * 将两个轴的 Camera scroll 限制在世界边界内；若某轴可见范围大于世界，
 * 则在该轴居中显示世界，而不是允许继续平移。
 */
export function constrainCameraScroll(
  scroll: Point,
  viewport: { width: number; height: number },
  zoom: number,
  bounds: WorldBounds,
): Point {
  return {
    x: constrainAxis(scroll.x, viewport.width, zoom, bounds.x, bounds.width),
    y: constrainAxis(scroll.y, viewport.height, zoom, bounds.y, bounds.height),
  };
}

function constrainAxis(scroll: number, viewportSize: number, zoom: number, boundsStart: number, boundsSize: number): number {
  const displayedSize = viewportSize / zoom;
  if (displayedSize >= boundsSize) return boundsStart + boundsSize / 2 - viewportSize / 2;

  const minimum = boundsStart + (displayedSize - viewportSize) / 2;
  const maximum = minimum + boundsSize - displayedSize;
  return Math.min(Math.max(scroll, minimum), maximum);
}
