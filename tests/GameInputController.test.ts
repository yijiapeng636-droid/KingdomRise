import type Phaser from 'phaser';
import { describe, expect, it, vi } from 'vitest';
import type { CameraController } from '../src/presentation/camera/CameraController';
import { GameInputController } from '../src/presentation/input/GameInputController';

type Listener = (...args: unknown[]) => void;

function createInputHarness() {
  const listeners = new Map<string, Listener>();
  const input = {
    mouse: { disableContextMenu: vi.fn() },
    on(event: string, listener: Listener) {
      listeners.set(event, listener);
      return this;
    },
    off(event: string) {
      listeners.delete(event);
      return this;
    },
  };
  return { input: input as unknown as Phaser.Input.InputPlugin, listeners };
}

describe('game input controller', () => {
  it('translates primary and secondary pointer input into scene actions', () => {
    const { input, listeners } = createInputHarness();
    const camera = { panByScreenDelta: vi.fn(), zoomFromWheel: vi.fn() } as unknown as CameraController;
    const onPrimary = vi.fn();
    const onSecondary = vi.fn();

    new GameInputController(input, camera, { onPrimary, onSecondary });
    const primary = { button: 0, x: 10, y: 20 } as Phaser.Input.Pointer;
    const secondary = { button: 2, x: 30, y: 40 } as Phaser.Input.Pointer;
    listeners.get('pointerdown')!(primary);
    listeners.get('pointerdown')!(secondary);

    expect(onPrimary).toHaveBeenCalledWith(primary);
    expect(onSecondary).toHaveBeenCalledWith(secondary);
    expect(input.mouse?.disableContextMenu).toHaveBeenCalledOnce();
  });

  it('owns middle-button panning, wheel zoom, and listener cleanup', () => {
    const { input, listeners } = createInputHarness();
    const camera = { panByScreenDelta: vi.fn(), zoomFromWheel: vi.fn() } as unknown as CameraController;
    const controller = new GameInputController(input, camera, { onPrimary: vi.fn(), onSecondary: vi.fn() });
    const middleDown = { button: 1, x: 100, y: 80 } as Phaser.Input.Pointer;
    const middleMove = { x: 90, y: 100, middleButtonDown: () => true } as Phaser.Input.Pointer;

    listeners.get('pointerdown')!(middleDown);
    listeners.get('pointermove')!(middleMove);
    listeners.get('wheel')!({ x: 320, y: 240 }, [], 0, -120);

    expect(camera.panByScreenDelta).toHaveBeenCalledWith(10, -20);
    expect(camera.zoomFromWheel).toHaveBeenCalledWith(-120, { x: 320, y: 240 });

    controller.destroy();
    expect(listeners.size).toBe(0);
  });
});
