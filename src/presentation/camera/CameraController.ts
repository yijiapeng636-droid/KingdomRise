/**
 * 将镜头平移、平滑缩放与世界边界约束封装在 Phaser Camera 之外。
 * 输入模块只提交屏幕位移或缩放意图，场景负责按帧调用 `update`。
 */
import type Phaser from 'phaser';
import { CAMERA_CONFIG, clampCameraZoom } from '../../core/config/cameraConfig';
import { constrainCameraScroll, zoomAroundPoint, type Point, type WorldBounds } from './cameraGeometry';

/** 维护一个 Phaser 2D Camera 的目标缩放和缩放锚点。 */
export class CameraController {
  readonly #camera: Phaser.Cameras.Scene2D.Camera;
  readonly #bounds: WorldBounds;
  #targetZoom: number = CAMERA_CONFIG.defaultZoom;
  #zoomAnchor: Point;

  constructor(camera: Phaser.Cameras.Scene2D.Camera, bounds: WorldBounds) {
    this.#camera = camera;
    this.#bounds = bounds;
    this.#zoomAnchor = this.#viewportCenter;
    camera.setZoom(CAMERA_CONFIG.defaultZoom);
  }

  /** 将滚轮纵向增量转换为以指针为锚点的缩放量。 */
  zoomFromWheel(deltaY: number, anchor: Point): void {
    this.zoomBy(-deltaY * CAMERA_CONFIG.wheelSensitivity, anchor);
  }

  /**
   * 更新目标缩放；`anchor` 使用场景输入提供的屏幕像素坐标。
   * 实际 Camera 缩放由后续 `update` 平滑逼近。
   */
  zoomBy(delta: number, anchor = this.#viewportCenter): void {
    const nextZoom = clampCameraZoom(this.#targetZoom + delta);
    if (nextZoom === this.#targetZoom) return;
    this.#targetZoom = nextZoom;
    this.#zoomAnchor = { x: anchor.x - this.#camera.x, y: anchor.y - this.#camera.y };
  }

  zoomBySteps(steps: number, anchor?: Point): void {
    this.zoomBy(steps * CAMERA_CONFIG.zoomStep, anchor);
  }

  /** 按屏幕像素平移镜头，并立即钳制到世界边界。 */
  panByScreenDelta(deltaX: number, deltaY: number): void {
    this.#camera.scrollX += deltaX / this.#camera.zoom;
    this.#camera.scrollY += deltaY / this.#camera.zoom;
    this.constrainToWorld();
  }

  /** 按帧平滑逼近目标缩放，同时保持锚点下方的世界位置稳定。 */
  update(deltaMs: number): void {
    const currentZoom = this.#camera.zoom;
    if (Math.abs(currentZoom - this.#targetZoom) < 0.0001) return;

    const amount = 1 - Math.exp(-CAMERA_CONFIG.smoothing * deltaMs / 1000);
    const nextZoom = Math.abs(currentZoom - this.#targetZoom) < 0.001
      ? this.#targetZoom
      : currentZoom + (this.#targetZoom - currentZoom) * amount;
    const scroll = zoomAroundPoint({
      viewportWidth: this.#camera.width,
      viewportHeight: this.#camera.height,
      scrollX: this.#camera.scrollX,
      scrollY: this.#camera.scrollY,
      zoom: currentZoom,
    }, nextZoom, this.#zoomAnchor);

    this.#camera.setZoom(nextZoom).setScroll(scroll.x, scroll.y);
    this.constrainToWorld();
  }

  /** 调整当前 scroll，避免可见区域越出配置的世界边界。 */
  constrainToWorld(): void {
    const scroll = constrainCameraScroll(
      { x: this.#camera.scrollX, y: this.#camera.scrollY },
      { width: this.#camera.width, height: this.#camera.height },
      this.#camera.zoom,
      this.#bounds,
    );
    this.#camera.setScroll(scroll.x, scroll.y);
  }

  get #viewportCenter(): Point {
    return {
      x: this.#camera.x + this.#camera.width / 2,
      y: this.#camera.y + this.#camera.height / 2,
    };
  }
}
