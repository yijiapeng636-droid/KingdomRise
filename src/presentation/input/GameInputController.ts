/**
 * 将 Phaser 指针事件翻译为场景动作和摄像机操作。
 *
 * 主键、次键的玩法含义交由场景决定；本模块只拥有一次中键拖动的瞬态状态，
 * 并负责注册和释放自己的 Phaser 监听器。
 */
import type Phaser from 'phaser';
import type { CameraController } from '../camera/CameraController';

/** 场景提供的主键与次键意图回调。 */
export interface GameInputActions {
  onPrimary(pointer: Phaser.Input.Pointer): void;
  onSecondary(pointer: Phaser.Input.Pointer): void;
}

/** 绑定一组 Phaser 输入事件，并把镜头手势与玩法点击分流。 */
export class GameInputController {
  readonly #input: Phaser.Input.InputPlugin;
  readonly #camera: CameraController;
  readonly #actions: GameInputActions;
  #panning = false;
  #panX = 0;
  #panY = 0;

  constructor(input: Phaser.Input.InputPlugin, camera: CameraController, actions: GameInputActions) {
    this.#input = input;
    this.#camera = camera;
    this.#actions = actions;
    input.mouse?.disableContextMenu();
    input.on('pointerdown', this.#onPointerDown);
    input.on('pointermove', this.#onPointerMove);
    input.on('pointerup', this.#onPointerUp);
    input.on('wheel', this.#onWheel);
  }

  /** 移除构造时注册的全部监听器；场景关闭时必须调用。 */
  destroy(): void {
    this.#input.off('pointerdown', this.#onPointerDown);
    this.#input.off('pointermove', this.#onPointerMove);
    this.#input.off('pointerup', this.#onPointerUp);
    this.#input.off('wheel', this.#onWheel);
  }

  readonly #onPointerDown = (pointer: Phaser.Input.Pointer): void => {
    if (pointer.button === 1) {
      this.#panning = true;
      this.#panX = pointer.x;
      this.#panY = pointer.y;
    } else if (pointer.button === 0) {
      this.#actions.onPrimary(pointer);
    } else if (pointer.button === 2) {
      this.#actions.onSecondary(pointer);
    }
  };

  readonly #onPointerMove = (pointer: Phaser.Input.Pointer): void => {
    if (!this.#panning || !pointer.middleButtonDown()) return;
    this.#camera.panByScreenDelta(this.#panX - pointer.x, this.#panY - pointer.y);
    this.#panX = pointer.x;
    this.#panY = pointer.y;
  };

  readonly #onPointerUp = (pointer: Phaser.Input.Pointer): void => {
    if (pointer.button === 1) this.#panning = false;
  };

  readonly #onWheel = (pointer: Phaser.Input.Pointer, _objects: unknown[], _dx: number, dy: number): void => {
    this.#camera.zoomFromWheel(dy, { x: pointer.x, y: pointer.y });
  };
}
