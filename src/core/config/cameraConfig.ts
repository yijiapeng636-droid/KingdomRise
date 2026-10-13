/**
 * 摄像机交互参数。该文件虽然位于 core/config，但只供表现层使用，
 * 不参与核心游戏规则或固定步长模拟。
 */
export const CAMERA_CONFIG = {
  minZoom: 0.75,
  maxZoom: 2,
  defaultZoom: 1,
  zoomStep: 0.1,
  wheelSensitivity: 0.001,
  smoothing: 14,
} as const;

/** 将请求的缩放值限制在摄像机配置范围内。 */
export function clampCameraZoom(zoom: number): number {
  return Math.min(Math.max(zoom, CAMERA_CONFIG.minZoom), CAMERA_CONFIG.maxZoom);
}
